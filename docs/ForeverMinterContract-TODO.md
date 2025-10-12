# ForeverMinterContract - Implementation TODO

## Version: 1.0
## Status: Ready for Implementation

---

## Phase 1: Core Contract Structure

### 1.1 Contract Declaration & Imports
- [ ] Create `ForeverMinterContract.sol` file
- [ ] Add SPDX license identifier (GPL-3.0)
- [ ] Set Solidity version pragma (>=0.8.12 <0.9.0)
- [ ] Import OpenZeppelin contracts:
  - [ ] `Ownable.sol`
  - [ ] `ReentrancyGuard.sol`
  - [ ] `SafeCast.sol`
  - [ ] `EnumerableMap.sol`
  - [ ] `EnumerableSet.sol`
  - [ ] `IERC721.sol`
  - [ ] `IERC20.sol`
  - [ ] `Address.sol`
  - [ ] `Math.sol`
- [ ] Import Hedera contracts:
  - [ ] `HederaResponseCodes.sol`
  - [ ] `HederaTokenService.sol`
  - [ ] `IHederaTokenService.sol`
- [ ] Import custom contracts:
  - [ ] `TokenStakerV2.sol`
  - [ ] `IPrngGenerator.sol`
  - [ ] `ILazyGasStation.sol`
  - [ ] `IBurnableHTS.sol`
- [ ] Declare contract with inheritance

### 1.2 Using Directives
- [ ] Add `using EnumerableSet for EnumerableSet.UintSet`
- [ ] Add `using EnumerableSet for EnumerableSet.AddressSet`
- [ ] Add `using EnumerableMap for EnumerableMap.AddressToUintMap`
- [ ] Add `using SafeCast for uint256`
- [ ] Add `using SafeCast for int64`
- [ ] Add `using SafeCast for int256`
- [ ] Add `using Address for address`
- [ ] Add `using Math for uint256`

---

## Phase 2: State Variables

### 2.1 Immutable Variables
- [ ] `address public immutable nftToken`
- [ ] `address public immutable prngGenerator`

### 2.2 Serial Management
- [ ] `EnumerableSet.UintSet private availableSerials`
- [ ] `mapping(uint256 => uint256) private serialMintTime`
- [ ] Create `MintPayment` struct
  - [ ] `uint256 hbarPaid`
  - [ ] `uint256 lazyPaid`
  - [ ] `address minter`
- [ ] `mapping(uint256 => MintPayment) private serialPaymentTracking`

### 2.3 Economics & Timing Structs
- [ ] Create `MintEconomics` struct:
  - [ ] `uint256 mintPriceHbar`
  - [ ] `uint256 mintPriceLazy`
  - [ ] `uint256 wlDiscount`
  - [ ] `uint256 sacrificeDiscount`
  - [ ] `uint256 maxMint`
  - [ ] `uint256 maxMintPerWallet`
  - [ ] `uint256 buyWlWithLazy`
  - [ ] `uint256 maxWlAddressMint`
  - [ ] `uint256 maxSacrifice`
- [ ] `MintEconomics private mintEconomics`
- [ ] Create `MintTiming` struct:
  - [ ] `uint256 lastMintTime`
  - [ ] `uint256 mintStartTime`
  - [ ] `bool mintPaused`
  - [ ] `uint256 refundWindow`
  - [ ] `uint256 refundPercentage`
  - [ ] `bool wlOnly`
- [ ] `MintTiming private mintTiming`

### 2.4 Discount System
- [ ] Create `DiscountTier` struct:
  - [ ] `uint256 discountPercentage`
  - [ ] `uint256 maxUsesPerSerial`
- [ ] `DiscountTier[] private discountTiers`
- [ ] `mapping(address => uint256) private tokenToTierIndex`
- [ ] `mapping(address => bool) private isDiscountToken`
- [ ] `mapping(address => mapping(uint256 => uint256)) private serialDiscountUsage`

### 2.5 Lazy Token Configuration
- [ ] Create `LazyDetails` struct:
  - [ ] `address lazyToken`
  - [ ] `uint256 lazyBurnPerc`
- [ ] `LazyDetails private lazyDetails`
- [ ] `ILazyGasStation public lazyGasStation`

