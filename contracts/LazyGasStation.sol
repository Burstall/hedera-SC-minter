// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import { HederaResponseCodes } from "./HederaResponseCodes.sol";
import { HederaTokenService } from "./HederaTokenService.sol";

import { ILazyGasStation } from "./interfaces/ILazyGasStation.sol";
import { IRoles } from "./interfaces/IRoles.sol";
import { IBurnableHTS } from "./interfaces/IBurnableHTS.sol";

contract LazyGasStation is HederaTokenService, ILazyGasStation, IRoles, ReentrancyGuard {
	using SafeCast for uint256;
	using SafeCast for int256;
	using EnumerableSet for EnumerableSet.AddressSet;
	using Address for address;

	enum PaymentType {
		Hbar,
		Lazy
	}

	event GasStationRefillEvent(
		address indexed _callingContract,
		uint256 _amount,
		PaymentType _type
	);

	event GasStationFunding(
		address indexed _callingContract,
		address indexed _user,
		uint256 _amount,
		uint256 _burnPercentage,
		bool _fromUser
	);

	event GasStationAccessControlEvent(
		address indexed _executor,
		address indexed _address,
		bool _added,
		Role _role
	);

	event GasStationStatus (
		string message,
		address sender,
		uint256 value
	);

	EnumerableSet.AddressSet private admins;
	EnumerableSet.AddressSet private authorizers;
	EnumerableSet.AddressSet private contractUsers;

	address public lazyToken;
	address public lazySCT;

	error AssociationFailed();
	error Empty(uint256 _required, uint256 _available);
	error BadInput();
	error PayoutFailed();
	error NetPayoutFailed();
	error BurnFailed();
	error LastAdmin();
	error InsufficientAllowance();
	error ToLGSTransferFailed();

	constructor(
		address _lazyToken,
		address _lazySCT
	) {
		lazyToken = _lazyToken;
		lazySCT = _lazySCT;

		int256 response = HederaTokenService.associateToken(
			address(this),
			lazyToken
		);

		if (response != HederaResponseCodes.SUCCESS) {
			revert AssociationFailed();
		}

		admins.add(msg.sender);
	}

	modifier onlyAdmin() {
		if(!admins.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.Admin);
		_;
	}

	modifier onlyAuthorizer() {
		if(!authorizers.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.GasStationAuthorizer);
		_;
	}

	modifier onlyContractUser() {
		if(!contractUsers.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.GasStationContractUser);
		_;
	}

	modifier onlyAdminOrAuthorizer() {
		if(!(admins.contains(msg.sender) || authorizers.contains(msg.sender)))
			revert PermissionDenied(msg.sender, Role.AdminOrCreator);
		_;
	}

	/// @notice Refill the calling contract with Lazy tokens
	/// @param _amount The amount of Lazy tokens to refill
	function refillLazy(
		uint256 _amount
	) external onlyContractUser nonReentrant {
		if (IERC20(lazyToken).balanceOf(address(this)) < _amount) {
			revert Empty(_amount, IERC20(lazyToken).balanceOf(address(this)));
		}
		if (_amount == 0) {
			revert BadInput();
		}

		bool result = IERC20(lazyToken).transfer(msg.sender, _amount);
		if (!result) {
			revert PayoutFailed();
		}

		emit GasStationRefillEvent(msg.sender, _amount, PaymentType.Lazy);
	}

	/// @notice Refill the calling contract with Hbar
	/// @param _amount The amount of Hbar to refill
	function refillHbar(
		uint256 _amount
	) external onlyContractUser nonReentrant {
		// check the contract has enough hbar
		if (address(this).balance < _amount) {
			revert Empty(_amount, address(this).balance);
		}
		if (_amount == 0) {
			revert BadInput();
		}

		Address.sendValue(payable(msg.sender), _amount);

		emit GasStationRefillEvent(msg.sender, _amount, PaymentType.Hbar);
	}

	/// @notice Pay out Lazy tokens to a user
	/// @param _user The address of the user to pay out to
	/// @param _amount The amount of Lazy tokens to pay out
	/// @param _burnPercentage The percentage of the payout to burn
	function payoutLazy(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage
	) external onlyContractUser nonReentrant returns (uint256 _payoutAmount) {
		if (_amount == 0 || _burnPercentage > 100) {
			revert BadInput();
		}		
		else if (IERC20(lazyToken).balanceOf(address(this)) < _amount) {
			revert Empty(_amount, IERC20(lazyToken).balanceOf(address(this)));
		}

		uint256 burnAmt = (_amount * _burnPercentage) / 100;

		bool result;
		if (burnAmt > 0) {
			int256 responseCode = IBurnableHTS(lazySCT).burn(
				lazyToken,
				burnAmt.toUint32()
			);

			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert BurnFailed();
			}

			// pay out the remainder to the user
			uint256 remainder = _amount - burnAmt;
			if (remainder > 0) {
				result = IERC20(lazyToken).transfer(
					_user,
					remainder
				);
				if (!result) {
					revert NetPayoutFailed();
				}
			}
			_payoutAmount = remainder;
		}
		else {
			result = IERC20(lazyToken).transfer(
				_user,
				_amount
			);
			if (!result) {
				revert PayoutFailed();
			}
			_payoutAmount = _amount;
		}

		emit GasStationFunding(msg.sender, _user, _amount, _burnPercentage, false);
	}

	/// @notice Take Lazy tokens from a user to centralize the allowances
	/// @param _user The address of the user to pay out to
	/// @param _amount The amount of Lazy tokens to pay out
	/// @param _burnPercentage The percentage of the payout to burn
	function drawLazyFrom(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage
	) external onlyContractUser {
		drawLazyFromPayTo(_user, _amount, _burnPercentage, address(this));
	}

	/// @notice Take Lazy tokens from a user to centralize the allowances and pay out to a nominated address
	/// @param _user The address of the user to pay out to
	/// @param _amount The amount of Lazy tokens to pay out
	/// @param _burnPercentage The percentage of the payout to burn
	/// @param _payTo The address to pay out to
	function drawLazyFromPayTo(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage,
		address _payTo
	) public onlyContractUser nonReentrant {
		if (IERC20(lazyToken).allowance(_user, address(this)) < _amount) {
			revert InsufficientAllowance();
		}
		else if (_amount == 0 || _burnPercentage > 100 || _payTo == address(0)) {
			revert BadInput();
		}

		uint256 burnAmt = (_amount * _burnPercentage) / 100;

		// If there is any to burn will need to transfer to this contract first then send balanmce on
		bool result;
		if (burnAmt > 0) {
			result = IERC20(lazyToken).transferFrom(
				_user,
				address(this),
				_amount
			);
			if (!result) {
				revert ToLGSTransferFailed();
			}
			int256 responseCode = IBurnableHTS(lazySCT).burn(
                lazyToken,
                burnAmt.toUint32()
            );

            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert BurnFailed();
            }

			// send the remainder to nominated address
			uint256 remainder = _amount - burnAmt;
			if (remainder > 0 && _payTo != address(this)) {
				result = IERC20(lazyToken).transferFrom(
					address(this),
					_payTo,
					remainder
				);
				if (!result) {
					revert NetPayoutFailed();
				}
			}
		}
		else {
			result = IERC20(lazyToken).transferFrom(
				_user,
				_payTo,
				_amount
			);
			if (!result) {
				revert PayoutFailed();
			}
		}

		emit GasStationFunding(msg.sender, _user, _amount, _burnPercentage, true);
	}

	/// @notice Add an Admin user to the Gas Station
	/// @param _admin The address of the user to pay out to
	function addAdmin(
		address _admin
	) external onlyAdmin returns (bool _added){
		emit GasStationAccessControlEvent(msg.sender, _admin, true, Role.Admin);
		return admins.add(_admin);
	}

	/// @notice Remove an Admin user from the Gas Station
	/// @param _admin The address of the user to pay out to
	function removeAdmin(
		address _admin
	) external onlyAdmin returns (bool _removed){
		if (admins.length() == 1) {
			revert LastAdmin();
		}
		emit GasStationAccessControlEvent(msg.sender, _admin, false, Role.Admin);
		return admins.remove(_admin);
	}

	/// @notice Add an Authorizer user to the Gas Station
	/// @param _authorized A contract authorized to add other contracts
	function addAuthorizer(
		address _authorized
	) external onlyAdmin returns (bool _added){
		emit GasStationAccessControlEvent(msg.sender, _authorized, true, Role.GasStationAuthorizer);
		return authorizers.add(_authorized);
	}

	/// @notice Remove an Authorizer user from the Gas Station
	/// @param _authorized A contract authorized to add other contracts
	function removeAuthorizer(
		address _authorized
	) external onlyAdmin returns (bool _removed){
		emit GasStationAccessControlEvent(msg.sender, _authorized, false, Role.GasStationAuthorizer);
		return authorizers.remove(_authorized);
	}

	/// @notice Add a contract user (who can call for refills) to the Gas Station
	/// @param _deployer contract user to add
	function addContractUser(
		address _deployer
	) external onlyAdminOrAuthorizer returns (bool _added){
		if (_deployer == address(0) || !_deployer.isContract()) {
			revert BadInput();
		}
		emit GasStationAccessControlEvent(msg.sender, _deployer, true, Role.GasStationContractUser);
		return contractUsers.add(_deployer);
	}

	/// @notice Remove a contract user (who can call for refills) from the Gas Station
	/// @param _deployer contract user to remove
	function removeContractUser(
		address _deployer
	) external onlyAdminOrAuthorizer returns (bool _removed){
		emit GasStationAccessControlEvent(msg.sender, _deployer, false, Role.GasStationContractUser);
		return contractUsers.remove(_deployer);
	}

	/// @notice Get the list of Admins
	function getAdmins() external view returns (address[] memory _admins) {
		return admins.values();
	}

	/// @notice Get the list of Authorizers
	function getAuthorizers() external view returns (address[] memory _authorizers) {
		return authorizers.values();
	}

	/// @notice Get the list of Contract Users
	function getContractUsers() external view returns (address[] memory _contractUsers) {
		return contractUsers.values();
	}

	/// @notice Check if an address is an Admin
	function isAdmin(address _admin) external view returns (bool _isAdmin) {
		return admins.contains(_admin);
	}

	/// @notice Check if an address is an Authorizer
	function isAuthorizer(address _authorizer) external view returns (bool _isAuthorizer) {
		return authorizers.contains(_authorizer);
	}

	/// @notice Check if an address is a Contract User
	function isContractUser(address _contractUser) external view returns (bool _isContractUser) {
		return contractUsers.contains(_contractUser);
	}

	/// @notice Transfer Hbar from the contract to a receiver
	/// @param receiverAddress The address to send the Hbar to
	/// @param amount The amount of Hbar to send
    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyAdmin()
    {
		if (receiverAddress == address(0) || amount == 0) {
			revert BadInput();
		}
		Address.sendValue(receiverAddress, amount);
    }

	/// @notice Retrieve Lazy tokens from the contract
	/// @param _receiver The address to send the Lazy tokens to
	/// @param _amount The amount of Lazy tokens to send
	function retrieveLazy(
		address _receiver,
		uint256 _amount
	) external onlyAdmin() {
		if (_receiver == address(0) || _amount == 0) {
			revert BadInput();
		}

		IERC20(lazyToken).transfer(_receiver, _amount);
	}

	 // allows the contract top recieve HBAR
    receive() external payable {
        emit GasStationStatus(
            "Receive",
            msg.sender,
            msg.value
        );
    }

    fallback() external payable {
        emit GasStationStatus(
            "Fallback",
            msg.sender,
            msg.value
        );
    }
}