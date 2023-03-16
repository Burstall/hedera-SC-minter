// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";
import "./ExpiryHelper.sol";
import "./IPrngGenerator.sol";

// functionality preparing to move to library for space saving
import "./MinterLibrary.sol";

// Import OpenZeppelin Contracts libraries where needed
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract LAZYTokenCreator {
	function burn(address token, uint32 amount) external returns (int responseCode) {}
}

contract MinterContract is ExpiryHelper, Ownable, ReentrancyGuard {
	using EnumerableMap for EnumerableMap.AddressToUintMap;
	using EnumerableMap for EnumerableMap.UintToUintMap;
	using EnumerableSet for EnumerableSet.UintSet;
	using SafeCast for uint256;
	using SafeCast for int256;
	using SafeCast for int64;

	error MintError(int8 responseCode);

	uint public constant BATCH_SIZE = 10;

	LazyDetails private _lazyDetails;
	string private _cid;
	string[] private _metadata;
	uint private _totalMinted;
	uint private _maxSupply;
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
	// list of WL addresses
    EnumerableMap.AddressToUintMap private _whitelistedAddressQtyMap;

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

	struct LazyDetails {
		address lazyToken;
		uint lazyBurnPerc;
		LAZYTokenCreator lazySCT;
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
		BURN,
		PAUSE,
		UNPAUSE,
		LAZY_PMT,
		WL_PURCHASE_TOKEN,
		WL_PURCHASE_LAZY,
		WL_SPOTS_PURCHASED,
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
		UPDATE_REFUND_WINDOW,
		UPDATE_MINT_PRICE,
		UPDATE_MINT_PRICE_LAZY,
		UPDATE_LAZY_BURN_PERCENTAGE,
		UPDATE_LAZY_FROM_CONTRACT,
		UPDATE_LAZY_SCT,
		UPDATE_LAZY_TOKEN,
		UPDATE_CID,
		UPDATE_MINT_START_TIME,
		RECIEVE,
		FALLBACK
	}
	
	event MinterContractMessage(
		ContractEventType eventType,
		address indexed msgAddress,
		uint msgNumeric
	);

	event MintEvent(
		address indexed msgAddress,
		bool mintType,
		uint indexed serial,
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
		_lazyDetails = LazyDetails(lazy, lazyBurnPerc, LAZYTokenCreator(lsct));

		int256 response = HederaTokenService.associateToken(
            address(this),
            _lazyDetails.lazyToken
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert MintError(MinterLibrary.MINT_ERROR_ASSOCIATE_TOKEN);
        }

		_mintEconomics = MintEconomics(false, 0, 0, 0, 20, 0, 0, 0, address(0));
		_mintTiming = MintTiming(0, 0, true, 0, 0, false);
		_token = address(0);
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
	returns (address createdTokenAddress, uint maxSupply) {
		if (_token != address(0)) revert MintError(MinterLibrary.CONTRACT_TOKEN_NOT_RESET);
		if (bytes(memo).length > 100) revert MintError(MinterLibrary.MEMO_TOO_LONG);
		if (royalties.length >10) revert MintError(MinterLibrary.ROYALTY_TOO_MANY);

		_cid = cid;

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
			// check that there is not already too much metadat in the contract
			if (_metadata.length > maxIssuance.toUint256()) revert MintError(MinterLibrary.TOO_MUCH_METADATA);
			token.maxSupply = maxIssuance;
		} 
		else {
			if (_metadata.length == 0) revert MintError(MinterLibrary.NO_METADATA_LOADED);
        	token.maxSupply = _metadata.length.toInt256().toInt64();
		}
		_maxSupply = token.maxSupply.toUint256();
		// create the expiry schedule for the token using ExpiryHelper
        token.expiry = createAutoRenewExpiry(
            address(this),
            HederaTokenService.defaultAutoRenewPeriod
        );


		(int responseCode, address tokenAddress) = HederaTokenService.createNonFungibleTokenWithCustomFees(
			token,
			new IHederaTokenService.FixedFee[](0),
			fees);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert MintError(MinterLibrary.TOKEN_CREATE_FAILED);
        }

		_token = tokenAddress;
		maxSupply = _maxSupply;

		emit MinterContractMessage(ContractEventType.INITIALISE, _token, maxSupply);

		createdTokenAddress = _token;
	}

	/// @param numberToMint the number of serials to mint
	function mintNFT(uint256 numberToMint) external payable nonReentrant returns (int64[] memory serials, bytes[] memory metadataForMint) {
		if (numberToMint == 0) revert MintError(MinterLibrary.MINT_ZERO);
		else if (_mintTiming.mintStartTime > 0 && _mintTiming.mintStartTime > block.timestamp) revert MintError(MinterLibrary.MINT_NOT_OPEN);
		else if (_mintTiming.mintPaused) revert MintError(MinterLibrary.PAUSED);
		else if (numberToMint > _metadata.length) revert MintError(MinterLibrary.MINT_OUT);
		else if (numberToMint > _mintEconomics.maxMint) revert MintError(MinterLibrary.ABOVE_MAX_MINT);
		
		bool isWlMint = false;
		bool found;
		uint numPreviouslyMinted;
		// Design decision: WL max mint per wallet takes priority 
		// over max mint per wallet
		if (_mintTiming.wlOnly) {
			require(MinterLibrary.checkWhitelistConditions(_whitelistedAddressQtyMap, _mintEconomics.maxWlAddressMint), "NotWL");
			// only check the qty if there is a limit at contract level
			if (_mintEconomics.maxWlAddressMint > 0) {
				// we know the address is in the list to get here.
				uint wlMintsRemaining = _whitelistedAddressQtyMap.get(msg.sender);

				if (numberToMint > wlMintsRemaining) revert MintError(MinterLibrary.NOT_ENOUGH_WL_SLOTS);
				_whitelistedAddressQtyMap.set(msg.sender, wlMintsRemaining -= numberToMint);
			}
			isWlMint = true;
		}
		else if (_mintEconomics.maxMintPerWallet > 0) {
			(found, numPreviouslyMinted) = _addressToNumMintedMap.tryGet(msg.sender);
			if (!found) {
				numPreviouslyMinted = 0;
			}
		
			if ((numPreviouslyMinted + numberToMint) >
					_mintEconomics.maxMintPerWallet) revert MintError(MinterLibrary.ABOVE_MAX_MINT_PER_WALLET);
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
		(uint totalHbarCost, uint totalLazyCost) = getCostInternal(isWlMint, numberToMint);

		// take the payment
		if (totalLazyCost > 0) {
			takeLazyPayment(totalLazyCost, 
				_mintEconomics.lazyFromContract ? address(this) : msg.sender);
		}

		if (totalHbarCost > 0 && msg.value < totalHbarCost ) {
			revert MintError(MinterLibrary.INSUFFICIENT_PAYMENT_HBAR);
		}

		// pop the metadata
		metadataForMint = new bytes[](numberToMint);
		for (uint m = 0; m < numberToMint; m++) {
			// TODO: use hedera PRGN to move a random element to the end of the array
			metadataForMint[m] = bytes(string.concat(_cid, _metadata[_metadata.length - 1]));
			// pop discarding the element used up
			_metadata.pop();
		}

		int64[] memory mintedSerials = new int64[](numberToMint);
		for (uint outer = 0; outer < numberToMint; outer += BATCH_SIZE) {
			uint batchSize = (numberToMint - outer) >= BATCH_SIZE ? BATCH_SIZE : (numberToMint - outer);
			bytes[] memory batchMetadataForMint = new bytes[](batchSize);
			for (uint inner = 0; ((outer + inner) < numberToMint) && (inner < BATCH_SIZE); inner++) {
				batchMetadataForMint[inner] = metadataForMint[inner + outer];
			}

			(int responseCode, , int64[] memory serialNumbers) 
				= mintToken(_token, 0, batchMetadataForMint);

			if (responseCode != HederaResponseCodes.SUCCESS) revert MintError(MinterLibrary.HTS_MINT_FAIL);

			
			// transfer the token to the user
			address[] memory senderList = new address[](serialNumbers.length);
			address[] memory receiverList = new address[](serialNumbers.length);
			for (uint256 s = 0 ; s < serialNumbers.length; s++) {
				emitMintEvent(isWlMint, serialNumbers[s], batchMetadataForMint[s]);
				senderList[s] = address(this);
				receiverList[s] = msg.sender;
				mintedSerials[s + outer] = serialNumbers[s];
				_serialMintTimeMap.set(serialNumbers[s].toUint256(), block.timestamp);
			}

			responseCode = transferNFTs(_token, senderList, receiverList, serialNumbers);

			if (responseCode != HederaResponseCodes.SUCCESS) revert MintError(MinterLibrary.HTS_TRANSFER_TOKEN_FAIL);
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

		_totalMinted += numberToMint;

		serials = mintedSerials;
		
	}

	/// Stack too deep - so split out
	function emitMintEvent(
		bool isWlMint,
		int64 serial,
		bytes memory metadata
	) internal {
		emit MintEvent(msg.sender, isWlMint, serial.toUint256(), string(metadata));
	}

	/// Use HTS to transfer FT - add the burn
    /// @param amount Non-negative value to take as pmt. a negative value will result in a failure.
    function takeLazyPayment(
        uint amount,
		address payer
    )
		internal 
	returns (int responseCode) {
		if (IERC721(_lazyDetails.lazyToken).balanceOf(payer) < amount) revert MintError(MinterLibrary.NOT_ENOUGH_LAZY);

		if (payer != address(this)) {
			responseCode = transferToken(
				_lazyDetails.lazyToken,
				msg.sender,
				address(this),
				amount.toInt256().toInt64()
			);
		}

		uint256 burnAmt = (amount * _lazyDetails.lazyBurnPerc) / 100;

		// This is a safe cast to uint32 as max value is >> max supply of Lazy
		
		if (burnAmt > 0) {
			responseCode = _lazyDetails.lazySCT.burn(_lazyDetails.lazyToken, burnAmt.toUint32());
			if (responseCode != HederaResponseCodes.SUCCESS) {
            	revert MintError(MinterLibrary.LAZY_BURN_FAILED);
        	}
		}
        emit MinterContractMessage(ContractEventType.LAZY_PMT, payer, amount);
    }

	function getCostInternal(bool wl, uint numberToMint) internal view returns (uint hbarCost, uint lazyCost) {
		if (wl) {
			hbarCost = (_mintEconomics.mintPriceHbar * (100 - _mintEconomics.wlDiscount)) / 100 * numberToMint;
			lazyCost = (_mintEconomics.mintPriceLazy * (100 - _mintEconomics.wlDiscount)) / 100 * numberToMint;
		}
		else {
			hbarCost = _mintEconomics.mintPriceHbar * numberToMint;
			lazyCost = _mintEconomics.mintPriceLazy * numberToMint;
		}
	}

	// function to asses the cost to mint for a user
	// currently flat cost, eventually dynamic on holdings
	/// @return hbarCost
	/// @return lazyCost
    function getCost() external view returns (uint hbarCost, uint lazyCost) {
		(hbarCost, lazyCost) = getCostInternal(MinterLibrary.checkWhitelistConditions(_whitelistedAddressQtyMap, _mintEconomics.maxWlAddressMint), 1);
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
		if (block.timestamp < (_mintTiming.lastMintTime + _mintTiming.refundWindow))
			revert MintError(MinterLibrary.REFUND_WINDOW_NOT_PASSED);

        responseCode = HederaTokenService.transferToken(
            _lazyDetails.lazyToken,
            address(this),
            receiver,
            amount
        );

        if (responseCode != HederaResponseCodes.SUCCESS) revert MintError(MinterLibrary.HTS_TRANSFER_LAZY_FAIL);
    }

	/// @return wlSpotsPurchased number of spots purchased
	function buyWlWithLazy() external returns (uint wlSpotsPurchased) {
		if (_mintEconomics.buyWlWithLazy == 0) revert MintError(MinterLibrary.UNABLE_TO_BUY_WL_LAZY);

		wlSpotsPurchased = _whitelistedAddressQtyMap.contains(msg.sender) ?
			_whitelistedAddressQtyMap.get(msg.sender) + _mintEconomics.maxWlAddressMint :
				_mintEconomics.maxWlAddressMint;

		_whitelistedAddressQtyMap.set(msg.sender, wlSpotsPurchased);
		takeLazyPayment(_mintEconomics.buyWlWithLazy, msg.sender);
		emit MinterContractMessage(ContractEventType.WL_PURCHASE_LAZY, msg.sender, wlSpotsPurchased);
	}

	/// @return wlSpotsPurchased number of sports purchased
	function buyWlWithTokens(uint256[] memory serials) external returns (uint wlSpotsPurchased) {
		if (_mintEconomics.wlToken == address(0)) revert MintError(MinterLibrary.UNABLE_TO_BUY_WL_TOKEN);

		for (uint8 i = 0; i < serials.length; i++) {
			// check no double dipping
			if (_wlSerialsUsed.contains(serials[i])) revert MintError(MinterLibrary.SERIAL_ALREADY_USED);
			// check user owns the token
			if (IERC721(_mintEconomics.wlToken).ownerOf(serials[i]) != msg.sender) revert MintError(MinterLibrary.SERIAL_NOT_OWNED);
			_wlSerialsUsed.add(serials[i]);
			emit MinterContractMessage(ContractEventType.WL_PURCHASE_TOKEN, msg.sender, serials[i]);
		}

		wlSpotsPurchased = _whitelistedAddressQtyMap.contains(msg.sender) ?
			_whitelistedAddressQtyMap.get(msg.sender) + (_mintEconomics.maxWlAddressMint * serials.length) :
				(_mintEconomics.maxWlAddressMint * serials.length);
		emit MinterContractMessage(ContractEventType.WL_SPOTS_PURCHASED, msg.sender, wlSpotsPurchased);
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
		if (block.timestamp < (_mintTiming.lastMintTime + _mintTiming.refundWindow))
			revert MintError(MinterLibrary.REFUND_WINDOW_NOT_PASSED);
        // throws error on failure
        //receiverAddress.transfer(amount);
		Address.sendValue(receiverAddress, amount);
    }

	// Add an address to the allowance WL
    /// @param newAddresses array of addresses to add
    function addToWhitelist(address[] memory newAddresses) external onlyOwner {
		for (uint a = 0 ; a < newAddresses.length; a++ ){
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
		for (uint a = 0 ; a < oldAddresses.length; a++ ){
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
	function clearWhitelist() external onlyOwner returns(uint numAddressesRemoved) {
		numAddressesRemoved = MinterLibrary.clearWhitelist(_whitelistedAddressQtyMap);
	}

	// function to allow the burning of NFTs
	// NFTs transfered to the SC and then burnt with contract as supply key
	// using staking tech to enable the burn
	// requires strictly 0.1 $LAZY per NFT - returned back to the contract during 'stake'
	/// @param serials array of serials to burn
	function burnNFTs(int64[] memory serials) external returns (int responseCode, uint64 newTotalSupply) {
		if (serials.length > 8) revert MintError(MinterLibrary.TOO_MANY_SERIALS_SUPPLIED);
		// get the $LAZY needed from caller
		takeLazyPayment(serials.length, msg.sender);

        // sized to a single move, expandable to up to 10 elements (untested)
        IHederaTokenService.TokenTransferList[]
            memory _transfers = new IHederaTokenService.TokenTransferList[](
                serials.length + 1
            );
        //transfer lazy token
        _transfers[0].transfers = new IHederaTokenService.AccountAmount[](2);
        _transfers[0].token = _lazyDetails.lazyToken;

        IHederaTokenService.AccountAmount memory _sendAccountAmount;
        _sendAccountAmount.accountID = address(this);
        _sendAccountAmount.amount = -1;
        _transfers[0].transfers[0] = _sendAccountAmount;

        IHederaTokenService.AccountAmount memory _recieveAccountAmount;
        _recieveAccountAmount.accountID = msg.sender;
        _recieveAccountAmount.amount = 1;
        _transfers[0].transfers[1] = _recieveAccountAmount;

        // transfer NFT
        for (uint256 i = 0; i < serials.length; i++) {
            IHederaTokenService.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = msg.sender;
            _nftTransfer.receiverAccountID = address(this);
            if (serials[i] == 0) {
                continue;
            }
            _transfers[i + 1].token = _token;
            _transfers[i + 1]
                .nftTransfers = new IHederaTokenService.NftTransfer[](1);

            _nftTransfer.serialNumber = SafeCast.toInt64(int256(serials[i]));
            _transfers[i + 1].nftTransfers[0] = _nftTransfer;
        }

        int256 response = HederaTokenService.cryptoTransfer(_transfers);

        if (response != HederaResponseCodes.SUCCESS) revert MintError(MinterLibrary.HTS_TRANSFER_TOKEN_FAIL);

		(responseCode, newTotalSupply) = burnToken(_token, 0, serials);
		// emit events for burn
		emit BurnEvent(msg.sender, serials, newTotalSupply);

		if (responseCode != HederaResponseCodes.SUCCESS) revert MintError(MinterLibrary.BURN_FAILED);
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

	/// @param lazyAmt int amount of Lazy (adjusted for decimals)
	function setBuyWlWithLazy(uint lazyAmt) external onlyOwner returns (bool changed) {
		changed = _mintEconomics.buyWlWithLazy == lazyAmt ? false : true;
		if (changed) emit MinterContractMessage(ContractEventType.UPDATE_WL_LAZY_BUY, msg.sender, lazyAmt);
		_mintEconomics.buyWlWithLazy = lazyAmt;
	}

	/// @param maxMint int of how many a WL address can mint
	function setMaxWlAddressMint(uint maxMint) external onlyOwner returns (bool changed) {
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
        _lazyDetails.lazySCT = LAZYTokenCreator(lsct);
		emit MinterContractMessage(ContractEventType.UPDATE_LAZY_SCT, msg.sender, 0);
    }

	/// @param lazy new Lazy FT address
    function updateLazyToken(address lazy) external onlyOwner {
        _lazyDetails.lazyToken = lazy;
		emit MinterContractMessage(ContractEventType.UPDATE_LAZY_TOKEN, msg.sender, 0);
    }

	function updateWlToken(address wlToken) external onlyOwner {
        _mintEconomics.wlToken = wlToken;
		emit MinterContractMessage(ContractEventType.UPDATE_WL_TOKEN, msg.sender, 0);
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
    function updateMetadataArray(string[] memory metadata, uint startIndex) external onlyOwner {
		// enforce consistency of the metadata list
		if ((startIndex + metadata.length) > _metadata.length) revert MintError(MinterLibrary.OUT_OF_RANGE);
		uint index = 0;
		for (uint i = startIndex; i < (startIndex + metadata.length); i++) {
			_metadata[i] = metadata[index];
			index++;
		}
    }

	// method to push metadata end points up
	function addMetadata(string[] memory metadata) external onlyOwner returns (uint totalLoaded) {
		if (_token != address(0)) {
			if((_totalMinted + _metadata.length + metadata.length) > _maxSupply) revert MintError(MinterLibrary.TOO_MUCH_METADATA);
		}
		for (uint i = 0; i < metadata.length; i++) {
			_metadata.push(metadata[i]);
		}
		totalLoaded = _metadata.length;
	}

	// Helper method to strip storage requirements
	// boolean toggle to remove the token ID if full reset
	/// @param removeToken reset token to zero address
	/// @param batch allow for batched reset
	function resetContract(bool removeToken, uint batch) external onlyOwner {
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

	/// @return metadataList of metadata unminted -> only owner
    function getMetadataArray(uint startIndex, uint endIndex) 
		external view onlyOwner 
		returns (string[] memory metadataList) 
	{
		if (endIndex <= startIndex) revert MintError(MinterLibrary.BAD_ARGUMENTS);
		if (endIndex > _metadata.length) revert MintError(MinterLibrary.OUT_OF_RANGE);
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

	/// @return numMinted helper function to check how many a wallet has minted
	// TODO: migrate to events?
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

	/// @return wlNumMinted helper function to check how many a wallet has minted
	// TODO: migrate to events?
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

	/// @return remainingMint number of NFTs left to mint
	// TODO: migrate to events
    function getRemainingMint() external view returns (uint256 remainingMint) {
    	remainingMint = _metadata.length;
    }

	/// @return lazy the address set for Lazy FT token
    function getLazyDetails() external view returns (address lazy, uint lazyBurn, address lazySCT) {
    	lazy = _lazyDetails.lazyToken;
		lazyBurn = _lazyDetails.lazyBurnPerc;
		lazySCT = address(_lazyDetails.lazySCT);
    }

	/// Check the current Whitelist for minting
    /// @return wl an array of addresses currently enabled for allownace approval
	//TODO: add batching
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
            ContractEventType.RECIEVE,
            msg.sender,
			msg.value
        );
    }

    fallback() external payable {
        emit MinterContractMessage(ContractEventType.FALLBACK, msg.sender, msg.value);
    }

}