### 2.6 Other State Variables
- [ ] `address public sacrificeDestination`
- [ ] `EnumerableMap.AddressToUintMap private whitelistedAddressQtyMap`
- [ ] `EnumerableMap.AddressToUintMap private addressToNumMintedMap`
- [ ] `EnumerableMap.AddressToUintMap private wlAddressToNumMintedMap`
- [ ] `EnumerableSet.AddressSet private adminSet`
- [ ] `uint256 public totalMinted`

---

## Phase 3: Events

### 3.1 Minting & Refund Events
- [ ] `event MintEvent(address indexed minter, uint256[] serials, uint256 hbarPaid, uint256 lazyPaid)`
- [ ] `event RefundEvent(address indexed refunder, uint256[] serials, uint256 hbarRefunded, uint256 lazyRefunded)`

### 3.2 Sacrifice Events
- [ ] `event SacrificeEvent(address indexed sacrificer, uint256[] sacrificedSerials, address indexed destination)`

### 3.3 Pool Management Events
- [ ] `event NFTsAddedToPool(address indexed contributor, uint256[] serials, uint256 newPoolSize)`
- [ ] `event NFTsRemovedFromPool(address indexed admin, uint256[] serials, uint256 newPoolSize)`

### 3.4 Discount Events
- [ ] `event DiscountTierAdded(address indexed tokenAddress, uint256 discountPercentage, uint256 maxUsesPerSerial)`
- [ ] `event DiscountTierUpdated(address indexed tokenAddress, uint256 discountPercentage, uint256 maxUsesPerSerial)`
- [ ] `event DiscountTierRemoved(address indexed tokenAddress)`
- [ ] `event DiscountUsed(address indexed user, address indexed discountToken, uint256 serial, uint256 usesConsumed)`

### 3.5 Payment Events
- [ ] `event LazyPaymentEvent(address indexed payer, uint256 amount, uint256 burnPercentage)`
- [ ] `event HbarWithdrawn(address indexed recipient, uint256 amount)`
- [ ] `event LazyWithdrawn(address indexed recipient, uint256 amount)`

### 3.6 Admin Events
- [ ] `event AdminAdded(address indexed newAdmin, address indexed addedBy)`
- [ ] `event AdminRemoved(address indexed removedAdmin, address indexed removedBy)`

### 3.7 Configuration Events
- [ ] `event EconomicsUpdated(string parameter, uint256 oldValue, uint256 newValue)`
- [ ] `event TimingUpdated(string parameter, uint256 oldValue, uint256 newValue)`
- [ ] `event SacrificeDestinationUpdated(address indexed oldDestination, address indexed newDestination)`
- [ ] `event WhitelistAdded(address indexed user, uint256 spots)`
- [ ] `event WhitelistRemoved(address indexed user)`
- [ ] `event WhitelistPurchased(address indexed user, uint256 spotsPurchased, uint256 lazyPaid)`

---

## Phase 4: Errors

- [ ] `error NotInitialized()`
- [ ] `error BadQuantity(uint256 quantity)`
- [ ] `error MaxMintExceeded(uint256 requested, uint256 max)`
- [ ] `error MaxSacrificeExceeded(uint256 requested, uint256 max)`
- [ ] `error MaxMintPerWalletExceeded(uint256 totalAfterMint, uint256 max)`
- [ ] `error MustMatchQuantity()`
- [ ] `error NotOpen()`
- [ ] `error Paused()`
- [ ] `error MintedOut()`
- [ ] `error NotAdmin()`
- [ ] `error NotWL()`
- [ ] `error NotOwner()`
- [ ] `error NotEligibleForDiscount()`
- [ ] `error NotEnoughHbar()`
- [ ] `error NotEnoughLazy()`
- [ ] `error LazyTransferFailed()`
- [ ] `error CannotMixSacrificeAndDiscount()`
- [ ] `error InvalidDiscountSerial(uint256 serial)`
- [ ] `error DiscountAlreadyFullyUsed(uint256 serial)`
- [ ] `error RefundWindowExpired(uint256 serial, uint256 expiredAt)`
- [ ] `error NotEligibleForRefund()`
- [ ] `error SerialNotOwnedByContract(uint256 serial)`
- [ ] `error SerialNotInPool(uint256 serial)`
- [ ] `error EmergencyWithdrawOnlyWhenPaused()`
- [ ] `error CannotRemoveLastAdmin()`
- [ ] `error CannotRemoveSelf()`
- [ ] `error ZeroAddress()`
- [ ] `error CooldownActive(uint256 timeRemaining)`
- [ ] `error InvalidPercentage(uint256 value)`
- [ ] `error InvalidConfiguration()`
- [ ] `error NotEnoughWLSlots()`

