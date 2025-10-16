# ForeverMinter - Testing Plan

## Version: 1.0.5
## Coverage Target: >95%

> **Note**: This testing plan has been updated for v1.0.5 to include comprehensive tests for the new **waterfall discount system** with **DRY slot consumption architecture**. The waterfall applies discounts in priority order: Sacrifice → Holder (sorted, with WL stacking) → WL-only → Full Price. All slot consumption is calculated once during cost calculation and directly applied, ensuring consistency. See section 11.7 for detailed waterfall test cases.

---

## Version History

### Version 1.0.5 Updates (Current)
**DRY Architecture Refactoring:**
1. **Single Source of Truth**: `calculateMintCostWithSlots()` now returns both costs AND slot usage counts
2. **Guaranteed Consistency**: Slot consumption in Steps 7-8 uses pre-calculated values from cost calculation
3. **Enhanced Return Values**: Cost calculation functions now return `holderSlotsUsed` and `wlSlotsUsed`
4. **Struct-Based Returns**: Introduced `MintCostResult` struct to avoid stack-too-deep errors
5. **Simplified mintNFT()**: Steps 7-8 now simply consume pre-calculated slot counts instead of re-implementing waterfall logic
6. **Bug Fix**: Eliminated consumption logic bugs where holder/WL slots were incorrectly consumed in edge cases

**Breaking Changes:**
- `calculateMintCost()` now returns 5 values instead of 3: `(totalHbarCost, totalLazyCost, totalDiscount, holderSlotsUsed, wlSlotsUsed)`
- External integrations calling `calculateMintCost()` must update to handle new return values

### Version 1.0.4 Updates
**New Test Coverage Areas:**
1. **Waterfall Discount System**: Progressive discount application (sacrifice → holder → WL → full)
2. **Mixed Discount Types**: Sacrifice + holder, sacrifice + WL, all combined
3. **WL Slot Consumption**: Updated logic for waterfall (only consumes after sacrifice)
4. **Sacrifice Validation**: sacrifice count must be <= mint count
5. **Weighted Average Discounts**: Complex multi-tier discount calculations
6. **Backwards Compatibility**: Ensuring old test cases still pass

### Version 1.0.2 Updates

### New Test Coverage Areas:
1. **Whitelist Slot Management**: Per-address slot grants, batch operations, slot consumption
2. **Option B Discount Logic**: Partial WL discount application, weighted averages, stacking rules
3. **Configurable Slot Purchases**: `buyWlSlotCount` parameter, multiple purchases
4. **New Query Functions**: `getWhitelistSlots()`, `getBatchWhitelistSlots()`
5. **Slot Consumption**: Tracking across mints, sacrifice mode exemption
6. **WL-Only Mode**: Behavior with 0 slots, minting beyond slots

See [ForeverMinter-WHITELIST-SLOT-SYSTEM.md](./ForeverMinter-WHITELIST-SLOT-SYSTEM.md) for detailed implementation documentation.

---

## Table of Contents

