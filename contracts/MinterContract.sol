// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenService} from "./HederaTokenService.sol";
import {IHederaTokenService} from "./IHederaTokenService.sol";
import {ExpiryHelper} from "./ExpiryHelper.sol";
import {IHRC719} from "./IHRC719.sol";

// functionality moved to library for space saving
import {MinterLibrary} from "./MinterLibrary.sol";
import {IBurnableHTS} from "./IBurnableHTS.sol";

// Import OpenZeppelin Contracts libraries where needed
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract MinterContract is ExpiryHelper, Ownable, ReentrancyGuard {
	using EnumerableMap for EnumerableMap.AddressToUintMap;
	using EnumerableMap for EnumerableMap.UintToUintMap;
	using EnumerableSet for EnumerableSet.UintSet;
	using SafeCast for uint256;
	using SafeCast for int64;
	using SafeCast for int256;
	using Address for address;
	using Strings for string;


	// list of WL addresses
    EnumerableMap.AddressToUintMap private _whitelistedAddressQtyMap;
	LazyDetails private _lazyDetails;
	string private _cid;
	string[] private _metadata;
	uint256 private _batchSize;
	uint256 private _totalMinted;
	uint256 private _maxSupply;
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

	error NotReset(address token);
	error MemoTooLong();
	error TooManyFees();
	error TooMuchMetadata();
	error EmptyMetadata();
	error FailedToMint();
	error BadQuantity(uint256 quantity);
	error NotOpen();
	error Paused();
	error NotWL();
	error NotEnoughWLSlots();
	error MintedOut();
	error MaxMintExceeded();
	error MaxMintPerWalletExceeded();
	error NotEnoughLazy();
	error NotEnoughHbar();
	error FailedNFTMint();
	error NFTTransferFailed();
	error AssociationFailed();
	error FailedToPayLazy();
	error BurnFailed();
	error LazyCooldown();
	error HbarCooldown();
	error WLPurchaseFailed();
	error NoWLToken();
	error WLTokenUsed();
	error NotTokenOwner();
	error MaxSerials();
	error BadArguments();

	struct MintTiming {
		uint256 lastMintTime;
		uint256 mintStartTime;
		bool mintPaused;
		uint256 cooldownPeriod;
		uint256 refundWindow;
		bool wlOnly;
	}

	struct MintEconomics {
		bool lazyFromContract;
		// in tinybar
		uint256 mintPriceHbar;
		// adjusted for decimal 1
		uint256 mintPriceLazy;
		uint256 wlDiscount;
		uint256 maxMint;
		uint256 buyWlWithLazy;
		uint256 maxWlAddressMint;
		uint256 maxMintPerWallet;
		address wlToken;
	}

	struct LazyDetails {
		address lazyToken;
		uint256 lazyBurnPerc;
		IBurnableHTS lazySCT;
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
	address private _prngGenerator;

	enum ContractEventType {
		INITIALISE, 
		REFUND,
		PAUSE,
		UNPAUSE,
		LAZY_PMT,
		WL_PURCHASE_TOKEN,
		WL_PURCHASE_LAZY,
		WL_ADD,
		WL_REMOVE,
		RESET_CONTRACT,
		RESET_INC_TOKEN,
		UPDATE_WL_TOKEN,
		UPDATE_WL_LAZY_BUY,
		UPDATE_WL_ONLY,
		UPDATE_WL_MAX,
		UPDATE_WL_DISCOUNT,
		UPDATE_MAX_MINT,
		UPDATE_MAX_WALLET_MINT,
		UPDATE_COOLDOWN,
		UPDATE_MINT_PRICE,
		UPDATE_MINT_PRICE_LAZY,
		UPDATE_LAZY_BURN_PERCENTAGE,
		UPDATE_LAZY_FROM_CONTRACT,
		UPDATE_CID,
		UPDATE_MINT_START_TIME,
		UPDATE_REFUND_WINDOW
	}
	
	event MinterContractMessage(
		ContractEventType eventType,
		address indexed msgAddress,
		uint256 msgNumeric
	);

	event MintEvent(
		address indexed msgAddress,
		bool mintType,
		uint256 indexed serial,
		string metadata
	);

	event BurnEvent(
		address indexed burnerAddress,
		int64[] serials,
		uint64 newSupply
	);

	/// @param lsct the address of the Lazy Smart Contract Treasury (for burn)
	constructor(
		address lsct, 
		address lazy,
		uint256 lazyBurnPerc
	) {
		_lazyDetails = LazyDetails(lazy, lazyBurnPerc, IBurnableHTS(lsct));

		uint256 responseCode = IHRC719(_lazyDetails.lazyToken).associate();
		if (responseCode.toInt256().toInt32() != HederaResponseCodes.SUCCESS) {
			revert AssociationFailed();
		}

		_mintEconomics = MintEconomics(false, 0, 0, 0, 20, 0, 0, 0, address(0));
		_mintTiming = MintTiming(0, 0, true, 0, 0, false);
		_token = address(0);
		_batchSize = 10;
	}

	// Supply the contract with token details and metadata
	// Once basic integrity checks are done the token will mint and the address will be returned
	/// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
	/// @param cid root cid for the metadata files
	/// @param maxIssuance 0 or less to size based off metadata else will override
    /// @return createdTokenAddress the address of the new token
	function initialiseNFTMint (
		string memory name,
        string memory symbol,
        string memory memo,
		string memory cid,
		NFTFeeObject[] memory royalties,
		int64 maxIssuance
	)
		external
		payable
		onlyOwner
	returns (address createdTokenAddress, uint256 maxSupply) {
		if(_token != address(0)) revert NotReset(_token);
		if(bytes(memo).length > 100) revert MemoTooLong();
		if(royalties.length > 10) revert TooManyFees();

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
		if (maxIssuance > 0) {
			// check that there is not already too much metadats in the contract
			if(_metadata.length > maxIssuance.toUint256()) revert TooMuchMetadata();
			token.maxSupply = maxIssuance;
		} 
		else {
			if(_metadata.length == 0) revert EmptyMetadata();
        	token.maxSupply = _metadata.length.toInt256().toInt64();
		}
		_maxSupply = SafeCast.toUint256(token.maxSupply);
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

		(int32 responseCode, address tokenAddress) = HederaTokenService.createNonFungibleTokenWithCustomFees(
			token,
			new IHederaTokenService.FixedFee[](0),
			fees);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedToMint();
        }

		_token = tokenAddress;
		maxSupply = _maxSupply;

		emit MinterContractMessage(ContractEventType.INITIALISE, _token, maxSupply);

		createdTokenAddress = _token;
	}

	/// @param numberToMint the number of serials to mint
	function mintNFT(uint256 numberToMint) external payable nonReentrant returns (int64[] memory serials, bytes[] memory metadataForMint) {
		if(numberToMint == 0) revert BadQuantity(numberToMint);
		if(_mintTiming.mintStartTime != 0 && _mintTiming.mintStartTime > block.timestamp) revert NotOpen();
		if(_mintTiming.mintPaused) revert Paused();
		if(numberToMint > _metadata.length) revert MintedOut();
		if(numberToMint > _mintEconomics.maxMint) revert MaxMintExceeded();

		bool isWlMint = false;
		// Design decision: WL max mint per wallet takes priority 
		// over max mint per wallet
		if (_mintTiming.wlOnly) {
			if(!MinterLibrary.checkWhitelistConditions(_whitelistedAddressQtyMap, _mintEconomics.maxWlAddressMint)) revert NotWL();
			// only check the qty if there is a limit at contract level
			if (_mintEconomics.maxWlAddressMint > 0) {
				// we know the address is in the list to get here.
				uint256 wlMintsRemaining = _whitelistedAddressQtyMap.get(msg.sender);
				if(wlMintsRemaining < numberToMint) revert NotEnoughWLSlots();
				_whitelistedAddressQtyMap.set(msg.sender, wlMintsRemaining -= numberToMint);
			}
			isWlMint = true;
		}
		else if (_mintEconomics.maxMintPerWallet > 0) {
			(bool found, uint256 numPreviouslyMinted) = _addressToNumMintedMap.tryGet(msg.sender);
			if (!found) {
				numPreviouslyMinted = 0;
			}
		
			if((numPreviouslyMinted + numberToMint) >
					_mintEconomics.maxMintPerWallet) revert MaxMintPerWalletExceeded();
		}

		//calculate cost
		(uint256 hbarCost, uint256 lazyCost) = getCostInternal(isWlMint);
		uint256 totalHbarCost = numberToMint * hbarCost;
		uint256 totalLazyCost = numberToMint * lazyCost;

		// take the payment
		if (totalLazyCost > 0) {
			takeLazyPayment(totalLazyCost, 
				_mintEconomics.lazyFromContract ? address(this) : msg.sender);
		}

		if (totalHbarCost > 0) {
			if(msg.value < totalHbarCost) revert NotEnoughHbar();
		}

		// pop the metadata
		metadataForMint = MinterLibrary.selectMetdataToMint(_metadata, numberToMint, _cid, _prngGenerator);

		int64[] memory mintedSerials = new int64[](numberToMint);
		for (uint256 outer = 0; outer < numberToMint; outer += _batchSize) {
			uint256 batchSize = (numberToMint - outer) >= _batchSize ? _batchSize : (numberToMint - outer);
			bytes[] memory batchMetadataForMint = new bytes[](batchSize);
			for (uint256 inner = 0; ((outer + inner) < numberToMint) && (inner < _batchSize); inner++) {
				batchMetadataForMint[inner] = metadataForMint[inner + outer];
			}

			(int32 responseCode, , int64[] memory serialNumbers) 
				= mintToken(_token, 0, batchMetadataForMint);

			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert FailedNFTMint();
			}

			
			// transfer the token to the user
			address[] memory senderList = new address[](serialNumbers.length);
			address[] memory receiverList = new address[](serialNumbers.length);
			uint256 length = serialNumbers.length;
			for (uint256 s = 0 ; s < length; ) {
				emitMintEvent(isWlMint, serialNumbers[s], batchMetadataForMint[s]);
				senderList[s] = address(this);
				receiverList[s] = msg.sender;
				mintedSerials[s + outer] = serialNumbers[s];
				_serialMintTimeMap.set(SafeCast.toUint256(serialNumbers[s]), block.timestamp);

				unchecked {
					++s;
				}
			}

			responseCode = transferNFTs(_token, senderList, receiverList, serialNumbers);

			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert NFTTransferFailed();
			}
		}
		
		_mintTiming.lastMintTime = block.timestamp;
		_walletMintTimeMap.set(msg.sender, block.timestamp);

		if (isWlMint) {
			(bool wlFound, uint256 wlNumPreviouslyMinted) = _wlAddressToNumMintedMap.tryGet(msg.sender);
			if (wlFound) {
				_wlAddressToNumMintedMap.set(msg.sender, wlNumPreviouslyMinted + numberToMint);
			}
			else {
				_wlAddressToNumMintedMap.set(msg.sender, numberToMint);
			}
		}

		// track all minters in case max mint per wallet required
		(bool numMintfound, uint256 totalNumPreviouslyMinted) = _addressToNumMintedMap.tryGet(msg.sender);
		if (numMintfound) {
			_addressToNumMintedMap.set(msg.sender, totalNumPreviouslyMinted + numberToMint);
		}
		else {
			_addressToNumMintedMap.set(msg.sender, numberToMint);
		}

		_totalMinted += numberToMint;

		serials = mintedSerials;
		
	}

	/// Use HTS to transfer FT - add the burn
    /// @param amount Non-negative value to take as pmt. a negative value will result in a failure.
    function takeLazyPayment(
        uint256 amount,
		address payer
    )
		internal 
	returns (int256 responseCode) {
		// check the payer has the required amount && the allowance is in place
		if(IERC721(_lazyDetails.lazyToken).balanceOf(payer) < amount) revert NotEnoughLazy();

		if (payer != address(this)) {
			bool success = IERC20(_lazyDetails.lazyToken).transferFrom(payer, address(this), amount);
			if (!success) {
				revert FailedToPayLazy();
			}
		}

		uint256 burnAmt = (amount * _lazyDetails.lazyBurnPerc) / 100;

		// This is a safe cast to uint32 as max value is >> max supply of Lazy
		
		if (burnAmt > 0) {
			responseCode = _lazyDetails.lazySCT.burn(_lazyDetails.lazyToken, SafeCast.toUint32(burnAmt));
			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert BurnFailed();
        	}
		}
        emit MinterContractMessage(ContractEventType.LAZY_PMT, payer, amount);
    }

	function getCostInternal(bool wl) internal view returns (uint256 hbarCost, uint256 lazyCost) {
		if (wl) {
			hbarCost = (_mintEconomics.mintPriceHbar * (100 - _mintEconomics.wlDiscount)) / 100;
			lazyCost = (_mintEconomics.mintPriceLazy * (100 - _mintEconomics.wlDiscount)) / 100;
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
    function getCost() external view returns (uint256 hbarCost, uint256 lazyCost) {
		(hbarCost, lazyCost) = getCostInternal(MinterLibrary.checkWhitelistConditions(_whitelistedAddressQtyMap, _mintEconomics.maxWlAddressMint));
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
	returns (int32 responseCode) {
		if(block.timestamp < (_mintTiming.lastMintTime + _mintTiming.refundWindow)) revert LazyCooldown();

        responseCode = HederaTokenService.transferToken(
            _lazyDetails.lazyToken,
            address(this),
            receiver,
            amount
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedToPayLazy();
        }
    }

	/// @return wlSpotsPurchased number of spots purchased
	function buyWlWithLazy() external returns (uint256 wlSpotsPurchased) {
		if(_mintEconomics.buyWlWithLazy == 0) revert WLPurchaseFailed();

		wlSpotsPurchased = _whitelistedAddressQtyMap.contains(msg.sender) ?
			_whitelistedAddressQtyMap.get(msg.sender) + _mintEconomics.maxWlAddressMint :
				_mintEconomics.maxWlAddressMint;

		_whitelistedAddressQtyMap.set(msg.sender, wlSpotsPurchased);
		takeLazyPayment(_mintEconomics.buyWlWithLazy, msg.sender);
		emit MinterContractMessage(ContractEventType.WL_PURCHASE_LAZY, msg.sender, wlSpotsPurchased);
	}

	/// @return wlSpotsPurchased number of sports purchased
	function buyWlWithTokens(uint256[] memory serials) external returns (uint256 wlSpotsPurchased) {
		if(_mintEconomics.wlToken == address(0)) revert NoWLToken();

		for (uint8 i = 0; i < serials.length; i++) {
			// check no double dipping
			if(_wlSerialsUsed.contains(serials[i])) revert WLTokenUsed();
			// check user owns the token
			if(IERC721(_mintEconomics.wlToken).ownerOf(serials[i]) != msg.sender) revert NotTokenOwner();
			_wlSerialsUsed.add(serials[i]);
			emit MinterContractMessage(ContractEventType.WL_PURCHASE_TOKEN, msg.sender, serials[i]);
		}

		wlSpotsPurchased = _whitelistedAddressQtyMap.contains(msg.sender) ?
			_whitelistedAddressQtyMap.get(msg.sender) + (_mintEconomics.maxWlAddressMint * serials.length) :
				(_mintEconomics.maxWlAddressMint * serials.length);
		_whitelistedAddressQtyMap.set(msg.sender, wlSpotsPurchased);
	}

	// Transfer hbar out of the contract
	// using OZ sendValue()
    /// @param receiverAddress address in EVM format of the reciever of the hbar
    /// @param amount number of tokens to send (in long form adjusted for decimal)
    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyOwner
    {
		if(block.timestamp < (_mintTiming.lastMintTime + _mintTiming.refundWindow)) revert HbarCooldown();
        // throws error on failure
        //receiverAddress.transfer(amount);
		Address.sendValue(receiverAddress, amount);
    }

	// Add an address to the allowance WL
    /// @param newAddresses array of addresses to add
    function addToWhitelist(address[] memory newAddresses) external onlyOwner {
		for (uint256 a = 0 ; a < newAddresses.length; a++ ){
			bool result = _whitelistedAddressQtyMap.set(newAddresses[a], _mintEconomics.maxWlAddressMint);
			emit MinterContractMessage(
				ContractEventType.WL_ADD,
				newAddresses[a],
				result ? 1 : 0
			);
		}
    }

	// Remove an address to the allowance WL
    /// @param oldAddresses the address to remove
    function removeFromWhitelist(address[] memory oldAddresses) external onlyOwner {
		for (uint256 a = 0 ; a < oldAddresses.length; a++ ){
			bool result = _whitelistedAddressQtyMap.remove(oldAddresses[a]);
			emit MinterContractMessage(
				ContractEventType.WL_REMOVE,
				oldAddresses[a],
				result ? 1 : 0
			);
		}
    }

	// clear the whole WL
	/// @return numAddressesRemoved how many WL entries were removed. 
	function clearWhitelist() external onlyOwner returns(uint256 numAddressesRemoved) {
		numAddressesRemoved = MinterLibrary.clearWhitelist(_whitelistedAddressQtyMap);
	}

	// function to allow the burning of NFTs (as long as no fallback fee)
	// NFTs transfered to the SC and then burnt with contract as supply key
	/// @param serialNumbers array of serials to burn
	/// @return newTotalSupply the new total supply of the NFT
	function burnNFTs(int64[] memory serialNumbers) external returns (uint64 newTotalSupply) {
		if(serialNumbers.length > 10) revert MaxSerials();
		// need to transfer back to treasury to burn
		address[] memory senderList = new address[](serialNumbers.length);
		address[] memory receiverList = new address[](serialNumbers.length);
		for (uint256 s = 0 ; s < serialNumbers.length; s++) {
			senderList[s] = msg.sender;
			receiverList[s] = address(this);
		}

		// Need to check if this allows approval based transfers, else move it to 'stake' code
		int32 responseCode = transferNFTs(_token, senderList, receiverList, serialNumbers);
		// emit events for each transfer

		if (responseCode != HederaResponseCodes.SUCCESS) {
			revert NFTTransferFailed();
		}

		(responseCode, newTotalSupply) = burnToken(_token, 0, serialNumbers);
		// emit events for burn
		emit BurnEvent(msg.sender, serialNumbers, newTotalSupply);

		if (responseCode != HederaResponseCodes.SUCCESS) {
            revert BurnFailed();
        }
	}

	// unsigned ints so no ability to set a negative cost.
	/// @param hbarCost in *tinybar*
	/// @param lazyCost adjusted for the decimal of 1. 
	function updateCost(uint256 hbarCost, uint256 lazyCost) external onlyOwner {
		if (_mintEconomics.mintPriceHbar != hbarCost) {
			_mintEconomics.mintPriceHbar = hbarCost;
			emit MinterContractMessage(ContractEventType.UPDATE_MINT_PRICE, msg.sender, _mintEconomics.mintPriceHbar);
		}

		if (_mintEconomics.mintPriceLazy != lazyCost) {
			_mintEconomics.mintPriceLazy = lazyCost;
			emit MinterContractMessage(ContractEventType.UPDATE_MINT_PRICE_LAZY, msg.sender, _mintEconomics.mintPriceLazy);
		}
	}

	/// @param mintPaused boolean to pause (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updatePauseStatus(bool mintPaused) external onlyOwner returns (bool changed) {
		changed = _mintTiming.mintPaused == mintPaused ? false : true;
		if (changed) emit MinterContractMessage(mintPaused ? ContractEventType.PAUSE : ContractEventType.UNPAUSE, msg.sender, mintPaused ? 1 : 0);
		_mintTiming.mintPaused = mintPaused;
	}

	/// @param wlOnly boolean to lock mint to WL only
	/// @return changed indicative of whether a change was made
	function updateWlOnlyStatus(bool wlOnly) external onlyOwner returns (bool changed) {
		changed = _mintTiming.wlOnly == wlOnly ? false : true;
		if (changed) emit MinterContractMessage(ContractEventType.UPDATE_WL_ONLY, msg.sender, wlOnly ? 1 : 0);
		_mintTiming.wlOnly = wlOnly;
	}

	/// @param prng address of the new PRNG Generator
	function updatePrng(address prng) external onlyOwner {
		_prngGenerator = prng;
	}

	/// @param lazyAmt int amount of Lazy (adjusted for decimals)
	function setBuyWlWithLazy(uint256 lazyAmt) external onlyOwner returns (bool changed) {
		changed = _mintEconomics.buyWlWithLazy == lazyAmt ? false : true;
		if (changed) emit MinterContractMessage(ContractEventType.UPDATE_WL_LAZY_BUY, msg.sender, lazyAmt);
		_mintEconomics.buyWlWithLazy = lazyAmt;
	}

	/// @param maxMint int of how many a WL address can mint
	function setMaxWlAddressMint(uint256 maxMint) external onlyOwner returns (bool changed) {
		changed = _mintEconomics.maxWlAddressMint == maxMint ? false : true;
		if (changed) emit MinterContractMessage(ContractEventType.UPDATE_WL_MAX, msg.sender, maxMint);
		_mintEconomics.maxWlAddressMint = maxMint;
	}
	
	/// @param lazyFromContract boolean to pay (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updateContractPaysLazy(bool lazyFromContract) external onlyOwner returns (bool changed) {
		changed = _mintEconomics.lazyFromContract == lazyFromContract ? false : true;
		if (changed) emit MinterContractMessage(ContractEventType.UPDATE_LAZY_FROM_CONTRACT, msg.sender, lazyFromContract ? 1 : 0);
		_mintEconomics.lazyFromContract = lazyFromContract;
	}

	/// @param startTime new start time in seconds
    function updateMintStartTime(uint256 startTime) external onlyOwner {
        _mintTiming.mintStartTime = startTime;
		emit MinterContractMessage(ContractEventType.UPDATE_MINT_START_TIME, msg.sender, startTime);
    }

	/// @param batchSize updated minting batch just in case
    function updateBatchSize(uint256 batchSize) external onlyOwner returns (bool changed) {
		if((batchSize == 0) || (batchSize > 10)) revert BadArguments();
		changed = _batchSize == batchSize ? false : true;
    	_batchSize = batchSize;
    }

	/// @param lbp new Lazy SC Treasury address
    function updateLazyBurnPercentage(uint256 lbp) external onlyOwner {
        _lazyDetails.lazyBurnPerc = lbp;
		emit MinterContractMessage(ContractEventType.UPDATE_LAZY_BURN_PERCENTAGE, msg.sender, lbp);
    }

	/// @param maxMint new max mint (0 = uncapped)
    function updateMaxMint(uint256 maxMint) external onlyOwner {
        _mintEconomics.maxMint = maxMint;
		emit MinterContractMessage(ContractEventType.UPDATE_MAX_MINT, msg.sender, maxMint);
    }

	/// @param wlDiscount as percentage
    function updateWlDiscount(uint256 wlDiscount) external onlyOwner {
        _mintEconomics.wlDiscount = wlDiscount;
		emit MinterContractMessage(ContractEventType.UPDATE_WL_DISCOUNT, msg.sender, wlDiscount);
    }

	/// @param cooldownPeriod cooldown period as seconds
    function updateCooldown(uint256 cooldownPeriod) external onlyOwner {
        _mintTiming.cooldownPeriod = cooldownPeriod;
		emit MinterContractMessage(ContractEventType.UPDATE_COOLDOWN, msg.sender, cooldownPeriod);
    }

	/// @param refundWindow refund period in seconds / cap on withdrawals
    function updateRefundWindow(uint256 refundWindow) external onlyOwner {
        _mintTiming.refundWindow = refundWindow;
		emit MinterContractMessage(ContractEventType.UPDATE_REFUND_WINDOW, msg.sender, refundWindow);
    }

	/// @param lsct new Lazy SC Treasury address
    function updateLSCT(address lsct) external onlyOwner {
        _lazyDetails.lazySCT = IBurnableHTS(lsct);
    }

	/// @return lsct the address set for the current lazy SC Treasury
    function getLSCT() external view returns (address lsct) {
    	lsct = address(_lazyDetails.lazySCT);
    }

	/// @param lazy new Lazy FT address
    function updateLazyToken(address lazy) external onlyOwner {
        _lazyDetails.lazyToken = lazy;
    }

	function updateWlToken(address wlToken) external onlyOwner {
        _mintEconomics.wlToken = wlToken;
		emit MinterContractMessage(ContractEventType.UPDATE_WL_TOKEN, wlToken, 0);
    }

	function updateMaxMintPerWallet(uint256 max) external onlyOwner {
        _mintEconomics.maxMintPerWallet = max;
		emit MinterContractMessage(ContractEventType.UPDATE_MAX_WALLET_MINT, msg.sender, max);
    }

	/// @param cid new cid
    function updateCID(string memory cid) external onlyOwner {
        _cid = cid;
		emit MinterContractMessage(ContractEventType.UPDATE_CID, msg.sender, 0);
    }

	/// @param metadata new metadata array
    function updateMetadataArray(string[] memory metadata, uint256 startIndex) external onlyOwner {
		// enforce consistency of the metadata list
		if((startIndex + metadata.length) > _metadata.length) revert TooMuchMetadata();
		uint256 index = 0;
		for (uint256 i = startIndex; i < (startIndex + metadata.length); ) {
			_metadata[i] = metadata[index];
			index++;
			unchecked {
				++i;
			}
		}
    }

	// method to push metadata end points up
	function addMetadata(string[] memory metadata) external onlyOwner returns (uint256 totalLoaded) {
		if (_token != address(0)) {
			if((_totalMinted + _metadata.length + metadata.length) > _maxSupply) revert TooMuchMetadata();
		}
		for (uint256 i = 0; i < metadata.length; ) {
			_metadata.push(metadata[i]);

			unchecked {
				++i;
			}
		}
		totalLoaded = _metadata.length;
	}

	// Helper method to strip storage requirements
	// boolean toggle to remove the token ID if full reset
	/// @param removeToken reset token to zero address
	/// @param batch allow for batched reset
	function resetContract(bool removeToken, uint256 batch) external onlyOwner {
		if (removeToken) {
			_token = address(0);
			_totalMinted = 0;
		}
		MinterLibrary.resetContract(
			_addressToNumMintedMap, 
			_metadata, 
			_walletMintTimeMap, 
			_wlAddressToNumMintedMap, 
			_serialMintTimeMap, 
			_wlSerialsUsed,
			batch);

		emit MinterContractMessage(
			removeToken ? ContractEventType.RESET_INC_TOKEN : ContractEventType.RESET_CONTRACT, 
			msg.sender, 
			batch);
	}

	/// @return metadataList of metadata unminted
	// no point in obfuscating the ability to view unminted metadata
	// technical workarounds are trivial.
    function getMetadataArray(uint256 startIndex, uint256 endIndex) 
		external view 
		returns (string[] memory metadataList) 
	{
		if(endIndex <= startIndex) revert BadArguments();
		if(endIndex > _metadata.length) revert TooMuchMetadata();
		metadataList = new string[](endIndex - startIndex);
		uint256 index = 0;
        for (uint256 i = startIndex; i < endIndex; ) {
			metadataList[index] = _metadata[i];
			index++;
			unchecked {
				++i;
			}
		}
    }

	/// @return token the address for the NFT to be minted
    function getNFTTokenAddress() external view returns (address token) {
    	token = _token;
    }

	/// @return lazy the address set for Lazy FT token
    function getLazyToken() external view returns (address lazy) {
    	lazy = _lazyDetails.lazyToken;
    }

	/// @return numMinted helper function to check how many a wallet has minted
	function getNumberMintedByAddress() external view returns(uint256 numMinted) {
		bool found;
		uint256 numPreviouslyMinted;
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
	function getNumberMintedByAllAddresses() external view onlyOwner returns(address[] memory walletList, uint256[] memory numMintedList) {
		walletList = new address[](_addressToNumMintedMap.length());
		numMintedList = new uint256[](_addressToNumMintedMap.length());
		for (uint256 a = 0; a < _addressToNumMintedMap.length(); ) {
			(walletList[a], numMintedList[a]) = _addressToNumMintedMap.at(a);
			unchecked {
				++a;
			}
		}
	}

	/// @return wlNumMinted helper function to check how many a wallet has minted
	function getNumberMintedByWlAddress() external view returns(uint256 wlNumMinted) {
		bool found;
		uint256 numPreviouslyMinted;
		(found, numPreviouslyMinted) = _wlAddressToNumMintedMap.tryGet(msg.sender);
		if (found) {
			wlNumMinted = numPreviouslyMinted;
		}
		else {
			wlNumMinted = 0;
		}
	}

	// Likely only viable with smaller mints
	// else gather via events emitted.
	// TODO: Create a batched retrieval
	/// @return wlWalletList list of wallets who minted
	/// @return wlNumMintedList lst of number minted
	function getNumberMintedByAllWlAddresses() external view returns(address[] memory wlWalletList, uint256[] memory wlNumMintedList) {
		(wlWalletList, wlNumMintedList) = MinterLibrary.getNumberMintedByAllWlAddressesBatch(_wlAddressToNumMintedMap, 0, _wlAddressToNumMintedMap.length());
	}

	function getNumberMintedByAllWlAddressesBatch(uint256 offset, uint256 batchSize) external view returns(address[] memory wlWalletList, uint256[] memory wlNumMintedList) {
		(wlWalletList, wlNumMintedList) = MinterLibrary.getNumberMintedByAllWlAddressesBatch(_wlAddressToNumMintedMap, offset, batchSize);
	}

	/// @return remainingMint number of NFTs left to mint
    function getRemainingMint() external view returns (uint256 remainingMint) {
    	remainingMint = _metadata.length;
    }

	/// @return batchSize the size for mint/transfer
    function getBatchSize() external view returns (uint256 batchSize) {
    	batchSize = _batchSize;
    }

	/// @return lazyBurn percentage of lazy to brun each interaction
    function getLazyBurnPercentage() external view returns (uint256 lazyBurn) {
    	lazyBurn = _lazyDetails.lazyBurnPerc;
    }

	/// Check the current Whitelist for minting
    /// @return wl an array of addresses on WL
	/// @return wlQty an array of the number of mints allowed
    function getWhitelist()
        external
        view
        returns (address[] memory wl, uint256[] memory wlQty)
    {
        wl = new address[](_whitelistedAddressQtyMap.length());
		wlQty = new uint256[](_whitelistedAddressQtyMap.length());
		
		for (uint256 a = 0; a < _whitelistedAddressQtyMap.length(); ) {
			(wl[a], wlQty[a]) = _whitelistedAddressQtyMap.at(a);
			unchecked {
				++a;
			}
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
    function isAddressWL(address addressToCheck) external view returns (bool inWl, uint256 qty) {
		(inWl, qty) = _whitelistedAddressQtyMap.tryGet(addressToCheck);
    }

	/// Stack too deep - so split out
	function emitMintEvent(
		bool isWlMint,
		int64 serial,
		bytes memory metadata
	) internal {
		emit MintEvent(msg.sender, isWlMint, serial.toUint256(), string(metadata));
	}

	receive() external payable { }

    fallback() external payable { }

}