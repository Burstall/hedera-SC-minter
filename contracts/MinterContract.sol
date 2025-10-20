// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/*
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 * ⚡                                                             ⚡
 * ⚡                        LAZY SUPERHEROES                     ⚡
 * ⚡                      The OG Hedera Project                  ⚡
 * ⚡                                                             ⚡
 * ⚡                        %%%%#####%%@@@@                      ⚡
 * ⚡                   @%%%@%###%%%%###%%%%%@@                   ⚡
 * ⚡                %%%%%%@@@@@@@@@@@@@@@@%##%%@@                ⚡
 * ⚡              @%%@#@@@@@@@@@@@@@@@@@@@@@@@@*%%@@             ⚡
 * ⚡            @%%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*%@@           ⚡
 * ⚡           %%%#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%#%@@         ⚡
 * ⚡          %%%@@@@@@@@@@@@@@#-:--==+#@@@@@@@@@@@@@*%@@        ⚡
 * ⚡         %@#@@@@@@@@@@@@@@*-------::%@@@@@@@@%%%%%*%@@       ⚡
 * ⚡        %%#@@@@@@@@@@@@@@@=-------:#@@@@@@@@@%%%%%%*%@@      ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@#-------:+@@@@@@@@@@%%%%%%%#%@@     ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@=------:=@@@@@@@@@@@%%%%%%%%#@@     ⚡
 * ⚡      #%#@@@%%%%%%%@@@@@%------:-@@@@@@@@@@@@@%%%%%%%#%@@    ⚡
 * ⚡      %%#@@@%%%%%%%%@@@@=------------:::@@@@@@@@%%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@%:------------::%@@@@@@@@@%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@=:::---------:-@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      #%#@@@%%%%%%%@@@@*:::::::----:-@@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      %%%%@@@@%%%%%@@@@@@@@@@-:---:=@@@@@@@@@@@@@@@@@%@@@    ⚡
 * ⚡       %%#@@@@%%%%@@@@@@@@@@@::--:*@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡       %#%#@@@%@%%%@@@@@@@@@#::::#@@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡        %%%%@@@%%%%%%@@@@@@@*:::%@@@@@@@@@@@@@@@@@@%@@@      ⚡
 * ⚡         %%#%@@%%%%%%%@@@@@@=.-%@@@@@@@@@@@@@@@@@@%@@@       ⚡
 * ⚡          %##*@%%%%%%%%%@@@@=+@@@@@@@@@@@@@@@@@@%%@@@        ⚡
 * ⚡           %##*%%%%%%%%%%@@@@@@@@@@@@@@@@@@@@@@%@@@@         ⚡
 * ⚡             %##+#%%%%%%%%@@@@@@@@@@@@@@@@@@@%@@@@           ⚡
 * ⚡               %##*=%%%%%%%@@@@@@@@@@@@@@@#@@@@@             ⚡
 * ⚡                 %##%#**#@@@@@@@@@@@@%%%@@@@@@               ⚡
 * ⚡                    %%%%@@%@@@%%@@@@@@@@@@@                  ⚡
 * ⚡                         %%%%%%%%%%%@@                       ⚡
 * ⚡                                                             ⚡
 * ⚡                 Development Team Focused on                 ⚡
 * ⚡                   Decentralized Solutions                   ⚡
 * ⚡                                                             ⚡
 * ⚡         Visit: http://lazysuperheroes.com/                  ⚡
 * ⚡            or: https://dapp.lazysuperheroes.com/            ⚡
 * ⚡                   to get your LAZY on!                      ⚡
 * ⚡                                                             ⚡
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 */

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenService} from "./HederaTokenService.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";
import {ExpiryHelper} from "./ExpiryHelper.sol";

