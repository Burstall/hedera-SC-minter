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

/// @title ForeverMinter - NFT Distribution with Discount System
/// @author stowerling.eth / stowerling.hbar
/// @notice Distributes existing NFTs from a pool with holder discounts, sacrifice mechanism, and refund system
/// @dev Inherits TokenStakerV2 for royalty-compliant NFT transfers via STAKING/WITHDRAWAL
/// @version 1.0.5

// OpenZeppelin imports
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// Custom imports
import {TokenStakerV2} from "./TokenStakerV2.sol";
import {IPrngGenerator} from "./interfaces/IPrngGenerator.sol";

contract ForeverMinter is TokenStakerV2, Ownable, ReentrancyGuard {
    // ============ Using Directives ============

    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableMap for EnumerableMap.AddressToUintMap;
    using SafeCast for uint256;
    using SafeCast for int64;
    using SafeCast for int256;
    using Address for address;
    using Address for address payable;
    using Math for uint256;

    // ============ Immutable State Variables ============

    /// @notice The NFT token address that will be distributed
    address public immutable NFT_TOKEN;

    /// @notice The PRNG generator contract for random serial selection
    address public immutable PRNG_GENERATOR;

    // ============ Serial Management ============

    /// @notice Set of available serial numbers in the pool
    EnumerableSet.UintSet private availableSerials;

    /// @notice Tracks when each serial was minted (for refund window calculation)
    mapping(uint256 => uint256) private serialMintTime;

    /// @notice Payment information for each minted serial
    struct MintPayment {
        uint256 hbarPaid;
        uint256 lazyPaid;
        address minter;
    }
    mapping(uint256 => MintPayment) private serialPaymentTracking;

    // ============ Economics & Timing ============

    /// @notice Economics configuration for minting
    struct MintEconomics {
        uint256 mintPriceHbar; // Base price in hbar (tinybars)
        uint256 mintPriceLazy; // Base price in LAZY tokens
        uint256 wlDiscount; // Whitelist discount percentage (0-100)
        uint256 sacrificeDiscount; // Sacrifice discount percentage (0-100)
        uint256 maxMint; // Max NFTs per mint transaction (0 = unlimited)
        uint256 maxMintPerWallet; // Max total mints per wallet (0 = unlimited)
        uint256 buyWlWithLazy; // LAZY cost to buy WL slot(s)
        uint256 buyWlSlotCount; // Number of WL slots granted per purchase (default: 1)
        uint256 maxSacrifice; // Max NFTs that can be sacrificed per mint
        bool lazyFromContract; // If true, contract pays LAZY cost (sponsorship)
    }
    MintEconomics private mintEconomics;

    /// @notice Timing and control configuration
    struct MintTiming {
        uint256 lastMintTime; // Last time a mint occurred
        uint256 mintStartTime; // When minting becomes available
        bool mintPaused; // Emergency pause switch
        uint256 refundWindow; // Time window for refunds (seconds)
        uint256 refundPercentage; // Percentage of payment refunded (0-100)
        bool wlOnly; // Restrict minting to whitelist only
    }
    MintTiming private mintTiming;

    // ============ Discount System ============

    /// @notice Discount tier configuration for holder discounts
    struct DiscountTier {
        uint256 discountPercentage; // Discount percentage (0-100)
        uint256 maxUsesPerSerial; // Max times a serial can be used for discount
    }
    DiscountTier[] private discountTiers;

    /// @notice Internal struct for discount slot management
    struct DiscountSlot {
        address token;
        uint256 serial;
        uint256 discountPercentage;
        uint256 usesAvailable;
    }

    /// @notice Struct for mint cost calculation results
    struct MintCostResult {
        uint256 totalHbarCost;
        uint256 totalLazyCost;
        uint256 totalDiscount;
        uint256 holderSlotsUsed;
        uint256 wlSlotsUsed;
    }

    /// @notice Maps discount token address to tier index
    mapping(address => uint256) private tokenToTierIndex;

    /// @notice Tracks which tokens provide discounts
    mapping(address => bool) private isDiscountToken;

    /// @notice Tracks discount usage per serial: token => serial => use count
    mapping(address => mapping(uint256 => uint256)) private serialDiscountUsage;

    // ============ Whitelist & Wallet Tracking ============

    /// @notice Tracks whitelist slots per address (consumable)
    mapping(address => uint256) private whitelistSlots;

    /// @notice Tracks total mints per wallet
    mapping(address => uint256) private walletMintCount;

    /// @notice Tracks average payment per wallet for refund calculations
    mapping(address => uint256) private walletAveragePaymentHbar;
    mapping(address => uint256) private walletAveragePaymentLazy;

    // ============ LAZY Token Configuration ============

    /// @notice LAZY token details
    struct LazyDetails {
        address lazyToken;
        uint256 lazyBurnPerc;
    }
    LazyDetails private lazyDetails;

    // ============ Sacrifice Configuration ============

    /// @notice Destination address for sacrificed NFTs
    address public sacrificeDestination;

    // ============ Admin System ============

    /// @notice Set of admin addresses with elevated privileges
    EnumerableSet.AddressSet private adminSet;

    // ============ Events ============

    /// @notice Emitted when NFTs are successfully minted
    event NFTMinted(
        address indexed minter,
        uint256 indexed quantity,
        uint256[] serials,
        uint256 hbarPaid,
        uint256 lazyPaid,
        uint256 totalDiscount
    );

    /// @notice Emitted when NFTs are refunded
    event NFTRefunded(
        address indexed refunder,
        uint256[] serials,
        uint256 hbarRefunded,
        uint256 lazyRefunded
    );

    /// @notice Emitted when NFTs are added to the pool
    event NFTsAddedToPool(
        address indexed source,
        uint256[] serials,
        uint256 newPoolSize
    );

    /// @notice Emitted when NFTs are removed from the pool
    event NFTsRemovedFromPool(uint256[] serials, uint256 newPoolSize);

    /// @notice Emitted when a discount tier is added or updated
    event DiscountTierUpdated(
        address indexed token,
        uint256 tierIndex,
        uint256 discountPercentage,
        uint256 maxUsesPerSerial
    );

    /// @notice Emitted when economics are updated
    event EconomicsUpdated(
        uint256 mintPriceHbar,
        uint256 mintPriceLazy,
        uint256 wlDiscount,
        uint256 sacrificeDiscount
    );

    /// @notice Emitted when timing is updated
    event TimingUpdated(
        uint256 mintStartTime,
        bool mintPaused,
        uint256 refundWindow,
        uint256 refundPercentage,
        bool wlOnly
    );

    /// @notice Emitted when whitelist is updated
    event WhitelistUpdated(address indexed account, bool added);

    /// @notice Emitted when an admin is added or removed
    event AdminUpdated(address indexed account, bool added);

    /// @notice Emitted when funds are withdrawn
    event FundsWithdrawn(
        address indexed recipient,
        uint256 hbarAmount,
        uint256 lazyAmount
    );

    /// @notice Emitted when LAZY payment is processed
    event LazyPaymentEvent(
        address indexed payer,
        uint256 amount,
        uint256 burnAmount
    );

    // ============ Errors ============

    error NotAdmin();
    error NotOwnerOfSerial(uint256 serial);
    error MintPaused();
    error MintNotStarted();
    error MintedOut();
    error InvalidQuantity();
    error ExceedsMaxMint();
    error ExceedsMaxMintPerWallet();
    error ExceedsMaxWlMint();
    error NotEnoughHbar();
    error NotEnoughLazy();
    error InvalidDiscount();
    error DiscountSerialNotOwned(uint256 serial);
    error DiscountSerialMaxUsesReached(uint256 serial);
    error ExceedsMaxSacrifice();
    error SacrificeSerialNotOwned(uint256 serial);
    error RefundWindowExpired();
    error InvalidRefundSerial(uint256 serial);
    error WhitelistOnly();
    error CannotRemoveLastAdmin();
    error WithdrawalDuringRefundWindow();
    error InvalidParameter();
    error SerialNotInPool(uint256 serial);
    error SerialAlreadyInPool(uint256 serial);
    error TransferFailed();
    error EmptyArray();
    error ArrayLengthMismatch();
    error RefundBlockedDueToDiscountUsage(uint256 serial);

    // ============ Modifiers ============

    /// @notice Restricts function access to admins only
    modifier onlyAdmin() {
        if (!adminSet.contains(msg.sender)) revert NotAdmin();
        _;
    }

    /// @notice Checks if minting is currently allowed
    modifier whenMintingAllowed() {
        if (mintTiming.mintPaused) revert MintPaused();
        if (block.timestamp < mintTiming.mintStartTime) revert MintNotStarted();
        _;
    }

    // ============ Constructor ============

    /// @notice Initializes the ForeverMinter contract
    /// @param _nftToken The address of the NFT token to distribute
    /// @param _prngGenerator The address of the PRNG generator contract
    /// @param _lazyToken The address of the LAZY token
    /// @param _lazyGasStation The address of the LazyGasStation contract
    /// @param _lazyDelegateRegistry The address of the LazyDelegateRegistry contract
    constructor(
        address _nftToken,
        address _prngGenerator,
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry
    ) {
        // Initialize TokenStakerV2
        initContracts(_lazyToken, _lazyGasStation, _lazyDelegateRegistry);

        // Set immutable addresses
        NFT_TOKEN = _nftToken;
        PRNG_GENERATOR = _prngGenerator;

        // Add deployer as first admin
        adminSet.add(msg.sender);

        // Associate contract with NFT token (inherited from TokenStakerV2)
        tokenAssociate(NFT_TOKEN);

        // Initialize LAZY configuration
        lazyDetails.lazyToken = _lazyToken;
        lazyDetails.lazyBurnPerc = 50; // Default, can be updated

        // Initialize default timing (paused by default)
        mintTiming.mintPaused = true;
        mintTiming.mintStartTime = block.timestamp;
        mintTiming.refundWindow = 1 hours; // Default 1 hour refund window
        mintTiming.refundPercentage = 60; // Default 60% refund
        mintTiming.wlOnly = false;

        // Initialize default economics
        mintEconomics.maxMint = 50; // Default max 50 per transaction
        mintEconomics.maxSacrifice = 10; // Default max 10 sacrifice per mint
        mintEconomics.buyWlSlotCount = 1; // Default 1 slot per whitelist purchase
    }

    // ============ NFT Pool Management Functions ============

    /// @notice Register NFTs that have been sent to the contract by treasury
    /// @param _serials Array of serial numbers to register
    /// @dev Verifies ownership before adding to pool. Likely only called by treasury but anyone can trigger.
    function registerNFTs(uint256[] memory _serials) external {
        if (_serials.length == 0) revert EmptyArray();

        for (uint256 i = 0; i < _serials.length; i++) {
            uint256 serial = _serials[i];

            // Verify contract owns the serial
            if (IERC721(NFT_TOKEN).ownerOf(serial) != address(this)) {
                revert NotOwnerOfSerial(serial);
            }

            // Check if serial is already in pool
            if (availableSerials.contains(serial)) {
                revert SerialAlreadyInPool(serial);
            }

            // Add to available pool
            availableSerials.add(serial);
        }

        emit NFTsAddedToPool(msg.sender, _serials, availableSerials.length());
    }

    /// @notice Accept NFT donations to the pool from any address
    /// @param _serials Array of serial numbers to add
    /// @dev Uses STAKING transfer direction to respect royalties
    function addNFTsToPool(uint256[] memory _serials) external {
        if (_serials.length == 0) revert EmptyArray();

        // Transfer NFTs to contract using STAKING direction
        batchMoveNFTs(
            TransferDirection.STAKING,
            NFT_TOKEN,
            _serials,
            msg.sender,
            false,
            int64(1)
        );

        // Add serials to available pool
        for (uint256 i = 0; i < _serials.length; i++) {
            uint256 serial = _serials[i];

            // Do not need to check if serial is already in pool
            // It can only be added if it is owned by the contract
            // Network transfer will fail if the transferring user did not own it

            availableSerials.add(serial);
        }

        emit NFTsAddedToPool(msg.sender, _serials, availableSerials.length());
    }

    /// @notice Emergency withdrawal of NFTs from the pool
    /// @param _serials Array of serial numbers to withdraw
    /// @param _recipient Address to receive the NFTs
    /// @dev Only callable by admins. Can be used when paused.
    function emergencyWithdrawNFTs(
        uint256[] memory _serials,
        address _recipient
    ) external onlyAdmin {
        if (_serials.length == 0) revert EmptyArray();
        if (_recipient == address(0)) revert InvalidParameter();

        // Remove from available pool
        for (uint256 i = 0; i < _serials.length; i++) {
            uint256 serial = _serials[i];

            if (!availableSerials.contains(serial)) {
                revert SerialNotInPool(serial);
            }

            availableSerials.remove(serial);
        }

        // Transfer NFTs to recipient using WITHDRAWAL direction
        batchMoveNFTs(
            TransferDirection.WITHDRAWAL,
            NFT_TOKEN,
            _serials,
            _recipient,
            false,
            int64(1)
        );

        emit NFTsRemovedFromPool(_serials, availableSerials.length());
    }

    // ============ Main Mint Function ============

    /// @notice Mint NFTs from the pool with waterfall discount system
    /// @param _numberToMint Number of NFTs to mint
    /// @param _discountTokens Array of token addresses for holder discounts (ordered by preference)
    /// @param _serialsByToken Array of arrays of serials for each discount token
    /// @param _sacrificeSerials Array of serial numbers to sacrifice for discount (must be <= _numberToMint)
    /// @dev User pays cost which includes HBAR + LAZY. If lazyFromContract=true, contract sponsors LAZY portion
    /// @dev Discount waterfall order: Sacrifice → Holder → WL → Full Price
    /// @dev IMPORTANT: For optimal discounts, provide _discountTokens sorted by discount tier (highest first)
    function mintNFT(
        uint256 _numberToMint,
        address[] memory _discountTokens,
        uint256[][] memory _serialsByToken,
        uint256[] memory _sacrificeSerials
    ) external payable nonReentrant whenMintingAllowed {
        // ====== Step 1: Validate inputs ======

        if (_numberToMint == 0) revert InvalidQuantity();

        // Check max mint per transaction (0 = unlimited)
        if (mintEconomics.maxMint > 0) {
            if (_numberToMint > mintEconomics.maxMint) revert ExceedsMaxMint();
        }

        if (availableSerials.length() < _numberToMint) revert MintedOut();

        // Check whitelist restriction
        if (mintTiming.wlOnly && whitelistSlots[msg.sender] == 0) {
            revert WhitelistOnly();
        }

        // Check max mint per wallet (0 = unlimited)
        if (mintEconomics.maxMintPerWallet > 0) {
            if (
                walletMintCount[msg.sender] + _numberToMint >
                mintEconomics.maxMintPerWallet
            ) {
                revert ExceedsMaxMintPerWallet();
            }
        }

        // Validate discount arrays match
        if (_discountTokens.length != _serialsByToken.length) {
            revert ArrayLengthMismatch();
        }

        // Validate sacrifice count (must not exceed mint count or max sacrifice limit)
        if (_sacrificeSerials.length > _numberToMint) {
            revert ExceedsMaxSacrifice();
        }
        if (_sacrificeSerials.length > mintEconomics.maxSacrifice) {
            revert ExceedsMaxSacrifice();
        }

        // Select random serials to mint - executed up front to avoid selecting sacrificed serials
        uint256[] memory selectedSerials = selectRandomSerials(_numberToMint);

        // ====== Step 2: Process Sacrifice (if applicable) ======

        if (_sacrificeSerials.length > 0) {
            // Verify ownership and transfer sacrificed NFTs
            for (uint256 i = 0; i < _sacrificeSerials.length; i++) {
                uint256 serial = _sacrificeSerials[i];

                if (IERC721(NFT_TOKEN).ownerOf(serial) != msg.sender) {
                    revert SacrificeSerialNotOwned(serial);
                }
            }

            // STAKE sacrificed NFTs into contract (1 tinybar)
            batchMoveNFTs(
                TransferDirection.STAKING,
                NFT_TOKEN,
                _sacrificeSerials,
                msg.sender,
                false,
                int64(1)
            );

            // If sacrifice destination is set AND not the contract, transfer to it
            if (
                sacrificeDestination != address(0) &&
                sacrificeDestination != address(this)
            ) {
                batchMoveNFTs(
                    TransferDirection.WITHDRAWAL,
                    NFT_TOKEN,
                    _sacrificeSerials,
                    sacrificeDestination,
                    false,
                    int64(1)
                );
            } else {
                // Otherwise, add to available pool
                for (uint256 i = 0; i < _sacrificeSerials.length; i++) {
                    availableSerials.add(_sacrificeSerials[i]);
                }
            }
        }

        // ====== Step 3: Build and Validate Discount Slots (Once) ======

        DiscountSlot[] memory discountSlots;

        if (_discountTokens.length > 0) {
            // Build and sort discount slots ONCE (sorted internally)
            discountSlots = _buildAndSortDiscountSlots(
                _discountTokens,
                _serialsByToken
            );

            // Validate ownership or delegation for all provided serials
            for (uint256 i = 0; i < discountSlots.length; i++) {
                if (
                    !_canUseSerial(
                        msg.sender,
                        discountSlots[i].token,
                        discountSlots[i].serial
                    )
                ) {
                    revert DiscountSerialNotOwned(discountSlots[i].serial);
                }
            }
        }

        // ====== Step 4: Calculate Cost (Using Pre-Built Slots) ======

        MintCostResult memory costResult = calculateMintCostWithSlots(
            _numberToMint,
            discountSlots,
            _sacrificeSerials.length
        );

        // ====== Step 5: Process Dual-Currency Payment ======

        uint256 hbarPaid = 0;
        uint256 lazyPaid = 0;

        // User always pays HBAR portion via msg.value
        if (msg.value < costResult.totalHbarCost) revert NotEnoughHbar();
        hbarPaid = costResult.totalHbarCost;

        // Refund excess HBAR
        if (msg.value > costResult.totalHbarCost) {
            uint256 refund = msg.value - costResult.totalHbarCost;
            payable(msg.sender).sendValue(refund);
        }

        // LAZY payment: drawn from contract if lazyFromContract=true, else from user
        if (costResult.totalLazyCost > 0) {
            address lazyPaymentSource = msg.sender;

            // If contract is paying, approve LazyGasStation to spend contract's LAZY
            if (mintEconomics.lazyFromContract) {
                // update payment source
                lazyPaymentSource = address(this);
                // approve LazyGasStation to spend
                int32 approvalResponse = approve(
                    lazyDetails.lazyToken,
                    address(lazyGasStation),
                    costResult.totalLazyCost
                );
                if (approvalResponse != SUCCESS) {
                    revert TransferFailed();
                }
            }

            lazyGasStation.drawLazyFrom(
                lazyPaymentSource,
                costResult.totalLazyCost,
                lazyDetails.lazyBurnPerc
            );
            lazyPaid = costResult.totalLazyCost;

            emit LazyPaymentEvent(
                lazyPaymentSource,
                costResult.totalLazyCost,
                (costResult.totalLazyCost * lazyDetails.lazyBurnPerc) / 100
            );
        }

        // ====== Step 6: Transfer Selected NFTs ======

        // Transfer NFTs to user (1 tinybar per transfer)
        batchMoveNFTs(
            TransferDirection.WITHDRAWAL,
            NFT_TOKEN,
            selectedSerials,
            msg.sender,
            false,
            int64(1)
        );

        // ====== Step 7: Consume Discount Slots (Using Pre-Calculated Counts) ======

        if (costResult.holderSlotsUsed > 0 && discountSlots.length > 0) {
            // Consume holder slots based on pre-calculated waterfall usage
            uint256 slotsConsumed = 0;
            for (
                uint256 i = 0;
                i < discountSlots.length &&
                    slotsConsumed < costResult.holderSlotsUsed;
                i++
            ) {
                address token = discountSlots[i].token;
                uint256 serial = discountSlots[i].serial;

                // Consume uses (up to usesAvailable or remaining slots needed)
                uint256 usesToConsume = Math.min(
                    discountSlots[i].usesAvailable,
                    costResult.holderSlotsUsed - slotsConsumed
                );

                serialDiscountUsage[token][serial] += usesToConsume;
                slotsConsumed += usesToConsume;
            }
        }

        // ====== Step 8: Update State ======

        // Update mint tracking
        walletMintCount[msg.sender] += _numberToMint;
        mintTiming.lastMintTime = block.timestamp;

        // Track payment for each serial (for refunds) - split both HBAR and LAZY evenly
        uint256 hbarPerNFT = hbarPaid / _numberToMint;
        uint256 lazyPerNFT = lazyPaid / _numberToMint;

        for (uint256 i = 0; i < selectedSerials.length; i++) {
            uint256 serial = selectedSerials[i];
            serialMintTime[serial] = block.timestamp;
            serialPaymentTracking[serial] = MintPayment({
                hbarPaid: hbarPerNFT,
                lazyPaid: lazyPerNFT,
                minter: msg.sender
            });
        }

        // Consume WL slots (using pre-calculated count from waterfall)
        if (costResult.wlSlotsUsed > 0) {
            whitelistSlots[msg.sender] -= costResult.wlSlotsUsed;
        }

        // Update wallet average payment (for future refund calculations)
        updateWalletAveragePayment(
            msg.sender,
            hbarPaid,
            lazyPaid,
            _numberToMint
        );

        // ====== Step 9: Emit Event ======

        emit NFTMinted(
            msg.sender,
            _numberToMint,
            selectedSerials,
            hbarPaid,
            lazyPaid,
            costResult.totalDiscount
        );
    }

    // ============ Refund Function ============

    /// @notice Refund NFTs within the refund window
    /// @param _serials Array of serial numbers to refund
    function refundNFT(uint256[] memory _serials) external nonReentrant {
        if (_serials.length == 0) revert EmptyArray();

        uint256 totalHbarRefund = 0;
        uint256 totalLazyRefund = 0;

        // Validate and calculate refunds
        for (uint256 i = 0; i < _serials.length; i++) {
            uint256 serial = _serials[i];

            // Verify ownership
            if (IERC721(NFT_TOKEN).ownerOf(serial) != msg.sender) {
                revert InvalidRefundSerial(serial);
            }

            // Check refund window
            uint256 mintTime = serialMintTime[serial];
            if (
                mintTime == 0 ||
                block.timestamp > mintTime + mintTiming.refundWindow
            ) {
                revert RefundWindowExpired();
            }

            // Block refund if serial has been used as discount token
            // This prevents: mint at full price → use for discount → refund → profit
            if (serialDiscountUsage[NFT_TOKEN][serial] > 0) {
                revert RefundBlockedDueToDiscountUsage(serial);
            }

            // Calculate refund
            MintPayment memory payment = serialPaymentTracking[serial];

            if (payment.hbarPaid > 0) {
                totalHbarRefund +=
                    (payment.hbarPaid * mintTiming.refundPercentage) /
                    100;
            }
            if (payment.lazyPaid > 0) {
                totalLazyRefund +=
                    (payment.lazyPaid * mintTiming.refundPercentage) /
                    100;
            }

            // Clear tracking
            delete serialMintTime[serial];
            delete serialPaymentTracking[serial];
        }

        // Receive NFTs back (1 tinybar per transfer)
        batchMoveNFTs(
            TransferDirection.STAKING,
            NFT_TOKEN,
            _serials,
            msg.sender,
            false,
            int64(1)
        );

        // Add back to available pool
        for (uint256 i = 0; i < _serials.length; i++) {
            availableSerials.add(_serials[i]);
        }

        // Process refunds
        if (totalHbarRefund > 0) {
            payable(msg.sender).sendValue(totalHbarRefund);
        }

        if (totalLazyRefund > 0) {
            // Use LazyGasStation to payout LAZY (0 burn for refunds)
            lazyGasStation.payoutLazy(msg.sender, totalLazyRefund, 0);
        }

        // Update wallet mint count
        walletMintCount[msg.sender] -= _serials.length;

        emit NFTRefunded(
            msg.sender,
            _serials,
            totalHbarRefund,
            totalLazyRefund
        );
    }

    // ============ Cost Calculation Functions ============

    /// @notice Calculate the total costs for minting with tiered holder discounts (HBAR + LAZY)
    /// @param _numberToMint Number of NFTs to mint
    /// @param _tokens Array of discount token addresses
    /// @param _serialsByToken Array of arrays containing serials for each token
    /// @param _sacrificeCount Number of NFTs being sacrificed
    /// @return totalHbarCost The final HBAR cost after discounts (tinybars)
    /// @return totalLazyCost The final LAZY cost after discounts (tokens)
    /// @return totalDiscount The weighted average discount percentage applied
    /// @return holderSlotsUsed Number of holder discount slot uses that will be consumed
    /// @return wlSlotsUsed Number of whitelist slots that will be consumed
    function calculateMintCost(
        uint256 _numberToMint,
        address[] memory _tokens,
        uint256[][] memory _serialsByToken,
        uint256 _sacrificeCount
    )
        public
        view
        returns (
            uint256 totalHbarCost,
            uint256 totalLazyCost,
            uint256 totalDiscount,
            uint256 holderSlotsUsed,
            uint256 wlSlotsUsed
        )
    {
        // Build and sort discount slots (sorted internally)
        DiscountSlot[] memory slots = _buildAndSortDiscountSlots(
            _tokens,
            _serialsByToken
        );

        MintCostResult memory result = calculateMintCostWithSlots(
            _numberToMint,
            slots,
            _sacrificeCount
        );

        return (
            result.totalHbarCost,
            result.totalLazyCost,
            result.totalDiscount,
            result.holderSlotsUsed,
            result.wlSlotsUsed
        );
    }

    /// @notice Internal: Calculate costs using pre-built discount slots (optimized for mintNFT)
    /// @param _numberToMint Number of NFTs to mint
    /// @param _slots Pre-built and sorted array of discount slots
    /// @param _sacrificeCount Number of NFTs being sacrificed
    /// @return result MintCostResult struct with costs, discount percentage, and slot usage counts
    function calculateMintCostWithSlots(
        uint256 _numberToMint,
        DiscountSlot[] memory _slots,
        uint256 _sacrificeCount
    ) internal view returns (MintCostResult memory result) {
        // Calculate base price per NFT
        uint256 pricePerNftHbar = mintEconomics.mintPriceHbar;
        uint256 pricePerNftLazy = mintEconomics.mintPriceLazy;

        // Track NFTs remaining to price
        uint256 nftsRemaining = _numberToMint;
        uint256 totalDiscountValue = 0; // For weighted average calculation

        // Get WL information
        uint256 wlSlotsAvailable = whitelistSlots[msg.sender];
        uint256 wlDiscount = mintEconomics.wlDiscount;

        // STEP 1: Apply sacrifice discount first (exclusive - no WL stacking)
        if (_sacrificeCount > 0) {
            uint256 sacrificeNfts = Math.min(nftsRemaining, _sacrificeCount);
            uint256 sacrificeDiscount = mintEconomics.sacrificeDiscount;

            result.totalHbarCost +=
                (pricePerNftHbar * sacrificeNfts * (100 - sacrificeDiscount)) /
                100;
            result.totalLazyCost +=
                (pricePerNftLazy * sacrificeNfts * (100 - sacrificeDiscount)) /
                100;
            totalDiscountValue += sacrificeDiscount * sacrificeNfts;

            nftsRemaining -= sacrificeNfts;
        }

        // STEP 2: Apply holder discounts (sorted by best discount, can stack with WL)
        for (uint256 i = 0; i < _slots.length && nftsRemaining > 0; i++) {
            uint256 nftsAtThisDiscount = Math.min(
                nftsRemaining,
                _slots[i].usesAvailable
            );
            uint256 holderDiscount = _slots[i].discountPercentage;

            // Track holder slot usage
            result.holderSlotsUsed += nftsAtThisDiscount;

            // Check if these NFTs are WL-eligible
            uint256 wlEligibleCount = Math.min(
                nftsAtThisDiscount,
                wlSlotsAvailable
            );
            uint256 nonWlCount = nftsAtThisDiscount - wlEligibleCount;

            // WL-eligible NFTs get stacked discount (WL + holder, capped at 100%)
            if (wlEligibleCount > 0) {
                uint256 stackedDiscount = Math.min(
                    wlDiscount + holderDiscount,
                    100
                );
                result.totalHbarCost +=
                    (pricePerNftHbar *
                        wlEligibleCount *
                        (100 - stackedDiscount)) /
                    100;
                result.totalLazyCost +=
                    (pricePerNftLazy *
                        wlEligibleCount *
                        (100 - stackedDiscount)) /
                    100;
                totalDiscountValue += stackedDiscount * wlEligibleCount;
                wlSlotsAvailable -= wlEligibleCount;
                result.wlSlotsUsed += wlEligibleCount; // Track WL usage for stacked discounts
            }

            // Non-WL NFTs get holder discount only
            if (nonWlCount > 0) {
                result.totalHbarCost +=
                    (pricePerNftHbar * nonWlCount * (100 - holderDiscount)) /
                    100;
                result.totalLazyCost +=
                    (pricePerNftLazy * nonWlCount * (100 - holderDiscount)) /
                    100;
                totalDiscountValue += holderDiscount * nonWlCount;
            }

            nftsRemaining -= nftsAtThisDiscount;
        }

        // STEP 3: Remaining NFTs - WL-only or full price
        if (nftsRemaining > 0) {
            uint256 wlOnlyCount = Math.min(nftsRemaining, wlSlotsAvailable);
            uint256 fullPriceCount = nftsRemaining - wlOnlyCount;

            // WL-only NFTs (no holder discount)
            if (wlOnlyCount > 0) {
                result.totalHbarCost +=
                    (pricePerNftHbar * wlOnlyCount * (100 - wlDiscount)) /
                    100;
                result.totalLazyCost +=
                    (pricePerNftLazy * wlOnlyCount * (100 - wlDiscount)) /
                    100;
                totalDiscountValue += wlDiscount * wlOnlyCount;
                result.wlSlotsUsed += wlOnlyCount; // Track WL-only usage
            }

            // Full price NFTs (no discounts)
            if (fullPriceCount > 0) {
                result.totalHbarCost += pricePerNftHbar * fullPriceCount;
                result.totalLazyCost += pricePerNftLazy * fullPriceCount;
            }
        }

        // Calculate weighted average discount
        result.totalDiscount = totalDiscountValue / _numberToMint;
    }

    /// @notice Get discount information for serials across specific discount tokens
    /// @param _tokens Array of discount token addresses to check
    /// @param _serials Array of serial numbers to check (must match _tokens length)
    /// @return discountPercentages Array of discount percentages available
    /// @return usesRemaining Array of remaining uses for each serial
    /// @return isEligible Array of eligibility flags
    function getBatchSerialDiscountInfo(
        address[] memory _tokens,
        uint256[] memory _serials
    )
        external
        view
        returns (
            uint256[] memory discountPercentages,
            uint256[] memory usesRemaining,
            bool[] memory isEligible
        )
    {
        if (_tokens.length != _serials.length) revert ArrayLengthMismatch();

        discountPercentages = new uint256[](_serials.length);
        usesRemaining = new uint256[](_serials.length);
        isEligible = new bool[](_serials.length);

        for (uint256 i = 0; i < _serials.length; i++) {
            address token = _tokens[i];
            uint256 serial = _serials[i];

            if (isDiscountToken[token]) {
                uint256 tierIndex = tokenToTierIndex[token];
                DiscountTier memory tier = discountTiers[tierIndex];
                uint256 usageCount = serialDiscountUsage[token][serial];

                if (usageCount < tier.maxUsesPerSerial) {
                    discountPercentages[i] = tier.discountPercentage;
                    usesRemaining[i] = tier.maxUsesPerSerial - usageCount;
                    isEligible[i] = true;
                }
                // else: arrays already initialized to 0/false
            }
            // else: not a discount token, leave as 0/false
        }
    }

    // ============ Internal Helper Functions ============

    /// @notice Check if user owns or has delegation rights for an NFT
    /// @param _user User address to check
    /// @param _token Token address
    /// @param _serial Serial number
    /// @return True if user owns the NFT or has delegation rights
    function _canUseSerial(
        address _user,
        address _token,
        uint256 _serial
    ) internal view returns (bool) {
        // Check direct ownership first
        if (IERC721(_token).ownerOf(_serial) == _user) {
            return true;
        }

        // Check if serial is delegated to user via LazyDelegateRegistry
        return
            lazyDelegateRegistry.checkDelegateToken(
                msg.sender,
                _token,
                _serial
            );
    }

    /// @notice Build and sort discount slots from user's tokens (combined for efficiency)
    /// @param _tokens Array of discount token addresses
    /// @param _serialsByToken Array of arrays of serials for each token
    /// @return slots Sorted array of DiscountSlot structs with available uses (descending by discount %)
    /// @dev Uses assembly to resize array and insertion sort (efficient for small arrays)
    function _buildAndSortDiscountSlots(
        address[] memory _tokens,
        uint256[][] memory _serialsByToken
    ) internal view returns (DiscountSlot[] memory slots) {
        // Calculate total slot count
        uint256 totalSlots = 0;
        for (uint256 i = 0; i < _serialsByToken.length; i++) {
            totalSlots += _serialsByToken[i].length;
        }

        slots = new DiscountSlot[](totalSlots);
        uint256 slotIndex = 0;

        // Build slots array
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];

            if (!isDiscountToken[token]) continue;

            uint256 tierIndex = tokenToTierIndex[token];
            DiscountTier memory tier = discountTiers[tierIndex];

            for (uint256 j = 0; j < _serialsByToken[i].length; j++) {
                uint256 serial = _serialsByToken[i][j];
                uint256 usageCount = serialDiscountUsage[token][serial];
                uint256 remaining = tier.maxUsesPerSerial > usageCount
                    ? tier.maxUsesPerSerial - usageCount
                    : 0;

                if (remaining > 0) {
                    slots[slotIndex] = DiscountSlot({
                        token: token,
                        serial: serial,
                        discountPercentage: tier.discountPercentage,
                        usesAvailable: remaining
                    });
                    slotIndex++;
                }
            }
        }

        // Resize array to actual number of valid slots (safe assembly usage)
        assembly {
            mstore(slots, slotIndex)
        }

        // Sort by discount percentage (descending) using insertion sort
        uint256 length = slotIndex; // Use actual length after resize
        for (uint256 i = 1; i < length; i++) {
            DiscountSlot memory key = slots[i];
            uint256 j = i;
            while (
                j > 0 &&
                slots[j - 1].discountPercentage < key.discountPercentage
            ) {
                slots[j] = slots[j - 1];
                j--;
            }
            slots[j] = key;
        }
    }

    /// @notice Select random serials from the available pool
    /// @param _count Number of serials to select
    /// @return selectedSerials Array of selected serial numbers
    function selectRandomSerials(
        uint256 _count
    ) internal returns (uint256[] memory selectedSerials) {
        selectedSerials = new uint256[](_count);

        for (uint256 i = 0; i < _count; i++) {
            // Get current pool size
            uint256 poolSize = availableSerials.length();

            // Generate random index
            uint256 randomIndex = IPrngGenerator(PRNG_GENERATOR)
                .getPseudorandomNumber(0, poolSize - 1, i + block.timestamp);

            // Get serial at random index
            uint256 selectedSerial = availableSerials.at(randomIndex);
            selectedSerials[i] = selectedSerial;

            // Remove from available pool
            availableSerials.remove(selectedSerial);
        }
    }

    /// @notice Update wallet average payment tracking
    /// @param _wallet The wallet address
    /// @param _hbarPaid HBAR paid in this mint
    /// @param _lazyPaid LAZY paid in this mint
    /// @param _quantity Number of NFTs minted
    function updateWalletAveragePayment(
        address _wallet,
        uint256 _hbarPaid,
        uint256 _lazyPaid,
        uint256 _quantity
    ) internal {
        uint256 previousMintCount = walletMintCount[_wallet];
        uint256 newTotalMints = previousMintCount + _quantity;

        if (_hbarPaid > 0) {
            uint256 previousAvgHbar = walletAveragePaymentHbar[_wallet];
            uint256 newAvgHbar = ((previousAvgHbar * previousMintCount) +
                _hbarPaid) / newTotalMints;
            walletAveragePaymentHbar[_wallet] = newAvgHbar;
        }

        if (_lazyPaid > 0) {
            uint256 previousAvgLazy = walletAveragePaymentLazy[_wallet];
            uint256 newAvgLazy = ((previousAvgLazy * previousMintCount) +
                _lazyPaid) / newTotalMints;
            walletAveragePaymentLazy[_wallet] = newAvgLazy;
        }
    }

    // ============ Admin Functions - Discount Management ============

    /// @notice Add or update a discount tier
    /// @param _token The token address that provides the discount
    /// @param _discountPercentage The discount percentage (0-100)
    /// @param _maxUsesPerSerial Maximum times a serial can be used
    function addDiscountTier(
        address _token,
        uint256 _discountPercentage,
        uint256 _maxUsesPerSerial
    ) external onlyAdmin {
        if (_token == address(0)) revert InvalidParameter();
        if (_discountPercentage > 100) revert InvalidParameter();
        if (_maxUsesPerSerial == 0) revert InvalidParameter();

        uint256 tierIndex;

        if (isDiscountToken[_token]) {
            // Update existing tier
            tierIndex = tokenToTierIndex[_token];
            discountTiers[tierIndex] = DiscountTier({
                discountPercentage: _discountPercentage,
                maxUsesPerSerial: _maxUsesPerSerial
            });
        } else {
            // Add new tier
            tierIndex = discountTiers.length;
            discountTiers.push(
                DiscountTier({
                    discountPercentage: _discountPercentage,
                    maxUsesPerSerial: _maxUsesPerSerial
                })
            );
            tokenToTierIndex[_token] = tierIndex;
            isDiscountToken[_token] = true;
        }

        emit DiscountTierUpdated(
            _token,
            tierIndex,
            _discountPercentage,
            _maxUsesPerSerial
        );
    }

    /// @notice Remove a discount tier
    /// @param _token The token address to remove
    function removeDiscountTier(address _token) external onlyAdmin {
        if (!isDiscountToken[_token]) revert InvalidParameter();

        uint256 tierIndex = tokenToTierIndex[_token];

        // Mark as removed (don't actually delete to preserve indices)
        discountTiers[tierIndex] = DiscountTier({
            discountPercentage: 0,
            maxUsesPerSerial: 0
        });

        delete tokenToTierIndex[_token];
        delete isDiscountToken[_token];

        emit DiscountTierUpdated(_token, tierIndex, 0, 0);
    }

    // ============ Admin Functions - Economics ============

    /// @notice Update mint economics
    function updateEconomics(
        uint256 _mintPriceHbar,
        uint256 _mintPriceLazy,
        uint256 _wlDiscount,
        uint256 _sacrificeDiscount,
        uint256 _maxMint,
        uint256 _maxMintPerWallet,
        uint256 _buyWlWithLazy,
        uint256 _buyWlSlotCount,
        uint256 _maxSacrifice,
        bool _lazyFromContract
    ) external onlyAdmin {
        if (_wlDiscount > 100) revert InvalidParameter();
        if (_sacrificeDiscount > 100) revert InvalidParameter();

        mintEconomics.mintPriceHbar = _mintPriceHbar;
        mintEconomics.mintPriceLazy = _mintPriceLazy;
        mintEconomics.wlDiscount = _wlDiscount;
        mintEconomics.sacrificeDiscount = _sacrificeDiscount;
        mintEconomics.maxMint = _maxMint;
        mintEconomics.maxMintPerWallet = _maxMintPerWallet;
        mintEconomics.buyWlWithLazy = _buyWlWithLazy;
        mintEconomics.buyWlSlotCount = _buyWlSlotCount;
        mintEconomics.maxSacrifice = _maxSacrifice;
        mintEconomics.lazyFromContract = _lazyFromContract;

        emit EconomicsUpdated(
            _mintPriceHbar,
            _mintPriceLazy,
            _wlDiscount,
            _sacrificeDiscount
        );
    }

    // ============ Admin Functions - Timing ============

    /// @notice Update mint timing configuration
    function updateTiming(
        uint256 _mintStartTime,
        bool _mintPaused,
        uint256 _refundWindow,
        uint256 _refundPercentage,
        bool _wlOnly
    ) external onlyAdmin {
        if (_refundPercentage > 100) revert InvalidParameter();

        mintTiming.mintStartTime = _mintStartTime;
        mintTiming.mintPaused = _mintPaused;
        mintTiming.refundWindow = _refundWindow;
        mintTiming.refundPercentage = _refundPercentage;
        mintTiming.wlOnly = _wlOnly;

        emit TimingUpdated(
            _mintStartTime,
            _mintPaused,
            _refundWindow,
            _refundPercentage,
            _wlOnly
        );
    }

    /// @notice Update pause status for minting
    /// @param _paused True to pause, false to unpause
    function updatePauseStatus(bool _paused) external onlyAdmin {
        mintTiming.mintPaused = _paused;
        emit TimingUpdated(
            mintTiming.mintStartTime,
            _paused,
            mintTiming.refundWindow,
            mintTiming.refundPercentage,
            mintTiming.wlOnly
        );
    }

    // ============ Admin Functions - Whitelist ============

    /// @notice Add whitelist slots to an address
    /// @param _address Address to add slots to
    /// @param _slots Number of slots to add
    function addToWhitelist(
        address _address,
        uint256 _slots
    ) external onlyAdmin {
        if (_address == address(0)) revert InvalidParameter();
        if (_slots == 0) revert InvalidParameter();

        whitelistSlots[_address] += _slots;
        emit WhitelistUpdated(_address, true);
    }

    /// @notice Add whitelist slots to multiple addresses
    /// @param _addresses Array of addresses to add slots to
    /// @param _slots Array of slot counts to add (must match _addresses length)
    function batchAddToWhitelist(
        address[] memory _addresses,
        uint256[] memory _slots
    ) external onlyAdmin {
        if (_addresses.length != _slots.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < _addresses.length; i++) {
            if (_addresses[i] != address(0) && _slots[i] > 0) {
                whitelistSlots[_addresses[i]] += _slots[i];
                emit WhitelistUpdated(_addresses[i], true);
            }
        }
    }

    /// @notice Remove addresses from whitelist (sets slots to 0)
    /// @param _addresses Array of addresses to remove
    function removeFromWhitelist(
        address[] memory _addresses
    ) external onlyAdmin {
        if (_addresses.length == 0) revert EmptyArray();

        for (uint256 i = 0; i < _addresses.length; i++) {
            if (_addresses[i] != address(0)) {
                whitelistSlots[_addresses[i]] = 0;
                emit WhitelistUpdated(_addresses[i], false);
            }
        }
    }

    /// @notice Buy whitelist slots with LAZY tokens
    /// @param _quantity Number of slot groups to purchase (e.g., 2 = buy 2x the configured slot count)
    function buyWhitelistWithLazy(uint256 _quantity) external {
        if (mintEconomics.buyWlWithLazy == 0) revert InvalidParameter();
        if (mintEconomics.buyWlSlotCount == 0) revert InvalidParameter();
        if (_quantity == 0) revert InvalidParameter();

        uint256 totalLazyCost = mintEconomics.buyWlWithLazy * _quantity;
        uint256 totalSlotsGranted = mintEconomics.buyWlSlotCount * _quantity;

        // Draw LAZY from user
        lazyGasStation.drawLazyFrom(
            msg.sender,
            totalLazyCost,
            lazyDetails.lazyBurnPerc
        );

        // Add slots to user's whitelist allocation
        whitelistSlots[msg.sender] += totalSlotsGranted;

        emit WhitelistUpdated(msg.sender, true);
        emit LazyPaymentEvent(
            msg.sender,
            totalLazyCost,
            (totalLazyCost * lazyDetails.lazyBurnPerc) / 100
        );
    }

    // ============ Admin Functions - Admin Management ============

    /// @notice Add a new admin
    /// @param _admin Address to add as admin
    function addAdmin(address _admin) external onlyAdmin {
        if (_admin == address(0)) revert InvalidParameter();

        adminSet.add(_admin);
        emit AdminUpdated(_admin, true);
    }

    /// @notice Remove an admin
    /// @param _admin Address to remove from admins
    function removeAdmin(address _admin) external onlyAdmin {
        // Must have at least one admin
        if (adminSet.length() <= 1) revert CannotRemoveLastAdmin();

        adminSet.remove(_admin);
        emit AdminUpdated(_admin, false);
    }

    /// @notice Check if address is admin
    /// @param _address Address to check
    /// @return True if address is admin
    function isAdmin(address _address) external view returns (bool) {
        return adminSet.contains(_address);
    }

    /// @notice Get all admin addresses
    /// @return Array of admin addresses
    function getAdmins() external view returns (address[] memory) {
        uint256 length = adminSet.length();
        address[] memory admins = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            admins[i] = adminSet.at(i);
        }
        return admins;
    }

    // ============ Admin Functions - Configuration ============

    /// @notice Set sacrifice destination address
    /// @param _destination Destination address for sacrificed NFTs
    function setSacrificeDestination(address _destination) external onlyAdmin {
        sacrificeDestination = _destination;
    }

    /// @notice Update LAZY burn percentage
    /// @param _burnPerc New burn percentage (0-100)
    function updateLazyBurnPercentage(uint256 _burnPerc) external onlyAdmin {
        if (_burnPerc > 100) revert InvalidParameter();
        lazyDetails.lazyBurnPerc = _burnPerc;
    }

    // ============ Admin Functions - Withdrawals ============

    /// @notice Internal helper to check withdrawal is allowed (after refund window + buffer)
    /// @param _recipient Recipient address to validate
    /// @dev Ensures withdrawals only happen when all minted NFTs are past their refund window
    function _checkWithdrawalAllowed(address _recipient) internal view {
        if (_recipient == address(0)) revert InvalidParameter();

        // Calculate minimum time that must pass: refundWindow + 1 hour buffer
        uint256 requiredCooldown = mintTiming.refundWindow + 1 hours;

        // Check if enough time has passed since last mint
        if (
            mintTiming.lastMintTime > 0 &&
            block.timestamp < mintTiming.lastMintTime + requiredCooldown
        ) {
            revert WithdrawalDuringRefundWindow();
        }
    }

    /// @notice Withdraw HBAR from contract
    /// @param _recipient Address to receive HBAR
    /// @param _amount Amount of HBAR to withdraw (in tinybars)
    function withdrawHbar(
        address _recipient,
        uint256 _amount
    ) external onlyAdmin {
        _checkWithdrawalAllowed(_recipient);

        payable(_recipient).sendValue(_amount);

        emit FundsWithdrawn(_recipient, _amount, 0);
    }

    /// @notice Withdraw LAZY tokens from contract
    /// @param _recipient Address to receive LAZY
    /// @param _amount Amount of LAZY to withdraw
    function withdrawLazy(
        address _recipient,
        uint256 _amount
    ) external onlyAdmin {
        _checkWithdrawalAllowed(_recipient);

        bool success = IERC20(lazyDetails.lazyToken).transfer(
            _recipient,
            _amount
        );
        if (!success) revert TransferFailed();

        emit FundsWithdrawn(_recipient, 0, _amount);
    }

    // ============ View Functions ============

    /// @notice Get remaining supply in the pool
    /// @return Number of NFTs available for minting
    function getRemainingSupply() external view returns (uint256) {
        return availableSerials.length();
    }

    /// @notice Get mint count for a wallet
    /// @param _wallet Wallet address to check
    /// @return Number of NFTs minted by wallet
    function getWalletMintCount(
        address _wallet
    ) external view returns (uint256) {
        return walletMintCount[_wallet];
    }

    /// @notice Check if address is whitelisted
    /// @param _address Address to check
    /// @return True if whitelisted (has slots > 0)
    function isWhitelisted(address _address) external view returns (bool) {
        return whitelistSlots[_address] > 0;
    }

    /// @notice Get whitelist slot counts for multiple addresses
    /// @param _users Array of addresses to check
    /// @return Array of slot counts for each address
    function getBatchWhitelistSlots(
        address[] memory _users
    ) external view returns (uint256[] memory) {
        uint256[] memory slots = new uint256[](_users.length);
        for (uint256 i = 0; i < _users.length; i++) {
            slots[i] = whitelistSlots[_users[i]];
        }
        return slots;
    }

    /// @notice Get all economics settings
    /// @return Economics struct with all settings
    function getMintEconomics() external view returns (MintEconomics memory) {
        return mintEconomics;
    }

    /// @notice Get all timing settings
    /// @return Timing struct with all settings
    function getMintTiming() external view returns (MintTiming memory) {
        return mintTiming;
    }

    /// @notice Get LAZY configuration
    /// @return LazyDetails struct with token and burn percentage
    function getLazyDetails() external view returns (LazyDetails memory) {
        return lazyDetails;
    }

    /// @notice Get payment tracking for a serial
    /// @param _serial Serial number to check
    /// @return MintPayment struct with payment details
    function getSerialPayment(
        uint256 _serial
    ) external view returns (MintPayment memory) {
        return serialPaymentTracking[_serial];
    }

    /// @notice Get mint time for a serial
    /// @param _serial Serial number to check
    /// @return Timestamp when serial was minted
    function getSerialMintTime(
        uint256 _serial
    ) external view returns (uint256) {
        return serialMintTime[_serial];
    }

    /// @notice Check if serial is in available pool
    /// @param _serial Serial number to check
    /// @return True if serial is available
    function isSerialAvailable(uint256 _serial) external view returns (bool) {
        return availableSerials.contains(_serial);
    }

    /// @notice Get paginated available serials
    /// @param _offset Starting index
    /// @param _limit Number of serials to return
    /// @return Array of serial numbers
    function getAvailableSerialsPaginated(
        uint256 _offset,
        uint256 _limit
    ) external view returns (uint256[] memory) {
        uint256 length = availableSerials.length();
        if (_offset >= length) {
            return new uint256[](0);
        }

        uint256 end = Math.min(_offset + _limit, length);
        uint256 resultLength = end - _offset;
        uint256[] memory serials = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            serials[i] = availableSerials.at(_offset + i);
        }

        return serials;
    }

    /// @notice Get discount tier count
    /// @return Number of discount tiers
    function getDiscountTierCount() external view returns (uint256) {
        return discountTiers.length;
    }

    /// @notice Get discount tier details
    /// @param _tierIndex Index of the tier
    /// @return DiscountTier struct
    function getDiscountTier(
        uint256 _tierIndex
    ) external view returns (DiscountTier memory) {
        if (_tierIndex >= discountTiers.length) revert InvalidParameter();
        return discountTiers[_tierIndex];
    }

    /// @notice Get tier index for a token
    /// @param _token Token address
    /// @return Tier index
    function getTokenTierIndex(address _token) external view returns (uint256) {
        if (!isDiscountToken[_token]) revert InvalidParameter();
        return tokenToTierIndex[_token];
    }

    /// @notice Get comprehensive discount info for a specific serial
    /// @param _token Token address
    /// @param _serial Serial number
    /// @return isEligible True if token provides discount
    /// @return remainingUses Number of uses remaining for this serial (0 if exhausted or not eligible)
    /// @return currentUsage Current number of times this serial has been used for discounts
    function getSerialDiscountInfo(
        address _token,
        uint256 _serial
    )
        external
        view
        returns (bool isEligible, uint256 remainingUses, uint256 currentUsage)
    {
        isEligible = isDiscountToken[_token];
        currentUsage = serialDiscountUsage[_token][_serial];

        if (isEligible) {
            uint256 tierIndex = tokenToTierIndex[_token];
            uint256 maxUses = discountTiers[tierIndex].maxUsesPerSerial;

            if (currentUsage < maxUses) {
                remainingUses = maxUses - currentUsage;
            } else {
                remainingUses = 0;
            }
        } else {
            remainingUses = 0;
        }
    }

    /// @notice Check if refund is owed for serials and get refund expiry times
    /// @param _serials Array of serial numbers to check
    /// @return isOwed Array of booleans indicating if refund is owed for each serial
    /// @return expiryTimes Array of timestamps when refund expires for each serial (0 if not eligible)
    function isRefundOwed(
        uint256[] memory _serials
    )
        external
        view
        returns (bool[] memory isOwed, uint256[] memory expiryTimes)
    {
        isOwed = new bool[](_serials.length);
        expiryTimes = new uint256[](_serials.length);

        for (uint256 i = 0; i < _serials.length; i++) {
            uint256 serial = _serials[i];
            uint256 mintTime = serialMintTime[serial];

            if (mintTime > 0) {
                uint256 expiryTime = mintTime + mintTiming.refundWindow;
                expiryTimes[i] = expiryTime;
                isOwed[i] = block.timestamp <= expiryTime;
            }
        }
    }

    // ============ Receive Function ============

    /// @notice Allow contract to receive HBAR
    receive() external payable {}
}