---

## Phase 5: Modifiers

- [ ] Create `onlyAdmin()` modifier
  - [ ] Check `adminSet.contains(msg.sender)`
  - [ ] Revert with `NotAdmin()` if false

---

## Phase 6: Constructor

- [ ] Define constructor with parameters:
  - [ ] `address _nftToken`
  - [ ] `address _lazyToken`
  - [ ] `address _lazyGasStation`
  - [ ] `address _prngGenerator`
  - [ ] `address _lazyDelegateRegistry`
- [ ] Call `TokenStakerV2.initContracts(_lazyToken, _lazyGasStation, _lazyDelegateRegistry)`
- [ ] Set immutable variables:
  - [ ] `nftToken = _nftToken`
  - [ ] `prngGenerator = _prngGenerator`
- [ ] Add `msg.sender` to `adminSet`
- [ ] Associate contract with `nftToken` using `tokenAssociate(nftToken)` from TokenStakerV2
- [ ] Set `lazyDetails.lazyToken = _lazyToken`
- [ ] Set `lazyGasStation = ILazyGasStation(_lazyGasStation)`
- [ ] Initialize default values:
  - [ ] `mintEconomics` with zeros/defaults
  - [ ] `mintTiming.mintPaused = true`
  - [ ] `sacrificeDestination = address(0)`

---

## Phase 7: Core Functions - Initialization

- [ ] Create `initialize()` function:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `MintEconomics memory _economics`
  - [ ] Accept `MintTiming memory _timing`
  - [ ] Accept `address _sacrificeDestination`
  - [ ] Validate percentage values (0-100)
  - [ ] Set `mintEconomics = _economics`
  - [ ] Set `mintTiming = _timing`
  - [ ] Set `sacrificeDestination = _sacrificeDestination`
  - [ ] Emit configuration events

---

## Phase 8: Pool Management Functions

### 8.1 Register NFTs from Treasury
- [ ] Create `registerNFTs()` function:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `uint256[] memory _serials`
  - [ ] Loop through serials:
    - [ ] Verify `IERC721(nftToken).ownerOf(serial) == address(this)`
    - [ ] Add to `availableSerials`
  - [ ] Emit `NFTsAddedToPool` event

### 8.2 Add NFTs to Pool
- [ ] Create `addNFTsToPool()` function:
  - [ ] Add `public` visibility
  - [ ] Accept `uint256[] memory _serials`
  - [ ] Calculate hbar inline: `int64 hbarAmount = int64(uint64(_serials.length))`
  - [ ] Convert `_serials` to `uint256[]` format for `batchMoveNFTs`
  - [ ] Call `batchMoveNFTs(TransferDirection.STAKING, nftToken, _serials, msg.sender, false, hbarAmount)`
  - [ ] Add serials to `availableSerials`
  - [ ] Emit `NFTsAddedToPool` event

### 8.3 Emergency Withdrawal
- [ ] Create `emergencyWithdrawNFTs()` function:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `uint256[] memory _serials`
  - [ ] Accept `address _recipient`
  - [ ] Require `mintTiming.mintPaused == true`
  - [ ] Verify each serial in `availableSerials`
  - [ ] Remove serials from `availableSerials`
  - [ ] Call `batchMoveNFTs(TransferDirection.WITHDRAWAL, ...)`
  - [ ] Emit `NFTsRemovedFromPool` event

---

## Phase 9: Main Mint Function

### 9.1 Function Declaration
- [ ] Create `mintNFT()` function:
  - [ ] Add `external payable nonReentrant`
  - [ ] Accept `uint256 _numberToMint`
  - [ ] Accept `uint256[] memory _discountSerials`
  - [ ] Accept `uint256[] memory _sacrificeSerials`
  - [ ] Return `(uint256[] memory _receivedSerials, uint256 _totalHbarPaid, uint256 _totalLazyPaid)`

### 9.2 Validation Phase
- [ ] Validate `_numberToMint > 0`
- [ ] Validate `_numberToMint <= mintEconomics.maxMint`
- [ ] Validate `_sacrificeSerials.length <= mintEconomics.maxSacrifice`
- [ ] Check mutual exclusivity:
  - [ ] If sacrifice, require no discount serials
  - [ ] If sacrifice, require matching quantity
