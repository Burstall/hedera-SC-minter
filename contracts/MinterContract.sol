// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.5.8 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";
import "./ExpiryHelper.sol";

import "./AddrArrayLib.sol";

// Import Ownable from the OpenZeppelin Contracts library
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract LAZYTokenCreator {
	function burn(address token, uint32 amount) external returns (int responseCode) {}
}

contract MinterContract is ExpiryHelper, Ownable {
	using AddrArrayLib for AddrArrayLib.Addresses;

	// list of WL addresses
    AddrArrayLib.Addresses private _whitelistedAddresses;
	LAZYTokenCreator private _lazySCT;
	address private _lazyToken;
	string private _cid;
	string[] private _metadata;
	mapping (address => uint) private _walletMintTimeMap;

	address public _token;
	uint public _lastMintTime;
	uint public _mintStartTime;
	bool public _mintPaused;
	uint public _mintPriceHbar;
	uint public _mintPriceLazy;

	event MinterContractMessage(
		string evtType,
		address indexed msgAddress,
		uint msgNumeric,
		string msgText
	);

	/// @param lsct the address of the Lazy Smart Contract Treasury (for burn)
	constructor(
		address lsct, 
		address lazy
	) {
		_lazySCT = LAZYTokenCreator(lsct);
		_lazyToken = lazy;

		tokenAssociate(_lazyToken);

		_mintPaused = true;
	}

	// Supply the contract with token details and metadata
	// Once basic integrity checks are done the token will mint and the address will be returned
	/// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
    /// @param initialSupply number of tokens to mint
    /// @param decimals decimal for the token -> 100 of the token divisible to 1dp will be 1000 supply with decimal 1
    /// @param maxSupply Set to 0 for an infinite token, set > 0 to enforce capped suply @ maxSupply
    /// @return createdTokenAddress the address of the new token
	function initialiseMint (
		string memory name,
        string memory symbol,
        string memory memo,
        uint64 initialSupply,
        uint32 decimals,
        int64 maxSupply,
		string memory cid,
		string[] memory metadata
	)
		external
		payable
		onlyOwner
	returns (address createdTokenAddress) {
		require(maxSupply > 0, "maxSupply cannot be 0");
		require(maxSupply == SafeCast.toInt64(SafeCast.toInt256(metadata.length)), "Supply metadata = maxSupply");

		// instantiate the list of keys we'll use for token create
        IHederaTokenService.TokenKey[]
            memory keys = new IHederaTokenService.TokenKey[](1);

        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));

		IHederaTokenService.HederaToken memory token;
		token.name = name;
        token.symbol = symbol;
        token.memo = memo;
        token.treasury = address(this);
        token.tokenKeys = keys;
		token.tokenSupplyType = true;
        token.maxSupply = maxSupply;
		// create the expiry schedule for the token using ExpiryHelper
        token.expiry = createAutoRenewExpiry(
            address(this),
            HederaTokenService.defaultAutoRenewPeriod
        );

		(int responseCode, address tokenAddress) = HederaTokenService.createNonFungibleToken(token);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert ("Failed to mint Token");
        }

		_token = tokenAddress;
		createdTokenAddress = _token;
	}


	// Transfer hbar oput of the contract - using secure ether transfer pattern
    // on top of onlyOwner as max gas of 2300 (not adjustable) will limit re-entrrant attacks
    // also throws error on failure causing contract to auutomatically revert
    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in long form adjusted for decimal)
    function transferHbar(address payable receiverAddress, uint amount)
        external
        onlyOwner
    {
        // throws error on failure
        receiverAddress.transfer(amount);

        emit MinterContractMessage(
            "Hbar Transfer",
            receiverAddress,
            amount,
            "complete"
        );
    }

	 // Call to associate a new token to the contract
    /// @param tokenId EVM token to associate
    function tokenAssociate(address tokenId) internal {
        int256 response = HederaTokenService.associateToken(
            address(this),
            tokenId
        );

        emit MinterContractMessage("TokenAssociate", tokenId, 0, "Associated");

        if (response != HederaResponseCodes.SUCCESS) {
            revert("Associate Failed");
        }
    }

	receive() external payable {
        emit MinterContractMessage(
            "Receive",
            msg.sender,
			msg.value,
            "Hbar Received by Contract"
        );
    }

    fallback() external payable {
        emit MinterContractMessage("Fallback", msg.sender, msg.value, "Fallback Called");
    }

}