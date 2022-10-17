// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";
import "./ExpiryHelper.sol";

import "./AddrArrayLib.sol";

// Import OpenZeppelin Contracts libraries where needed
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

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
	uint private _lazyBurnPerc;
	string private _cid;
	string[] private _metadata;
	// map address to timestamps
	EnumerableMap.AddressToUintMap private _walletMintTimeMap;
	// map serials to timestamps
	EnumerableMap.UintToUintMap private _serialMintTimeMap;
	// map WL serials to tyhe numbers of mints used
	EnumerableMap.UintToUintMap private _wlSerialsToNumMintedMap;

	struct MintTiming {
		uint lastMintTime;
		uint mintStartTime;
		bool mintPaused;
		uint cooldownPeriod;
		uint refundWindow;
	}

	struct MintEconomics {
		bool lazyFromContract;
		// in tinybar
		uint mintPriceHbar;
		// adjusted for decimal 1
		uint mintPriceLazy;
		uint wlDiscount;
		uint maxMint;
	}

	// to avoid serialisation related default causing odd behaviour
	// implementing custom object as a wrapper
	struct NFTFeeObject {
		uint32 numerator;
		uint32 denominator;
		uint32 fallbackfee;
		address account;
	}

	MintTiming private _mintTiming;
	MintEconomics private _mintEconomics;

	address private _token;
	
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

		_mintEconomics = MintEconomics(false, 0, 0, 0, 20);
		_mintTiming= MintTiming(0, 0, true, 0, 5);
		_lazyBurnPerc = lazyBurnPerc;
	}

	// Supply the contract with token details and metadata
	// Once basic integrity checks are done the token will mint and the address will be returned
	/// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
	/// @param cid root cid for the metadata files
	/// @param metadata string array of the metadata files (in randomised order!)
    /// @return createdTokenAddress the address of the new token
	function initialiseNFTMint (
		string memory name,
        string memory symbol,
        string memory memo,
		string memory cid,
		string[] memory metadata,
		NFTFeeObject[] memory royalties
	)
		external
		payable
		onlyOwner
	returns (address createdTokenAddress) {
		require(bytes(memo).length <= 100, "Memo max 100 bytes");
		require(metadata.length > 0, "supply metadata");
		require(royalties.length <= 10, "Max 10 royalties");

		_cid = cid;
		_metadata = metadata;

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
        token.maxSupply = SafeCast.toInt64(SafeCast.toInt256(metadata.length));
		// create the expiry schedule for the token using ExpiryHelper
        token.expiry = createAutoRenewExpiry(
            address(this),
            HederaTokenService.defaultAutoRenewPeriod
        );

		// translate fee objects to avoid oddities from serialisation of default/empty values
		IHederaTokenService.RoyaltyFee[] memory fees = new IHederaTokenService.RoyaltyFee[](royalties.length);

		for (uint256 f = 0; f < royalties.length; f++) {
			IHederaTokenService.RoyaltyFee memory fee;
			fee.numerator = royalties[f].numerator;
			fee.denominator = royalties[f].denominator;
			fee.feeCollector = royalties[f].account;

			if (royalties[f].fallbackfee != 0) {
				fee.amount = royalties[f].fallbackfee;
				fee.useHbarsForPayment = true;
			}

			fees[f] = fee;
		}

		(int responseCode, address tokenAddress) = HederaTokenService.createNonFungibleTokenWithCustomFees(
			token,
			new IHederaTokenService.FixedFee[](0),
			fees);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert ("Failed to mint Token");
        }

		_token = tokenAddress;

		emit MinterContractMessage("Token Create", _token, 0, "SUCCESS");

		createdTokenAddress = _token;
	}

	/// @param numberToMint the number of serials to mint
	function mintNFT(uint256 numberToMint) external payable returns (int64[] memory serials) {
		require(numberToMint > 0, "Request +ve mint");
		require(!_mintTiming.mintPaused, "Mint Paused");
		require(numberToMint <= _metadata.length, "Minted out");
		require(numberToMint <= _mintEconomics.maxMint, "Max Mint Exceeded");

		//calculate cost
		uint totalHbarCost = SafeMath.mul(numberToMint, _mintEconomics.mintPriceHbar);
		uint totalLazyCost = SafeMath.mul(numberToMint, _mintEconomics.mintPriceLazy);

		// take the payment
		if (totalLazyCost > 0) {
			takeLazyPayment(totalLazyCost);
		}

		if (totalHbarCost > 0) {
			require(msg.value >= totalHbarCost, "Too little Hbar");
		}

		// pop the metadata
		bytes[] memory metadataForMint = new bytes[](numberToMint);
		for (uint m = 0; m < numberToMint; m++) {
			string memory fullPath = string.concat(_cid, _metadata[_metadata.length - 1]);
			metadataForMint[m] = bytes(fullPath);
			// pop discarding the elemnt used up
			_metadata.pop();
		}
		emit MinterContractMessage(string(metadataForMint[0]), _token, numberToMint, "meta");

		
		(int responseCode, , int64[] memory serialNumbers) 
			= mintToken(_token, 0, metadataForMint);

		if (responseCode != HederaResponseCodes.SUCCESS) {
            revert ("Failed to mint Token");
        }

		// transfer the token to the user
		for (uint256 s = 0 ; s < serialNumbers.length; s++) {
			emit MinterContractMessage("Mint Serial", msg.sender, SafeCast.toUint256(serialNumbers[s]), string(metadataForMint[s]));

			responseCode = transferNFT(_token, address(this), msg.sender, serialNumbers[s]);

			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert ("Failed to send NFTs");
			}

			emit MinterContractMessage("Tfr Serial", msg.sender, SafeCast.toUint256(serialNumbers[s]), "Complete");
		}

		serials = serialNumbers;
		
	}


	/// Use HTS to transfer FT - add the burn
    /// @param amount Non-negative value to take as pmt. a negative value will result in a failure.
    function takeLazyPayment(
        uint amount
    )
		internal 
	returns (int responseCode) {
		require(amount > 0, "Positive transfers only");
		require(IERC721(_token).balanceOf(msg.sender) >= amount, "Not LAZY enough");

        responseCode = transferToken(
            _lazyToken,
            msg.sender,
            address(this),
            SafeCast.toInt64(int256(amount))
        );

		uint256 burnAmt = SafeMath.div(amount, _lazyBurnPerc);

		// This is a safe cast to uint32 as max value is >> max supply of Lazy
		responseCode = _lazySCT.burn(_lazyToken, SafeCast.toUint32(burnAmt));

        emit MinterContractMessage("LAZY Pmt", msg.sender, amount, "SUCCESS");
		emit MinterContractMessage("LAZY Burn", msg.sender, burnAmt, "SUCCESS");

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("taking LAzy payment - failed");
        }
    }

	// function to asses the cost to mint for a user
	// currently flat cost, eventually dynamic on holdings
	/// @return hbarCost
	/// @return lazyCost
    function getCost() external view returns (uint hbarCost, uint lazyCost) {
    	hbarCost = _mintEconomics.mintPriceHbar;
		lazyCost = _mintEconomics.mintPriceLazy;
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
    /// @param receiverAddress address in EVM format of the reciever of the hbar
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

	// unsigned ints so no ability to set a negative cost.
	/// @param hbarCost in *tinybar*
	/// @param lazyCost adjusted for the decimal of 1. 
	function updateCost(uint256 hbarCost, uint256 lazyCost) external onlyOwner {
		if (_mintEconomics.mintPriceHbar != hbarCost) {
			_mintEconomics.mintPriceHbar = hbarCost;
			emit MinterContractMessage("Hbar mint px", msg.sender, _mintEconomics.mintPriceHbar, "Updated");
		}

		if (_mintEconomics.mintPriceLazy != lazyCost) {
			_mintEconomics.mintPriceLazy = lazyCost;
			emit MinterContractMessage("Lazy mint px", msg.sender, _mintEconomics.mintPriceLazy, "Updated");
		}
	}

	/// @param mintPaused boolean to pause (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updatePauseStatus(bool mintPaused) external onlyOwner returns (bool changed) {
		changed = _mintTiming.mintPaused == mintPaused ? false : true;
		_mintTiming.mintPaused = mintPaused;
	}

	
	/// @param lazyFromContract boolean to pay (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updateContractPaysLazy(bool lazyFromContract) external onlyOwner returns (bool changed) {
		changed = _mintEconomics.lazyFromContract == lazyFromContract ? false : true;
		_mintEconomics.lazyFromContract = lazyFromContract;
	}

	/// @param startTime new start time in seconds
    function updateMintStartTime(uint256 startTime) external onlyOwner {
        _mintTiming.mintStartTime = startTime;
       emit MinterContractMessage("Mint Start", msg.sender, _mintTiming.mintStartTime, "Updated");
    }

	/// @param lbp new Lazy SC Treasury address
    function updateLazyBurnPercentage(uint256 lbp) external onlyOwner {
        _lazyBurnPerc = lbp;
       emit MinterContractMessage("Lazy Burn %", msg.sender, _lazyBurnPerc, "Updated");
    }

	/// @param maxMint new max mint (0 = uncapped)
    function updateMaxMint(uint256 maxMint) external onlyOwner {
        _mintEconomics.maxMint = maxMint;
       emit MinterContractMessage("Max Mint", msg.sender, _mintEconomics.maxMint, "Updated");
    }

	/// @param cooldownPeriod cooldown period as seconds
    function updateCooldown(uint256 cooldownPeriod) external onlyOwner {
        _mintTiming.cooldownPeriod = cooldownPeriod;
       emit MinterContractMessage("Cooldown", msg.sender, _mintTiming.cooldownPeriod, "Updated");
    }

	/// @param refundWindow refund period in seconds / cap on withdrawals
    function updateRefundWindow(uint256 refundWindow) external onlyOwner {
        _mintTiming.refundWindow = refundWindow;
       emit MinterContractMessage("Refund Windows", msg.sender, _mintTiming.refundWindow, "Updated");
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

	/// @return token the address for the NFT to be minted
    function getNFTTokenAddress() external view returns (address token) {
    	token = _token;
    }

	/// @return lazy the address set for Lazy FT token
    function getLazyToken() external view returns (address lazy) {
    	lazy = _lazyToken;
    }

	/// @return paused boolean indicating whether mint is paused
    function getMintPaused() external view returns (bool paused) {
    	paused = _mintTiming.mintPaused;
    }

	/// @return refundWindow boolean indicating whether mint is paused
    function getRefundWindow() external view returns (uint256 refundWindow) {
    	refundWindow = _mintTiming.refundWindow;
    }

	/// @return payFromSC boolean indicating whether any Lazy payment is expect to be prefunded
    function getPayLazyFromSC() external view returns (bool payFromSC) {
    	payFromSC = _mintEconomics.lazyFromContract;
    }

	/// @return priceHbar base Hbar price for mint
    function getBasePriceHbar() external view returns (uint priceHbar) {
    	priceHbar = _mintEconomics.mintPriceHbar;
    }
	
	/// @return priceLazy base Lazy price for mint
    function getBasePriceLazy() external view returns (uint priceLazy) {
    	priceLazy = _mintEconomics.mintPriceLazy;
    }
	
	/// @return wlDiscount the address set for Lazy FT token
    function getWLDiscount() external view returns (uint wlDiscount) {
    	wlDiscount = _mintEconomics.wlDiscount;
    }
	
	/// @return lastMintTime the address set for Lazy FT token
    function getLastMint() external view returns (uint lastMintTime) {
    	lastMintTime = _mintTiming.lastMintTime;
    }
	
	/// @return mintStartTime the address set for Lazy FT token
    function getMintStartTime() external view returns (uint mintStartTime) {
    	mintStartTime = _mintTiming.mintStartTime;
    }

	/// @return maxMint 0 implies no cap to minting
    function getMaxMint() external view returns (uint maxMint) {
    	maxMint = _mintEconomics.maxMint;
    }

	/// @return cooldownPeriod 0 implies no cooldown
    function getCooldownPeriod() external view returns (uint cooldownPeriod) {
    	cooldownPeriod = _mintTiming.cooldownPeriod;
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

	/// @return mintEconomics basic struct with mint economics details
	function getMintEconomics() external view returns (MintEconomics memory mintEconomics){
		mintEconomics = _mintEconomics;
	}

	/// @return mintTiming basic struct with mint economics details
	function getMintTiming() external view returns (MintTiming memory mintTiming){
		mintTiming = _mintTiming;
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