- [ ] Check timing:
  - [ ] Verify mint has started
  - [ ] Verify not paused
- [ ] Check supply:
  - [ ] Verify enough serials available
- [ ] Check wallet limits:
  - [ ] Verify max mint per wallet not exceeded
- [ ] Check WL-only mode:
  - [ ] Verify user is WL if required
  - [ ] Verify WL slots available

### 9.3 Serial Selection
- [ ] Call `selectRandomSerials(_numberToMint)`
- [ ] Store selected serials

### 9.4 Cost Calculation
- [ ] Call `calculateMintCost()` with parameters
- [ ] Store `totalHbar`, `totalLazy`, `discountUsage`

### 9.5 Process Sacrifices
- [ ] Check if `_sacrificeSerials.length > 0`
- [ ] If yes:
  - [ ] Validate ownership of each serial
  - [ ] Calculate hbar for transfer
  - [ ] Call `batchMoveNFTs(STAKING, ...)` to receive sacrifices
  - [ ] Check `sacrificeDestination`:
    - [ ] If `address(this)`: Add to `availableSerials`
    - [ ] Else: Call `batchMoveNFTs(WITHDRAWAL, ...)` to send out
  - [ ] Emit `SacrificeEvent`

### 9.6 Payment Collection
- [ ] If `totalLazy > 0`:
  - [ ] Call `takeLazyPayment(totalLazy, msg.sender)`
- [ ] If `totalHbar > 0`:
  - [ ] Verify `msg.value >= totalHbar`
  - [ ] Refund excess if `msg.value > totalHbar`

### 9.7 Update Discount Usage
- [ ] If `_discountSerials.length > 0`:
  - [ ] Loop through each discount serial
  - [ ] If usage > 0:
    - [ ] Get discount token address
    - [ ] Update `serialDiscountUsage`
    - [ ] Emit `DiscountUsed` event

### 9.8 Transfer NFTs to User
- [ ] Calculate hbar for transfer
- [ ] Call `batchMoveNFTs(WITHDRAWAL, ...)`

### 9.9 Update Tracking
- [ ] Calculate per-serial costs
- [ ] Loop through selected serials:
  - [ ] Set `serialMintTime[serial] = block.timestamp`
  - [ ] Set `serialPaymentTracking[serial]`
- [ ] Update `mintTiming.lastMintTime`
- [ ] Call `updateWalletMintTracking()`
- [ ] Update WL spots if applicable
- [ ] Increment `totalMinted`

### 9.10 Emit Events and Return
- [ ] Emit `MintEvent`
- [ ] Return values

---

## Phase 10: Refund Function

### 10.1 Function Declaration
- [ ] Create `refundNFT()` function:
  - [ ] Add `external nonReentrant`
  - [ ] Accept `uint256[] memory _serials`
  - [ ] Return `(uint256 _refundedHbar, uint256 _refundedLazy)`

### 10.2 Validation & Calculation
- [ ] Loop through serials:
  - [ ] Verify ownership
  - [ ] Verify within refund window
  - [ ] Get payment info
  - [ ] Calculate refunds

### 10.3 Receive NFTs Back
- [ ] Calculate hbar for transfer
- [ ] Call `batchMoveNFTs(STAKING, ...)`

### 10.4 Return to Pool
- [ ] Loop through serials
- [ ] Add to `availableSerials`

### 10.5 Issue Refunds
- [ ] If `_refundedHbar > 0`:
  - [ ] Use `Address.sendValue()`
- [ ] If `_refundedLazy > 0`:
  - [ ] Use `IERC20.transfer()`

### 10.6 Update Tracking
- [ ] Call `updateWalletMintTrackingRefund()`
- [ ] Loop through serials:
  - [ ] Delete `serialMintTime`
  - [ ] Delete `serialPaymentTracking`
- [ ] Decrement `totalMinted`

### 10.7 Emit Events
- [ ] Emit `RefundEvent`
- [ ] Return values

---

## Phase 11: Cost Calculation Function

### 11.1 Function Declaration
- [ ] Create `calculateMintCost()` function:
  - [ ] Add `public view`
  - [ ] Accept `address _user`
  - [ ] Accept `uint256 _quantity`
  - [ ] Accept `uint256[] memory _discountSerials`
  - [ ] Accept `uint256[] memory _sacrificeSerials`
  - [ ] Return `(uint256 _totalHbar, uint256 _totalLazy, uint256[] memory _discountUsage)`

