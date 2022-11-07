// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";
import "./ExpiryHelper.sol";

// Import OpenZeppelin Contracts libraries where needed
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract LAZYTokenCreator {
	function burn(address token, uint32 amount) external returns (int responseCode) {}
}

contract MinterContract is ExpiryHelper, Ownable, ReentrancyGuard {
	using EnumerableMap for EnumerableMap.AddressToUintMap;
	using EnumerableMap for EnumerableMap.UintToUintMap;
	using EnumerableSet for EnumerableSet.UintSet;

	// list of WL addresses
    EnumerableMap.AddressToUintMap private _whitelistedAddressQtyMap;
	LAZYTokenCreator private _lazySCT;
	address private _lazyToken;
	uint private _lazyBurnPerc;
	string private _cid;
	string[] private _metadata;
	uint private _batchSize;
	// map address to timestamps
	// for cooldown mechanic
	EnumerableMap.AddressToUintMap private _walletMintTimeMap;
	// map serials to timestamps
	// for burn / refund mechanic
	EnumerableMap.UintToUintMap private _serialMintTimeMap;
	// set of the serials used to redeem WL to ensure no double dip
	EnumerableSet.UintSet private _wlSerialsUsed;
	// map WL addresses to the numbers of mints used
	// track WL mints per address for max cap
	EnumerableMap.AddressToUintMap private _wlAddressToNumMintedMap;
	// map ALL addreesses to the numbers of mints used
	// track mints per wallet for max cap
	EnumerableMap.AddressToUintMap private _addressToNumMintedMap;

	struct MintTiming {
		uint lastMintTime;
		uint mintStartTime;
		bool mintPaused;
		uint cooldownPeriod;
		uint refundWindow;
		bool wlOnly;
	}

	struct MintEconomics {
		bool lazyFromContract;
		// in tinybar
		uint mintPriceHbar;
		// adjusted for decimal 1
		uint mintPriceLazy;
		uint wlDiscount;
		uint maxMint;
		uint buyWlWithLazy;
		uint maxWlAddressMint;
		uint maxMintPerWallet;
		address wlToken;
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

		_mintEconomics = MintEconomics(false, 0, 0, 0, 20, 0, 0, 0, address(0));
		_mintTiming = MintTiming(0, 0, true, 0, 0, false);
		_lazyBurnPerc = lazyBurnPerc;
		_token = address(0);
		_batchSize = 10;
	}

	// Supply the contract with token details and metadata
	// Once basic integrity checks are done the token will mint and the address will be returned
	/// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
	/// @param cid root cid for the metadata files
    /// @return createdTokenAddress the address of the new token
	function initialiseNFTMint (
		string memory name,
        string memory symbol,
        string memory memo,
		string memory cid,
		NFTFeeObject[] memory royalties
	)
		external
		payable
		onlyOwner
	returns (address createdTokenAddress, uint maxSupply) {
		require(bytes(memo).length <= 100, "Memo<100b");
		require(_metadata.length > 0, "add meta");
		require(royalties.length <= 10, "<=10Fees");

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
        token.maxSupply = SafeCast.toInt64(SafeCast.toInt256(_metadata.length));
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
            revert ("FM");
        }

		_token = tokenAddress;
		maxSupply = _metadata.length;

		emit MinterContractMessage("Token Create", _token, maxSupply, "SUCCESS");

		createdTokenAddress = _token;
	}

	/// @param numberToMint the number of serials to mint
	function mintNFT(uint256 numberToMint) external payable nonReentrant returns (int64[] memory serials, bytes[] memory metadataForMint) {
		require(numberToMint > 0, ">0");
		require(_mintTiming.mintStartTime == 0 ||
			_mintTiming.mintStartTime <= block.timestamp, 
			"NotOpen");
		require(!_mintTiming.mintPaused, "Paused");
		require(numberToMint <= _metadata.length, "MOut");
		require(numberToMint <= _mintEconomics.maxMint, "MaxMint");

		bool isWlMint = false;
		bool found;
		uint numPreviouslyMinted;
		// Design decision: WL max mint per wallet takes priority 
		// over max mint per wallet
		if (_mintTiming.wlOnly) {
			require(checkWhitelistConditions(), "NotWL");
			// only check the qty if there is a limit at contract level
			if (_mintEconomics.maxWlAddressMint > 0) {
				// we know the address is in the list to get here.
				uint wlMintsRemaining = _whitelistedAddressQtyMap.get(msg.sender);
				require(wlMintsRemaining >= numberToMint, "WLSlots");
				_whitelistedAddressQtyMap.set(msg.sender, wlMintsRemaining -= numberToMint);
			}
			isWlMint = true;
		}
		else if (_mintEconomics.maxMintPerWallet > 0) {
			(found, numPreviouslyMinted) = _addressToNumMintedMap.tryGet(msg.sender);
			if (found) {
				require((numPreviouslyMinted + numberToMint) <=
					_mintEconomics.maxMintPerWallet,
					">WMax");
			}
			else {
				require(numberToMint <=
					_mintEconomics.maxMintPerWallet,
					">WMax");
			}
		}

		//check if wallet has minted before - if not try and associate
		//SWALLOW ERROR as user may have already associated
		//Ideally we would just check association before the brute force method
		(found, ) = _walletMintTimeMap.tryGet(msg.sender);
		if (!found) {
			//let's associate
			if(IERC721(_token).balanceOf(msg.sender) == 0) associateToken(msg.sender, _token);
			// no need to capture result as failure simply means account already had it associated
			// if user in the mint DB then will not be tried anyway
		}

		//calculate cost
		(uint hbarCost, uint lazyCost) = getCostInternal(isWlMint);
		uint totalHbarCost = SafeMath.mul(numberToMint, hbarCost);
		uint totalLazyCost = SafeMath.mul(numberToMint, lazyCost);

		// take the payment
		if (totalLazyCost > 0) {
			takeLazyPayment(totalLazyCost, 
				_mintEconomics.lazyFromContract ? address(this) : msg.sender);
		}

		if (totalHbarCost > 0) {
			require(msg.value >= totalHbarCost, "+Hbar");
		}

		// pop the metadata
		metadataForMint = new bytes[](numberToMint);
		for (uint m = 0; m < numberToMint; m++) {
			string memory fullPath = string.concat(_cid, _metadata[_metadata.length - 1]);
			metadataForMint[m] = bytes(fullPath);
			// pop discarding the elemnt used up
			_metadata.pop();
		}

		int64[] memory mintedSerials = new int64[](numberToMint);
		for (uint outer = 0; outer < numberToMint; outer += _batchSize) {
			uint batchSize = (numberToMint - outer) >= _batchSize ? _batchSize : numberToMint;
			bytes[] memory batchMetadataForMint = new bytes[](batchSize);
			for (uint inner = 0; ((outer + inner) < numberToMint) && (inner < _batchSize); inner++) {
				batchMetadataForMint[inner] = metadataForMint[inner + outer];
			}

			(int responseCode, , int64[] memory serialNumbers) 
				= mintToken(_token, 0, batchMetadataForMint);

			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert ("FSMint");
			}

			
			// transfer the token to the user
			address[] memory senderList = new address[](serialNumbers.length);
			address[] memory receiverList = new address[](serialNumbers.length);
			for (uint256 s = 0 ; s < serialNumbers.length; s++) {
				emit MinterContractMessage("Mint Serial", msg.sender, SafeCast.toUint256(serialNumbers[s]), string(batchMetadataForMint[s]));
				senderList[s] = address(this);
				receiverList[s] = msg.sender;
				mintedSerials[s + outer] = serialNumbers[s];
				_serialMintTimeMap.set(SafeCast.toUint256(serialNumbers[s]), block.timestamp);
			}

			responseCode = transferNFTs(_token, senderList, receiverList, serialNumbers);

			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert ("FSNFT");
			}
		}
		
		_mintTiming.lastMintTime = block.timestamp;
		_walletMintTimeMap.set(msg.sender, block.timestamp);

		if (isWlMint) {
			(found, numPreviouslyMinted) = _wlAddressToNumMintedMap.tryGet(msg.sender);
			if (found) {
				_wlAddressToNumMintedMap.set(msg.sender, numPreviouslyMinted + numberToMint);
			}
			else {
				_wlAddressToNumMintedMap.set(msg.sender, numberToMint);
			}
		}

		// track all minters in case max mint per wallet required
		(found, numPreviouslyMinted) = _addressToNumMintedMap.tryGet(msg.sender);
		if (found) {
			_addressToNumMintedMap.set(msg.sender, numPreviouslyMinted + numberToMint);
		}
		else {
			_addressToNumMintedMap.set(msg.sender, numberToMint);
		}

		serials = mintedSerials;
		
	}

	function checkWhitelistConditions() internal view returns (bool allowedToMint) {
		(bool found, uint qty) = _whitelistedAddressQtyMap.tryGet(msg.sender);
		if (found) {
			if (_mintEconomics.maxWlAddressMint > 0) {
				allowedToMint = qty > 0 ? true : false;
			}
			else {
				allowedToMint = true;
			}
		}
		else {
			allowedToMint = false;
		}
	}

	// Call to associate a new token to the contract
    /// @param tokenId EVM token to associate
    function tokenAssociate(address tokenId) internal {
        int256 response = HederaTokenService.associateToken(
            address(this),
            tokenId
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert("AF");
        }
    }

	/// Use HTS to transfer FT - add the burn
    /// @param amount Non-negative value to take as pmt. a negative value will result in a failure.
    function takeLazyPayment(
        uint amount,
		address payer
    )
		internal 
	returns (int responseCode) {
		require(IERC721(_lazyToken).balanceOf(payer) >= amount, "LAZYpmt");

		if (payer != address(this)) {
			responseCode = transferToken(
				_lazyToken,
				msg.sender,
				address(this),
				SafeCast.toInt64(int256(amount))
			);
		}

		uint256 burnAmt = SafeMath.div(SafeMath.mul(amount, _lazyBurnPerc), 100);

		// This is a safe cast to uint32 as max value is >> max supply of Lazy
		
		if (burnAmt > 0) {
			responseCode = _lazySCT.burn(_lazyToken, SafeCast.toUint32(burnAmt));
			if (responseCode != HederaResponseCodes.SUCCESS) {
            	revert("BF");
        	}
		}
        emit MinterContractMessage("LAZY Pmt", payer, amount, "");
		emit MinterContractMessage("LAZY Burn", payer, burnAmt, "");
    }

	function getCostInternal(bool wl) internal view returns (uint hbarCost, uint lazyCost) {
		if (wl) {
			hbarCost = SafeMath.div(SafeMath.mul(_mintEconomics.mintPriceHbar, (100 - _mintEconomics.wlDiscount)), 100);
			lazyCost = SafeMath.div(SafeMath.mul(_mintEconomics.mintPriceLazy, (100 - _mintEconomics.wlDiscount)), 100);
		}
		else {
			hbarCost = _mintEconomics.mintPriceHbar;
			lazyCost = _mintEconomics.mintPriceLazy;
		}
	}

	// function to asses the cost to mint for a user
	// currently flat cost, eventually dynamic on holdings
	/// @return hbarCost
	/// @return lazyCost
    function getCost() public view returns (uint hbarCost, uint lazyCost) {
		(hbarCost, lazyCost) = getCostInternal(checkWhitelistConditions());
    }

	/// Use HTS to retrieve LAZY
    /// @param receiver The receiver of the transaction
    /// @param amount Non-negative value to send. a negative value will result in a failure.
    function retrieveLazy(
        address receiver,
        int64 amount
    )
		external
		onlyOwner 
	returns (int responseCode) {
		require(block.timestamp >= (_mintTiming.lastMintTime + _mintTiming.refundWindow), 
			"lazyCooldown");

        responseCode = HederaTokenService.transferToken(
            _lazyToken,
            address(this),
            receiver,
            amount
        );

		require(amount > 0, "+ve");

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("retrieveLazy");
        }
    }

	/// @return wlSpotsPurchased number of spots purchased
	function buyWlWithLazy() external returns (uint wlSpotsPurchased) {
		require(_mintEconomics.buyWlWithLazy > 0, "WL0");

		wlSpotsPurchased = _whitelistedAddressQtyMap.contains(msg.sender) ?
			_whitelistedAddressQtyMap.get(msg.sender) + _mintEconomics.maxWlAddressMint :
				_mintEconomics.maxWlAddressMint;

		_whitelistedAddressQtyMap.set(msg.sender, wlSpotsPurchased);
		takeLazyPayment(_mintEconomics.buyWlWithLazy, msg.sender);
		emit MinterContractMessage("WLPurcLazy", msg.sender, 
				wlSpotsPurchased, "");
	}

	/// @return wlSpotsPurchased number of sports purchased
	function buyWlWithTokens(uint256[] memory serials) external returns (uint wlSpotsPurchased) {
		require(_mintEconomics.wlToken != address(0), "NoWLToken");

		for (uint8 i = 0; i < serials.length; i++) {
			// check no double dipping
			require(!_wlSerialsUsed.contains(serials[i]), "Used");
			// check user owns the token
			require(IERC721(_mintEconomics.wlToken).ownerOf(serials[i]) == msg.sender, "NotWLTOwner");
			_wlSerialsUsed.add(serials[i]);
			emit MinterContractMessage("WLPurcToken", msg.sender, 
				serials[i], "");
		}

		wlSpotsPurchased = _whitelistedAddressQtyMap.contains(msg.sender) ?
			_whitelistedAddressQtyMap.get(msg.sender) + (_mintEconomics.maxWlAddressMint * serials.length) :
				(_mintEconomics.maxWlAddressMint * serials.length);
		emit MinterContractMessage("WLPurcTokenSlots", msg.sender, 
				wlSpotsPurchased, "");
		_whitelistedAddressQtyMap.set(msg.sender, wlSpotsPurchased);
	}

	// Transfer hbar out of the contract
	// using OZ sendValue()
    /// @param receiverAddress address in EVM format of the reciever of the hbar
    /// @param amount number of tokens to send (in long form adjusted for decimal)
    function transferHbar(address payable receiverAddress, uint amount)
        external
        onlyOwner
    {
		require(block.timestamp >= (_mintTiming.lastMintTime + _mintTiming.refundWindow), 
			"HbarCooldown");
        // throws error on failure
        //receiverAddress.transfer(amount);
		Address.sendValue(receiverAddress, amount);
    }

	// Add an address to the allowance WL
    /// @param newAddresses array of addresses to add
	/// @return results a boolean showing if the address was added (or was already present)
    function addToWhitelist(address[] memory newAddresses) external onlyOwner returns(bool[] memory results) {
        results = new bool[](newAddresses.length);

		for (uint a = 0 ; a < newAddresses.length; a++ ){
			results[a] = _whitelistedAddressQtyMap.set(newAddresses[a], _mintEconomics.maxWlAddressMint);
			emit MinterContractMessage(
				"ADD WL", 
				newAddresses[a],
				results[a] ? 1 : 0,
				""
			);
		}
    }

	// Remove an address to the allowance WL
    /// @param oldAddresses the address to remove
	/// @return results if the address was removed or it was not present
    function removeFromWhitelist(address[] memory oldAddresses) external onlyOwner returns(bool[] memory results) {
        results = new bool[](oldAddresses.length);
		for (uint a = 0 ; a < oldAddresses.length; a++ ){
			results[a] = _whitelistedAddressQtyMap.remove(oldAddresses[a]);
			emit MinterContractMessage(
				"REMOVE WL", 
				oldAddresses[a],
				results[a] ? 1 : 0,
				""
			);
		}
    }

	// clear the whole WL
	/// @return numAddressesRemoved how many WL entries were removed. 
	function clearWhitelist() external onlyOwner returns(uint numAddressesRemoved) {
		numAddressesRemoved = _whitelistedAddressQtyMap.length();
		for (uint a = numAddressesRemoved; a > 0; a--) {
			(address key, ) = _whitelistedAddressQtyMap.at(a - 1);
			_whitelistedAddressQtyMap.remove(key);
			emit MinterContractMessage("RM WL", key, 0, "");
		}
	}

	// unsigned ints so no ability to set a negative cost.
	/// @param hbarCost in *tinybar*
	/// @param lazyCost adjusted for the decimal of 1. 
	function updateCost(uint256 hbarCost, uint256 lazyCost) external onlyOwner {
		if (_mintEconomics.mintPriceHbar != hbarCost) {
			_mintEconomics.mintPriceHbar = hbarCost;
			emit MinterContractMessage("Hbar mint px", msg.sender, _mintEconomics.mintPriceHbar, "");
		}

		if (_mintEconomics.mintPriceLazy != lazyCost) {
			_mintEconomics.mintPriceLazy = lazyCost;
			emit MinterContractMessage("Lazy mint px", msg.sender, _mintEconomics.mintPriceLazy, "");
		}
	}

	/// @param mintPaused boolean to pause (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updatePauseStatus(bool mintPaused) external onlyOwner returns (bool changed) {
		changed = _mintTiming.mintPaused == mintPaused ? false : true;
		if (changed) emit MinterContractMessage("PAUSE UPDATED", msg.sender, mintPaused ? 1 : 0, mintPaused ? "PAUSED" : "UNPAUSED");
		_mintTiming.mintPaused = mintPaused;
	}

	/// @param wlOnly boolean to lock mint to WL only
	/// @return changed indicative of whether a change was made
	function updateWlOnlyStatus(bool wlOnly) external onlyOwner returns (bool changed) {
		changed = _mintTiming.wlOnly == wlOnly ? false : true;
		if (changed) emit MinterContractMessage("WL Usage", msg.sender, wlOnly ? 1 : 0, wlOnly ? "Only WL" : "Open Access");
		_mintTiming.wlOnly = wlOnly;
	}

	/// @param lazyAmt int amount of Lazy (adjusted for decimals)
	function setBuyWlWithLazy(uint lazyAmt) external onlyOwner returns (bool changed) {
		changed = _mintEconomics.buyWlWithLazy == lazyAmt ? false : true;
		if (changed) emit MinterContractMessage("Buy WL w/ LAZY", msg.sender, lazyAmt, "");
		_mintEconomics.buyWlWithLazy = lazyAmt;
	}

	/// @param maxMint int of how many a WL address can mint
	function setMaxWlAddressMint(uint maxMint) external onlyOwner returns (bool changed) {
		changed = _mintEconomics.maxWlAddressMint == maxMint ? false : true;
		if (changed) emit MinterContractMessage("Set Max Mint", msg.sender, maxMint, "");
		_mintEconomics.maxWlAddressMint = maxMint;
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
    }

	/// @param batchSize updated minting batch just in case
    function updateBatchSize(uint256 batchSize) external onlyOwner returns (bool changed) {
		require((batchSize > 0) && (batchSize <= 10), "Batch Size");
		changed = _batchSize == batchSize ? false : true;
    	_batchSize = batchSize;
    }

	/// @param lbp new Lazy SC Treasury address
    function updateLazyBurnPercentage(uint256 lbp) external onlyOwner {
        _lazyBurnPerc = lbp;
    }

	/// @param maxMint new max mint (0 = uncapped)
    function updateMaxMint(uint256 maxMint) external onlyOwner {
        _mintEconomics.maxMint = maxMint;
    }

	/// @param wlDiscount as percentage
    function updateWlDiscount(uint256 wlDiscount) external onlyOwner {
        _mintEconomics.wlDiscount = wlDiscount;
    }

	/// @param cooldownPeriod cooldown period as seconds
    function updateCooldown(uint256 cooldownPeriod) external onlyOwner {
        _mintTiming.cooldownPeriod = cooldownPeriod;
    }

	/// @param refundWindow refund period in seconds / cap on withdrawals
    function updateRefundWindow(uint256 refundWindow) external onlyOwner {
        _mintTiming.refundWindow = refundWindow;
    }

	/// @param lsct new Lazy SC Treasury address
    function updateLSCT(address lsct) external onlyOwner {
        _lazySCT = LAZYTokenCreator(lsct);
    }

	/// @return lsct the address set for the current lazy SC Treasury
    function getLSCT() external view returns (address lsct) {
    	lsct = address(_lazySCT);
    }

	/// @param lazy new Lazy FT address
    function updateLazyToken(address lazy) external onlyOwner {
        _lazyToken = lazy;
    }

	function updateWlToken(address wlToken) external onlyOwner {
        _mintEconomics.wlToken = wlToken;
    }


	/// @param cid new cid
    function updateCID(string memory cid) external onlyOwner {
        _cid = cid;
    }

	/// @param metadata new metadata array
    function updateMetadataArray(string[] memory metadata, uint startIndex) external onlyOwner {
		// enforce consistency of the metadata list
		require((startIndex + metadata.length) <= _metadata.length, "offset");
		uint index = 0;
		for (uint i = startIndex; i < (startIndex + metadata.length); i++) {
			_metadata[i] = metadata[index];
			index++;
		}
    }

	// method to push metadata end points up
	function addMetadata(string[] memory metadata) external onlyOwner returns (uint totalLoaded) {
		require(_token == address(0), "Need Reset");
		for (uint i = 0; i < metadata.length; i++) {
			_metadata.push(metadata[i]);
		}
		totalLoaded = _metadata.length;
	}

	// Helper method to strip storage requirements
	// boolean toggle to remove the token ID if full reset
	/// @param removeToken reset token to zero address
	function resetContract(bool removeToken) external onlyOwner {
		if (removeToken) {
			_token = address(0);
		}
		uint size = _addressToNumMintedMap.length();
		for (uint a = size; a > 0; a--) {
			(address key, ) = _addressToNumMintedMap.at(a - 1);
			_addressToNumMintedMap.remove(key);
		}
		for (uint a = 0; a <_metadata.length; a++) {
			_metadata.pop();
		}
		size = _walletMintTimeMap.length();
		for (uint a = size; a > 0; a--) {
			(address key, ) = _walletMintTimeMap.at(a - 1);
			_walletMintTimeMap.remove(key);
		}
		size = _wlAddressToNumMintedMap.length();
		for (uint a = size; a > 0; a--) {
			(address key, ) = _wlAddressToNumMintedMap.at(a - 1);
			_wlAddressToNumMintedMap.remove(key);
		}
		size = _serialMintTimeMap.length();
		for (uint a = size; a > 0; a--) {
			(uint key, ) = _serialMintTimeMap.at(a - 1);
			_serialMintTimeMap.remove(key);
		}
		size = _wlSerialsUsed.length();
		for (uint a = size; a > 0; a--) {
			uint key = _wlSerialsUsed.at(a - 1);
			_wlSerialsUsed.remove(key);
		}

		emit MinterContractMessage(removeToken ? "Clear Token" : "Reset Contract", msg.sender, 0, "Reset");
	}

	/// @return metadataList of metadata unminted -> only owner
    function getMetadataArray(uint startIndex, uint endIndex) external view onlyOwner 
		returns (string[] memory metadataList) {
			require(endIndex > startIndex, "args");
			require(endIndex <= _metadata.length, "past end");
		metadataList = new string[](endIndex - startIndex);
		uint index = 0;
        for (uint i = startIndex; i < endIndex; i++) {
			metadataList[index] = _metadata[i];
			index++;
		}
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

	/// @return wlOnly boolean indicating whether mint is only for WL
    function getWlOnly() external view returns (bool wlOnly) {
    	wlOnly = _mintTiming.wlOnly;
    }

	/// @return lazyAmt amount fof Lazy to buy WL (0 = not possible)
    function getBuyWlWithLazy() external view returns (uint lazyAmt) {
    	lazyAmt = _mintEconomics.buyWlWithLazy;
    }

	/// @return numMinted helper function to check how many a wallet has minted
	function getNumberMintedByAddress() external view returns(uint numMinted) {
		bool found;
		uint numPreviouslyMinted;
		(found, numPreviouslyMinted) = _addressToNumMintedMap.tryGet(msg.sender);
		if (found) {
			numMinted = numPreviouslyMinted;
		}
		else {
			numMinted = 0;
		}
	}

	// Likely only viable with smaller mints
	/// @return walletList list of wallets who minted
	/// @return numMintedList lst of number minted
	function getNumberMintedByAllAddresses() external view onlyOwner returns(address[] memory walletList, uint[] memory numMintedList) {
		walletList = new address[](_addressToNumMintedMap.length());
		numMintedList = new uint[](_addressToNumMintedMap.length());
		for (uint a = 0; a < _addressToNumMintedMap.length(); a++) {
			(walletList[a], numMintedList[a]) = _addressToNumMintedMap.at(a);
		}
	}

	/// @return wlNumMinted helper function to check how many a wallet has minted
	function getNumberMintedByWlAddress() external view returns(uint wlNumMinted) {
		bool found;
		uint numPreviouslyMinted;
		(found, numPreviouslyMinted) = _wlAddressToNumMintedMap.tryGet(msg.sender);
		if (found) {
			wlNumMinted = numPreviouslyMinted;
		}
		else {
			wlNumMinted = 0;
		}
	}

	// Likely only viable with smaller mints
	/// @return wlWalletList list of wallets who minted
	/// @return wlNumMintedList lst of number minted
	function getNumberMintedByAllWlAddresses() external view onlyOwner returns(address[] memory wlWalletList, uint[] memory wlNumMintedList) {
		wlWalletList = new address[](_wlAddressToNumMintedMap.length());
		wlNumMintedList = new uint[](_wlAddressToNumMintedMap.length());
		for (uint a = 0; a < _wlAddressToNumMintedMap.length(); a++) {
			(wlWalletList[a], wlNumMintedList[a]) = _wlAddressToNumMintedMap.at(a);
		}
	}

	/// @return refundWindow boolean indicating whether mint is paused
    function getRefundWindow() external view returns (uint256 refundWindow) {
    	refundWindow = _mintTiming.refundWindow;
    }

	/// @return remainingMint number of NFTs left to mint
    function getRemainingMint() external view returns (uint256 remainingMint) {
    	remainingMint = _metadata.length;
    }

	/// @return blockTime current network time (seconds)
    function getBlockTime() external view returns (uint256 blockTime) {
    	blockTime = block.timestamp;
    }

	/// @return payFromSC boolean indicating whether any Lazy payment is expect to be prefunded
    function getPayLazyFromSC() external view returns (bool payFromSC) {
    	payFromSC = _mintEconomics.lazyFromContract;
    }

	/// @return priceHbar base Hbar price for mint
    function getBasePriceHbar() external view returns (uint priceHbar) {
    	priceHbar = _mintEconomics.mintPriceHbar;
    }

	/// @return wlToken token address to redeem WL
    function getWlToken() external view returns (address wlToken) {
    	wlToken = _mintEconomics.wlToken;
    }

	/// @return batchSize the size for mint/transfer
    function getBatchSize() external view returns (uint batchSize) {
    	batchSize = _batchSize;
    }
	
	/// @return priceLazy base Lazy price for mint
    function getBasePriceLazy() external view returns (uint priceLazy) {
    	priceLazy = _mintEconomics.mintPriceLazy;
    }
	
	/// @return wlDiscount the address set for Lazy FT token
    function getWlDiscount() external view returns (uint wlDiscount) {
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

	/// @return maxMint percentage of lazy to brun each interaction
    function getMaxWlAddressMint() external view returns (uint maxMint) {
    	maxMint = _mintEconomics.maxWlAddressMint;
    }

	/// Check the current Whitelist for minting
    /// @return wl an array of addresses currently enabled for allownace approval
    function getWhitelist()
        external
        view
        returns (address[] memory wl, uint[] memory wlQty)
    {
        wl = new address[](_whitelistedAddressQtyMap.length());
		wlQty = new uint[](_whitelistedAddressQtyMap.length());
		
		for (uint a = 0; a < _whitelistedAddressQtyMap.length(); a++) {
			(wl[a], wlQty[a]) = _whitelistedAddressQtyMap.at(a);
		}
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
    /// @return inWl if in the WL
	/// @return qty the number of WL mints (0 = unbounded)
    function isAddressWL(address addressToCheck) external view returns (bool inWl, uint qty) {
		(inWl, qty) = _whitelistedAddressQtyMap.tryGet(addressToCheck);
    }

	receive() external payable {
        emit MinterContractMessage(
            "Receive Hbar",
            msg.sender,
			msg.value,
            ""
        );
    }

    fallback() external payable {
        emit MinterContractMessage("Fallback Call", msg.sender, msg.value, "");
    }

}