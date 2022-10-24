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
	uint private _batchSize;
	// map address to timestamps
	// for cooldown mechanic
	EnumerableMap.AddressToUintMap private _walletMintTimeMap;
	// map serials to timestamps
	// for burn / refund mechanic
	EnumerableMap.UintToUintMap private _serialMintTimeMap;
	// map WL serials to the numbers of mints used
	// for WL mints based on ownership
	EnumerableMap.UintToUintMap private _wlSerialsToNumMintedMap;
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

		_mintEconomics = MintEconomics(false, 0, 0, 0, 20, 0, 0, 0);
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
		require(bytes(memo).length <= 100, "Memo max 100 bytes");
		require(_metadata.length > 0, "supply metadata");
		require(royalties.length <= 10, "Max 10 royalties");

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
            revert ("Failed to mint Token");
        }

		_token = tokenAddress;
		maxSupply = _metadata.length;

		emit MinterContractMessage("Token Create", _token, maxSupply, "SUCCESS");

		createdTokenAddress = _token;
	}

	/// @param numberToMint the number of serials to mint
	function mintNFT(uint256 numberToMint) external payable returns (int64[] memory serials, bytes[] memory metadataForMint) {
		require(_mintTiming.mintStartTime == 0 ||
			_mintTiming.mintStartTime <= block.timestamp, 
			"Mint not started");
		require(!_mintTiming.mintPaused, "Mint Paused");
		require(numberToMint <= _metadata.length, "Minted out");
		require(numberToMint <= _mintEconomics.maxMint, "Max Mint Exceeded");

		bool isWlMint = false;
		bool found;
		uint numPreviouslyMinted;
		// Design decision: WL max mint per wallet takes priority 
		// over max mint per wallet
		if (_mintTiming.wlOnly) {
			require(checkWhitelistConditions(), "Not valid WL");
			if (_mintEconomics.maxWlAddressMint > 0) {
				(found, numPreviouslyMinted) = _wlAddressToNumMintedMap.tryGet(msg.sender);
				if (found) {
					require((numPreviouslyMinted + numberToMint) <=
						_mintEconomics.maxWlAddressMint,
						"Can't Exceeded Max WL Mint");
				}
				else {
					require(numberToMint <=
						_mintEconomics.maxWlAddressMint,
						"Can't Exceeded Max WL Mint");
				}
			}
			isWlMint = true;
		}
		else if (_mintEconomics.maxMintPerWallet > 0) {
			(found, numPreviouslyMinted) = _addressToNumMintedMap.tryGet(msg.sender);
			if (found) {
				require((numPreviouslyMinted + numberToMint) <=
					_mintEconomics.maxMintPerWallet,
					"> Max Mint Per Wallet");
			}
			else {
				require(numberToMint <=
					_mintEconomics.maxMintPerWallet,
					"> Max Mint Per Wallet");
			}
		}

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
				revert ("Failed to mint Token");
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
				revert ("Failed to send NFTs");
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
		allowedToMint = _whitelistedAddresses.contains(msg.sender);
	}


	/// Use HTS to transfer FT - add the burn
    /// @param amount Non-negative value to take as pmt. a negative value will result in a failure.
    function takeLazyPayment(
        uint amount
    )
		internal 
	returns (int responseCode) {
		require(amount > 0, "Positive transfers only");
		require(IERC721(_lazyToken).balanceOf(msg.sender) >= amount, "Not LAZY enough");

        responseCode = transferToken(
            _lazyToken,
            msg.sender,
            address(this),
            SafeCast.toInt64(int256(amount))
        );

		uint256 burnAmt = SafeMath.div(SafeMath.mul(amount, _lazyBurnPerc), 100);

		// This is a safe cast to uint32 as max value is >> max supply of Lazy
		
		if (burnAmt > 0) {
			responseCode = _lazySCT.burn(_lazyToken, SafeCast.toUint32(burnAmt));
			if (responseCode != HederaResponseCodes.SUCCESS) {
            	revert("taking Lazy payment - failed");
        	}
		}
        emit MinterContractMessage("LAZY Pmt", msg.sender, amount, "SUCCESS");
		emit MinterContractMessage("LAZY Burn", msg.sender, burnAmt, "SUCCESS");
    }

	// function to asses the cost to mint for a user
	// currently flat cost, eventually dynamic on holdings
	/// @return hbarCost
	/// @return lazyCost
    function getCost() external view returns (uint hbarCost, uint lazyCost) {
    	hbarCost = _mintEconomics.mintPriceHbar;
		lazyCost = _mintEconomics.mintPriceLazy;
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
			"Post-mint Cooldown");

        responseCode = HederaTokenService.transferToken(
            _lazyToken,
            address(this),
            receiver,
            amount
        );

		require(amount > 0, "Positive transfers only");

        emit MinterContractMessage(
            "Retrieve Lazy",
            receiver,
            uint256(uint64(amount)),
            "completed"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("retrieveLazy - failed");
        }
    }

	/// @return purchaseStatus bool representing whether operation worked
	function buyWlWithLazy() external returns (bool purchaseStatus) {
		require(_mintEconomics.buyWlWithLazy > 0, "WL purchase Disabled");

		if (_whitelistedAddresses.contains(msg.sender)) {
			purchaseStatus = false;
		}
		else {
			_whitelistedAddresses.add(msg.sender);

			takeLazyPayment(_mintEconomics.buyWlWithLazy);

			emit MinterContractMessage("WL Purchase", msg.sender, 
				_mintEconomics.buyWlWithLazy, "SUCESS");
			purchaseStatus = true;
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
		require(block.timestamp >= (_mintTiming.lastMintTime + _mintTiming.refundWindow), 
			"Post-mint Cooldown");
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
		if (changed) emit MinterContractMessage("Buy WL w/ LAZY", msg.sender, lazyAmt, "Updated");
		_mintEconomics.buyWlWithLazy = lazyAmt;
	}

	/// @param maxMint int of how many a WL address can mint
	function setMaxWlAddressMint(uint maxMint) external onlyOwner returns (bool changed) {
		changed = _mintEconomics.maxWlAddressMint == maxMint ? false : true;
		if (changed) emit MinterContractMessage("Set Max Mint", msg.sender, maxMint, "For WL Addresses");
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
    	emit MinterContractMessage("Mint Start", msg.sender, _mintTiming.mintStartTime, "Updated");
    }

	/// @param batchSize updated minting batch just in case
    function updateBatchSize(uint256 batchSize) external onlyOwner returns (bool changed) {
		require((batchSize > 0) && (batchSize <= 10), "Check Batch Size");
		changed = _batchSize == batchSize ? false : true;
    	_batchSize = batchSize;
    	emit MinterContractMessage("Batching", msg.sender, _batchSize, "Updated");
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
    function updateMetadataArray(string[] memory metadata, uint startIndex) external onlyOwner {
		// enforce consistency of the metadata list
		require((startIndex + metadata.length) <= _metadata.length, "Bad offset");
		uint index = 0;
		for (uint i = startIndex; i < (startIndex + metadata.length); i++) {
			_metadata[i] = metadata[index];
			index++;
		}
       emit MinterContractMessage("Metadata", msg.sender, metadata.length, "Updated");
    }

	// method to push metadata end points up
	function addMetadata(string[] memory metadata) external onlyOwner returns (uint totalLoaded) {
		require(_token == address(0), "Reset to load new metadata");
		for (uint i = 0; i < metadata.length; i++) {
			_metadata.push(metadata[i]);
		}
		totalLoaded = _metadata.length;
	}

	function resetToken() external onlyOwner {
		_token = address(0);
		for (uint i = 0; i < _metadata.length; i++) {
			_metadata.pop();
		}
		address wallet;
		for(uint i = 0; i < _addressToNumMintedMap.length(); i++) {
			(wallet, ) = _addressToNumMintedMap.at(i);
			_addressToNumMintedMap.remove(wallet);
		}
		for(uint i = 0; i < _walletMintTimeMap.length(); i++) {
			(wallet, ) = _walletMintTimeMap.at(i);
			_walletMintTimeMap.remove(wallet);
		}
		for(uint i = 0; i < _wlAddressToNumMintedMap.length(); i++) {
			(wallet, ) = _wlAddressToNumMintedMap.at(i);
			_wlAddressToNumMintedMap.remove(wallet);
		}
		uint serial;
		for(uint i = 0; i < _serialMintTimeMap.length(); i++) {
			(serial, ) = _serialMintTimeMap.at(i);
			_serialMintTimeMap.remove(serial);
		}
		for(uint i = 0; i < _wlSerialsToNumMintedMap.length(); i++) {
			(serial, ) = _wlSerialsToNumMintedMap.at(i);
			_wlSerialsToNumMintedMap.remove(serial);
		}

		emit MinterContractMessage("Clear Token", msg.sender, 0, "Reset");
	}

	/// @return metadataList of metadata unminted -> only owner
    function getMetadataArray(uint startIndex, uint endIndex) external view onlyOwner 
		returns (string[] memory metadataList) {
			require(endIndex > startIndex, "valid length please");
			require(endIndex <= _metadata.length, "out of bounds end");
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
    function getWLOnly() external view returns (bool wlOnly) {
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

	/// @return batchSize the size for mint/transfer
    function getBatchSize() external view returns (uint batchSize) {
    	batchSize = _batchSize;
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

	/// @return maxMint percentage of lazy to brun each interaction
    function getMaxWlAddressMint() external view returns (uint maxMint) {
    	maxMint = _mintEconomics.maxWlAddressMint;
    }

	/// Check the current Whitelist for minting
    /// @return wl an array of addresses currently enabled for allownace approval
    function getWhitelist()
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