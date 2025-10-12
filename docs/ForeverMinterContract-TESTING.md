# ForeverMinterContract - Testing Plan

## Version: 1.0
## Coverage Target: >95%

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
- ForeverMinterContract (main contract)
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
  // Deploy ForeverMinterContract
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

### 6. Whitelist Management

#### 6.1 Add to Whitelist
- [ ] **Test:** Can add addresses to WL
- [ ] **Test:** Can add with specific quantity
- [ ] **Test:** Can add multiple at once
- [ ] **Test:** Only admin can add
- [ ] **Test:** Emits events

#### 6.2 Remove from Whitelist
- [ ] **Test:** Can remove addresses
- [ ] **Test:** Can remove multiple
- [ ] **Test:** Only admin can remove

#### 6.3 Clear Whitelist
- [ ] **Test:** Can clear all WL addresses
- [ ] **Test:** Returns count removed
- [ ] **Test:** Only admin can clear

#### 6.4 Buy WL with LAZY
- [ ] **Test:** Can purchase WL spot
  - Set buy cost
  - User approves LazyGasStation
  - Call buyWlWithLazy
  - Verify added to WL
  - Verify LAZY transferred/burned

- [ ] **Test:** Calculates spots correctly
  - If already WL, adds spots
  - If new, grants maxWlAddressMint

- [ ] **Test:** Reverts if cost not set (0)

- [ ] **Test:** Calls LazyGasStation correctly

---

### 7. Cost Calculation

#### 7.1 Base Price Calculation
- [ ] **Test:** Calculates base HBAR price
  - No discounts
  - Quantity × base price

- [ ] **Test:** Calculates base LAZY price

- [ ] **Test:** Calculates both currencies

#### 7.2 WL Discount Calculation
- [ ] **Test:** Applies WL discount
  - User is WL
  - Discount applied to all mints
  - Formula: price × (100 - discount) / 100

- [ ] **Test:** No discount if not WL

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

#### 7.4 WL + Holder Stacking
- [ ] **Test:** Stacks WL and holder discounts
  - User is WL and owns discount NFT
  - Both discounts applied
  - Capped at 100%

- [ ] **Test:** Correct calculation for stacked discounts
  - Example: 10% WL + 25% holder = 35% total

#### 7.5 Sacrifice Discount
- [ ] **Test:** Applies sacrifice discount
  - User sacrificing NFTs
  - Discount applied to all
  - No other discounts

- [ ] **Test:** Verifies sacrifice quantity matches mint quantity

- [ ] **Test:** Mutual exclusivity enforced
  - Cannot use holder discounts with sacrifice
  - Should revert

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

#### 11.4 Mint with WL Discount
```javascript
describe("WL Discount Minting", function() {
  it("Should apply WL discount", async function() {
    // Setup: User on WL, 10% discount
    // Mint 3 NFTs
    // Verify:
    //   - Discounted price charged
    //   - WL spots decremented
    //   - Correct calculation
  });
  
  it("Should enforce WL-only mode", async function() {
    // Enable WL-only
    // Non-WL user tries to mint
    // Should revert
  });
  
  it("Should track WL mints separately", async function() {
    // Verify wlAddressToNumMintedMap updated
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
  
  it("Should stack WL + holder discount", async function() {
    // User is WL (10%) and owns Gen1 (25%)
    // Mint 1 NFT
    // Verify: 35% discount applied
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
  
  it("Should require 1:1 quantity match", async function() {
    // Try to sacrifice 3, mint 5
    // Should revert
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

#### 14.2 Maximum Values
- [ ] **Test:** 100% discount (free mint)
- [ ] **Test:** Max mint quantity (50)
- [ ] **Test:** Max sacrifice quantity (20)
- [ ] **Test:** Very large HBAR price
- [ ] **Test:** Very large LAZY price
- [ ] **Test:** Pool with 1000+ NFTs
- [ ] **Test:** User with max wallet mints

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
name: Test ForeverMinterContract

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
