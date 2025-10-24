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

/// @title EditionWithPrize - Edition NFT Minter with Random Prize Distribution
/// @author stowerling.eth / stowerling.hbar
/// @notice Mints edition NFTs with identical metadata, then awards a unique 1-of-1 prize to a random edition holder
/// @dev Uses PRNG for verifiable on-chain randomness, wipe key for clean prize claim UX, bearer asset model
/// @version 1.0.0

// OpenZeppelin imports
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

// Custom imports
import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";
import {IPrngGenerator} from "./interfaces/IPrngGenerator.sol";
import {IBurnableHTS} from "./interfaces/IBurnableHTS.sol";
import {ExpiryHelper} from "./ExpiryHelper.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

contract EditionWithPrize is ExpiryHelper, Ownable, ReentrancyGuard {
    // ============ Using Directives ============

    using EnumerableMap for EnumerableMap.AddressToUintMap;
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeCast for uint256;
    using SafeCast for int64;
    using SafeCast for int256;
    using Address for address;
    using Strings for string;

    // ============ Custom Errors ============

    error NotInitialized();
    error AlreadyInitialized();
    error InvalidPhase();
    error EditionNotSoldOut();
    error WinnerAlreadySelected();
    error PrizeAlreadyClaimed();
    error NotWinningSerial();
    error NotSerialOwner();
    error MintedOut();
    error MaxSupplyReached();
    error NotOpen();
    error Paused();
    error NotWL();
    error NotEnoughWLSlots();
    error MaxMintExceeded();
    error MaxMintPerWalletExceeded();
    error NotEnoughLazy();
    error NotEnoughHbar();
    error BadQuantity();
    error BadArguments();
    error AssociationFailed();
    error FailedToMint();
    error TransferFailed();
    error WipeFailed();
    error PaymentFailed();
    error BurnFailed();
    error WLPurchaseFailed();
    error NoWLToken();
    error WLTokenUsed();
    error NotTokenOwner();
    error TooManyFees();
    error EmptyMetadata();
    error NotEnoughUsdc();
    error UsdcWithdrawFailed();

    // ============ Enums ============

    /// @notice Contract lifecycle phases
    enum Phase {
        NOT_INITIALIZED, // Contract deployed, tokens not created
        EDITION_MINTING, // Edition NFTs being minted
        EDITION_SOLD_OUT, // All editions minted, awaiting winner selection
        WINNER_SELECTED, // Winner chosen, awaiting prize claim
        PRIZE_CLAIMED // Prize claimed, contract complete
    }

    // ============ Structs ============

    /// @notice Lazy token integration details
    struct LazyDetails {
        address lazyToken;
        uint256 lazyBurnPerc;
        IBurnableHTS lazySCT;
    }

    /// @notice NFT royalty/fee configuration
    struct NFTFeeObject {
        uint32 numerator;
        uint32 denominator;
        uint32 fallbackfee;
        address account;
    }

    /// @notice Minting economics configuration
    struct MintEconomics {
        bool lazyFromContract; // If true, contract pays LAZY cost (sponsorship)
        uint256 mintPriceHbar; // Base price in hbar (tinybars)
        uint256 mintPriceLazy; // Base price in LAZY tokens
        uint256 mintPriceUsdc; // Base price in USDC (6 decimals)
        uint256 wlDiscount; // Whitelist discount percentage (0-100)
        uint256 maxMint; // Max NFTs per mint transaction (0 = unlimited)
        uint256 buyWlWithLazy; // LAZY cost to buy WL slot(s)
        uint256 wlSlotsPerPurchase; // Number of WL slots granted per purchase
        uint256 maxWlAddressMint; // Max mints for WL addresses (0 = unlimited)
        uint256 maxMintPerWallet; // Max total mints per wallet (0 = unlimited)
        address wlToken; // Token used for token-based WL purchase
    }

    /// @notice Minting timing and control configuration
    struct MintTiming {
        uint256 lastMintTime; // Last time a mint occurred
        uint256 mintStartTime; // When minting becomes available
        bool mintPaused; // Emergency pause switch
        bool wlOnly; // Restrict minting to whitelist only
    }

    // ============ State Variables ============

    // Core configuration
    LazyDetails private lazyDetails;
    MintEconomics private mintEconomics;
    MintTiming private mintTiming;
    Phase public currentPhase;

    // Token addresses
    address public editionToken;
    address public prizeToken;
    address public immutable PRNG_GENERATOR;
    address public immutable LAZY_DELEGATE_REGISTRY;

    // USDC token addresses (native and bridged) - configured per network
    address public immutable USDC_NATIVE;
    address public immutable USDC_BRIDGED;

    // Token metadata (needed for minting)
    string private editionMetadata;
    string private prizeMetadata;

    // Edition token details
    uint256 public editionMaxSupply;
    uint256 public editionMinted;

    // Prize token details
    uint256 public prizeMaxSupply;
    uint256 public prizeMinted;

    // Winner tracking
    EnumerableSet.UintSet private winningSerials;

    // Whitelist management
    EnumerableMap.AddressToUintMap private whitelistedAddressQtyMap;
    EnumerableSet.UintSet private wlSerialsUsed;

    // Per-wallet mint tracking
    EnumerableMap.AddressToUintMap private wlAddressToNumMintedMap;
    EnumerableMap.AddressToUintMap private addressToNumMintedMap;

    // ============ Events ============

    enum ContractEventType {
        PHASE_CHANGE,
        EDITION_INITIALIZED,
        PRIZE_INITIALIZED,
        EDITION_MINTED,
        WINNER_SELECTED,
        PRIZE_CLAIMED,
        PAUSE,
        UNPAUSE,
        WL_ADD,
        WL_REMOVE,
        WL_PURCHASE_TOKEN,
        WL_PURCHASE_LAZY,
        UPDATE_WL_TOKEN,
        UPDATE_WL_LAZY_BUY,
        UPDATE_WL_ONLY,
        UPDATE_WL_MAX,
        UPDATE_WL_DISCOUNT,
        UPDATE_MAX_MINT,
        UPDATE_MAX_WALLET_MINT,
        UPDATE_MINT_PRICE,
        UPDATE_MINT_PRICE_LAZY,
        UPDATE_MINT_PRICE_USDC,
        UPDATE_LAZY_BURN_PERCENTAGE,
        UPDATE_LAZY_FROM_CONTRACT,
        UPDATE_MINT_START_TIME
    }

    event EditionWithPrizeEvent(
        ContractEventType indexed eventType,
        address indexed msgAddress,
        uint256 msgNumeric
    );

    event EditionMintEvent(
        address indexed minter,
        bool isLazyPayment,
        uint256 quantity,
        uint256 totalPaid
    );

    event WinnerSelectedEvent(uint256[] winningSerials, uint256 timestamp);

    event PrizeClaimedEvent(
        address indexed claimer,
        uint256 indexed editionSerial,
        uint256 timestamp
    );

    // ============ Constructor ============

    /// @param _lazyToken Address of the LAZY token
    /// @param _lsct Address of the Lazy Smart Contract Treasury (for burn)
    /// @param _lazyBurnPerc Percentage of LAZY to burn on each mint
    /// @param _prngGenerator Address of the PRNG generator contract
    /// @param _delegateRegistry Address of the Lazy Delegate Registry
    constructor(
        address _lazyToken,
        address _lsct,
        uint256 _lazyBurnPerc,
        address _prngGenerator,
        address _delegateRegistry,
        address _usdcNative,
        address _usdcBridged
    ) {
        if (
            _lazyToken == address(0) ||
            _lsct == address(0) ||
            _prngGenerator == address(0) ||
            _delegateRegistry == address(0) ||
            _usdcNative == address(0) ||
            _usdcBridged == address(0)
        ) {
            revert BadArguments();
        }

        lazyDetails = LazyDetails(
            _lazyToken,
            _lazyBurnPerc,
            IBurnableHTS(_lsct)
        );
        PRNG_GENERATOR = _prngGenerator;
        LAZY_DELEGATE_REGISTRY = _delegateRegistry;
        USDC_NATIVE = _usdcNative;
        USDC_BRIDGED = _usdcBridged;

        // Associate tokens
        address[] memory tokens = new address[](3);
        tokens[0] = _lazyToken;
        tokens[1] = _usdcNative;
        tokens[2] = _usdcBridged;
        int64 responseCode = associateTokens(address(this), tokens);
        if (int32(responseCode) != HederaResponseCodes.SUCCESS) {
            revert AssociationFailed();
        }

        // Initialize economics and timing with defaults
        mintEconomics = MintEconomics({
            lazyFromContract: false,
            mintPriceHbar: 0,
            mintPriceLazy: 0,
            mintPriceUsdc: 0,
            wlDiscount: 0,
            maxMint: 20,
            buyWlWithLazy: 0,
            wlSlotsPerPurchase: 1,
            maxWlAddressMint: 0,
            maxMintPerWallet: 0,
            wlToken: address(0)
        });

        mintTiming = MintTiming({
            lastMintTime: 0,
            mintStartTime: 0,
            mintPaused: true,
            wlOnly: false
        });

        currentPhase = Phase.NOT_INITIALIZED;
    }

    // ============ Modifiers ============

    modifier onlyPhase(Phase _phase) {
        if (currentPhase != _phase) revert InvalidPhase();
        _;
    }

    modifier whenNotPaused() {
        if (mintTiming.mintPaused) revert Paused();
        _;
    }

    modifier whenMintOpen() {
        if (block.timestamp < mintTiming.mintStartTime) revert NotOpen();
        _;
    }

    // ============ Token Initialization Functions ============

    /// @notice Initialize the edition token with metadata and royalties
    /// @param _name Token name
    /// @param _symbol Token symbol
    /// @param _memo Token memo
    /// @param _metadata Token metadata URI
    /// @param _maxSupply Maximum supply of edition tokens
    /// @param _fees Array of royalty/fee objects
    function initializeEditionToken(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        string memory _metadata,
        int64 _maxSupply,
        NFTFeeObject[] memory _fees
    )
        external
        payable
        onlyOwner
        onlyPhase(Phase.NOT_INITIALIZED)
        returns (address)
    {
        if (bytes(_metadata).length == 0) revert EmptyMetadata();

        editionMetadata = _metadata;
        editionMaxSupply = _maxSupply.toUint256();

        // Create the edition token with SUPPLY + WIPE keys
        editionToken = _createToken(
            _name,
            _symbol,
            _memo,
            _maxSupply,
            _fees,
            true
        );

        emit EditionWithPrizeEvent(
            ContractEventType.EDITION_INITIALIZED,
            msg.sender,
            editionMaxSupply
        );

        return editionToken;
    }

    /// @notice Initialize the prize token with metadata and royalties
    /// @param _name Token name
    /// @param _symbol Token symbol
    /// @param _memo Token memo
    /// @param _metadata Token metadata URI
    /// @param _maxSupply Maximum number of prize tokens (winners)
    /// @param _fees Array of royalty/fee objects (can differ from edition)
    function initializePrizeToken(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        string memory _metadata,
        int64 _maxSupply,
        NFTFeeObject[] memory _fees
    )
        external
        payable
        onlyOwner
        onlyPhase(Phase.NOT_INITIALIZED)
        returns (address)
    {
        if (editionToken == address(0)) revert NotInitialized();
        if (prizeToken != address(0)) revert AlreadyInitialized();
        if (bytes(_metadata).length == 0) revert EmptyMetadata();

        prizeMetadata = _metadata;
        prizeMaxSupply = _maxSupply.toUint256();

        // Create the prize token with SUPPLY key only (no wipe needed)
        prizeToken = _createToken(
            _name,
            _symbol,
            _memo,
            _maxSupply,
            _fees,
            false
        );

        // Move to EDITION_MINTING phase
        currentPhase = Phase.EDITION_MINTING;

        emit EditionWithPrizeEvent(
            ContractEventType.PRIZE_INITIALIZED,
            msg.sender,
            prizeMaxSupply
        );

        emit EditionWithPrizeEvent(
            ContractEventType.PHASE_CHANGE,
            msg.sender,
            uint256(Phase.EDITION_MINTING)
        );

        return prizeToken;
    }

    /// @dev Internal function to create HTS tokens
    /// @param _name Token name
    /// @param _symbol Token symbol
    /// @param _memo Token memo
    /// @param _maxSupply Maximum supply for the token
    /// @param _royalties Royalty fees
    /// @param _withWipeKey If true, include wipe key
    /// @return tokenAddress Address of created token
    function _createToken(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        int64 _maxSupply,
        NFTFeeObject[] memory _royalties,
        bool _withWipeKey
    ) private returns (address tokenAddress) {
        if (bytes(_memo).length > 100) revert BadArguments();
        if (_royalties.length > 10) revert TooManyFees();
        if (_maxSupply == 0) revert BadArguments();

        IHederaTokenService.TokenKey[]
            memory _keys = new IHederaTokenService.TokenKey[](1);

        // Set up token keys using KeyHelper
        if (_withWipeKey) {
            _keys[0] = getSingleKey(
                KeyType.SUPPLY,
                KeyType.WIPE,
                KeyValueType.CONTRACT_ID,
                address(this)
            );
        } else {
            _keys[0] = getSingleKey(
                KeyType.SUPPLY,
                KeyValueType.CONTRACT_ID,
                address(this)
            );
        }

        IHederaTokenService.HederaToken memory _token;
        _token.name = _name;
        _token.symbol = _symbol;
        _token.treasury = address(this);
        _token.memo = _memo;
        _token.tokenSupplyType = true; // FINITE
        _token.maxSupply = _maxSupply;
        _token.tokenKeys = _keys;
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
            address createdToken
        ) = createNonFungibleTokenWithCustomFees(
                _token,
                new IHederaTokenService.FixedFee[](0),
                _fees
            );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedToMint();
        }

        return createdToken;
    }

    // ============ Phase Transition Functions ============

    /// @notice Select winners after all editions are minted
    /// @dev Can be called by anyone once editions sold out
    /// @dev IMPORTANT: This function may require multiple PRNG calls if duplicates occur.
    /// @dev Ensure sufficient gas limit (recommend 2-3x normal estimate) to handle worst-case scenarios.
    /// @dev In edge cases with many duplicates, the transaction may still fail due to gas limits.
    function selectWinner()
        external
        nonReentrant
        onlyPhase(Phase.EDITION_SOLD_OUT)
        returns (uint256[] memory)
    {
        uint256 targetWinners = prizeMaxSupply;
        uint256 baseSeed = uint256(blockhash(block.number - 1)) +
            block.timestamp;
        uint256 nonce = 0;

        // Keep generating until we have enough unique winners
        while (winningSerials.length() < targetWinners) {
            uint256 remaining = targetWinners - winningSerials.length();

            // Generate random numbers with nonce-updated seed
            uint256[] memory randomNumbers = IPrngGenerator(PRNG_GENERATOR)
                .getPseudorandomNumberArray(
                    1,
                    editionMaxSupply,
                    uint256(keccak256(abi.encodePacked(baseSeed, nonce))),
                    remaining
                );

            // Add unique numbers to winning serials
            for (uint256 i = 0; i < randomNumbers.length; i++) {
                winningSerials.add(randomNumbers[i]);
                if (winningSerials.length() == targetWinners) break;
            }

            nonce++;
        }

        // Get final winning serials array
        uint256[] memory finalWinners = winningSerials.values();

        // Move to WINNER_SELECTED phase
        currentPhase = Phase.WINNER_SELECTED;

        emit WinnerSelectedEvent(finalWinners, block.timestamp);

        emit EditionWithPrizeEvent(
            ContractEventType.WINNER_SELECTED,
            msg.sender,
            winningSerials.length()
        );

        emit EditionWithPrizeEvent(
            ContractEventType.PHASE_CHANGE,
            msg.sender,
            uint256(Phase.WINNER_SELECTED)
        );

        return finalWinners;
    }

    /// @notice Claim prize by presenting winning edition serial
    /// @param _editionSerial The edition serial number to exchange
    function claimPrize(
        uint256 _editionSerial
    )
        external
        nonReentrant
        onlyPhase(Phase.WINNER_SELECTED)
        returns (int64[] memory serials)
    {
        // Check if serial is a winner (O(1) lookup)
        if (!winningSerials.contains(_editionSerial)) {
            revert NotWinningSerial();
        }

        // Verify caller owns the winning serial
        address owner = IERC721(editionToken).ownerOf(_editionSerial);
        if (owner != msg.sender) revert NotSerialOwner();

        // Check if all prizes already minted
        if (prizeMinted >= prizeMaxSupply) revert MaxSupplyReached();

        // Wipe the edition NFT from winner's account
        int64[] memory serialsToWipe = new int64[](1);
        serialsToWipe[0] = int64(uint64(_editionSerial));

        int64 wipeResponse = wipeTokenAccountNFT(
            editionToken,
            msg.sender,
            serialsToWipe
        );

        if (int32(wipeResponse) != HederaResponseCodes.SUCCESS) {
            revert WipeFailed();
        }

        // Mint and transfer prize token
        bytes[] memory prizeMetadataArray = new bytes[](1);
        prizeMetadataArray[0] = bytes(prizeMetadata);

        serials = _mintAndTransfer(prizeToken, prizeMetadataArray, msg.sender);

        // Increment prize minted counter
        prizeMinted++;

        emit PrizeClaimedEvent(msg.sender, _editionSerial, block.timestamp);

        emit EditionWithPrizeEvent(
            ContractEventType.PRIZE_CLAIMED,
            msg.sender,
            _editionSerial
        );

        // Move to PRIZE_CLAIMED phase if all prizes claimed
        if (prizeMinted >= prizeMaxSupply) {
            currentPhase = Phase.PRIZE_CLAIMED;

            emit EditionWithPrizeEvent(
                ContractEventType.PHASE_CHANGE,
                msg.sender,
                uint256(Phase.PRIZE_CLAIMED)
            );
        }
    }

    // ============ Minting Functions ============

    /// @notice Mint editions
    /// @param _quantity Number of editions to mint
    /// @dev Enforces configured costs - HBAR paid via msg.value, LAZY via allowance
    /// @return serials Array of minted edition serial numbers
    function mint(
        uint256 _quantity
    ) external payable returns (int64[] memory serials) {
        return _mintFor(msg.sender, _quantity);
    }

    /// @notice Mint editions on behalf of another address (for gas abstraction)
    /// @param _onBehalfOf Address to mint for
    /// @param _quantity Number of editions to mint
    /// @dev LAZY comes from _onBehalfOf's allowance, HBAR from msg.sender
    /// @return serials Array of minted edition serial numbers
    function mintOnBehalfOf(
        address _onBehalfOf,
        uint256 _quantity
    ) external payable returns (int64[] memory serials) {
        return _mintFor(_onBehalfOf, _quantity);
    }

    /// @dev Internal unified minting logic
    function _mintFor(
        address _minter,
        uint256 _quantity
    )
        private
        nonReentrant
        onlyPhase(Phase.EDITION_MINTING)
        whenNotPaused
        whenMintOpen
        returns (int64[] memory serials)
    {
        _validateMintQuantity(_quantity);
        _checkWhitelistAccess(_minter, _quantity);

        // Calculate required costs
        uint256 hbarCost = _calculateHbarCost(_quantity, _minter);
        uint256 lazyCost = _calculateLazyCost(_quantity, _minter);
        uint256 usdcCost = _calculateUsdcCost(_quantity, _minter);

        // Validate HBAR payment
        if (hbarCost > 0 && msg.value < hbarCost) {
            revert NotEnoughHbar();
        }

        // Validate and process LAZY if required
        bool usesLazy = lazyCost > 0;
        if (usesLazy) {
            uint256 lazyAllowance = IERC20(lazyDetails.lazyToken).allowance(
                _minter,
                address(this)
            );
            if (lazyAllowance < lazyCost) {
                revert NotEnoughLazy();
            }
            _processFungiblePayment(_minter, lazyCost, lazyDetails.lazyToken);
        }

        // Validate and process USDC if required
        bool usesUsdc = usdcCost > 0;
        if (usesUsdc) {
            _processUsdcPayment(_minter, usdcCost);
        }

        // Mint and transfer
        serials = _executeMint(_minter, _quantity);

        // Refund excess HBAR
        if (msg.value > hbarCost) {
            Address.sendValue(payable(msg.sender), msg.value - hbarCost);
        }

        emit EditionMintEvent(
            _minter,
            usesLazy || usesUsdc,
            _quantity,
            hbarCost + lazyCost + usdcCost
        );
    }

    // ============ Internal Minting Logic ============

    /// @dev Validate mint quantity against limits
    function _validateMintQuantity(uint256 _quantity) private view {
        if (_quantity == 0) revert BadQuantity();
        if (mintEconomics.maxMint > 0 && _quantity > mintEconomics.maxMint) {
            revert MaxMintExceeded();
        }
        if (editionMinted + _quantity > editionMaxSupply) {
            revert MintedOut();
        }

        // Check per-wallet limit
        if (mintEconomics.maxMintPerWallet > 0) {
            uint256 currentMinted = addressToNumMintedMap.contains(msg.sender)
                ? addressToNumMintedMap.get(msg.sender)
                : 0;
            if (currentMinted + _quantity > mintEconomics.maxMintPerWallet) {
                revert MaxMintPerWalletExceeded();
            }
        }
    }

    /// @dev Check whitelist access and availability
    function _checkWhitelistAccess(
        address _minter,
        uint256 _quantity
    ) private view {
        if (mintTiming.wlOnly) {
            if (!whitelistedAddressQtyMap.contains(_minter)) {
                revert NotWL();
            }

            uint256 wlSlots = whitelistedAddressQtyMap.get(_minter);

            // Check WL slots if not unlimited
            if (wlSlots > 0) {
                uint256 wlUsed = wlAddressToNumMintedMap.contains(_minter)
                    ? wlAddressToNumMintedMap.get(_minter)
                    : 0;

                if (wlUsed + _quantity > wlSlots) {
                    revert NotEnoughWLSlots();
                }
            }

            // Check max WL address mint if set
            if (mintEconomics.maxWlAddressMint > 0) {
                uint256 wlUsed = wlAddressToNumMintedMap.contains(_minter)
                    ? wlAddressToNumMintedMap.get(_minter)
                    : 0;

                if (wlUsed + _quantity > mintEconomics.maxWlAddressMint) {
                    revert NotEnoughWLSlots();
                }
            }
        }
    }

    /// @dev Calculate cost with WL discount
    function _calculateCost(
        uint256 _basePrice,
        uint256 _quantity,
        address _minter
    ) private view returns (uint256) {
        uint256 baseCost = _basePrice * _quantity;

        // Apply WL discount if applicable
        if (
            whitelistedAddressQtyMap.contains(_minter) &&
            mintEconomics.wlDiscount > 0
        ) {
            return baseCost - ((baseCost * mintEconomics.wlDiscount) / 100);
        }

        return baseCost;
    }

    /// @dev Calculate HBAR cost with WL discount
    function _calculateHbarCost(
        uint256 _quantity,
        address _minter
    ) private view returns (uint256) {
        return _calculateCost(mintEconomics.mintPriceHbar, _quantity, _minter);
    }

    /// @dev Calculate LAZY cost with WL discount
    function _calculateLazyCost(
        uint256 _quantity,
        address _minter
    ) private view returns (uint256) {
        return _calculateCost(mintEconomics.mintPriceLazy, _quantity, _minter);
    }

    /// @dev Calculate USDC cost with WL discount
    function _calculateUsdcCost(
        uint256 _quantity,
        address _minter
    ) private view returns (uint256) {
        return _calculateCost(mintEconomics.mintPriceUsdc, _quantity, _minter);
    }

    /// @dev Mint tokens with specified metadata and transfer to recipient
    /// @param _token Token address to mint
    /// @param _metadata Array of metadata for each token
    /// @param _recipient Address to receive the tokens
    /// @return mintedSerials Array of serials that were minted
    function _mintAndTransfer(
        address _token,
        bytes[] memory _metadata,
        address _recipient
    ) private returns (int64[] memory mintedSerials) {
        // Mint the tokens
        (int64 mintResponse, , int64[] memory serials) = mintToken(
            _token,
            0,
            _metadata
        );

        if (int32(mintResponse) != HederaResponseCodes.SUCCESS) {
            revert FailedToMint();
        }

        // Transfer tokens to recipient
        address[] memory senders = new address[](_metadata.length);
        address[] memory receivers = new address[](_metadata.length);

        for (uint256 i = 0; i < _metadata.length; i++) {
            senders[i] = address(this);
            receivers[i] = _recipient;
        }

        int64 transferResponse = transferNFTs(
            _token,
            senders,
            receivers,
            serials
        );

        if (int32(transferResponse) != HederaResponseCodes.SUCCESS) {
            revert TransferFailed();
        }

        return serials;
    }

    /// @dev Execute the actual minting and tracking updates
    function _executeMint(
        address _minter,
        uint256 _quantity
    ) private returns (int64[] memory serials) {
        // Prepare metadata array
        bytes[] memory metadataArray = new bytes[](_quantity);
        for (uint256 i = 0; i < _quantity; i++) {
            metadataArray[i] = bytes(editionMetadata);
        }

        // Mint and transfer using shared function
        serials = _mintAndTransfer(editionToken, metadataArray, _minter);

        // Update tracking
        editionMinted += _quantity;

        if (whitelistedAddressQtyMap.contains(_minter)) {
            uint256 currentWlMinted = wlAddressToNumMintedMap.contains(_minter)
                ? wlAddressToNumMintedMap.get(_minter)
                : 0;
            wlAddressToNumMintedMap.set(_minter, currentWlMinted + _quantity);
        }

        uint256 currentMinted = addressToNumMintedMap.contains(_minter)
            ? addressToNumMintedMap.get(_minter)
            : 0;
        addressToNumMintedMap.set(_minter, currentMinted + _quantity);

        mintTiming.lastMintTime = block.timestamp;

        // Check if edition sold out
        if (editionMinted >= editionMaxSupply) {
            currentPhase = Phase.EDITION_SOLD_OUT;
            emit EditionWithPrizeEvent(
                ContractEventType.PHASE_CHANGE,
                _minter,
                uint256(Phase.EDITION_SOLD_OUT)
            );
        }
    }

    /// @dev Process fungible token payment (LAZY with burn, others direct transfer)
    function _processFungiblePayment(
        address _from,
        uint256 _amount,
        address _token
    ) private {
        if (_token == lazyDetails.lazyToken) {
            // LAZY token - handle burn mechanism
            if (!mintEconomics.lazyFromContract) {
                // Transfer from User to treasury
                if (_amount > 0) {
                    bool success = IERC20(_token).transferFrom(
                        _from,
                        address(this),
                        _amount
                    );
                    if (!success) revert PaymentFailed();
                }
            }
            // Either way have to burn a portion if configured
            uint256 burnAmount = (_amount * lazyDetails.lazyBurnPerc) / 100;

            // Burn portion
            if (burnAmount > 0) {
                int256 responseCode = lazyDetails.lazySCT.burn(
                    _token,
                    uint32(burnAmount)
                );
                if (responseCode != HederaResponseCodes.SUCCESS) {
                    revert BurnFailed();
                }
            }
        } else {
            // Non-LAZY token - direct transfer to treasury
            bool success = IERC20(_token).transferFrom(
                _from,
                address(this),
                _amount
            );
            if (!success) revert PaymentFailed();
        }
    }

    /// @dev Process USDC payment from allowances (prioritizes native, then bridged)
    function _processUsdcPayment(address _from, uint256 _amount) private {
        uint256 remaining = _amount;

        // Try native USDC first
        if (remaining > 0) {
            uint256 nativeAllowance = IERC20(USDC_NATIVE).allowance(
                _from,
                address(this)
            );
            if (nativeAllowance > 0) {
                uint256 nativeAmount = remaining > nativeAllowance
                    ? nativeAllowance
                    : remaining;
                _processFungiblePayment(_from, nativeAmount, USDC_NATIVE);
                remaining -= nativeAmount;
            }
        }

        // Use bridged USDC for remainder
        if (remaining > 0) {
            uint256 bridgedAllowance = IERC20(USDC_BRIDGED).allowance(
                _from,
                address(this)
            );
            if (bridgedAllowance < remaining) {
                revert NotEnoughUsdc();
            }
            _processFungiblePayment(_from, remaining, USDC_BRIDGED);
        }
    }

    // ============ Whitelist Management Functions ============

    /// @notice Manually add addresses to whitelist
    /// @param _addresses Array of addresses to whitelist
    /// @param _quantities Array of quantities allowed (0 = unlimited)
    function addToWhitelist(
        address[] memory _addresses,
        uint256[] memory _quantities
    ) external onlyOwner {
        if (_addresses.length != _quantities.length) revert BadArguments();

        for (uint256 i = 0; i < _addresses.length; i++) {
            whitelistedAddressQtyMap.set(_addresses[i], _quantities[i]);
        }

        emit EditionWithPrizeEvent(
            ContractEventType.WL_ADD,
            msg.sender,
            _addresses.length
        );
    }

    /// @notice Remove addresses from whitelist
    /// @param _addresses Array of addresses to remove
    function removeFromWhitelist(
        address[] memory _addresses
    ) external onlyOwner {
        for (uint256 i = 0; i < _addresses.length; i++) {
            if (whitelistedAddressQtyMap.contains(_addresses[i])) {
                whitelistedAddressQtyMap.remove(_addresses[i]);
            }
        }

        emit EditionWithPrizeEvent(
            ContractEventType.WL_REMOVE,
            msg.sender,
            _addresses.length
        );
    }

    /// @dev Add whitelist slots to an address (additive, respects unlimited)
    function _addWhitelistSlots(address _address) private {
        uint256 currentSlots = whitelistedAddressQtyMap.contains(_address)
            ? whitelistedAddressQtyMap.get(_address)
            : 0;

        // If current is 0 (unlimited), keep it unlimited
        if (currentSlots > 0) {
            whitelistedAddressQtyMap.set(
                _address,
                currentSlots + mintEconomics.wlSlotsPerPurchase
            );
        } else if (
            currentSlots == 0 && !whitelistedAddressQtyMap.contains(_address)
        ) {
            // First purchase - set slots
            whitelistedAddressQtyMap.set(
                _address,
                mintEconomics.wlSlotsPerPurchase
            );
        }
        // else already unlimited, do nothing
    }

    /// @notice Purchase whitelist slots with LAZY tokens
    function purchaseWhitelistWithLazy() external nonReentrant {
        if (mintEconomics.buyWlWithLazy == 0) revert BadArguments();

        // Transfer LAZY from user
        bool success = IERC20(lazyDetails.lazyToken).transferFrom(
            msg.sender,
            owner(),
            mintEconomics.buyWlWithLazy
        );
        if (!success) revert WLPurchaseFailed();

        _addWhitelistSlots(msg.sender);

        emit EditionWithPrizeEvent(
            ContractEventType.WL_PURCHASE_LAZY,
            msg.sender,
            mintEconomics.buyWlWithLazy
        );
    }

    /// @notice Purchase whitelist by owning a specific token (supports staked tokens via delegate registry)
    /// @param _serial Serial number of the WL token to use
    function purchaseWhitelistWithToken(uint256 _serial) external nonReentrant {
        if (mintEconomics.wlToken == address(0)) revert NoWLToken();
        if (wlSerialsUsed.contains(_serial)) revert WLTokenUsed();

        // Check direct ownership first
        address tokenOwner = IERC721(mintEconomics.wlToken).ownerOf(_serial);
        bool isOwner = (tokenOwner == msg.sender);

        // If not direct owner, check delegate registry (for staked tokens)
        if (!isOwner) {
            isOwner = ILazyDelegateRegistry(LAZY_DELEGATE_REGISTRY)
                .checkDelegateToken(msg.sender, mintEconomics.wlToken, _serial);
        }

        if (!isOwner) revert NotTokenOwner();

        // Mark serial as used
        wlSerialsUsed.add(_serial);

        _addWhitelistSlots(msg.sender);

        emit EditionWithPrizeEvent(
            ContractEventType.WL_PURCHASE_TOKEN,
            msg.sender,
            _serial
        );
    }

    // ============ Configuration Functions ============

    /// @notice Pause or unpause minting
    /// @param _paused True to pause, false to unpause
    function setPaused(bool _paused) external onlyOwner {
        mintTiming.mintPaused = _paused;

        emit EditionWithPrizeEvent(
            _paused ? ContractEventType.PAUSE : ContractEventType.UNPAUSE,
            msg.sender,
            0
        );
    }

    /// @notice Set mint start time
    /// @param _startTime Unix timestamp when minting begins
    function setMintStartTime(uint256 _startTime) external onlyOwner {
        mintTiming.mintStartTime = _startTime;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_MINT_START_TIME,
            msg.sender,
            _startTime
        );
    }

    /// @notice Enable or disable whitelist-only minting
    /// @param _wlOnly True to restrict to whitelist only
    function setWhitelistOnly(bool _wlOnly) external onlyOwner {
        mintTiming.wlOnly = _wlOnly;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_WL_ONLY,
            msg.sender,
            _wlOnly ? 1 : 0
        );
    }

    /// @notice Update mint costs for HBAR, LAZY, and USDC
    /// @param _hbarPrice Price in tinybars
    /// @param _lazyPrice Price in LAZY tokens (with decimals)
    /// @param _usdcPrice Price in USDC (6 decimals)
    function updateMintCost(
        uint256 _hbarPrice,
        uint256 _lazyPrice,
        uint256 _usdcPrice
    ) external onlyOwner {
        mintEconomics.mintPriceHbar = _hbarPrice;
        mintEconomics.mintPriceLazy = _lazyPrice;
        mintEconomics.mintPriceUsdc = _usdcPrice;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_MINT_PRICE,
            msg.sender,
            _hbarPrice
        );

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_MINT_PRICE_LAZY,
            msg.sender,
            _lazyPrice
        );

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_MINT_PRICE_USDC,
            msg.sender,
            _usdcPrice
        );
    }

    /// @notice Set whitelist discount percentage
    /// @param _discount Discount percentage (0-100)
    function setWhitelistDiscount(uint256 _discount) external onlyOwner {
        if (_discount > 100) revert BadArguments();
        mintEconomics.wlDiscount = _discount;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_WL_DISCOUNT,
            msg.sender,
            _discount
        );
    }

    /// @notice Set whitelist slots per purchase
    /// @param _slots Number of whitelist slots granted per purchase
    function setWlSlotsPerPurchase(uint256 _slots) external onlyOwner {
        if (_slots == 0) revert BadArguments();
        mintEconomics.wlSlotsPerPurchase = _slots;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_WL_MAX,
            msg.sender,
            _slots
        );
    }

    /// @notice Set maximum mints per transaction
    /// @param _maxMint Max mints per transaction (0 = unlimited)
    function setMaxMint(uint256 _maxMint) external onlyOwner {
        mintEconomics.maxMint = _maxMint;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_MAX_MINT,
            msg.sender,
            _maxMint
        );
    }

    /// @notice Set maximum mints per wallet
    /// @param _maxMintPerWallet Max total mints per wallet (0 = unlimited)
    function setMaxMintPerWallet(uint256 _maxMintPerWallet) external onlyOwner {
        mintEconomics.maxMintPerWallet = _maxMintPerWallet;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_MAX_WALLET_MINT,
            msg.sender,
            _maxMintPerWallet
        );
    }

    /// @notice Set maximum WL address mints
    /// @param _maxWlAddressMint Max mints for WL addresses (0 = unlimited)
    function setMaxWlAddressMint(uint256 _maxWlAddressMint) external onlyOwner {
        mintEconomics.maxWlAddressMint = _maxWlAddressMint;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_WL_MAX,
            msg.sender,
            _maxWlAddressMint
        );
    }

    /// @notice Set LAZY purchase price for WL
    /// @param _price Price in LAZY tokens
    function setBuyWlWithLazy(uint256 _price) external onlyOwner {
        mintEconomics.buyWlWithLazy = _price;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_WL_LAZY_BUY,
            msg.sender,
            _price
        );
    }

    /// @notice Set token used for WL purchase
    /// @param _token Address of token to use for WL
    function setWlToken(address _token) external onlyOwner {
        mintEconomics.wlToken = _token;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_WL_TOKEN,
            msg.sender,
            0
        );
    }

    /// @notice Set LAZY burn percentage
    /// @param _percentage Percentage to burn (0-100)
    function setLazyBurnPercentage(uint256 _percentage) external onlyOwner {
        if (_percentage > 100) revert BadArguments();
        lazyDetails.lazyBurnPerc = _percentage;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_LAZY_BURN_PERCENTAGE,
            msg.sender,
            _percentage
        );
    }

    /// @notice Set whether contract pays LAZY cost
    /// @param _fromContract True if contract pays
    function setLazyFromContract(bool _fromContract) external onlyOwner {
        mintEconomics.lazyFromContract = _fromContract;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_LAZY_FROM_CONTRACT,
            msg.sender,
            _fromContract ? 1 : 0
        );
    }

    /// @notice Set USDC price for minting
    /// @param _price Price in USDC (6 decimals)
    function setMintPriceUsdc(uint256 _price) external onlyOwner {
        mintEconomics.mintPriceUsdc = _price;

        emit EditionWithPrizeEvent(
            ContractEventType.UPDATE_MINT_PRICE,
            msg.sender,
            _price
        );
    }

    /// @notice Withdraw accumulated USDC tokens to owner
    function withdrawUSDC() external onlyOwner {
        // Withdraw native USDC
        uint256 nativeBalance = IERC20(USDC_NATIVE).balanceOf(address(this));
        if (nativeBalance > 0) {
            bool success = IERC20(USDC_NATIVE).transfer(owner(), nativeBalance);
            if (!success) revert UsdcWithdrawFailed();
        }

        // Withdraw bridged USDC
        uint256 bridgedBalance = IERC20(USDC_BRIDGED).balanceOf(address(this));
        if (bridgedBalance > 0) {
            bool success = IERC20(USDC_BRIDGED).transfer(
                owner(),
                bridgedBalance
            );
            if (!success) revert UsdcWithdrawFailed();
        }
    }

    /// @notice Withdraw accumulated HBAR balance to owner
    function withdrawHbar() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            Address.sendValue(payable(owner()), balance);
        }
    }

    /// @notice Withdraw accumulated LAZY tokens to owner
    function withdrawLazy() external onlyOwner {
        uint256 lazyBalance = IERC20(lazyDetails.lazyToken).balanceOf(
            address(this)
        );
        if (lazyBalance > 0) {
            bool success = IERC20(lazyDetails.lazyToken).transfer(
                owner(),
                lazyBalance
            );
            if (!success) revert PaymentFailed();
        }
    }

    // ============ View/Query Functions ============

    /// @notice Get whitelist status and remaining slots for an address
    /// @param _address Address to check
    /// @return isWhitelisted Whether address is whitelisted
    /// @return slotsTotal Total slots allocated (0 = unlimited)
    /// @return slotsUsed Number of slots used
    /// @return slotsRemaining Remaining slots (type(uint256).max if unlimited)
    function getWhitelistStatus(
        address _address
    )
        external
        view
        returns (
            bool isWhitelisted,
            uint256 slotsTotal,
            uint256 slotsUsed,
            uint256 slotsRemaining
        )
    {
        isWhitelisted = whitelistedAddressQtyMap.contains(_address);

        if (isWhitelisted) {
            slotsTotal = whitelistedAddressQtyMap.get(_address);
            slotsUsed = wlAddressToNumMintedMap.contains(_address)
                ? wlAddressToNumMintedMap.get(_address)
                : 0;

            if (slotsTotal == 0) {
                slotsRemaining = type(uint256).max; // Unlimited
            } else {
                slotsRemaining = slotsTotal > slotsUsed
                    ? slotsTotal - slotsUsed
                    : 0;
            }
        }
    }

    /// @notice Get Mint Cost
    function getMintCost()
        external
        view
        returns (uint256 hbarPrice, uint256 lazyPrice, uint256 usdcPrice)
    {
        hbarPrice = mintEconomics.mintPriceHbar;
        lazyPrice = mintEconomics.mintPriceLazy;
        usdcPrice = mintEconomics.mintPriceUsdc;
    }

    /// @notice isPaused
    function isPaused() external view returns (bool) {
        return mintTiming.mintPaused;
    }

    /// @notice Get minting statistics for an address
    /// @param _address Address to check
    /// @return totalMinted Total editions minted by address
    /// @return wlMinted Editions minted using whitelist
    function getMintStats(
        address _address
    ) external view returns (uint256 totalMinted, uint256 wlMinted) {
        totalMinted = addressToNumMintedMap.contains(_address)
            ? addressToNumMintedMap.get(_address)
            : 0;
        wlMinted = wlAddressToNumMintedMap.contains(_address)
            ? wlAddressToNumMintedMap.get(_address)
            : 0;
    }

    /// @notice Calculate mint cost for address
    /// @param _quantity Number of editions to mint
    /// @param _address Address minting
    /// @return hbarCost Cost in tinybars
    /// @return lazyCost Cost in LAZY tokens
    /// @return usdcCost Cost in USDC (6 decimals)
    function calculateMintCost(
        uint256 _quantity,
        address _address
    )
        external
        view
        returns (uint256 hbarCost, uint256 lazyCost, uint256 usdcCost)
    {
        hbarCost = _calculateHbarCost(_quantity, _address);
        lazyCost = _calculateLazyCost(_quantity, _address);
        usdcCost = _calculateUsdcCost(_quantity, _address);
    }

    /// @notice Check if minting is currently available
    /// @return isOpen Whether minting is open
    /// @return reason Human-readable reason if not open
    function isMintOpen()
        external
        view
        returns (bool isOpen, string memory reason)
    {
        if (editionMinted >= editionMaxSupply) {
            return (false, "Sold out");
        }
        if (currentPhase != Phase.EDITION_MINTING) {
            return (false, "Wrong phase");
        }
        if (mintTiming.mintPaused) {
            return (false, "Paused");
        }
        if (block.timestamp < mintTiming.mintStartTime) {
            return (false, "Not started");
        }
        return (true, "");
    }

    /// @notice Check if address can mint specified quantity
    /// @param _address Address to check
    /// @param _quantity Quantity to mint
    /// @return canMint Whether mint is possible
    /// @return reason Reason if cannot mint
    function canAddressMint(
        address _address,
        uint256 _quantity
    ) external view returns (bool canMint, string memory reason) {
        if (currentPhase != Phase.EDITION_MINTING) {
            return (false, "Wrong phase");
        }
        if (mintTiming.mintPaused) {
            return (false, "Paused");
        }
        if (block.timestamp < mintTiming.mintStartTime) {
            return (false, "Not started");
        }
        if (_quantity == 0) {
            return (false, "Zero quantity");
        }
        if (mintEconomics.maxMint > 0 && _quantity > mintEconomics.maxMint) {
            return (false, "Exceeds max per tx");
        }
        if (editionMinted + _quantity > editionMaxSupply) {
            return (false, "Insufficient supply");
        }

        // Check per-wallet limit
        if (mintEconomics.maxMintPerWallet > 0) {
            uint256 currentMinted = addressToNumMintedMap.contains(_address)
                ? addressToNumMintedMap.get(_address)
                : 0;
            if (currentMinted + _quantity > mintEconomics.maxMintPerWallet) {
                return (false, "Exceeds wallet limit");
            }
        }

        // Check whitelist if required
        if (mintTiming.wlOnly) {
            if (!whitelistedAddressQtyMap.contains(_address)) {
                return (false, "Not whitelisted");
            }

            uint256 wlSlots = whitelistedAddressQtyMap.get(_address);
            if (wlSlots > 0) {
                uint256 wlUsed = wlAddressToNumMintedMap.contains(_address)
                    ? wlAddressToNumMintedMap.get(_address)
                    : 0;
                if (wlUsed + _quantity > wlSlots) {
                    return (false, "Insufficient WL slots");
                }
            }

            if (mintEconomics.maxWlAddressMint > 0) {
                uint256 wlUsed = wlAddressToNumMintedMap.contains(_address)
                    ? wlAddressToNumMintedMap.get(_address)
                    : 0;
                if (wlUsed + _quantity > mintEconomics.maxWlAddressMint) {
                    return (false, "Exceeds WL max");
                }
            }
        }

        return (true, "");
    }

    /// @notice Get complete contract state
    /// @return phase Current phase
    /// @return editionsMinted Number of editions minted
    /// @return editionsMax Maximum edition supply
    /// @return prizesMax Maximum number of prizes
    /// @return prizesMinted Number of prizes claimed
    /// @return winners Array of winning serials
    function getContractState()
        external
        view
        returns (
            Phase phase,
            uint256 editionsMinted,
            uint256 editionsMax,
            uint256 prizesMax,
            uint256 prizesMinted,
            uint256[] memory winners
        )
    {
        phase = currentPhase;
        editionsMinted = editionMinted;
        editionsMax = editionMaxSupply;
        prizesMax = prizeMaxSupply;
        prizesMinted = prizeMinted;
        winners = new uint256[](winningSerials.length());
        for (uint256 i = 0; i < winningSerials.length(); i++) {
            winners[i] = winningSerials.at(i);
        }
    }

    /// @notice Get economics configuration
    function getEconomics() external view returns (MintEconomics memory) {
        return mintEconomics;
    }

    /// @notice Get timing configuration
    function getTiming() external view returns (MintTiming memory) {
        return mintTiming;
    }

    /// @notice Get token addresses
    /// @return edition Address of edition token
    /// @return prize Address of prize token
    /// @return lazy Address of LAZY token
    /// @return usdcNative Address of native USDC token
    /// @return usdcBridged Address of bridged USDC token
    function getTokens()
        external
        view
        returns (
            address edition,
            address prize,
            address lazy,
            address usdcNative,
            address usdcBridged
        )
    {
        edition = editionToken;
        prize = prizeToken;
        lazy = lazyDetails.lazyToken;
        usdcNative = USDC_NATIVE;
        usdcBridged = USDC_BRIDGED;
    }

    /// @notice Get all winning serial numbers
    /// @return winners Array of winning serial numbers
    function getWinningSerials()
        external
        view
        returns (uint256[] memory winners)
    {
        return winningSerials.values();
    }

    /// @notice Check if a serial number is a winner
    /// @param _serial Serial number to check
    /// @return isWinner True if the serial is a winning serial
    function isWinningSerial(
        uint256 _serial
    ) external view returns (bool isWinner) {
        return winningSerials.contains(_serial);
    }
}