### 11.2 Sacrifice Mode Logic
- [ ] Check if `_sacrificeSerials.length > 0`
- [ ] If yes:
  - [ ] Validate ownership
  - [ ] Calculate base costs
  - [ ] Apply sacrifice discount
  - [ ] Return with empty discount usage array

### 11.3 WL + Holder Mode Logic
- [ ] Check if user is WL
- [ ] Initialize `remainingToMint = _quantity`
- [ ] Create `_discountUsage` array
- [ ] Loop through discount serials:
  - [ ] Get serial discount info
  - [ ] Verify eligibility and remaining uses
  - [ ] Verify ownership
  - [ ] Calculate uses this mint
  - [ ] Calculate effective discount (stack WL if applicable)
  - [ ] Calculate discounted prices
  - [ ] Add to totals
  - [ ] Decrement `remainingToMint`
- [ ] Handle remaining mints:
  - [ ] Apply WL discount if applicable
  - [ ] Calculate at base or WL price
  - [ ] Add to totals
- [ ] Return values

---

## Phase 12: Discount System Functions

### 12.1 Get Serial Discount Info
- [ ] Create `getSerialDiscountInfo()` function:
  - [ ] Add `public view`
  - [ ] Accept `uint256 _serial`
  - [ ] Return `(bool _eligible, uint256 _remainingUses, uint256 _discountPercent)`
  - [ ] Implement logic:
    - [ ] Find token for serial (iterate through discount tokens)
    - [ ] Check if token is discount eligible
    - [ ] Get tier info
    - [ ] Calculate remaining uses
    - [ ] Return values

### 12.2 Batch Discount Info
- [ ] Create `getBatchSerialDiscountInfo()` function:
  - [ ] Add `external view`
  - [ ] Accept `uint256[] memory _serials`
  - [ ] Return arrays
  - [ ] Loop and call `getSerialDiscountInfo()` for each

### 12.3 Helper Function
- [ ] Create `getDiscountTokenForSerial()` internal view function:
  - [ ] Accept `uint256 _serial`
  - [ ] Return `address`
  - [ ] Iterate through registered discount tokens
  - [ ] Use try-catch to check ownership
  - [ ] Return address if found

### 12.4 Add Discount Tier
- [ ] Create `addDiscountTier()` function:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `address _tokenAddress`
  - [ ] Accept `uint256 _discountPercentage`
  - [ ] Accept `uint256 _maxUsesPerSerial`
  - [ ] Validate percentage (0-100)
  - [ ] Check token not already registered
  - [ ] Create and push tier
  - [ ] Update mappings
  - [ ] Emit event

### 12.5 Update Discount Tier
- [ ] Create `updateDiscountTier()` function:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Similar to add but update existing

### 12.6 Remove Discount Tier
- [ ] Create `removeDiscountTier()` function:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `address _tokenAddress`
  - [ ] Get tier index
  - [ ] Swap with last element
  - [ ] Pop array
  - [ ] Update mappings
  - [ ] Emit event

---

## Phase 13: Internal Helper Functions

### 13.1 Select Random Serials
- [ ] Create `selectRandomSerials()` internal function:
  - [ ] Accept `uint256 _count`
  - [ ] Return `uint256[] memory`
  - [ ] Create result array
  - [ ] Loop for count:
    - [ ] Generate random index via PRNG
    - [ ] Get serial at index
    - [ ] Store in result
    - [ ] Remove from `availableSerials`
  - [ ] Return result

### 13.2 Take Lazy Payment
- [ ] Create `takeLazyPayment()` internal function:
  - [ ] Accept `uint256 _amount`
  - [ ] Accept `address _payer`
  - [ ] Call `lazyGasStation.drawLazyFrom(_payer, _amount, lazyDetails.lazyBurnPerc)`
  - [ ] Emit `LazyPaymentEvent`

### 13.3 Update Wallet Mint Tracking
- [ ] Create `updateWalletMintTracking()` internal function:
  - [ ] Accept `address _wallet`
  - [ ] Accept `uint256 _count`
  - [ ] Accept `bool _isWl`
  - [ ] Update `addressToNumMintedMap`
  - [ ] If `_isWl`, update `wlAddressToNumMintedMap`