// functionality moved to library for space saving
import {MinterLibrary} from "./MinterLibrary.sol";
import {IBurnableHTS} from "./interfaces/IBurnableHTS.sol";

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
    EnumerableMap.AddressToUintMap private whitelistedAddressQtyMap;
    LazyDetails private lazyDetails;
    string public cid;
    string[] private metadata;
    uint256 private batchSize;
    uint256 public totalMinted;
    uint256 public maxSupply;
    // map address to timestamps
    // for cooldown mechanic
    EnumerableMap.AddressToUintMap private walletMintTimeMap;
    // map serials to timestamps
    // for burn / refund mechanic
    EnumerableMap.UintToUintMap private serialMintTimeMap;
    // set of the serials used to redeem WL to ensure no double dip
    EnumerableSet.UintSet private wlSerialsUsed;
    // map WL addresses to the numbers of mints used
    // track WL mints per address for max cap
    EnumerableMap.AddressToUintMap private wlAddressToNumMintedMap;
    // map ALL addreesses to the numbers of mints used
    // track mints per wallet for max cap
    EnumerableMap.AddressToUintMap private addressToNumMintedMap;

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

    MintTiming private mintTiming;
    MintEconomics private mintEconomics;

    address private token;
    address public prngGenerator;

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
        ContractEventType _eventType,
        address indexed _msgAddress,
        uint256 _msgNumeric
    );

    event MintEvent(
        address indexed _msgAddress,
        bool _mintType,
        uint256 indexed _serial,
        string _metadata
    );

    event BurnEvent(
        address indexed _burnerAddress,
        int64[] _serials,
        uint64 _newSupply
    );

    /// @param lsct the address of the Lazy Smart Contract Treasury (for burn)
    /// @param lazy the address of the Lazy Token
    /// @param lazyBurnPerc the percentage of Lazy to burn on each mint
    constructor(address lsct, address lazy, uint256 lazyBurnPerc) {
        lazyDetails = LazyDetails(lazy, lazyBurnPerc, IBurnableHTS(lsct));

        int256 responseCode = associateToken(
            address(this),
            lazyDetails.lazyToken
        );
        if (responseCode.toInt32() != HederaResponseCodes.SUCCESS) {
            revert AssociationFailed();
        }

        mintEconomics = MintEconomics(false, 0, 0, 0, 20, 0, 0, 0, address(0));
        mintTiming = MintTiming(0, 0, true, 0, 0, false);
        batchSize = 10;
    }

    // Supply the contract with token details and _metadata
    // Once basic integrity checks are done the token will mint and the address will be returned
    /// @param _name token name
    /// @param _symbol token symbol
    /// @param _memo token longer form description as a string
    /// @param _cid root _cid for the _metadata files
    /// @param _royalties array of NFTFeeObject to set the royalties
    /// @param _maxIssuance 0 or less to size based off _metadata else will override
    /// @return _createdTokenAddress the address of the new token
    function initialiseNFTMint(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        string memory _cid,
        NFTFeeObject[] memory _royalties,
        int64 _maxIssuance
    )
        external
        payable
        onlyOwner
        returns (address _createdTokenAddress, uint256 _maxSupply)
    {
        if (token != address(0)) revert NotReset(token);
        if (bytes(_memo).length > 100) revert MemoTooLong();
        if (_royalties.length > 10) revert TooManyFees();

        cid = _cid;

        // instantiate the list of keys we'll use for token create
        IHederaTokenService.TokenKey[]
            memory _keys = new IHederaTokenService.TokenKey[](1);

        _keys[0] = getSingleKey(
            KeyType.SUPPLY,
            KeyValueType.CONTRACT_ID,
            address(this)
        );

        IHederaTokenService.HederaToken memory _token;
        _token.name = _name;
        _token.symbol = _symbol;
        _token.memo = _memo;
        _token.treasury = address(this);
        _token.tokenKeys = _keys;
        _token.tokenSupplyType = true;
        if (_maxIssuance > 0) {
            // check that there is not already too much metadats in the contract
            if (metadata.length > _maxIssuance.toUint256())
                revert TooMuchMetadata();
            _token.maxSupply = _maxIssuance;
        } else {
            if (metadata.length == 0) revert EmptyMetadata();
            _token.maxSupply = metadata.length.toInt256().toInt64();
        }
        maxSupply = SafeCast.toUint256(_token.maxSupply);
        // create the expiry schedule for the token using ExpiryHelper
        _token.expiry = createAutoRenewExpiry(
            address(this),
            DEFAULT_AUTO_RENEW_PERIOD
        );

        // translate fee objects to avoid oddities from serialisation of default/empty values
        IHederaTokenService.RoyaltyFee[]
            memory _fees = new IHederaTokenService.RoyaltyFee[](
                _royalties.length
            );

        uint256 _length = _royalties.length;
        for (uint256 f = 0; f < _length; ) {
            IHederaTokenService.RoyaltyFee memory _fee;
            _fee.numerator = _royalties[f].numerator;
            _fee.denominator = _royalties[f].denominator;
            _fee.feeCollector = _royalties[f].account;

            if (_royalties[f].fallbackfee != 0) {
                _fee.amount = _royalties[f].fallbackfee;
                _fee.useHbarsForPayment = true;
            }

            _fees[f] = _fee;

            unchecked {
                ++f;
            }
        }

        (
            int32 responseCode,
            address tokenAddress
        ) = createNonFungibleTokenWithCustomFees(
                _token,
                new IHederaTokenService.FixedFee[](0),
                _fees
            );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedToMint();
        }

        token = tokenAddress;
        // set the return values
        _maxSupply = maxSupply;
        _createdTokenAddress = token;

        emit MinterContractMessage(
            ContractEventType.INITIALISE,
            token,
            _maxSupply
        );
    }

    /// @param _numberToMint the number of serials to mint
    /// @return _serials the serials minted
    /// @return _metadataForMint the metadata for the minted serials
    function mintNFT(
        uint256 _numberToMint
    )
        external
        payable
        nonReentrant
        returns (int64[] memory _serials, bytes[] memory _metadataForMint)
    {
        if (_numberToMint == 0) revert BadQuantity(_numberToMint);
        if (
            mintTiming.mintStartTime != 0 &&
            mintTiming.mintStartTime > block.timestamp
        ) revert NotOpen();
        if (mintTiming.mintPaused) revert Paused();
        if (_numberToMint > metadata.length) revert MintedOut();
        if (_numberToMint > mintEconomics.maxMint) revert MaxMintExceeded();

        bool isWlMint = false;
        // Design decision: WL max mint per wallet takes priority
        // over max mint per wallet
        if (mintTiming.wlOnly) {
            if (
                !MinterLibrary.checkWhitelistConditions(
                    whitelistedAddressQtyMap,
                    msg.sender,
                    mintEconomics.maxWlAddressMint
                )
            ) revert NotWL();
            // only check the qty if there is a limit at contract level
            if (mintEconomics.maxWlAddressMint > 0) {
                // we know the address is in the list to get here.
                uint256 wlMintsRemaining = whitelistedAddressQtyMap.get(
                    msg.sender
                );
                if (wlMintsRemaining < _numberToMint) revert NotEnoughWLSlots();
                whitelistedAddressQtyMap.set(
                    msg.sender,
                    wlMintsRemaining -= _numberToMint
                );
            }
            isWlMint = true;
        } else if (mintEconomics.maxMintPerWallet > 0) {
            (bool found, uint256 numPreviouslyMinted) = addressToNumMintedMap
                .tryGet(msg.sender);
            if (!found) {
                numPreviouslyMinted = 0;
            }

            if (
                (numPreviouslyMinted + _numberToMint) >
                mintEconomics.maxMintPerWallet
            ) revert MaxMintPerWalletExceeded();
        }

        //calculate cost
        (uint256 hbarCost, uint256 lazyCost) = getCostInternal(isWlMint);
        uint256 totalHbarCost = _numberToMint * hbarCost;
        uint256 totalLazyCost = _numberToMint * lazyCost;

        // take the payment
        if (totalLazyCost > 0) {
            takeLazyPayment(
                totalLazyCost,
                mintEconomics.lazyFromContract ? address(this) : msg.sender
            );
        }

        if (totalHbarCost > 0) {
            if (msg.value < totalHbarCost) revert NotEnoughHbar();
        }

        // pop the _metadata
        _metadataForMint = MinterLibrary.selectMetdataToMint(
            metadata,
            _numberToMint,
            cid,
            prngGenerator
        );

        int64[] memory mintedSerials = new int64[](_numberToMint);
        for (uint256 outer = 0; outer < _numberToMint; outer += batchSize) {
            uint256 thisBatch = (_numberToMint - outer) >= batchSize
                ? batchSize
                : (_numberToMint - outer);
            bytes[] memory batchMetadataForMint = new bytes[](thisBatch);
            for (
                uint256 inner = 0;
                ((outer + inner) < _numberToMint) && (inner < thisBatch);
                inner++
            ) {
                batchMetadataForMint[inner] = _metadataForMint[inner + outer];
            }

            (int32 responseCode, , int64[] memory serialNumbers) = mintToken(
                token,
                0,
                batchMetadataForMint
            );

            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert FailedNFTMint();
            }

            // transfer the token to the user
            address[] memory senderList = new address[](serialNumbers.length);
            address[] memory receiverList = new address[](serialNumbers.length);
            uint256 length = serialNumbers.length;
            for (uint256 s = 0; s < length; ) {
                emitMintEvent(
                    isWlMint,
                    serialNumbers[s],
                    batchMetadataForMint[s]
                );
                senderList[s] = address(this);
                receiverList[s] = msg.sender;
                mintedSerials[s + outer] = serialNumbers[s];
                serialMintTimeMap.set(
                    SafeCast.toUint256(serialNumbers[s]),
                    block.timestamp
                );

                unchecked {
                    ++s;
                }
            }

            responseCode = transferNFTs(
                token,
                senderList,
                receiverList,
                serialNumbers
            );

            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert NFTTransferFailed();
            }
        }

        mintTiming.lastMintTime = block.timestamp;
        walletMintTimeMap.set(msg.sender, block.timestamp);

        if (isWlMint) {
            (
                bool wlFound,
                uint256 wlNumPreviouslyMinted
            ) = wlAddressToNumMintedMap.tryGet(msg.sender);
            if (wlFound) {
                wlAddressToNumMintedMap.set(
                    msg.sender,
                    wlNumPreviouslyMinted + _numberToMint
                );
            } else {
                wlAddressToNumMintedMap.set(msg.sender, _numberToMint);
            }
        }

        // track all minters in case max mint per wallet required
        (
            bool numMintfound,
            uint256 totalNumPreviouslyMinted
        ) = addressToNumMintedMap.tryGet(msg.sender);
        if (numMintfound) {
            addressToNumMintedMap.set(
                msg.sender,
                totalNumPreviouslyMinted + _numberToMint
            );
        } else {
            addressToNumMintedMap.set(msg.sender, _numberToMint);
        }

        totalMinted += _numberToMint;

        _serials = mintedSerials;
    }

    /// @param _amount Non-negative value to take as pmt.
    /// @param _payer the address of the payer
    function takeLazyPayment(uint256 _amount, address _payer) internal {
        if (_payer != address(this)) {
            // check the payer has the required amount && the allowance is in place
            if (
                IERC20(lazyDetails.lazyToken).balanceOf(_payer) < _amount &&
                IERC20(lazyDetails.lazyToken).allowance(
                    _payer,
                    address(this)
                ) >=
                _amount
            ) revert NotEnoughLazy();
            bool success = IERC20(lazyDetails.lazyToken).transferFrom(
                _payer,
                address(this),
                _amount
            );
            if (!success) {
                revert FailedToPayLazy();
            }
        }

        uint256 burnAmt = (_amount * lazyDetails.lazyBurnPerc) / 100;

        // This is a safe cast to uint32 as max value is >> max supply of Lazy

        if (burnAmt > 0) {
            int256 _responseCode = lazyDetails.lazySCT.burn(
                lazyDetails.lazyToken,
                SafeCast.toUint32(burnAmt)
            );
            if (_responseCode != HederaResponseCodes.SUCCESS) {
                revert BurnFailed();
            }
        }
        emit MinterContractMessage(ContractEventType.LAZY_PMT, _payer, _amount);
    }

    /// @param _isWlMint boolean to indicate if the mint is a WL mint
    /// @return _hbarCost the cost in Hbar
    /// @return _lazyCost the cost in Lazy
    function getCostInternal(
        bool _isWlMint
    ) internal view returns (uint256 _hbarCost, uint256 _lazyCost) {
        if (_isWlMint) {
            _hbarCost =
                (mintEconomics.mintPriceHbar *
                    (100 - mintEconomics.wlDiscount)) /
                100;
            _lazyCost =
                (mintEconomics.mintPriceLazy *
                    (100 - mintEconomics.wlDiscount)) /
                100;
        } else {
            _hbarCost = mintEconomics.mintPriceHbar;
            _lazyCost = mintEconomics.mintPriceLazy;
        }
    }

    // function to asses the cost to mint for a user
    // currently flat cost, eventually dynamic on holdings
    /// @return _hbarCost
    /// @return _lazyCost
    function getCost()
        external
        view
        returns (uint256 _hbarCost, uint256 _lazyCost)
    {
        (_hbarCost, _lazyCost) = getCostInternal(
            MinterLibrary.checkWhitelistConditions(
                whitelistedAddressQtyMap,
                msg.sender,
                mintEconomics.maxWlAddressMint
            )
        );
    }

    /// @param _receiver The receiver of the transaction
    /// @param _amount Non-negative value to send. a negative value will result in a failure.
    function retrieveLazy(
        address _receiver,
        uint256 _amount
    ) external onlyOwner {
        if (
            block.timestamp <
            (mintTiming.lastMintTime + mintTiming.refundWindow)
        ) revert LazyCooldown();

        bool success = IERC20(lazyDetails.lazyToken).transfer(
            _receiver,
            _amount
        );
        if (!success) {
            revert FailedToPayLazy();
        }
    }

    /// @return _wlSpotsPurchased number of spots purchased
    function buyWlWithLazy() external returns (uint256 _wlSpotsPurchased) {
        if (mintEconomics.buyWlWithLazy == 0) revert WLPurchaseFailed();

        _wlSpotsPurchased = whitelistedAddressQtyMap.contains(msg.sender)
            ? whitelistedAddressQtyMap.get(msg.sender) +
                mintEconomics.maxWlAddressMint
            : mintEconomics.maxWlAddressMint;

        whitelistedAddressQtyMap.set(msg.sender, _wlSpotsPurchased);
        takeLazyPayment(mintEconomics.buyWlWithLazy, msg.sender);
        emit MinterContractMessage(
            ContractEventType.WL_PURCHASE_LAZY,
            msg.sender,
            _wlSpotsPurchased
        );
    }

    /// @param _serials array of serials to use for purchase
    /// @return _wlSpotsPurchased number of sports purchased
    function buyWlWithTokens(
        uint256[] memory _serials
    ) external returns (uint256 _wlSpotsPurchased) {
        if (mintEconomics.wlToken == address(0)) revert NoWLToken();

        for (uint8 i = 0; i < _serials.length; i++) {
            // check no double dipping
            if (wlSerialsUsed.contains(_serials[i])) revert WLTokenUsed();
            // check user owns the token
            if (
                IERC721(mintEconomics.wlToken).ownerOf(_serials[i]) !=
                msg.sender
            ) revert NotTokenOwner();
            wlSerialsUsed.add(_serials[i]);
            emit MinterContractMessage(
                ContractEventType.WL_PURCHASE_TOKEN,
                msg.sender,
                _serials[i]
            );
        }

        _wlSpotsPurchased = whitelistedAddressQtyMap.contains(msg.sender)
            ? whitelistedAddressQtyMap.get(msg.sender) +
                (mintEconomics.maxWlAddressMint * _serials.length)
            : (mintEconomics.maxWlAddressMint * _serials.length);
        whitelistedAddressQtyMap.set(msg.sender, _wlSpotsPurchased);
    }

    // Transfer hbar out of the contract
    // using OZ sendValue()
    /// @param receiverAddress address in EVM format of the reciever of the hbar
    /// @param amount number of tokens to send (in long form adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyOwner {
        if (
            block.timestamp <
            (mintTiming.lastMintTime + mintTiming.refundWindow)
        ) revert HbarCooldown();
        // throws error on failure
        //receiverAddress.transfer(amount);
        Address.sendValue(receiverAddress, amount);
    }

    // Add an address to the allowance WL
    /// @param _newAddresses array of addresses to add
    function addToWhitelist(address[] memory _newAddresses) external onlyOwner {
        uint256 _length = _newAddresses.length;
        for (uint256 a = 0; a < _length; ) {
            bool result = whitelistedAddressQtyMap.set(
                _newAddresses[a],
                mintEconomics.maxWlAddressMint
            );
            emit MinterContractMessage(
                ContractEventType.WL_ADD,
                _newAddresses[a],
                result ? 1 : 0
            );

            unchecked {
                ++a;
            }
        }
    }

    // Remove an address to the allowance WL
    /// @param _oldAddresses the address to remove
    function removeFromWhitelist(
        address[] memory _oldAddresses
    ) external onlyOwner {
        uint256 _length = _oldAddresses.length;
        for (uint256 a = 0; a < _length; ) {
            bool result = whitelistedAddressQtyMap.remove(_oldAddresses[a]);
            emit MinterContractMessage(
                ContractEventType.WL_REMOVE,
                _oldAddresses[a],
                result ? 1 : 0
            );

            unchecked {
                ++a;
            }
        }
    }

    // clear the whole WL
    /// @return _numAddressesRemoved how many WL entries were removed.
    function clearWhitelist()
        external
        onlyOwner
        returns (uint256 _numAddressesRemoved)
    {
        _numAddressesRemoved = MinterLibrary.clearWhitelist(
            whitelistedAddressQtyMap
        );
    }

    // function to allow the burning of NFTs (as long as no fallback fee)
    // NFTs transfered to the SC and then burnt with contract as supply key
    /// @param _serialNumbers array of serials to burn
    /// @return _newTotalSupply the new total supply of the NFT
    function burnNFTs(
        int64[] memory _serialNumbers
    ) external returns (uint64 _newTotalSupply) {
        if (_serialNumbers.length > 10) revert MaxSerials();
        // need to transfer back to treasury to burn
        address[] memory senderList = new address[](_serialNumbers.length);
        address[] memory receiverList = new address[](_serialNumbers.length);
        uint256 _length = _serialNumbers.length;
        for (uint256 s = 0; s < _length; ) {
            senderList[s] = msg.sender;
            receiverList[s] = address(this);

            unchecked {
                ++s;
            }
        }

        // Need to check if this allows approval based transfers, else move it to 'stake' code
        int32 responseCode = transferNFTs(
            token,
            senderList,
            receiverList,
            _serialNumbers
        );
        // emit events for each transfer

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed();
        }

        (responseCode, _newTotalSupply) = burnToken(token, 0, _serialNumbers);
        // emit events for burn
        emit BurnEvent(msg.sender, _serialNumbers, _newTotalSupply);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert BurnFailed();
        }
    }

    // unsigned ints so no ability to set a negative cost.
    /// @param _hbarCost in *tinybar*
    /// @param _lazyCost adjusted for the decimal of 1.
    function updateCost(
        uint256 _hbarCost,
        uint256 _lazyCost
    ) external onlyOwner {
        if (mintEconomics.mintPriceHbar != _hbarCost) {
            mintEconomics.mintPriceHbar = _hbarCost;
            emit MinterContractMessage(
                ContractEventType.UPDATE_MINT_PRICE,
                msg.sender,
                mintEconomics.mintPriceHbar
            );
        }

        if (mintEconomics.mintPriceLazy != _lazyCost) {
            mintEconomics.mintPriceLazy = _lazyCost;
            emit MinterContractMessage(
                ContractEventType.UPDATE_MINT_PRICE_LAZY,
                msg.sender,
                mintEconomics.mintPriceLazy
            );
        }
    }

    /// @param _mintPaused boolean to pause (true) or release (false)
    /// @return _changed indicative of whether a change was made
    function updatePauseStatus(
        bool _mintPaused
    ) external onlyOwner returns (bool _changed) {
        _changed = mintTiming.mintPaused == _mintPaused ? false : true;
        if (_changed)
            emit MinterContractMessage(
                _mintPaused
                    ? ContractEventType.PAUSE
                    : ContractEventType.UNPAUSE,
                msg.sender,
                _mintPaused ? 1 : 0
            );
        mintTiming.mintPaused = _mintPaused;
    }

    /// @param _wlOnly boolean to lock mint to WL only
    /// @return _changed indicative of whether a change was made
    function updateWlOnlyStatus(
        bool _wlOnly
    ) external onlyOwner returns (bool _changed) {
        _changed = mintTiming.wlOnly == _wlOnly ? false : true;
        if (_changed)
            emit MinterContractMessage(
                ContractEventType.UPDATE_WL_ONLY,
                msg.sender,
                _wlOnly ? 1 : 0
            );
        mintTiming.wlOnly = _wlOnly;
    }

    /// @param _prng address of the new PRNG Generator
    function updatePrng(address _prng) external onlyOwner {
        prngGenerator = _prng;
    }

    /// @param _lazyAmt int amount of Lazy (adjusted for decimals)
    function setBuyWlWithLazy(
        uint256 _lazyAmt
    ) external onlyOwner returns (bool _changed) {
        _changed = mintEconomics.buyWlWithLazy == _lazyAmt ? false : true;
        if (_changed)
            emit MinterContractMessage(
                ContractEventType.UPDATE_WL_LAZY_BUY,
                msg.sender,
                _lazyAmt
            );
        mintEconomics.buyWlWithLazy = _lazyAmt;
    }

    /// @param _maxMint int of how many a WL address can mint
    function setMaxWlAddressMint(
        uint256 _maxMint
    ) external onlyOwner returns (bool _changed) {
        _changed = mintEconomics.maxWlAddressMint == _maxMint ? false : true;
        if (_changed)
            emit MinterContractMessage(
                ContractEventType.UPDATE_WL_MAX,
                msg.sender,
                _maxMint
            );
        mintEconomics.maxWlAddressMint = _maxMint;
    }

    /// @param _lazyFromContract boolean to pay (true) or release (false)
    /// @return _changed indicative of whether a change was made
    function updateContractPaysLazy(
        bool _lazyFromContract
    ) external onlyOwner returns (bool _changed) {
        _changed = mintEconomics.lazyFromContract == _lazyFromContract
            ? false
            : true;
        if (_changed)
            emit MinterContractMessage(
                ContractEventType.UPDATE_LAZY_FROM_CONTRACT,
                msg.sender,
                _lazyFromContract ? 1 : 0
            );
        mintEconomics.lazyFromContract = _lazyFromContract;
    }

    /// @param _startTime new start time in seconds
    function updateMintStartTime(uint256 _startTime) external onlyOwner {
        mintTiming.mintStartTime = _startTime;
        emit MinterContractMessage(
            ContractEventType.UPDATE_MINT_START_TIME,
            msg.sender,
            _startTime
        );
    }

    /// @param _batchSize updated minting batch just in case
    function updateBatchSize(
        uint256 _batchSize
    ) external onlyOwner returns (bool _changed) {
        if ((_batchSize == 0) || (_batchSize > 10)) revert BadArguments();
        _changed = batchSize == _batchSize ? false : true;
        batchSize = _batchSize;
    }

    /// @param _lbp new Lazy SC Treasury address
    function updateLazyBurnPercentage(uint256 _lbp) external onlyOwner {
        lazyDetails.lazyBurnPerc = _lbp;
        emit MinterContractMessage(
            ContractEventType.UPDATE_LAZY_BURN_PERCENTAGE,
            msg.sender,
            _lbp
        );
    }

    /// @param _maxMint new max mint (0 = uncapped)
    function updateMaxMint(uint256 _maxMint) external onlyOwner {
        mintEconomics.maxMint = _maxMint;
        emit MinterContractMessage(
            ContractEventType.UPDATE_MAX_MINT,
            msg.sender,
            _maxMint
        );
    }

    /// @param _wlDiscount as percentage
    function updateWlDiscount(uint256 _wlDiscount) external onlyOwner {
        mintEconomics.wlDiscount = _wlDiscount;
        emit MinterContractMessage(
            ContractEventType.UPDATE_WL_DISCOUNT,
            msg.sender,
            _wlDiscount
        );
    }

    /// @param _cooldownPeriod cooldown period as seconds
    function updateCooldown(uint256 _cooldownPeriod) external onlyOwner {
        mintTiming.cooldownPeriod = _cooldownPeriod;
        emit MinterContractMessage(
            ContractEventType.UPDATE_COOLDOWN,
            msg.sender,
            _cooldownPeriod
        );
    }

    /// @param _refundWindow refund period in seconds / cap on withdrawals
    function updateRefundWindow(uint256 _refundWindow) external onlyOwner {
        mintTiming.refundWindow = _refundWindow;
        emit MinterContractMessage(
            ContractEventType.UPDATE_REFUND_WINDOW,
            msg.sender,
            _refundWindow
        );
    }

    /// @param _lsct new Lazy SC Treasury address
    function updateLSCT(address _lsct) external onlyOwner {
        lazyDetails.lazySCT = IBurnableHTS(_lsct);
    }

    /// @return _lsct the address set for the current lazy SC Treasury
    function getLSCT() external view returns (address _lsct) {
        _lsct = address(lazyDetails.lazySCT);
    }

    /// @param _lazy new Lazy FT address
    function updateLazyToken(address _lazy) external onlyOwner {
        lazyDetails.lazyToken = _lazy;
    }

    function updateWlToken(address _wlToken) external onlyOwner {
        mintEconomics.wlToken = _wlToken;
        emit MinterContractMessage(
            ContractEventType.UPDATE_WL_TOKEN,
            _wlToken,
            0
        );
    }

    function updateMaxMintPerWallet(uint256 _max) external onlyOwner {
        mintEconomics.maxMintPerWallet = _max;
        emit MinterContractMessage(
            ContractEventType.UPDATE_MAX_WALLET_MINT,
            msg.sender,
            _max
        );
    }

    /// @param _cid new _cid
    function updateCID(string memory _cid) external onlyOwner {
        cid = _cid;
        emit MinterContractMessage(ContractEventType.UPDATE_CID, msg.sender, 0);
    }

    /// @param _metadata new _metadata array
    function updateMetadataArray(
        string[] memory _metadata,
        uint256 _startIndex
    ) external onlyOwner {
        // enforce consistency of the _metadata list
        if ((_startIndex + _metadata.length) > metadata.length)
            revert TooMuchMetadata();
        uint256 index = 0;
        for (uint256 i = _startIndex; i < (_startIndex + _metadata.length); ) {
            metadata[i] = _metadata[index];
            index++;
            unchecked {
                ++i;
            }
        }
    }

    // method to push _metadata end points up
    function addMetadata(
        string[] memory _metadata
    ) external onlyOwner returns (uint256 _totalLoaded) {
        if (token != address(0)) {
            if ((totalMinted + metadata.length + _metadata.length) > maxSupply)
                revert TooMuchMetadata();
        }
        for (uint256 i = 0; i < _metadata.length; ) {
            metadata.push(_metadata[i]);

            unchecked {
                ++i;
            }
        }
        _totalLoaded = metadata.length;
    }

    // Helper method to strip storage requirements
    // boolean toggle to remove the token ID if full reset
    /// @param _removeToken reset token to zero address
    /// @param _batch allow for batched reset
    function resetContract(
        bool _removeToken,
        uint256 _batch
    ) external onlyOwner returns (uint256 _remaingItems) {
        if (_removeToken) {
            token = address(0);
            totalMinted = 0;
        }
        _remaingItems = MinterLibrary.resetContract(
            addressToNumMintedMap,
            metadata,
            walletMintTimeMap,
            wlAddressToNumMintedMap,
            serialMintTimeMap,
            wlSerialsUsed,
            _batch
        );

        emit MinterContractMessage(
            _removeToken
                ? ContractEventType.RESET_INC_TOKEN
                : ContractEventType.RESET_CONTRACT,
            msg.sender,
            _batch
        );
    }

    /// @return _metadataList of _metadata unminted
    // no point in obfuscating the ability to view unminted _metadata
    // technical workarounds are trivial.
    function getMetadataArray(
        uint256 _startIndex,
        uint256 _endIndex
    ) external view returns (string[] memory _metadataList) {
        if (_endIndex <= _startIndex) revert BadArguments();
        if (_endIndex > metadata.length) revert TooMuchMetadata();
        _metadataList = new string[](_endIndex - _startIndex);
        uint256 index = 0;
        for (uint256 i = _startIndex; i < _endIndex; ) {
            _metadataList[index] = metadata[i];
            index++;
            unchecked {
                ++i;
            }
        }
    }

    /// @return _token the address for the NFT to be minted
    function getNFTTokenAddress() external view returns (address _token) {
        _token = token;
    }

    /// @return _lazy the address set for Lazy FT token
    function getLazyToken() external view returns (address _lazy) {
        _lazy = lazyDetails.lazyToken;
    }

    /// @return _numMinted helper function to check how many a wallet has minted
    function getNumberMintedByAddress()
        external
        view
        returns (uint256 _numMinted)
    {
        bool found;
        uint256 numPreviouslyMinted;
        (found, numPreviouslyMinted) = addressToNumMintedMap.tryGet(msg.sender);
        if (found) {
            _numMinted = numPreviouslyMinted;
        } else {
            _numMinted = 0;
        }
    }

    // Likely only viable with smaller mints
    /// @return _walletList list of wallets who minted
    /// @return _numMintedList lst of number minted
    function getNumberMintedByAllAddresses()
        external
        view
        onlyOwner
        returns (address[] memory _walletList, uint256[] memory _numMintedList)
    {
        _walletList = new address[](addressToNumMintedMap.length());
        _numMintedList = new uint256[](addressToNumMintedMap.length());
        uint256 _length = addressToNumMintedMap.length();
        for (uint256 a = 0; a < _length; ) {
            (_walletList[a], _numMintedList[a]) = addressToNumMintedMap.at(a);
            unchecked {
                ++a;
            }
        }
    }

    /// @return _wlNumMinted helper function to check how many a wallet has minted
    function getNumberMintedByWlAddress()
        external
        view
        returns (uint256 _wlNumMinted)
    {
        bool found;
        uint256 numPreviouslyMinted;
        (found, numPreviouslyMinted) = wlAddressToNumMintedMap.tryGet(
            msg.sender
        );
        if (found) {
            _wlNumMinted = numPreviouslyMinted;
        } else {
            _wlNumMinted = 0;
        }
    }

    // Likely only viable with smaller mints
    // else gather via events emitted.
    // TODO: Create a batched retrieval
    /// @return _wlWalletList list of wallets who minted
    /// @return _wlNumMintedList lst of number minted
    function getNumberMintedByAllWlAddresses()
        external
        view
        returns (
            address[] memory _wlWalletList,
            uint256[] memory _wlNumMintedList
        )
    {
        (_wlWalletList, _wlNumMintedList) = MinterLibrary
            .getNumberMintedByAllWlAddressesBatch(
                wlAddressToNumMintedMap,
                0,
                wlAddressToNumMintedMap.length()
            );
    }

    function getNumberMintedByAllWlAddressesBatch(
        uint256 _offset,
        uint256 _batchSize
    )
        external
        view
        returns (
            address[] memory _wlWalletList,
            uint256[] memory _wlNumMintedList
        )
    {
        (_wlWalletList, _wlNumMintedList) = MinterLibrary
            .getNumberMintedByAllWlAddressesBatch(
                wlAddressToNumMintedMap,
                _offset,
                _batchSize
            );
    }

    /// @return _remainingMint number of NFTs left to mint
    function getRemainingMint() external view returns (uint256 _remainingMint) {
        _remainingMint = metadata.length;
    }

    /// @return _batchSize the size for mint/transfer
    function getBatchSize() external view returns (uint256 _batchSize) {
        _batchSize = batchSize;
    }

    /// @return _lazyBurn percentage of lazy to brun each interaction
    function getLazyBurnPercentage() external view returns (uint256 _lazyBurn) {
        _lazyBurn = lazyDetails.lazyBurnPerc;
    }

    /// Check the current Whitelist for minting
    /// @return _wl an array of addresses on WL
    /// @return _wlQty an array of the number of mints allowed
    function getWhitelist()
        external
        view
        returns (address[] memory _wl, uint256[] memory _wlQty)
    {
        uint256 _length = whitelistedAddressQtyMap.length();
        _wl = new address[](_length);
        _wlQty = new uint256[](_length);

        for (uint256 a = 0; a < _length; ) {
            (_wl[a], _wlQty[a]) = whitelistedAddressQtyMap.at(a);
            unchecked {
                ++a;
            }
        }
    }

    /// @return _mintEconomics basic struct with mint economics details
    function getMintEconomics()
        external
        view
        returns (MintEconomics memory _mintEconomics)
    {
        _mintEconomics = mintEconomics;
    }

    /// @return _mintTiming basic struct with mint economics details
    function getMintTiming()
        external
        view
        returns (MintTiming memory _mintTiming)
    {
        _mintTiming = mintTiming;
    }

    // Check if the address is in the WL
    /// @param addressToCheck the address to check in WL
    /// @return _inWl if in the WL
    /// @return _qty the number of WL mints (0 = unbounded)
    function isAddressWL(
        address addressToCheck
    ) external view returns (bool _inWl, uint256 _qty) {
        (_inWl, _qty) = whitelistedAddressQtyMap.tryGet(addressToCheck);
    }

    /// Stack too deep - so split out
    function emitMintEvent(
        bool _isWlMint,
        int64 _serial,
        bytes memory _metadata
    ) internal {
        emit MintEvent(
            msg.sender,
            _isWlMint,
            _serial.toUint256(),
            string(_metadata)
        );
    }

    receive() external payable {}

    fallback() external payable {}
}
