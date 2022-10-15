// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.5.8 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";
import "./ExpiryHelper.sol";

import "./AddrArrayLib.sol";
import "./StringUtils.sol";

// Import OpenZeppelin Contracts libraries where needed
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract LAZYTokenCreator {
	function burn(address token, uint32 amount) external returns (int responseCode) {}
}

contract MinterContract is ExpiryHelper, Ownable {
	using EnumerableSet for EnumerableSet.AddressSet;
	using EnumerableMap for EnumerableMap.AddressToUintMap;
	using EnumerableMap for EnumerableMap.UintToUintMap;

	// list of WL addresses
    EnumerableSet.AddressSet private _whitelistedAddresses;
	LAZYTokenCreator private _lazySCT;
	address private _lazyToken;
	string private _cid;
	string[] private _metadata;
	// map address to timestamps
	EnumerableMap.AddressToUintMap private _walletMintTimeMap;
	// map serials to timestamps
	EnumerableMap.UintToUintMap private _serialMintTimeMap;
	// map WL serials to tyhe numbers of mints used
	EnumerableMap.UintToUintMap private _wlSerialsToNumMintedMap;

	address private _token;
	uint private _lastMintTime;
	uint private _mintStartTime;
	bool private _mintPaused;
	bool private _lazyFromContract;
	// in tinybar
	uint private _mintPriceHbar;
	// adjusted for decimal 1
	uint private _mintPriceLazy;
	uint private _lazyBurnPerc;
	uint private _wlDiscount;
	uint private _maxMint;
	uint private _cooldownPeriod;

	event MinterContractMessage(
		string evtType,
		address indexed msgAddress,
		uint msgNumeric,
		string msgText
	);

	/// @param lsct the address of the Lazy Smart Contract Treasury (for burn)
	constructor(
		address lsct, 
		address lazy,
		uint256 lazyBurnPerc
	) {
		_lazySCT = LAZYTokenCreator(lsct);
		_lazyToken = lazy;

		tokenAssociate(_lazyToken);

		_mintPaused = true;
		_lazyFromContract = false;
		_wlDiscount = 0;
		_mintPriceHbar = 0;
		_mintPriceLazy = 0;
		_lastMintTime = 0;
		_mintStartTime = 0;
		_maxMint = 0;
		_cooldownPeriod = 0;
		_lazyBurnPerc = lazyBurnPerc;
	}

	// Supply the contract with token details and metadata
	// Once basic integrity checks are done the token will mint and the address will be returned
	/// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
	/// @param maxSupply Set to 0 for an infinite token, set > 0 to enforce capped suply @ maxSupply
    /// @return createdTokenAddress the address of the new token
	function initialiseNFTMint (
		string memory name,
        string memory symbol,
        string memory memo,
        int64 maxSupply,
		string memory cid,
		string[] memory metadata
	)
		external
		payable
		onlyOwner
	returns (address createdTokenAddress) {
		require(StringUtils.strlen(memo) <= 100, "Memo max 100 char");
		require(maxSupply > 0, "maxSupply cannot be 0");
		require(maxSupply == SafeCast.toInt64(SafeCast.toInt256(metadata.length)), "Supply metadata = maxSupply");

		_cid = cid;

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

	// function to asses the cost to mint for a user
	// currently flat cost, eventually dynamic on holdings
	/// @return hbarCost
	/// @return lazyCost
    function getCost() public view returns (uint hbarCost, uint lazyCost) {
    	hbarCost = _mintPriceHbar;
		lazyCost = _mintPriceLazy;
    }

	/// Use HTS to transfer FT
    /// @param token The token to transfer to/from
    /// @param receiver The receiver of the transaction
    /// @param amount Non-negative value to send. a negative value will result in a failure.
    function transferHTS(
        address token,
        address receiver,
        int64 amount
    )
		external
		onlyOwner 
	returns (int responseCode) {
        responseCode = HederaTokenService.transferToken(
            token,
            address(this),
            receiver,
            amount
        );

		require(amount > 0, "Positive transfers only");

        emit MinterContractMessage(
            "Transfer Lazy",
            receiver,
            uint256(uint64(amount)),
            "completed"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("transferHTS - failed");
        }
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

	// Add an address to the allowance WL
    /// @param newAddress the newss address to add
	/// @return result a boolean showing if the address was added (or was already present)
    function addToWhitelist(address newAddress) external onlyOwner returns(bool result) {
        result = _whitelistedAddresses.add(newAddress);
        emit MinterContractMessage(
			"ADD WL", 
            newAddress,
            result ? 1 : 0,
            "WL updated"
        );
    }

	// Remove an address to the allowance WL
    /// @param oldAddress the address to remove
	/// @return result if the address was removed or it was not present
    function removeFromWhitelist(address oldAddress) external onlyOwner returns(bool result) {
        result = _whitelistedAddresses.remove(oldAddress);
        emit MinterContractMessage(
			"REMOVE WL", 
            oldAddress,
            result ? 1 : 0,
            "WL updated"
        );
    }

	/// @param hbarCost in *tinybar*
	/// @param lazyCost adjusted for the decimal of 1. 
	function updateCost(uint256 hbarCost, uint256 lazyCost) external onlyOwner {
		require(hbarCost >= 0 && lazyCost >= 0, "No negatives please!");
		if (_mintPriceHbar != hbarCost) {
			_mintPriceHbar = hbarCost;
			emit MinterContractMessage("Hbar mint px", msg.sender, _mintPriceHbar, "Updated");
		}

		if (_mintPriceLazy != lazyCost) {
			_mintPriceLazy = lazyCost;
			emit MinterContractMessage("Lazy mint px", msg.sender, _mintPriceLazy, "Updated");
		}
	}

	/// @param mintPaused boolean to pause (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updatePauseStatus(bool mintPaused) external onlyOwner returns (bool changed) {
		changed = _mintPaused == mintPaused ? false : true;
		_mintPaused = mintPaused;
	}

	
	/// @param lazyFromContract boolean to pay (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updateContractPaysLazy(bool lazyFromContract) external onlyOwner returns (bool changed) {
		changed = _lazyFromContract == lazyFromContract ? false : true;
		_lazyFromContract = lazyFromContract;
	}

	/// @param startTime new start time in seconds
    function updateMintStartTime(uint256 startTime) external onlyOwner {
        _mintStartTime = startTime;
       emit MinterContractMessage("Mint Start", msg.sender, _mintStartTime, "Updated");
    }

	/// @param lbp new Lazy SC Treasury address
    function updateLazyBurnPercentage(uint256 lbp) external onlyOwner {
        _lazyBurnPerc = lbp;
       emit MinterContractMessage("Lazy Burn %", msg.sender, _lazyBurnPerc, "Updated");
    }

	/// @param maxMint new max mint (0 = uncapped)
    function updateMaxMint(uint256 maxMint) external onlyOwner {
        _maxMint = maxMint;
       emit MinterContractMessage("Max Mint", msg.sender, _maxMint, "Updated");
    }

	/// @param cooldownPeriod cooldown period as seconds
    function updateCooldown(uint256 cooldownPeriod) external onlyOwner {
        _cooldownPeriod = cooldownPeriod;
       emit MinterContractMessage("Cooldown", msg.sender, _cooldownPeriod, "Updated");
    }

	/// @param lsct new Lazy SC Treasury address
    function updateLSCT(address lsct) external onlyOwner {
        _lazySCT = LAZYTokenCreator(lsct);
       emit MinterContractMessage("Lazy SCT", address(_lazySCT), 0, "Updated");
    }

	/// @return lsct the address set for the current lazy SC Treasury
    function getLSCT() external view returns (address lsct) {
    	lsct = address(_lazySCT);
    }

	/// @param lazy new Lazy FT address
    function updateLazyToken(address lazy) external onlyOwner {
        _lazyToken = lazy;
       emit MinterContractMessage("Lazy Token", _lazyToken, 0, "Updated");
    }

	/// @param cid new cid
    function updateCID(string memory cid) external onlyOwner {
        _cid = cid;
       emit MinterContractMessage("CID", msg.sender, 0, "Updated");
    }

	/// @param metadata new metadata array
    function updateMetadataArray(string[] memory metadata) external onlyOwner {
		// enforce consistency of the metadata list
		require(metadata.length == _metadata.length, "New metadata wrong shape");
        _metadata = metadata;
       emit MinterContractMessage("Metadata", msg.sender, _metadata.length, "Updated");
    }

	/// @return metadataList of metadata unminted -> only owner
    function getMetadataArray() external view onlyOwner 
		returns (string[] memory metadataList) {
        metadataList = _metadata;
    }

	/// @return lazy the address set for Lazy FT token
    function getLazyToken() external view returns (address lazy) {
    	lazy = _lazyToken;
    }

	/// @return paused boolean indicating whether mint is paused
    function getMintPaused() external view returns (bool paused) {
    	paused = _mintPaused;
    }

	/// @return payFromSC boolean indicating whether any Lazy payment is expect to be prefunded
    function getPayLazyFromSC() external view returns (bool payFromSC) {
    	payFromSC = _lazyFromContract;
    }

	/// @return priceHbar base Hbar price for mint
    function getBasePriceHbar() external view returns (uint priceHbar) {
    	priceHbar = _mintPriceHbar;
    }
	
	/// @return priceLazy base Lazy price for mint
    function getBasePriceLazy() external view returns (uint priceLazy) {
    	priceLazy = _mintPriceLazy;
    }
	
	/// @return wlDiscount the address set for Lazy FT token
    function getWLDiscount() external view returns (uint wlDiscount) {
    	wlDiscount = _wlDiscount;
    }
	
	/// @return lastMintTime the address set for Lazy FT token
    function getLastMint() external view returns (uint lastMintTime) {
    	lastMintTime = _lastMintTime;
    }
	
	/// @return mintStartTime the address set for Lazy FT token
    function getMintStartTime() external view returns (uint mintStartTime) {
    	mintStartTime = _mintStartTime;
    }

	/// @return maxMint 0 implies no cap to minting
    function getMaxMint() external view returns (uint maxMint) {
    	maxMint = _maxMint;
    }

	/// @return cooldownPeriod 0 implies no cooldown
    function getCooldownPeriod() external view returns (uint cooldownPeriod) {
    	cooldownPeriod = _cooldownPeriod;
    }

	/// @return lazyBurn percentage of lazy to brun each interaction
    function getLazyBurnPercentage() external view returns (uint lazyBurn) {
    	lazyBurn = _lazyBurnPerc;
    }

	/// Check the current Whitelist for minting
    /// @return wl an array of addresses currently enabled for allownace approval
    function getAllowanceWhitelist()
        external
        view
        returns (address[] memory wl)
    {
        return _whitelistedAddresses.values();
    }

    // Check if the address is in the WL
    /// @param addressToCheck the address to check in WL
    /// @return bool if in the WL
    function isAddressWL(address addressToCheck) external view returns (bool) {
        return _whitelistedAddresses.contains(addressToCheck);
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