### 13.5 Update Wallet Mint Tracking Refund
- [ ] Create `updateWalletMintTrackingRefund()` internal function:
  - [ ] Accept `address _wallet`
  - [ ] Accept `uint256 _count`
  - [ ] Decrement counts in both maps

---

## Phase 14: Admin Functions

### 14.1 Admin Management
- [ ] Create `addAdmin()` function:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `address _newAdmin`
  - [ ] Validate not zero address
  - [ ] Add to `adminSet`
  - [ ] Emit event
  - [ ] Return bool

- [ ] Create `removeAdmin()` function:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `address _admin`
  - [ ] Check set length > 1
  - [ ] Remove from `adminSet`
  - [ ] Emit event
  - [ ] Return bool

- [ ] Create `isAdmin()` view function
- [ ] Create `getAdmins()` view function
- [ ] Create `getRemainingSupply()` view function returning `availableSerials.length()`

### 14.2 Economics Update Functions
- [ ] Create `updateCost()`:
  - [ ] Accept HBAR and LAZY prices
  - [ ] Update `mintEconomics`
  - [ ] Emit events

- [ ] Create `updateWlDiscount()`
- [ ] Create `updateSacrificeDiscount()`
- [ ] Create `updateMaxMint()`
- [ ] Create `updateMaxSacrifice()`
- [ ] Create `updateMaxMintPerWallet()`
- [ ] Create `updateBuyWlWithLazy()`
- [ ] Create `updateMaxWlAddressMint()`

### 14.3 Timing Update Functions
- [ ] Create `updateMintStartTime()`
- [ ] Create `updateRefundWindow()`
- [ ] Create `updateRefundPercentage()`
- [ ] Create `updatePauseStatus()`
- [ ] Create `updateWlOnlyStatus()`

### 14.4 Configuration Functions
- [ ] Create `setSacrificeDestination()`
- [ ] Create `updateLazyBurnPercentage()`
- [ ] Create `updateLazyGasStation()`

### 14.5 Withdrawal Functions
- [ ] Create `withdrawHbar()`:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `address payable _recipient`
  - [ ] Accept `uint256 _amount`
  - [ ] Check cooldown
  - [ ] Use `Address.sendValue()`
  - [ ] Emit event

- [ ] Create `withdrawLazy()`:
  - [ ] Similar to withdrawHbar but for LAZY

---

## Phase 15: Whitelist Functions

- [ ] Create `addToWhitelist()`:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Accept `address[] memory _addresses`
  - [ ] Loop and add to map
  - [ ] Emit events

- [ ] Create `removeFromWhitelist()`
- [ ] Create `clearWhitelist()`
- [ ] Create `buyWlWithLazy()`:
  - [ ] Check cost configured
  - [ ] Calculate spots purchased
  - [ ] Update map
  - [ ] Call `takeLazyPayment()`
  - [ ] Emit event

---

## Phase 16: View Functions

### 16.1 Pool & Supply Info
- [ ] Create `getAvailableSupply()` → returns `availableSerials.length()`
- [ ] Create `getNFTTokenAddress()` → returns `nftToken`
- [ ] Create `getTotalMinted()` → returns `totalMinted`

### 16.2 Economics & Timing Getters
- [ ] Create `getMintEconomics()` → returns struct
- [ ] Create `getMintTiming()` → returns struct
- [ ] Create `getLazyToken()` → returns address
- [ ] Create `getLazyBurnPercentage()` → returns percentage
- [ ] Create `getSacrificeDestination()` → returns address

### 16.3 Refund Info
- [ ] Create `getRefundInfo()`:
  - [ ] Accept `uint256 _serial`
  - [ ] Return `(bool _eligible, uint256 _timeRemaining, uint256 _refundHbar, uint256 _refundLazy)`
  - [ ] Check ownership
  - [ ] Check timing
  - [ ] Calculate amounts

### 16.4 Mint Tracking
- [ ] Create `getNumberMintedByAddress()`:
  - [ ] Check `addressToNumMintedMap` for `msg.sender`

- [ ] Create `getNumberMintedByAllAddresses()`:
  - [ ] Add `onlyAdmin` modifier
  - [ ] Return arrays

- [ ] Create `getNumberMintedByWlAddress()`
- [ ] Create `getNumberMintedByAllWlAddresses()`

### 16.5 Whitelist Info
- [ ] Create `getWhitelist()`:
  - [ ] Return arrays of addresses and quantities