1. [Test Setup](#test-setup)
2. [Unit Tests](#unit-tests)
3. [Integration Tests](#integration-tests)
4. [Scenario Tests](#scenario-tests)
5. [Edge Cases](#edge-cases)
6. [Gas Optimization Tests](#gas-optimization-tests)
7. [Security Tests](#security-tests)

---

## Test Setup

### Test Environment

```javascript
// Required Contracts
- ForeverMinter (main contract)
- MockERC721 (for NFT token)
- MockERC20 (for LAZY token)
- MockPrngGenerator (for randomness)
- MockLazyGasStation (for LAZY handling)
- MockLazyDelegateRegistry (dummy)

// Test Accounts
- deployer (initial admin)
- admin1, admin2 (additional admins)
- user1, user2, user3 (regular users)
- wlUser1, wlUser2 (whitelisted users)
- discountHolder1, discountHolder2 (hold discount NFTs)
- treasury (NFT treasury)
```

### Fixtures

```javascript
async function deployForeverMinterFixture() {
  // Deploy all mock contracts
  // Deploy ForeverMinter
  // Set up initial state
  // Return all contracts and signers
}

async function deployWithPoolFixture() {
  // Deploy + add NFTs to pool
  // Initialize economics and timing
  // Return ready-to-mint state
}

async function deployWithDiscountsFixture() {
  // Deploy + configure discount tiers
  // Mint discount NFTs to holders
  // Return ready-to-test-discounts state
}
```

---

## Unit Tests

### 1. Constructor & Initialization

#### 1.1 Constructor
- [ ] **Test:** Constructor sets immutable variables correctly
  - Verify `nftToken` address
  - Verify `prngGenerator` address
  - Verify `lazyGasStation` address
  - Verify deployer is added to `adminSet`

- [ ] **Test:** Constructor associates with NFT token
  - Mock `tokenAssociate(nftToken)` call (inherited from TokenStakerV2)
  - Verify association success

- [ ] **Test:** Constructor initializes TokenStakerV2 correctly
  - Verify `initContracts` called with correct params

#### 1.2 Initialize Function
- [ ] **Test:** Can initialize with valid parameters
  - Set economics
  - Set timing
  - Set sacrifice destination
  - Verify all values stored

- [ ] **Test:** Only admin can initialize
  - Non-admin call should revert

- [ ] **Test:** Can re-initialize (update parameters)
  - Call twice with different values
  - Verify updates applied

- [ ] **Test:** Validates percentage values
  - Try invalid percentages (>100)
  - Should revert

---

### 2. Admin System

#### 2.1 Admin Management
- [ ] **Test:** Can add new admin
  - Admin adds another address
  - Verify added to set
  - Verify event emitted

- [ ] **Test:** Only admin can add admin
  - Non-admin tries to add
  - Should revert

- [ ] **Test:** Can remove admin
  - Add 2 admins
  - Remove one
  - Verify removed from set

- [ ] **Test:** Cannot remove last admin
  - Try to remove when only one left
  - Should revert

- [ ] **Test:** Cannot remove self (optional safety)
  - Admin tries to remove own address
  - Should revert

- [ ] **Test:** isAdmin() works correctly
  - Check admin returns true
  - Check non-admin returns false

- [ ] **Test:** getAdmins() returns all admins
  - Add multiple admins
  - Verify array correct

- [ ] **Test:** getRemainingSupply() returns correct count
  - Add NFTs to pool
  - Verify count matches availableSerials length
  - Mint some NFTs
  - Verify count decreases

---

### 3. Pool Management

#### 3.1 Register NFTs from Treasury
- [ ] **Test:** Can register NFTs owned by contract
  - Transfer NFTs to contract first
  - Call registerNFTs
  - Verify added to availableSerials

- [ ] **Test:** Reverts if NFT not owned by contract
  - Try to register without transferring
  - Should revert

- [ ] **Test:** Only admin can register
  - Non-admin call should revert

- [ ] **Test:** Emits correct event
  - Verify NFTsAddedToPool event
  - Check parameters

#### 3.2 Add NFTs to Pool
- [ ] **Test:** Anyone can add NFTs to pool
  - User transfers NFTs via addNFTsToPool
  - Verify added to pool
  - Verify batchMoveNFTs called with correct hbar amount

- [ ] **Test:** Calls TokenStakerV2 correctly
  - Mock batchMoveNFTs
  - Verify STAKING direction
  - Verify hbar amount = _serials.length
  - Verify parameters

- [ ] **Test:** Emits correct event

#### 3.3 Emergency Withdrawal
- [ ] **Test:** Can withdraw when paused
  - Pause contract
  - Withdraw NFTs
  - Verify removed from pool
  - Verify transferred out

- [ ] **Test:** Cannot withdraw when not paused
  - Try to withdraw while unpaused
  - Should revert

- [ ] **Test:** Only admin can withdraw
  - Non-admin call should revert

- [ ] **Test:** Reverts if serial not in pool
  - Try to withdraw non-existent serial
  - Should revert

---

### 4. Economics & Timing Configuration

#### 4.1 Update Cost
- [ ] **Test:** Can update HBAR price
- [ ] **Test:** Can update LAZY price
- [ ] **Test:** Can update both
- [ ] **Test:** Only admin can update
- [ ] **Test:** Emits correct events

#### 4.2 Update Discounts
- [ ] **Test:** Can update WL discount
- [ ] **Test:** Can update sacrifice discount
- [ ] **Test:** Validates percentages (0-100)
- [ ] **Test:** Only admin can update

#### 4.3 Update Limits
- [ ] **Test:** Can update maxMint
- [ ] **Test:** Can update maxSacrifice
- [ ] **Test:** Can update maxMintPerWallet
- [ ] **Test:** Validates values > 0

#### 4.4 Update Timing
- [ ] **Test:** Can update mint start time
- [ ] **Test:** Can update refund window
- [ ] **Test:** Can update refund percentage
- [ ] **Test:** Can pause/unpause
- [ ] **Test:** Can toggle WL-only mode

#### 4.5 Update Other Config
- [ ] **Test:** Can update sacrifice destination
- [ ] **Test:** Can update LAZY burn percentage
- [ ] **Test:** Can update LazyGasStation address

---

### 5. Discount Tier Management

#### 5.1 Add Discount Tier
- [ ] **Test:** Can add new discount tier
  - Add tier with token address
  - Verify stored in array
  - Verify mappings updated

- [ ] **Test:** Only admin can add tier

- [ ] **Test:** Validates percentage (0-100)

- [ ] **Test:** Emits correct event

- [ ] **Test:** Cannot add duplicate tier
  - Add same token twice
  - Should revert or update

#### 5.2 Update Discount Tier
- [ ] **Test:** Can update existing tier
- [ ] **Test:** Only admin can update
- [ ] **Test:** Reverts if tier doesn't exist

#### 5.3 Remove Discount Tier
- [ ] **Test:** Can remove tier
  - Remove tier
  - Verify removed from array
  - Verify mappings cleared

- [ ] **Test:** Only admin can remove

- [ ] **Test:** Emits correct event

---

### 6. Whitelist Slot Management (v1.0.2)

#### 6.1 Add to Whitelist (New Signature)
- [ ] **Test:** Can add addresses with slot count
  - Call `addToWhitelist(address, uint256 slots)`
  - Verify slots added to mapping
  - Verify event emitted

- [ ] **Test:** Additive slot grants
  - Call `addToWhitelist(alice, 5)` twice
  - Verify alice has 10 total slots (5+5)
  - Not overwrite, but add

- [ ] **Test:** Reverts if slots parameter is 0
  - Try `addToWhitelist(alice, 0)`
  - Should revert with InvalidParameter

- [ ] **Test:** Only admin can add
  - Non-admin call should revert

#### 6.2 Batch Add to Whitelist (Parallel Arrays)
- [ ] **Test:** Can add multiple with different slot counts
  - Call `batchAddToWhitelist([alice, bob, charlie], [2, 10, 5])`
  - Verify each address gets correct slot count
  - Verify events emitted for each

- [ ] **Test:** Reverts if array lengths mismatch
  - Try `batchAddToWhitelist([alice, bob], [5])`
  - Should revert with InvalidParameter

- [ ] **Test:** Reverts if any slot count is 0
  - Try `batchAddToWhitelist([alice, bob], [5, 0])`
  - Should revert with InvalidParameter

- [ ] **Test:** Additive in batch operations too
  - Alice already has 5 slots
  - Call `batchAddToWhitelist([alice, bob], [3, 10])`
  - Verify alice now has 8 slots (5+3)

#### 6.3 Remove from Whitelist (Zero Slots)
- [ ] **Test:** Can remove by zeroing slots
  - Alice has 10 slots
  - Call `removeFromWhitelist(alice)`
  - Verify alice now has 0 slots
  - Verify event emitted

- [ ] **Test:** Idempotent removal
  - Remove alice twice
  - Should not revert
  - Still 0 slots

- [ ] **Test:** Only admin can remove

#### 6.4 Buy WL with LAZY (Configurable Slots)
- [ ] **Test:** Can purchase whitelist slots
  - Set `buyWlWithLazy` cost and `buyWlSlotCount`
  - User approves LazyGasStation
  - Call `buyWhitelistWithLazy()`
  - Verify `buyWlSlotCount` slots added
  - Verify LAZY transferred/burned

- [ ] **Test:** Multiple purchases stack
  - `buyWlSlotCount = 5`
  - Alice buys twice
  - Verify alice has 10 slots (5+5)

- [ ] **Test:** Reverts if cost not set (0)
  - Set `buyWlWithLazy = 0`
  - Should revert with InvalidParameter

- [ ] **Test:** Reverts if slot count not set (0)
  - Set `buyWlSlotCount = 0`
  - Should revert with InvalidParameter

- [ ] **Test:** Calls LazyGasStation correctly

#### 6.5 Query Functions
- [ ] **Test:** getWhitelistSlots() returns correct count
  - Alice has 5 slots
  - Call `getWhitelistSlots(alice)`
  - Returns 5

- [ ] **Test:** getBatchWhitelistSlots() returns parallel array
  - Alice=2, Bob=10, Charlie=5
  - Call `getBatchWhitelistSlots([alice, bob, charlie])`
  - Returns `[2, 10, 5]`

- [ ] **Test:** isWhitelisted() based on slots > 0
  - Alice has 5 slots: returns true
  - Bob has 0 slots: returns false

- [ ] **Test:** getWhitelistCount() returns 0 (deprecated)
  - Always returns 0 now
  - Kept for backward compatibility

---

### 7. Cost Calculation

#### 7.1 Base Price Calculation
- [ ] **Test:** Calculates base HBAR price
  - No discounts
  - Quantity × base price

- [ ] **Test:** Calculates base LAZY price

- [ ] **Test:** Calculates both currencies

#### 7.2 WL Discount Calculation (Option B Partial Application)
- [ ] **Test:** Applies WL discount when user has sufficient slots
  - User has 10 slots, mints 5 NFTs
  - WL discount applied to all 5
  - Formula: price × (100 - wlDiscount) / 100

- [ ] **Test:** Applies partial WL discount (Option B)
  - User has 5 slots, mints 10 NFTs
  - First 5 NFTs: WL + Holder discount (stacked)
  - Last 5 NFTs: Holder discount only
  - Verify split calculation

- [ ] **Test:** No WL discount if no slots
  - User has 0 slots
  - Mints 5 NFTs
  - Only holder discount applied (if applicable)

- [ ] **Test:** Consumes WL slots after mint
  - User has 10 slots
  - Mints 5 NFTs (not sacrifice)
  - Verify 5 slots consumed (5 remaining)

- [ ] **Test:** Does NOT consume slots in sacrifice mode
  - User has 10 slots
  - Mints 5 NFTs with sacrifice
  - Verify 10 slots still remain (not consumed)

- [ ] **Test:** Weighted average discount calculation
  - User has 5 slots, mints 10 NFTs
  - WL discount=10%, Holder discount=5%
  - First 5 at 15%, last 5 at 5%
  - Expected average: 10%
  - Verify returned discount percentage

#### 7.3 Holder Discount Calculation
- [ ] **Test:** Applies single holder discount
  - User owns discount NFT
  - Serial has remaining uses
  - Discount applied

- [ ] **Test:** Applies multiple holder discounts
  - User owns multiple discount NFTs
  - Uses best discounts first
  - Correct usage tracking

- [ ] **Test:** Partial usage of discount NFT
  - NFT has fewer uses than mints
  - Uses all remaining
  - Rest at base price

- [ ] **Test:** Verifies ownership at calculation time
  - User doesn't own serial
  - Should revert or skip

#### 7.4 WL + Holder Stacking (Option B)
- [ ] **Test:** Stacks WL and holder discounts on WL-covered NFTs
  - User has 5 slots and owns discount NFT
  - WL discount=10%, Holder discount=5%
  - Mints 5 NFTs (all covered by slots)
  - Both discounts applied: 15% total
  - Capped at 100%

- [ ] **Test:** Correct calculation for stacked discounts
  - User has 5 slots
  - WL discount=10%, Holder discount=25%
  - Mints 5 NFTs
  - Expected: 35% discount (10+25)

- [ ] **Test:** Stacking capped at 100%
  - User has 5 slots
  - WL discount=60%, Holder discount=50%
  - Mints 5 NFTs
  - Expected: 100% discount (60+50 capped at 100)

- [ ] **Test:** Partial WL coverage with stacking (Option B)
  - User has 5 slots
  - WL discount=10%, Holder discount=5%
  - Mints 10 NFTs
  - First 5: 15% discount (WL+Holder stacked)
  - Last 5: 5% discount (Holder only)
  - Weighted average: 10%

- [ ] **Test:** No stacking on non-WL-covered NFTs
  - User has 3 slots
  - Mints 10 NFTs
  - First 3: WL+Holder stacking
  - Last 7: Holder only (no WL discount)

#### 7.5 Sacrifice Discount (v1.0.4 Updated)
- [ ] **Test:** Applies sacrifice discount to first N NFTs
  - User sacrificing NFTs
  - Discount applied to min(sacrificeCount, mintCount) NFTs
  - Remaining NFTs use holder/WL/full price in waterfall order

- [ ] **Test:** Validates sacrifice count <= mint count
  - Should revert if sacrifice > mint
  - ExceedsMaxSacrifice error

- [ ] **Test:** Allows mixing with holder discounts (v1.0.4)
  - Sacrifice + holder discounts now allowed
  - Waterfall priority: sacrifice → holder → WL → full
  - See section 11.7 for comprehensive waterfall tests

#### 7.6 Edge Cases
- [ ] **Test:** Zero price (free mint)
- [ ] **Test:** 100% discount (free with discount)
- [ ] **Test:** Fractional calculations (rounding)
- [ ] **Test:** Large quantities
- [ ] **Test:** Multiple discount tiers

---

### 8. Random Serial Selection

#### 8.1 Basic Selection
- [ ] **Test:** Selects requested quantity
  - Pool has 100, request 5
  - Returns 5 serials

- [ ] **Test:** Removes selected from pool
  - Pool size decreases
  - Selected serials not in pool

- [ ] **Test:** Uses PRNG correctly
  - Mock PRNG
  - Verify calls with correct params

#### 8.2 Edge Cases
- [ ] **Test:** Select 1 serial
- [ ] **Test:** Select all serials in pool
- [ ] **Test:** Select from small pool (< 10)
- [ ] **Test:** Select from large pool (> 100)

#### 8.3 Randomness
- [ ] **Test:** Selection is non-deterministic
  - Multiple calls with same params
  - Different results (if PRNG changes)

---

### 9. Payment Processing

#### 9.1 HBAR Payment
- [ ] **Test:** Accepts exact HBAR amount
- [ ] **Test:** Accepts excess and refunds
- [ ] **Test:** Reverts if insufficient
- [ ] **Test:** Handles zero HBAR price

#### 9.2 LAZY Payment
- [ ] **Test:** Transfers LAZY via LazyGasStation
  - Mock drawLazyFrom
  - Verify called with correct amount
  - Verify burn percentage passed

- [ ] **Test:** Reverts if insufficient allowance
  - User hasn't approved
  - Should revert in LazyGasStation

- [ ] **Test:** Handles zero LAZY price

#### 9.3 Dual Payment
- [ ] **Test:** Accepts both HBAR and LAZY
  - Both prices set
  - Both currencies transferred

---

### 10. Withdrawal Functions

#### 10.1 Withdraw HBAR
- [ ] **Test:** Admin can withdraw after cooldown
  - Wait for cooldown period
  - Withdraw
  - Verify transferred

- [ ] **Test:** Reverts during cooldown
  - Try to withdraw immediately after mint
  - Should revert with timeRemaining

- [ ] **Test:** Only admin can withdraw

- [ ] **Test:** Emits correct event

#### 10.2 Withdraw LAZY
- [ ] **Test:** Similar to HBAR withdrawal
- [ ] **Test:** Uses IERC20 transfer

---

## Integration Tests

### 11. Mint Workflows

#### 11.1 Simple Mint (HBAR Only)
```javascript
describe("Simple Mint with HBAR", function() {
  it("Should mint 1 NFT with HBAR", async function() {
    // Setup: Pool with 10 NFTs, price 1000 HBAR
    // User mints 1 NFT
    // Verify:
    //   - User receives 1 NFT
    //   - Serial removed from pool
    //   - HBAR transferred
    //   - Tracking updated
    //   - Events emitted
  });
  
  it("Should mint 5 NFTs with HBAR", async function() {
    // Similar but quantity 5
  });
  
  it("Should mint max quantity (50)", async function() {
    // Test max batch size
  });
});
```

#### 11.2 Mint with LAZY
- [ ] **Test:** Mint 1 NFT with LAZY
- [ ] **Test:** Mint multiple with LAZY
- [ ] **Test:** Verifies burn percentage applied
- [ ] **Test:** Requires LazyGasStation approval

#### 11.3 Mint with HBAR + LAZY
- [ ] **Test:** Mint with both currencies
- [ ] **Test:** Correct amounts for each

#### 11.4 Mint with WL Slot System (v1.0.2)
```javascript
describe("WL Slot System Minting", function() {
  it("Should apply WL discount when slots available", async function() {
    // Setup: User has 10 slots, WL discount=10%, Holder discount=5%
    // Mint 5 NFTs
    // Verify:
    //   - WL+Holder stacked discount (15%) applied to all 5
    //   - 5 slots consumed (5 remaining)
    //   - Correct price charged
  });
  
  it("Should apply Option B partial WL discount", async function() {
    // Setup: User has 5 slots, WL discount=10%, Holder discount=5%
    // Mint 10 NFTs
    // Verify:
    //   - First 5 at 15% discount (WL+Holder stacked)
    //   - Last 5 at 5% discount (Holder only)
    //   - All 5 slots consumed (0 remaining)
    //   - Weighted average discount: 10%
  });
  
  it("Should allow minting beyond slots at reduced discount", async function() {
    // Setup: User has 3 slots
    // Mint 10 NFTs
    // Verify:
    //   - First 3: WL+Holder discount
    //   - Last 7: Holder discount only
    //   - Transaction succeeds (not blocked)
    //   - 3 slots consumed (0 remaining)
  });
  
  it("Should enforce WL-only mode for users with 0 slots", async function() {
    // Enable WL-only
    // User has 0 slots tries to mint
    // Should revert with NotWhitelisted
  });
  
  it("Should allow WL-only minting with slots", async function() {
    // Enable WL-only
    // User has 5 slots tries to mint 10
    // Should succeed (can mint beyond slots)
    // First 5 at WL discount, last 5 at reduced
  });
  
  it("Should NOT consume slots in sacrifice mode", async function() {
    // Setup: User has 10 slots
    // Mint 5 NFTs with sacrifice (sacrifice discount applied)
    // Verify:
    //   - Sacrifice discount applied (exclusive)
    //   - Slots NOT consumed (still 10)
    //   - No WL or holder discount
  });
  
  it("Should handle user with 0 slots (no WL discount)", async function() {
    // Setup: User has 0 slots but owns holder NFTs
    // Mint 5 NFTs
    // Verify:
    //   - Only holder discount applied
    //   - No WL discount
    //   - No slots consumed (already 0)
  });
});
```

#### 11.5 Mint with Holder Discounts
```javascript
describe("Holder Discount Minting", function() {
  it("Should apply single holder discount", async function() {
    // Setup: User owns Gen1 NFT (25% off, 5 uses)
    // Mint 3 NFTs using Gen1
    // Verify:
    //   - Discount applied
    //   - Usage tracked (3 uses consumed)
    //   - Correct price charged
  });
  
  it("Should apply multiple holder discounts", async function() {
    // User owns Gen1 (25% off, 2 uses) and Gen2 (10% off, 3 uses)
    // Mint 6 NFTs
    // Verify:
    //   - First 2 at 25% off
    //   - Next 3 at 10% off
    //   - Last 1 at base price
  });
  
  it("Should stack WL + holder discount (Option B)", async function() {
    // User has 5 WL slots (10% WL discount) and owns Gen1 (25% holder discount)
    // Mint 8 NFTs
    // Verify:
    //   - First 5: 35% discount (10+25, WL slots covered)
    //   - Last 3: 25% discount (holder only, no WL slots)
    //   - 5 slots consumed (0 remaining)
  });
  
  it("Should transfer discount with NFT", async function() {
    // User1 owns Gen1 with 5 uses
    // User1 uses 2
    // User1 transfers Gen1 to User2
    // User2 can use remaining 3
  });
});
```

#### 11.6 Mint with Sacrifice
```javascript
describe("Sacrifice Minting", function() {
  it("Should accept sacrifice and apply discount", async function() {
    // Setup: User owns 5 NFTs, sacrifice discount 50%
    // Sacrifice 5, mint 5 new
    // Verify:
    //   - Old NFTs transferred to contract
    //   - Routed to destination
    //   - New NFTs received
    //   - 50% discount applied
  });
  
  it("Should return sacrifices to pool if destination is contract", async function() {
    // Set sacrifice destination to address(this)
    // Sacrifice 5
    // Verify: 5 added back to availableSerials
  });
  
  it("Should send sacrifices to external address", async function() {
    // Set sacrifice destination to treasury
    // Sacrifice 5
    // Verify: Transferred to treasury
  });
  
  it("Should not allow mixing sacrifice and holder discounts", async function() {
    // Try to use both
    // Should revert
  });
  
  it("Should validate sacrifice count <= mint count", async function() {
    // Try to sacrifice 7, mint 5
    // Should revert ExceedsMaxSacrifice
  });
  
  it("Should validate sacrifice count <= maxSacrifice", async function() {
    // maxSacrifice = 10
    // Try to sacrifice 12
    // Should revert ExceedsMaxSacrifice
  });
});
```

---

### 11.7 Waterfall Discount System with DRY Architecture (v1.0.5)

> **Version 1.0.5 Update**: The contract now implements a **progressive waterfall discount system** with **DRY slot consumption architecture**. All slot usage is calculated once in `calculateMintCostWithSlots()` and returned alongside costs, eliminating duplication and ensuring perfect consistency between cost calculation and state updates.
>
> **Key Architecture**: 
> - `calculateMintCostWithSlots()` returns `MintCostResult` struct with: `{totalHbarCost, totalLazyCost, totalDiscount, holderSlotsUsed, wlSlotsUsed}`
> - Steps 7-8 in `mintNFT()` consume exactly the slot counts returned from the calculation
> - Waterfall order: Sacrifice → Holder → WL → Full Price

#### 11.7.1 Sacrifice-Only Tests
```javascript
describe("Waterfall: Sacrifice Only", function() {
  it("Should apply sacrifice discount to all NFTs when sacrifice == mint", async function() {
    // Setup: sacrificeDiscount = 40%
    // User sacrifices 5 NFTs
    // User mints 5 NFTs
    // Expected: 5 NFTs @ 40% discount
    // Verify cost calculation and payment
    // NEW: Verify holderSlotsUsed = 0, wlSlotsUsed = 0 in returned struct
  });
  
  it("Should apply sacrifice discount to partial NFTs when sacrifice < mint", async function() {
    // Setup: sacrificeDiscount = 40%, basePrice = 1000 HBAR
    // User sacrifices 3 NFTs
    // User mints 12 NFTs
    // Expected:
    //   - 3 NFTs @ 40% discount (600 HBAR each)
    //   - 9 NFTs @ 0% discount (1000 HBAR each)
    // Total: (3 × 600) + (9 × 1000) = 10,800 HBAR
    // NEW: Verify holderSlotsUsed = 0, wlSlotsUsed = 0
  });
  
  it("Should not consume WL slots for sacrifice-discounted NFTs", async function() {
    // Setup: User has 5 WL slots, sacrifices 3 NFTs, mints 12
    // Expected WL consumption:
    //   - 3 NFTs use sacrifice (no WL consumed)
    //   - 5 NFTs use WL (5 slots consumed)
    //   - 4 NFTs full price
    // NEW: Verify calculateMintCost returns wlSlotsUsed = 5
    // Verify whitelistSlots[user] = 0 after mint (5 slots consumed)
  });
});
```

#### 11.7.2 Sacrifice + WL Tests
```javascript
describe("Waterfall: Sacrifice + WL", function() {
  it("Should apply sacrifice first, then WL to remaining NFTs", async function() {
    // Setup:
    //   - sacrificeDiscount = 50%, wlDiscount = 20%
    //   - User has 5 WL slots
    //   - User sacrifices 3 NFTs, mints 12 NFTs
    // Expected discount distribution:
    //   - 3 NFTs @ 50% (sacrifice)
    //   - 5 NFTs @ 20% (WL only, no stacking with sacrifice)
    //   - 4 NFTs @ 0% (full price)
    // NEW: Verify calculateMintCost returns:
    //   - holderSlotsUsed = 0
    //   - wlSlotsUsed = 5
    // Verify cost and slot consumption match exactly
  });
  
  it("Should handle sacrifice == mint with WL slots remaining", async function() {
    // Setup: User has 10 WL slots, sacrifices 5, mints 5
    // Expected:
    //   - 5 NFTs @ sacrifice% (WL not used)
    //   - WL slots unchanged: still 10
    // NEW: Verify wlSlotsUsed = 0 (no WL consumed)
  });
  
  it("Should verify slot consumption matches cost calculation exactly", async function() {
    // Setup: sacrifice 2, WL 4, mint 10
    // Call calculateMintCost to get wlSlotsUsed
    // Perform mint
    // Verify: whitelistSlots decreased by exactly wlSlotsUsed from calculation
    // This validates DRY architecture consistency
  });
});
```

#### 11.7.3 Sacrifice + Holder Tests
```javascript
describe("Waterfall: Sacrifice + Holder", function() {
  it("Should apply sacrifice first, then holder discounts", async function() {
    // Setup:
    //   - sacrificeDiscount = 40%, holder discount = 50%
    //   - User has 6 holder slots @ 50%
    //   - User sacrifices 2 NFTs, mints 12 NFTs
    // Expected:
    //   - 2 NFTs @ 40% (sacrifice)
    //   - 6 NFTs @ 50% (holder)
    //   - 4 NFTs @ 0% (full price)
    // NEW: Verify calculateMintCost returns:
    //   - holderSlotsUsed = 6
    //   - wlSlotsUsed = 0
  });
  
  it("Should consume holder slots correctly after sacrifice", async function() {
    // Setup: User has 10 holder slots, sacrifices 3, mints 8
    // Expected holder consumption:
    //   - 3 NFTs use sacrifice (no holder consumed)
    //   - 5 NFTs use holder (5 slots consumed)
    // NEW: Query calculateMintCost, verify holderSlotsUsed = 5
    // Verify serialDiscountUsage increases by exactly 5 (matches calculation)
  });
  
  it("Should validate DRY consistency: holder consumption matches cost calc", async function() {
    // Setup: Multi-tier holders, sacrifice, complex scenario
    // Before mint: call calculateMintCost, save holderSlotsUsed
    // After mint: verify total serialDiscountUsage across all tokens = holderSlotsUsed
    // This confirms Steps 7 consumption matches calculation exactly
  });
});
```

#### 11.7.4 Sacrifice + Holder + WL Tests (Full Waterfall with DRY Validation)
```javascript
describe("Waterfall: All Discount Types", function() {
  it("Should apply all discounts in priority order with stacking", async function() {
    // Setup:
    //   - sacrificeDiscount = 30%
    //   - holder tier1 = 50% (6 slots), tier2 = 25% (4 slots)
    //   - wlDiscount = 15%
    //   - User has 3 WL slots
    //   - User sacrifices 2 NFTs, mints 12 NFTs
    // Expected waterfall:
    //   - 2 NFTs @ 30% (sacrifice only)
    //   - 3 NFTs @ 65% (50% holder + 15% WL, stacked, capped at 100%)
    //   - 3 NFTs @ 50% (50% holder only, WL exhausted)
    //   - 4 NFTs @ 0% (full price, all discounts exhausted)
    // NEW: Verify calculateMintCost returns:
    //   - holderSlotsUsed = 6 (3 stacked + 3 holder-only)
    //   - wlSlotsUsed = 3 (all stacked with holder)
    // Verify weighted average discount calculation
    // Validate actual state changes match returned values exactly
  });
  
  it("Should handle complex multi-tier holder scenario", async function() {
    // Setup:
    //   - sacrifice = 3 NFTs (40% discount)
    //   - holder: token A (50%, 4 slots), token B (25%, 6 slots)
    //   - WL: 5 slots (20% discount)
    //   - Mint: 20 NFTs
    // Expected:
    //   - 3 @ 40% (sacrifice)
    //   - 4 @ 70% (50% holder A + 20% WL, uses 4 holder + 4 WL)
    //   - 1 @ 45% (25% holder B + 20% WL, uses 1 holder + 1 WL)
    //   - 5 @ 25% (25% holder B only, WL exhausted)
    //   - 7 @ 0% (full price)
    // NEW: Verify calculateMintCost returns:
    //   - holderSlotsUsed = 10 (4 token A + 6 token B, but only 6 used from B)
    //   - wlSlotsUsed = 5 (4 with A + 1 with B)
    // Verify consumption across multiple discount tokens matches exactly
  });
  
  it("Should calculate correct weighted average discount", async function() {
    // Given: 12 NFTs with discounts: 2@30%, 3@65%, 3@50%, 4@0%
    // Calculation: (2×30 + 3×65 + 3×50 + 4×0) / 12 = 405 / 12 = 33.75%
    // Verify totalDiscount returned from calculateMintCost
  });
  
  it("Should guarantee DRY consistency in full waterfall scenario", async function() {
    // Setup: All discount types active (sacrifice, holder multi-tier, WL)
    // Before mint: capture calculateMintCost result
    // After mint: verify:
    //   - Total holder consumption = holderSlotsUsed
    //   - WL slots decreased by = wlSlotsUsed
    //   - No discrepancy between calculation and consumption
    // This is the CRITICAL test for DRY architecture
  });
});
```

#### 11.7.5 Edge Cases
```javascript
describe("Waterfall: Edge Cases", function() {
  it("Should handle sacrifice exactly equal to mint quantity", async function() {
    // Sacrifice 5, mint 5
    // All get sacrifice discount
    // No holder/WL used
  });
  
  it("Should revert if sacrifice exceeds mint quantity", async function() {
    // Try: sacrifice 7, mint 5
    // Should revert: ExceedsMaxSacrifice
  });
  
  it("Should handle all NFTs covered by holder discounts (no sacrifice)", async function() {
    // Mint 10 with 10 holder slots
    // No sacrifice
    // All get holder discount (no WL needed)
  });
  
  it("Should handle discount stacking capped at 100%", async function() {
    // Setup: holder 80%, WL 30%
    // Stacked = min(80 + 30, 100) = 100%
    // Verify: cost = 0 for those NFTs
  });
  
  it("Should handle zero-price edge case (100% discount)", async function() {
    // All NFTs at 100% discount
    // Verify: totalCost = 0, no payment required
  });
  
  it("Should handle large quantity mint with waterfall", async function() {
    // Mint 100 NFTs with complex waterfall
    // Verify: gas usage acceptable, calculations correct
  });
});
```

#### 11.7.6 WL Slot Consumption with Waterfall
```javascript
describe("Waterfall: WL Slot Consumption", function() {
  it("Should consume WL slots only for NFTs after sacrifice", async function() {
    // User: 10 WL slots, sacrifice 3, mint 12
    // NFTs using WL: min(12-3, 10) = 9
    // NEW: Verify calculateMintCost returns wlSlotsUsed = 9
    // Verify: whitelistSlots[user] = 1 after mint
    // Validate: consumed amount = returned amount
  });
  
  it("Should not consume WL slots for sacrifice-discounted NFTs", async function() {
    // User: 5 WL slots, sacrifice 5, mint 5
    // Expected: 0 WL consumed (all use sacrifice)
    // NEW: Verify wlSlotsUsed = 0 from calculation
    // Verify: whitelistSlots[user] = 5 after mint (unchanged)
  });
  
  it("Should consume WL slots correctly with holder discounts", async function() {
    // User: 4 WL slots, 6 holder slots, sacrifice 2, mint 12
    // Waterfall: 2 sacrifice, 4 holder+WL (consumes 4 WL), 2 holder, 4 full
    // NEW: Verify calculateMintCost returns:
    //   - holderSlotsUsed = 6
    //   - wlSlotsUsed = 4 (only the stacked ones)
    // Verify: whitelistSlots[user] = 0 after mint
  });
  
  it("Should track WL stacking accurately in complex scenarios", async function() {
    // Setup: 8 WL slots, 10 holder slots (5@50%, 5@25%), sacrifice 2, mint 20
    // Expected WL usage:
    //   - 2 sacrifice (0 WL)
    //   - 5 @ 50%+WL (5 WL consumed, stacked)
    //   - 3 @ 25%+WL (3 WL consumed, stacked)
    //   - 2 @ 25% (0 WL, exhausted)
    //   - 8 @ 0% (full price)
    // NEW: Verify wlSlotsUsed = 8 (5+3)
    // This tests the tracking within holder discount loop
  });
});

#### 11.7.7 DRY Architecture Validation (v1.0.5)
```javascript
describe("DRY Architecture: Calculation-Consumption Consistency", function() {
  it("Should ensure calculateMintCost return values match actual consumption", async function() {
    // Setup: Complex scenario with all discount types
    // Step 1: Call calculateMintCost, capture all 5 return values
    // Step 2: Capture initial state (holder usage, WL slots)
    // Step 3: Execute mintNFT
    // Step 4: Verify state changes:
    //   - Holder consumption = holderSlotsUsed from calculation
    //   - WL slots decreased by = wlSlotsUsed from calculation
    //   - Payment = totalHbarCost + totalLazyCost from calculation
    // CRITICAL: This validates DRY architecture end-to-end
  });
  
  it("Should return consistent values across multiple identical calls", async function() {
    // Call calculateMintCost with same params 3 times
    // Verify all return values are identical
    // Ensures calculation is deterministic (view function, no state changes)
  });
  
  it("Should handle edge case: zero holder/WL slots used", async function() {
    // Mint with only full price (no discounts)
    // Verify: holderSlotsUsed = 0, wlSlotsUsed = 0
    // Verify: no state changes to holder/WL tracking after mint
  });
  
  it("Should handle edge case: all slots used", async function() {
    // Mint where all available holder + WL slots are consumed
    // Verify: holderSlotsUsed = max available, wlSlotsUsed = max available
    // Verify: all slots consumed in actual mint
  });
  
  it("Should validate MintCostResult struct integrity", async function() {
    // Call calculateMintCost
    // Verify all 5 fields are present and valid:
    //   - totalHbarCost >= 0
    //   - totalLazyCost >= 0
    //   - totalDiscount in [0, 100]
    //   - holderSlotsUsed <= available holder slots
    //   - wlSlotsUsed <= whitelistSlots[user]
  });
  
  it("Should demonstrate eliminated consumption bug from v1.0.4", async function() {
    // Setup: The scenario from the bug discovery:
    //   - 10 mint, 2 sacrifice, 8 holder, 100 WL
    // In v1.0.4: Would have over-consumed WL slots
    // In v1.0.5: Should correctly return wlSlotsUsed = 0
    //   (because all 8 non-sacrifice NFTs use holder-only)
    // Verify: WL slots unchanged after mint
    // This is regression test for the DRY fix
  });
});
```

#### 11.7.8 Backwards Compatibility
```javascript
describe("Waterfall: Backwards Compatibility", function() {
  it("Should work like v1.0.2 when no sacrifice used", async function() {
    // Mint with only holder + WL (no sacrifice)
    // Should behave identically to v1.0.2 tiered system
    // NEW: Verify return values are consistent with expected v1.0.2 behavior
  });
  
  it("Should work with sacrifice-only (no holder/WL)", async function() {
    // Old exclusive sacrifice mode
    // Should apply sacrifice discount to all NFTs
    // NEW: Verify holderSlotsUsed = 0, wlSlotsUsed = 0
  });
  
  it("Should maintain API compatibility for calculateMintCost", async function() {
    // Note: Breaking change - now returns 5 values instead of 3
    // But function signature and parameters remain the same
    // Existing code calling with (numberToMint, tokens, serials, sacrificeCount)
    // will still work, just needs to capture 2 additional return values
  });
});
```

---

### 12. Refund Workflows

#### 12.1 Basic Refund
```javascript
describe("Basic Refund", function() {
  it("Should refund within window", async function() {
    // User mints 1 NFT for 1000 HBAR
    // Refund percentage: 95%
    // Immediately refund
    // Verify:
    //   - NFT returned to pool
    //   - 950 HBAR refunded
    //   - Tracking cleared
  });
  
  it("Should revert after window expires", async function() {
    // Mint NFT
    // Wait for window + 1 second
    // Try to refund
    // Should revert
  });
  
  it("Should refund multiple NFTs", async function() {
    // Mint 5 NFTs
    // Refund all 5
    // Verify correct amounts
  });
  
  it("Should track actual paid amount", async function() {
    // Mint with 50% discount (paid 500 HBAR)
    // Refund: Should get 500 × 95% = 475 HBAR
    // NOT 1000 × 95%
  });
});
```

#### 12.2 Refund with Discounts
- [ ] **Test:** Refund after WL discount mint
  - Refund discounted amount, not base

- [ ] **Test:** Refund after holder discount mint
  - Refund actual paid
  - Discount uses NOT restored

- [ ] **Test:** Refund after sacrifice mint
  - New NFTs refunded
  - Sacrificed NFTs NOT returned

#### 12.3 Refund Edge Cases
- [ ] **Test:** Partial refund from batch
  - Mint 5, refund 2
  - Verify correct amounts

- [ ] **Test:** Refund with LAZY payment
  - LAZY refunded to user

- [ ] **Test:** Refund with dual payment
  - Both currencies refunded proportionally

---

### 13. Complex Scenarios

#### 13.1 Full User Journey
```javascript
describe("Complete User Journey", function() {
  it("Should handle full lifecycle", async function() {
    // 1. User buys WL with LAZY
    // 2. User mints 5 NFTs with WL discount
    // 3. User refunds 2 unwanted NFTs
    // 4. User mints 3 more with holder discount
    // 5. Verify all state correct
  });
});
```

#### 13.2 Multiple Users
```javascript
describe("Multiple Concurrent Users", function() {
  it("Should handle multiple users minting", async function() {
    // User1, User2, User3 all mint simultaneously
    // Verify:
    //   - No serial collisions
    //   - Pool decreases correctly
    //   - All payments processed
  });
});
```

#### 13.3 Pool Depletion and Refill
```javascript
describe("Pool Management", function() {
  it("Should deplete pool and refill", async function() {
    // Start with 10 NFTs
    // Users mint all 10
    // Pool empty, mints revert
    // Admin adds 5 more
    // Minting resumes
  });
  
  it("Should handle refunds increasing pool", async function() {
    // Pool with 5 NFTs
    // User mints 5 (pool empty)
    // User refunds 2
    // Pool now has 2
    // Another user can mint
  });
});
```

#### 13.4 Discount Capacity Exhaustion
```javascript
describe("Discount Capacity Management", function() {
  it("Should exhaust discount capacity", async function() {
    // Gen1 NFT has 8 uses
    // User1 uses 5
    // User2 buys the NFT
    // User2 uses remaining 3
    // User3 buys the NFT
    // User3 cannot get discount (0 left)
  });
});
```

#### 13.5 Whitelist Slot System Scenarios (v1.0.2)
```javascript
describe("WL Slot System Comprehensive Tests", function() {
  it("Should handle slot consumption across multiple mints", async function() {
    // Setup: User starts with 10 WL slots
    // Mint 1: 3 NFTs → 7 slots remain
    // Mint 2: 5 NFTs → 2 slots remain
    // Mint 3: 5 NFTs → 0 slots remain (last 3 at reduced discount)
    // Verify slot tracking at each step
  });
  
  it("Should handle multiple WL purchases", async function() {
    // buyWlSlotCount = 5
    // User buys WL 1st time → 5 slots
    // User mints 3 NFTs → 2 slots remain
    // User buys WL 2nd time → 7 slots total (2+5)
    // User mints 10 NFTs → 0 slots remain (last 3 at reduced)
  });
  
  it("Should handle admin adding more slots after user exhausts", async function() {
    // User has 5 slots, mints 10 (exhausts all)
    // Admin adds 3 more slots to user
    // User mints 5 more (first 3 at WL discount)
  });
  
  it("Should differentiate between sacrifice and normal mints for slot consumption", async function() {
    // User has 10 slots
    // Sacrifice mint 5 NFTs → still 10 slots (not consumed)
    // Normal mint 3 NFTs → 7 slots remain (consumed)
    // Sacrifice mint 5 more → still 7 slots
    // Normal mint 7 → 0 slots remain
  });
  
  it("Should handle Option B with multiple discount tiers", async function() {
    // User has 5 WL slots
    // Owns Gen1 (25% holder, 3 uses) and Gen2 (10% holder, 5 uses)
    // Mints 10 NFTs
    // Verify:
    //   - First 3: 35% (10% WL + 25% Gen1, WL-covered)
    //   - Next 2: 20% (10% WL + 10% Gen2, WL-covered)
    //   - Next 3: 10% (Gen2 only, no WL slots)
    //   - Last 2: 0% (no discounts left)
  });
  
  it("Should handle batch WL slot grants with different allocations", async function() {
    // Admin calls batchAddToWhitelist([alice, bob, charlie], [2, 50, 10])
    // Alice mints 5 → first 2 at WL discount
    // Bob mints 100 → first 50 at WL discount
    // Charlie mints 5 → all 5 at WL discount (has 10 slots)
  });
  
  it("Should handle WL-only mode transitions", async function() {
    // WL-only mode OFF: Anyone can mint
    // User with 0 slots mints successfully
    // Admin enables WL-only mode
    // Same user tries to mint → reverts
    // Admin grants user 1 slot
    // User can mint again (can mint beyond 1 slot)
  });
});
```

---

## Edge Cases

### 14. Boundary Conditions

#### 14.1 Zero Values
- [ ] **Test:** Mint with 0 quantity → revert
- [ ] **Test:** 0 HBAR price (free HBAR)
- [ ] **Test:** 0 LAZY price (free LAZY)
- [ ] **Test:** 0% discount (no discount)
- [ ] **Test:** Empty pool → revert
- [ ] **Test:** 0 refund percentage (no refund)
- [ ] **Test:** 0 refund window (instant expiry)
- [ ] **Test:** User with 0 WL slots (no WL discount)
- [ ] **Test:** buyWlSlotCount = 0 → purchase reverts
- [ ] **Test:** addToWhitelist with 0 slots → reverts

#### 14.2 Maximum Values
- [ ] **Test:** 100% discount (free mint)
- [ ] **Test:** Max mint quantity (50)
- [ ] **Test:** Max sacrifice quantity (20)
- [ ] **Test:** Very large HBAR price
- [ ] **Test:** Very large LAZY price
- [ ] **Test:** Pool with 1000+ NFTs
- [ ] **Test:** User with max wallet mints
- [ ] **Test:** User with 1000+ WL slots
- [ ] **Test:** buyWlSlotCount = type(uint256).max
- [ ] **Test:** WL discount + Holder discount = 200% → capped at 100%

#### 14.3 Timing Edge Cases
- [ ] **Test:** Mint exactly at start time
- [ ] **Test:** Mint 1 second before start → revert
- [ ] **Test:** Refund at exact window expiry
- [ ] **Test:** Withdraw at exact cooldown end

#### 14.4 Fractional Calculations
- [ ] **Test:** Odd number division (e.g., 3 mints, 1000 HBAR)
  - Per-serial: 333.33... → how handled?

- [ ] **Test:** Discount resulting in fraction
  - 37% off 1000 → 630

#### 14.5 Whitelist Slot Edge Cases (v1.0.2)
- [ ] **Test:** User mints exactly their slot count
  - 5 slots, mint 5 → all WL discount, 0 slots remain

- [ ] **Test:** User mints 1 more than slot count
  - 5 slots, mint 6 → first 5 WL discount, last 1 holder only

- [ ] **Test:** Slot count changes between cost calculation and mint
  - Calculate cost with 10 slots
  - Admin removes slots (sets to 0)
  - Mint transaction → uses current 0 slots

- [ ] **Test:** Multiple users race for WL purchases
  - Two users simultaneously buy WL
  - Both should succeed with separate slot grants

- [ ] **Test:** Very large slot grant
  - Admin grants 10000 slots
  - User mints 50 (max) → uses 50 slots
  - 9950 slots remain

- [ ] **Test:** Additive slot grants to same address in same block
  - Admin adds 5 slots to alice
  - Admin adds 3 slots to alice (same transaction/block)
  - Alice should have 8 total

- [ ] **Test:** Remove user who never had slots
  - removeFromWhitelist(userNeverAdded)
  - Should not revert (idempotent)
  - Slots remain 0

- [ ] **Test:** Batch add with empty arrays
  - batchAddToWhitelist([], [])
  - Should revert with EmptyArray

- [ ] **Test:** Single address in batch with wrong slot array length
  - batchAddToWhitelist([alice], [])
  - Should revert with InvalidParameter

- [ ] **Test:** Option B weighted discount at boundaries
  - 1 slot, mint 100 → first 1 at WL+Holder, last 99 at Holder
  - Verify weighted average calculation correct

---

## Gas Optimization Tests

### 15. Gas Measurements

#### 15.1 Mint Gas Costs
- [ ] **Measure:** Mint 1 NFT
- [ ] **Measure:** Mint 10 NFTs
- [ ] **Measure:** Mint 50 NFTs (max)
- [ ] **Measure:** Mint with no discounts
- [ ] **Measure:** Mint with holder discount
- [ ] **Measure:** Mint with sacrifice
- [ ] **Compare:** Against MinterContract

#### 15.2 Refund Gas Costs
- [ ] **Measure:** Refund 1 NFT
- [ ] **Measure:** Refund 10 NFTs
- [ ] **Measure:** Refund vs mint cost ratio

#### 15.3 Pool Management Gas
- [ ] **Measure:** Deposit 1 NFT
- [ ] **Measure:** Deposit 50 NFTs
- [ ] **Measure:** Stake 1 NFT
- [ ] **Measure:** Emergency withdraw

#### 15.4 Configuration Gas
- [ ] **Measure:** Add discount tier
- [ ] **Measure:** Add to whitelist (1, 10, 100 addresses)
- [ ] **Measure:** Update economics

#### 15.5 Whitelist Slot System Gas (v1.0.2)
- [ ] **Measure:** addToWhitelist single address
- [ ] **Measure:** batchAddToWhitelist (10, 50, 100 addresses)
- [ ] **Measure:** removeFromWhitelist single address
- [ ] **Measure:** buyWhitelistWithLazy
- [ ] **Measure:** getWhitelistSlots (single)
- [ ] **Measure:** getBatchWhitelistSlots (10, 50, 100 addresses)
- [ ] **Measure:** Mint with WL slots vs without
- [ ] **Measure:** Mint with partial WL coverage (Option B split calculation)
- [ ] **Compare:** Old EnumerableSet vs new mapping-based system

---

## Security Tests

### 16. Access Control

#### 16.1 Admin Functions
- [ ] **Test:** All admin functions revert for non-admin
- [ ] **Test:** Multiple admins can all perform admin actions
- [ ] **Test:** Removed admin cannot perform actions

#### 16.2 User Functions
- [ ] **Test:** Users cannot call admin functions
- [ ] **Test:** Users can only refund their own NFTs
- [ ] **Test:** Users cannot use others' discount NFTs

### 17. Reentrancy

#### 17.1 Mint Function
- [ ] **Test:** Reentrancy on mint via receive()
  - User contract tries to re-enter mint
  - Should be blocked by nonReentrant

#### 17.2 Refund Function
- [ ] **Test:** Reentrancy on refund
  - Similar to mint test

#### 17.3 Payment Callbacks
- [ ] **Test:** Malicious NFT transfer hooks
- [ ] **Test:** Malicious ERC20 transfer hooks

### 18. Integer Overflow/Underflow

#### 18.1 Arithmetic Operations
- [ ] **Test:** Cost calculation overflow
  - Very large price × quantity
  - Solidity 0.8.x should revert

- [ ] **Test:** Discount calculation underflow
  - Edge case: More discount than price
  - Should cap at 0

- [ ] **Test:** Refund amount calculations

#### 18.2 State Variable Overflows
- [ ] **Test:** totalMinted overflow (theoretical)
- [ ] **Test:** Timestamp calculations
- [ ] **Test:** Mapping value overflows

### 19. Front-Running

#### 19.1 Random Selection
- [ ] **Verify:** Cannot predict which serial
- [ ] **Verify:** Cannot front-run for specific serial

#### 19.2 Discount Usage
- [ ] **Scenario:** Two users try to use same discount NFT
  - First transaction wins
  - Second fails or uses remaining

### 20. Denial of Service

#### 20.1 Gas Limits
- [ ] **Test:** Max mint doesn't exceed block gas limit
- [ ] **Test:** Max sacrifice doesn't exceed limit
- [ ] **Test:** Large whitelist operations

#### 20.2 Pool Exhaustion
- [ ] **Test:** Multiple users race for last NFTs
  - Last user gets reverted cleanly
  - No stuck state

---

## Test Utilities

### 21. Helper Functions

```javascript
// Time manipulation
async function increaseTime(seconds) { }
async function setBlockTimestamp(timestamp) { }

// NFT helpers
async function mintNFTsToPool(count) { }
async function setupDiscountNFTs(holders) { }

// Calculation helpers
async function calculateExpectedCost(params) { }
async function verifyPaymentTracking(serial, expected) { }

// Assertion helpers
async function expectMintSuccess(tx, expectedSerials) { }
async function expectRevertWithError(promise, errorName) { }
```

### 22. Mock Contracts

#### 22.1 MockPrngGenerator
```solidity
// Returns predictable "random" numbers for testing
function getPseudorandomNumber(lo, hi, seed) returns (uint256) {
  // Deterministic for testing
}
```

#### 22.2 MockLazyGasStation
```solidity
// Simulates LazyGasStation behavior
function drawLazyFrom(address user, uint256 amount, uint256 burnPerc) {
  // Transfer LAZY from user
  // Simulate burn
}
```

---

## Coverage Goals

### Target Coverage by Module

| Module | Target | Critical |
|--------|--------|----------|
| Constructor | 100% | Yes |
| Admin System | 100% | Yes |
| Pool Management | 100% | Yes |
| Mint Function | 100% | Yes |
| Refund Function | 100% | Yes |
| Cost Calculation | 100% | Yes |
| Discount System | 95% | Yes |
| Payment Processing | 100% | Yes |
| View Functions | 90% | No |
| Configuration | 95% | No |

### Overall Target: >95%

---

## Test Execution Order

### Phase 1: Unit Tests (Run First)
1. Constructor & Initialization
2. Admin System
3. Configuration Functions
4. View Functions

### Phase 2: Core Logic Tests
5. Pool Management
6. Cost Calculation
7. Random Selection
8. Payment Processing

### Phase 3: Integration Tests
9. Mint Workflows
10. Refund Workflows
11. Discount Workflows

### Phase 4: Complex Scenarios
12. Multi-user scenarios
13. Edge cases
14. Boundary conditions

### Phase 5: Security & Performance
15. Access control tests
16. Reentrancy tests
17. Gas optimization tests
18. Overflow/underflow tests

---

## Continuous Integration

### Automated Testing

```yaml
# .github/workflows/test.yml
name: Test ForeverMinter

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npx hardhat test
      - run: npx hardhat coverage
      - name: Check coverage threshold
        run: |
          coverage=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$coverage < 95" | bc -l) )); then
            echo "Coverage $coverage% is below 95%"
            exit 1
          fi
```

---

## Test Documentation

### For Each Test:

```javascript
describe("Module: Function Name", function() {
  context("When [specific condition]", function() {
    it("Should [expected behavior]", async function() {
      // Arrange: Setup test state
      // Act: Execute function
      // Assert: Verify results
    });
  });
  
  context("When [error condition]", function() {
    it("Should revert with [specific error]", async function() {
      // Arrange
      // Act & Assert
      await expect(action).to.be.revertedWithCustomError(
        contract,
        "ErrorName"
      );
    });
  });
});
```

---

## Success Criteria

Tests are complete when:
- ✅ All test categories implemented
- ✅ Coverage >95%
- ✅ All tests pass
- ✅ No gas regressions vs baseline
- ✅ Security tests pass
- ✅ Edge cases handled
- ✅ Documentation complete
- ✅ CI/CD pipeline passing

---

## Test Maintenance

### Regression Testing
- Run full suite on every code change
- Add tests for every bug found
- Update tests when requirements change

### Performance Baseline
- Establish gas cost baselines
- Track changes over time
- Alert on significant increases

### Documentation Updates
- Keep test docs in sync with code
- Document any test utilities
- Explain complex test scenarios

---

**Ready for comprehensive testing!** 🧪
