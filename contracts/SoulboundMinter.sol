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
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";
import {ExpiryHelper} from "./ExpiryHelper.sol";
import {IHRC719} from "./interfaces/IHRC719.sol";
import {IPrngGenerator} from "./interfaces/IPrngGenerator.sol";
import {Bits} from "./KeyHelper.sol";

import {IBurnableHTS} from "./interfaces/IBurnableHTS.sol";

// Import OpenZeppelin Contracts libraries where needed
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

// Minter Contract to mint Soulbound NFTs
contract SoulboundMinter is ExpiryHelper, Ownable, ReentrancyGuard {
    using EnumerableMap for EnumerableMap.AddressToUintMap;
    using EnumerableMap for EnumerableMap.UintToUintMap;
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeCast for uint256;
    using SafeCast for int64;
    using SafeCast for int256;
    using Address for address;
    using Strings for string;
    using Bits for uint256;

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

    error NotReset();
    error MemoTooLong();
    error TooManyFees();
    error TooMuchMetadata();
    error EmptyMetadata();
    error FailedToMint();
    error BadQuantity();
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
    error NotTokenOwner();
    error WLTokenUsed();
    error NoWLToken();
    error MaxSerials();
    error BadArguments();
    error FreezingFailed();
    error UnFreezingFailed();
    error NotRevokable();
    error NFTNotOwned();

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
        UPDATE_REFUND_WINDOW,
        REVOKE_SBT
    }

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
        // adjusted for decimal [e.g. 1 $LAZY = 10 given decimal of 1]
        uint256 mintPriceLazy;
        // as a percentage (whole % -> 20% = 20)
        uint256 wlDiscount;
        // maximum number of mints in a single transaction
        uint256 maxMint;
        // if > 0 the amount of the fungible $LAZY token to buy a WL slot(s)
        uint256 buyWlWithLazy;
        // 0 = uncapped mints per WL, > 0 = X mints per WL purchase ($LAZY or via serial)
        uint256 maxWlAddressMint;
        // maximum number of mints per wallet (default = 0 = uncapped)
        uint256 maxMintPerWallet;
        // address of the token to use for WL purchase (once per serial)
        address wlToken;
    }

    struct LazyDetails {
        address lazyToken;
        uint256 lazyBurnPerc;
        IBurnableHTS lazySCT;
    }

    // decidion to allow wipe of SBT to be made on deployment
    bool public immutable REVOCABLE;

    MintTiming private mintTiming;
    MintEconomics private mintEconomics;

    address private token;
    address private prngGenerator;
    bool public fixedEdition;

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
    constructor(
        address lsct,
        address lazy,
        uint256 lazyBurnPerc,
        bool _revocable
    ) {
        lazyDetails = LazyDetails(lazy, lazyBurnPerc, IBurnableHTS(lsct));

        uint256 responseCode = IHRC719(lazyDetails.lazyToken).associate();
        if (responseCode.toInt256().toInt32() != HederaResponseCodes.SUCCESS) {
            revert AssociationFailed();
        }

        // by default max 1 mint per wallet, singular mint
        mintEconomics = MintEconomics(false, 0, 0, 0, 1, 0, 1, 1, address(0));
        mintTiming = MintTiming(0, 0, true, 0, 0, false);
        batchSize = 1;

        REVOCABLE = _revocable;
    }

    // ============================================
    // Main Contract Functions
    // ============================================

    // Supply the contract with token details and _metadata
    // Once basic integrity checks are done the token will mint and the address will be returned
    /// @param _name token name
    /// @param _symbol token symbol
    /// @param _memo token longer form description as a string
    /// @param _cid root _cid for the _metadata files
    /// @param _maxSupply must be > 0 if _fixedEdition is true
    /// @param _fixedEdition boolean to indicate if the token is a fixed edition (repeated metadata)
    /// @param _unlimitedSupply boolean to indicate if the token has an unlimited supply (used with _fixedEdition)
    /// @return _createdTokenAddress the address of the new token
    /// @return _tokenSupply the total supply of the token
    function initialiseNFTMint(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        string memory _cid,
        int64 _maxSupply,
        bool _fixedEdition,
        bool _unlimitedSupply
    )
        external
        payable
        onlyOwner
        returns (address _createdTokenAddress, uint256 _tokenSupply)
    {
        // block the method if the token has already been set
        if (token != address(0)) revert NotReset();
        if (bytes(_memo).length > 100) revert MemoTooLong();
        if (_fixedEdition && !_unlimitedSupply && _maxSupply == 0)
            revert BadArguments();

        cid = _cid;

        // instantiate the list of keys we'll use for token create
        IHederaTokenService.TokenKey[]
            memory _keys = new IHederaTokenService.TokenKey[](1);

        // create the key for the token
        _keys[0] = getSBTContractMintKey(REVOCABLE, address(this));

        IHederaTokenService.HederaToken memory _token;
        _token.name = _name;
        _token.symbol = _symbol;
        _token.memo = _memo;
        _token.treasury = address(this);
        _token.tokenKeys = _keys;
        if (_fixedEdition && _unlimitedSupply) {
            // if any metadata is present, revert as contract likely misconfigured (or needs reset)
            if (metadata.length > 0) revert TooMuchMetadata();
            _token.tokenSupplyType = false;
            // int64 max value
            maxSupply = 0x7FFFFFFFFFFFFFFF;
        } else {
            _token.tokenSupplyType = true;
            if (_fixedEdition || _maxSupply > 0) {
                // check that there is not already too much metadata in the contract
                if (metadata.length > _maxSupply.toUint256())
                    revert TooMuchMetadata();
                _token.maxSupply = _maxSupply;
            } else {
                if (metadata.length == 0) revert EmptyMetadata();
                _token.maxSupply = metadata.length.toInt256().toInt64();
            }
            maxSupply = _token.maxSupply.toUint256();
        }

        fixedEdition = _fixedEdition;
        // create the expiry schedule for the token using ExpiryHelper
        _token.expiry = createAutoRenewExpiry(
            address(this),
            DEFAULT_AUTO_RENEW_PERIOD
        );

        (int32 responseCode, address tokenAddress) = createNonFungibleToken(
            _token
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedToMint();
        }

        token = tokenAddress;
        // set the return values
        _createdTokenAddress = token;
        _tokenSupply = maxSupply;

        emitMessage(ContractEventType.INITIALISE, token, maxSupply);
    }

    /// @param _numberToMint the number of NFTs to mint
    /// Regular method with user paying for their own gas
    /// @return _serials the serials minted
    /// @return _metadataForMint the metadata for the minted serials
    function mintNFT(
        uint256 _numberToMint
    )
        external
        payable
        returns (int64[] memory _serials, bytes[] memory _metadataForMint)
    {
        (_serials, _metadataForMint) = _mintNFT(_numberToMint, msg.sender);
    }

    /// @param _numberToMint the number of NFTs to mint
    /// Alternative method to allow a user to mint on behalf of another
    /// paying the gas in quasi abstraction. Given a user must associtate the token
    /// on Hedera there is less room for greifing (no association == failed mint)
    /// @return _serials the serials minted
    /// @return _metadataForMint the metadata for the minted serials
    function mintNFTOnBehalf(
        uint256 _numberToMint,
        address _onBehalfOf
    )
        external
        payable
        returns (int64[] memory _serials, bytes[] memory _metadataForMint)
    {
        (_serials, _metadataForMint) = _mintNFT(_numberToMint, _onBehalfOf);
    }

    /// @param _numberToMint the number of serials to mint
    /// @return _serials the serials minted
    /// Internal function to mint the NFTs to allow users to mint on behalf of others
    /// @return _metadataForMint the metadata for the minted serials
    function _mintNFT(
        uint256 _numberToMint,
        address _onBehalfOf
    )
        internal
        nonReentrant
        returns (int64[] memory _serials, bytes[] memory _metadataForMint)
    {
        if (_numberToMint == 0) revert BadQuantity();
        if (
            mintTiming.mintStartTime != 0 &&
            mintTiming.mintStartTime > block.timestamp
        ) revert NotOpen();
        if (mintTiming.mintPaused) revert Paused();
        if (fixedEdition) {
            if (_numberToMint > maxSupply) revert MintedOut();
        } else {
            if (_numberToMint > metadata.length) revert MintedOut();
        }
        if (_numberToMint > mintEconomics.maxMint) revert MaxMintExceeded();

        bool isWlMint = false;
        // Design decision: WL max mint per wallet takes priority
        // over max mint per wallet
        if (mintTiming.wlOnly) {
            // Inline checkWhitelistConditions
            (bool found, uint256 qty) = whitelistedAddressQtyMap.tryGet(
                _onBehalfOf
            );
            if (!found) revert NotWL();
            if (mintEconomics.maxWlAddressMint > 0) {
                if (qty == 0) revert NotWL();
                // only check the qty if there is a limit at contract level
                if (qty < _numberToMint) revert NotEnoughWLSlots();
                whitelistedAddressQtyMap.set(_onBehalfOf, qty - _numberToMint);
            }
            isWlMint = true;
        } else if (mintEconomics.maxMintPerWallet > 0) {
            (bool found, uint256 numPreviouslyMinted) = addressToNumMintedMap
                .tryGet(_onBehalfOf);
            if (!found) {
                numPreviouslyMinted = 0;
            }

            if (
                (numPreviouslyMinted + _numberToMint) >
                mintEconomics.maxMintPerWallet
            ) revert MaxMintPerWalletExceeded();
        }

        //calculate cost (inline getCostInternal)
        uint256 totalHbarCost;
        uint256 totalLazyCost;
        if (isWlMint) {
            totalHbarCost =
                (_numberToMint *
                    (mintEconomics.mintPriceHbar *
                        (100 - mintEconomics.wlDiscount))) /
                100;
            totalLazyCost =
                (_numberToMint *
                    (mintEconomics.mintPriceLazy *
                        (100 - mintEconomics.wlDiscount))) /
                100;
        } else {
            totalHbarCost = _numberToMint * mintEconomics.mintPriceHbar;
            totalLazyCost = _numberToMint * mintEconomics.mintPriceLazy;
        }

        // take the payment
        if (totalLazyCost > 0) {
            takeLazyPayment(
                totalLazyCost,
                mintEconomics.lazyFromContract ? address(this) : _onBehalfOf
            );
        }

        if (totalHbarCost > 0) {
            if (msg.value < totalHbarCost) revert NotEnoughHbar();
        }

        if (fixedEdition) {
            _metadataForMint = new bytes[](_numberToMint);
            for (uint256 i = 0; i < _numberToMint; ) {
                _metadataForMint[i] = bytes(cid);
                unchecked {
                    ++i;
                }
            }
        } else {
            _metadataForMint = selectMetdataToMint(
                metadata,
                _numberToMint,
                cid,
                prngGenerator
            );
        }

        int64[] memory mintedSerials = executeMint(
            _numberToMint,
            _metadataForMint,
            _onBehalfOf,
            isWlMint
        );

        mintTiming.lastMintTime = block.timestamp;
        walletMintTimeMap.set(_onBehalfOf, block.timestamp);

        if (isWlMint) {
            (
                bool wlFound,
                uint256 wlNumPreviouslyMinted
            ) = wlAddressToNumMintedMap.tryGet(_onBehalfOf);
            if (wlFound) {
                wlAddressToNumMintedMap.set(
                    _onBehalfOf,
                    wlNumPreviouslyMinted + _numberToMint
                );
            } else {
                wlAddressToNumMintedMap.set(_onBehalfOf, _numberToMint);
            }
        }

        // track all minters in case max mint per wallet required
        (
            bool numMintfound,
            uint256 totalNumPreviouslyMinted
        ) = addressToNumMintedMap.tryGet(_onBehalfOf);
        if (numMintfound) {
            addressToNumMintedMap.set(
                _onBehalfOf,
                totalNumPreviouslyMinted + _numberToMint
            );
        } else {
            addressToNumMintedMap.set(_onBehalfOf, _numberToMint);
        }

        // now freeze the mints to make them SBT
        int32 responseCode = freezeToken(token, _onBehalfOf);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FreezingFailed();
        }

        totalMinted += _numberToMint;

        _serials = mintedSerials;
    }

    /// @param _numberToMint the number of NFTs to mint
    /// @param _metadataForMint the metadata for the minted serials
    /// @param _onBehalfOf the address to mint on behalf of
    /// @param isWlMint boolean to indicate if the mint is a WL mint
    /// internal method to encapsulate the actual minting and avoid stack too deep
    /// @return mintedSerials the serials minted
    function executeMint(
        uint256 _numberToMint,
        bytes[] memory _metadataForMint,
        address _onBehalfOf,
        bool isWlMint
    ) internal returns (int64[] memory mintedSerials) {
        mintedSerials = new int64[](_numberToMint);
        for (uint256 outer = 0; outer < _numberToMint; outer += batchSize) {
            uint256 thisBatch = (_numberToMint - outer) >= batchSize
                ? batchSize
                : (_numberToMint - outer);
            bytes[] memory batchMetadataForMint = new bytes[](thisBatch);
            for (
                uint256 inner = 0;
                ((outer + inner) < _numberToMint) && (inner < thisBatch);

            ) {
                batchMetadataForMint[inner] = _metadataForMint[inner + outer];
                unchecked {
                    ++inner;
                }
            }

            (int32 response, , int64[] memory serialNumbers) = mintToken(
                token,
                0,
                batchMetadataForMint
            );

            if (response != HederaResponseCodes.SUCCESS) {
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
                receiverList[s] = _onBehalfOf;
                mintedSerials[s + outer] = serialNumbers[s];
                serialMintTimeMap.set(
                    SafeCast.toUint256(serialNumbers[s]),
                    block.timestamp
                );

                unchecked {
                    ++s;
                }
            }

            response = transferNFTs(
                token,
                senderList,
                receiverList,
                serialNumbers
            );

            if (response != HederaResponseCodes.SUCCESS) {
                revert NFTTransferFailed();
            }
        }
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

        emitMessage(ContractEventType.LAZY_PMT, _payer, _amount);
    }

    function emitMessage(
        ContractEventType _eventType,
        address _msgAddress,
        uint256 _msgNumeric
    ) internal {
        emit MinterContractMessage(_eventType, _msgAddress, _msgNumeric);
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
        // Inline both checkWhitelistConditions and getCostInternal
        (bool found, uint256 qty) = whitelistedAddressQtyMap.tryGet(msg.sender);
        bool isWlMint = false;
        if (found) {
            if (mintEconomics.maxWlAddressMint > 0) {
                isWlMint = qty > 0 ? true : false;
            } else {
                isWlMint = true;
            }
        }

        if (isWlMint) {
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
        emitMessage(
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
        _wlSpotsPurchased = buyWlWithTokensInternal(
            _serials,
            mintEconomics.wlToken,
            mintEconomics.maxWlAddressMint,
            whitelistedAddressQtyMap,
            wlSerialsUsed
        );
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
    ) public onlyOwner {
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
        _numAddressesRemoved = whitelistedAddressQtyMap.length();
        for (uint256 a = _numAddressesRemoved; a > 0; ) {
            (address key, ) = whitelistedAddressQtyMap.at(a - 1);
            whitelistedAddressQtyMap.remove(key);
            unchecked {
                --a;
            }
        }
    }

    function revokeSBT(
        address _user,
        uint256 serialToBurn
    ) external onlyOwner returns (int256 responseCode) {
        if (!REVOCABLE) revert NotRevokable();
        // remove the user from the WL
        address[] memory addresses = new address[](1);
        addresses[0] = _user;
        removeFromWhitelist(addresses);
        // wipe their key
        // work out serial of the SBT NFT held by the user
        if (IERC721(token).ownerOf(serialToBurn) != _user) {
            revert NFTNotOwned();
        }

        int64[] memory serials = new int64[](1);
        serials[0] = serialToBurn.toInt256().toInt64();

        // need to unfreeze the token to allow the wipe
        responseCode = unfreezeToken(token, _user);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert UnFreezingFailed();
        }

        responseCode = wipeTokenAccountNFT(token, _user, serials);

        emitMessage(ContractEventType.REVOKE_SBT, _user, serialToBurn);

        // if the user has more of the token refeeze it
        if (IERC721(token).balanceOf(_user) > 0) {
            responseCode = freezeToken(token, _user);
            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert FreezingFailed();
            }
        }
    }

    // Only way to remove the token from an account is via this method
    // contract will unfreeze, transfer and then burn the token atomicly
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

        // unfreeze the token to allow transfer and burn
        int32 responseCode = unfreezeToken(token, msg.sender);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert UnFreezingFailed();
        }

        // Need to check if this allows approval based transfers, else move it to 'stake' code
        responseCode = transferNFTs(
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

        // if the user has more of the token refeeze it
        if (IERC721(token).balanceOf(msg.sender) > 0) {
            responseCode = freezeToken(token, msg.sender);
            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert FreezingFailed();
            }
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
            emitMessage(
                ContractEventType.UPDATE_MINT_PRICE,
                msg.sender,
                mintEconomics.mintPriceHbar
            );
        }

        if (mintEconomics.mintPriceLazy != _lazyCost) {
            mintEconomics.mintPriceLazy = _lazyCost;
            emitMessage(
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
            emitMessage(
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
            emitMessage(
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
            emitMessage(
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
            emitMessage(ContractEventType.UPDATE_WL_MAX, msg.sender, _maxMint);
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
            emitMessage(
                ContractEventType.UPDATE_LAZY_FROM_CONTRACT,
                msg.sender,
                _lazyFromContract ? 1 : 0
            );
        mintEconomics.lazyFromContract = _lazyFromContract;
    }

    /// @param _startTime new start time in seconds
    function updateMintStartTime(uint256 _startTime) external onlyOwner {
        mintTiming.mintStartTime = _startTime;
        emitMessage(
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
        emitMessage(
            ContractEventType.UPDATE_LAZY_BURN_PERCENTAGE,
            msg.sender,
            _lbp
        );
    }

    /// @param _maxMint new max mint (0 = uncapped)
    function updateMaxMint(uint256 _maxMint) external onlyOwner {
        mintEconomics.maxMint = _maxMint;
        emitMessage(ContractEventType.UPDATE_MAX_MINT, msg.sender, _maxMint);
    }

    /// @param _wlDiscount as percentage
    function updateWlDiscount(uint256 _wlDiscount) external onlyOwner {
        mintEconomics.wlDiscount = _wlDiscount;
        emitMessage(
            ContractEventType.UPDATE_WL_DISCOUNT,
            msg.sender,
            _wlDiscount
        );
    }

    /// @param _cooldownPeriod cooldown period as seconds
    function updateCooldown(uint256 _cooldownPeriod) external onlyOwner {
        mintTiming.cooldownPeriod = _cooldownPeriod;
        emitMessage(
            ContractEventType.UPDATE_COOLDOWN,
            msg.sender,
            _cooldownPeriod
        );
    }

    /// @param _refundWindow refund period in seconds / cap on withdrawals
    function updateRefundWindow(uint256 _refundWindow) external onlyOwner {
        mintTiming.refundWindow = _refundWindow;
        emitMessage(
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
        emitMessage(ContractEventType.UPDATE_WL_TOKEN, msg.sender, 0);
    }

    function updateMaxMintPerWallet(uint256 _max) external onlyOwner {
        mintEconomics.maxMintPerWallet = _max;
        emitMessage(ContractEventType.UPDATE_MAX_WALLET_MINT, msg.sender, _max);
    }

    /// @param _cid new _cid
    function updateCID(string memory _cid) external onlyOwner {
        cid = _cid;
        emitMessage(ContractEventType.UPDATE_CID, msg.sender, 0);
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

        // Inline resetContractInternal
        uint256 size = addressToNumMintedMap.length();
        if (size > _batch) {
            _remaingItems = size - _batch;
            size = _batch;
        }

        for (uint256 a = size; a > 0; ) {
            (address key, ) = addressToNumMintedMap.at(a - 1);
            addressToNumMintedMap.remove(key);
            unchecked {
                --a;
            }
        }
        size = metadata.length;
        size = size > _batch ? _batch : size;
        if (size > _batch) {
            _remaingItems = Math.max(_remaingItems, size - _batch);
            size = _batch;
        }

        for (uint256 a = size; a > 0; ) {
            metadata.pop();
            unchecked {
                --a;
            }
        }
        size = walletMintTimeMap.length();
        if (size > _batch) {
            _remaingItems = Math.max(_remaingItems, size - _batch);
            size = _batch;
        }
        for (uint256 a = size; a > 0; ) {
            (address key, ) = walletMintTimeMap.at(a - 1);
            walletMintTimeMap.remove(key);
            unchecked {
                --a;
            }
        }
        size = wlAddressToNumMintedMap.length();
        if (size > _batch) {
            _remaingItems = Math.max(_remaingItems, size - _batch);
            size = _batch;
        }
        for (uint256 a = size; a > 0; ) {
            (address key, ) = wlAddressToNumMintedMap.at(a - 1);
            wlAddressToNumMintedMap.remove(key);
            unchecked {
                --a;
            }
        }
        size = serialMintTimeMap.length();
        if (size > _batch) {
            _remaingItems = Math.max(_remaingItems, size - _batch);
            size = _batch;
        }
        for (uint256 a = size; a > 0; ) {
            (uint256 key, ) = serialMintTimeMap.at(a - 1);
            serialMintTimeMap.remove(key);
            unchecked {
                --a;
            }
        }
        size = wlSerialsUsed.length();
        if (size > _batch) {
            _remaingItems = Math.max(_remaingItems, size - _batch);
            size = _batch;
        }
        for (uint256 a = size; a > 0; ) {
            uint256 key = wlSerialsUsed.at(a - 1);
            wlSerialsUsed.remove(key);
            unchecked {
                --a;
            }
        }

        emitMessage(
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

    function getPRNGContractAddress() external view returns (address _prng) {
        _prng = prngGenerator;
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
        uint256 length = wlAddressToNumMintedMap.length();
        _wlWalletList = new address[](length);
        _wlNumMintedList = new uint256[](length);
        for (uint256 a = 0; a < length; ) {
            (_wlWalletList[a], _wlNumMintedList[a]) = wlAddressToNumMintedMap
                .at(a);
            unchecked {
                ++a;
            }
        }
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
        if ((_offset + _batchSize) > wlAddressToNumMintedMap.length())
            revert BadArguments();
        _wlWalletList = new address[](_batchSize);
        _wlNumMintedList = new uint256[](_batchSize);
        for (uint256 a = 0; a < _batchSize; ) {
            (_wlWalletList[a], _wlNumMintedList[a]) = wlAddressToNumMintedMap
                .at(a + _offset);
            unchecked {
                ++a;
            }
        }
    }

    /// @return _remainingMint number of NFTs left to mint
    function getRemainingMint() external view returns (uint256 _remainingMint) {
        _remainingMint = maxSupply - totalMinted;
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
        // use the batch method to get all
        (_wl, _wlQty) = getWhitelistBatch(0, whitelistedAddressQtyMap.length());
    }

    // add a get Whitelist as Batch
    /// @param _offset the start of the batch
    /// @param _batchSize the size of the batch
    /// @return _wl an array of addresses on WL
    /// @return _wlQty an array of the number of mints allowed
    function getWhitelistBatch(
        uint256 _offset,
        uint256 _batchSize
    ) public view returns (address[] memory _wl, uint256[] memory _wlQty) {
        if ((_offset + _batchSize) > whitelistedAddressQtyMap.length())
            revert BadArguments();

        _wl = new address[](_batchSize);
        _wlQty = new uint256[](_batchSize);

        for (uint256 a = 0; a < _batchSize; ) {
            (_wl[a], _wlQty[a]) = whitelistedAddressQtyMap.at(_offset + a);
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

    // ============================================
    // Internal Helper Functions (formerly library)
    // ============================================

    function selectMetdataToMint(
        string[] storage metadata_,
        uint256 numberToMint,
        string storage cid_,
        address prngGenerator_
    ) internal returns (bytes[] memory metadataForMint) {
        // size the return array
        metadataForMint = new bytes[](numberToMint);

        if (prngGenerator_ == address(0)) {
            for (uint256 m = 0; m < numberToMint; m++) {
                metadataForMint[m] = bytes(
                    string.concat(cid_, metadata_[metadata_.length - 1])
                );
                // pop discarding the element used up
                metadata_.pop();
            }
        } else {
            for (uint256 m = 0; m < numberToMint; ) {
                // if only 1 item left, no need to generate random number
                if (metadata_.length == 1) {
                    metadataForMint[m] = bytes(
                        string.concat(cid_, metadata_[0])
                    );
                    metadata_.pop();
                    // should only be here on the last iteration anyway
                    break;
                } else {
                    uint256 index = IPrngGenerator(prngGenerator_)
                        .getPseudorandomNumber(0, metadata_.length - 1, m);
                    string memory chosen = metadata_[index];
                    // swap the chosen element with the last element
                    metadata_[index] = metadata_[metadata_.length - 1];
                    metadataForMint[m] = bytes(string.concat(cid_, chosen));
                    // pop discarding the element used up
                    metadata_.pop();
                }

                unchecked {
                    ++m;
                }
            }
        }
    }

    function getSBTContractMintKey(
        bool _revocable,
        address _contract
    ) internal pure returns (IHederaTokenService.TokenKey memory mintKey) {
        uint256 keyType;
        keyType = keyType.setBit(uint8(KeyType.SUPPLY));
        keyType = keyType.setBit(uint8(KeyType.FREEZE));

        if (_revocable) {
            keyType = keyType.setBit(uint8(KeyType.WIPE));
        }

        IHederaTokenService.KeyValue memory keyValue;
        keyValue.contractId = _contract;

        mintKey = IHederaTokenService.TokenKey(keyType, keyValue);
    }

    function buyWlWithTokensInternal(
        uint256[] memory _serials,
        address _wlToken,
        uint256 _maxWlAddressMint,
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap_,
        EnumerableSet.UintSet storage wlSerialsUsed_
    ) internal returns (uint256 _wlSpotsPurchased) {
        if (_wlToken == address(0)) revert NoWLToken();

        for (uint8 i = 0; i < _serials.length; i++) {
            // check no double dipping
            if (wlSerialsUsed_.contains(_serials[i])) revert WLTokenUsed();
            // check user owns the token
            if (IERC721(_wlToken).ownerOf(_serials[i]) != msg.sender)
                revert NotTokenOwner();
            wlSerialsUsed_.add(_serials[i]);
            emit MinterContractMessage(
                ContractEventType.WL_PURCHASE_TOKEN,
                msg.sender,
                _serials[i]
            );
        }

        _wlSpotsPurchased = whitelistedAddressQtyMap_.contains(msg.sender)
            ? whitelistedAddressQtyMap_.get(msg.sender) +
                (_maxWlAddressMint * _serials.length)
            : (_maxWlAddressMint * _serials.length);
        whitelistedAddressQtyMap_.set(msg.sender, _wlSpotsPurchased);
    }

    receive() external payable {}

    fallback() external payable {}
}