- [ ] Create `isAddressWL()`:
  - [ ] Accept `address`
  - [ ] Return `(bool _inWl, uint256 _qty)`

### 16.6 Preview Functions
- [ ] Create `previewMintCost()`:
  - [ ] External view version of `calculateMintCost()`
  - [ ] Add string breakdown for UX

---

## Phase 17: Receive/Fallback Functions

- [ ] Add `receive() external payable {}`
- [ ] Add `fallback() external payable {}`

---

## Phase 18: Testing Preparation

### 18.1 Create Test File
- [ ] Create `ForeverMinterContract.test.js`
- [ ] Set up test environment
- [ ] Import required contracts and utilities

### 18.2 Deployment Helper
- [ ] Create deployment script
- [ ] Create fixture for tests

---

## Phase 19: Documentation

- [ ] Add NatSpec comments to all functions
- [ ] Document all parameters
- [ ] Document all return values
- [ ] Add usage examples in comments
- [ ] Create README for contract

---

## Phase 20: Code Review & Optimization

### 20.1 Gas Optimization
- [ ] Review loop operations
- [ ] Add `unchecked` blocks where safe
- [ ] Optimize storage reads
- [ ] Cache frequently accessed values

### 20.2 Security Review
- [ ] Check reentrancy protection
- [ ] Verify checks-effects-interactions pattern
- [ ] Review integer overflow scenarios
- [ ] Check access control on all functions

### 20.3 Code Quality
- [ ] Remove unused code
- [ ] Consistent naming conventions
- [ ] Clean up comments
- [ ] Format code consistently

---

## Phase 21: Compilation & Initial Testing

- [ ] Compile contract
- [ ] Fix any compilation errors
- [ ] Run basic deployment test
- [ ] Verify all functions compile

---

## Phase 22: Comprehensive Testing

See `ForeverMinterContract-TESTING.md` for detailed test plan.

### 22.1 Unit Tests
- [ ] Test constructor initialization
- [ ] Test each function individually
- [ ] Test edge cases
- [ ] Test error conditions

### 22.2 Integration Tests
- [ ] Test mint workflows
- [ ] Test refund workflows
- [ ] Test discount combinations
- [ ] Test sacrifice mechanism

### 22.3 Scenario Tests
- [ ] Test real-world user scenarios
- [ ] Test admin workflows
- [ ] Test error recovery

---

## Phase 23: Deployment Preparation

### 23.1 Testnet Deployment
- [ ] Deploy to testnet
- [ ] Verify contract
- [ ] Test all functions on testnet
- [ ] Document testnet addresses

### 23.2 Mainnet Preparation
- [ ] Audit contract (if applicable)
- [ ] Prepare deployment parameters
- [ ] Create deployment checklist
- [ ] Prepare documentation for users

### 23.3 Post-Deployment
- [ ] Initialize contract
- [ ] Configure discount tiers
- [ ] Add admins
- [ ] Upload NFTs to pool
- [ ] Test minting
- [ ] Monitor for issues

---

## Priority Order

**High Priority (Core Functionality):**
1. Phase 1-6: Basic structure
2. Phase 8: Pool management
3. Phase 9: Mint function
4. Phase 11: Cost calculation
5. Phase 13: Helper functions

**Medium Priority (User Features):**
6. Phase 10: Refund system
7. Phase 12: Discount system
8. Phase 15: Whitelist

**Low Priority (Admin/Support):**
9. Phase 14: Admin functions
10. Phase 16: View functions
11. Phase 7: Initialization

**Final Steps:**
12. Phases 17-23: Testing, deployment, documentation

---

## Estimated Timeline

- **Phases 1-6:** 2-3 hours (structure)
- **Phases 7-13:** 6-8 hours (core logic)
- **Phases 14-16:** 3-4 hours (admin & views)
- **Phase 17:** 15 minutes (fallbacks)
- **Phases 18-22:** 8-12 hours (testing)
- **Phase 23:** 2-3 hours (deployment)

**Total:** ~25-35 hours for complete implementation and testing

---

## Success Criteria

Contract is complete when:
- ✅ All phases checked off
- ✅ Compiles without errors
- ✅ All tests pass (>95% coverage)
- ✅ Gas optimization complete
- ✅ Security review passed
- ✅ Deployed to testnet successfully
- ✅ Documentation complete
- ✅ Ready for mainnet deployment

---

**Ready to start implementation!** 🚀
