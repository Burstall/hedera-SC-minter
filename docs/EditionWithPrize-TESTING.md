# EditionWithPrize - Testing Plan

## Overview

This document outlines the comprehensive testing strategy for the EditionWithPrize contract. We'll leverage patterns from MinterContract.test.js and recent testing experience while adapting for the unique two-token + winner selection model.

---

## Test Environment Setup

### Required Dependencies
```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { 
  deployContract, 
  setupAccounts, 
  associateToken,
  getBalance,
  getTokenBalance
} = require("../utils/hederaHelpers");

// ⚠️ IMPORTANT: Create USDC test tokens with 6 decimals to match production behavior
```

### Test Accounts Structure
```javascript
let owner;           // Contract owner
let buyer1;          // Regular buyer (non-WL)
let buyer2;          // Regular buyer (non-WL)
let buyer3;          // Regular buyer (non-WL)
let wlUser1;         // Whitelisted user
let wlUser2;         // Whitelisted user
let tokenHolder;     // Holder of WL purchase token
let randomUser;      // For testing non-winner claim attempts
```

### Contract Instances
```javascript
let editionWithPrize;  // Main contract
let lazyToken;         // Mock Lazy FT
let usdcNative;        // Mock native USDC (6 decimals)
let usdcBridged;       // Mock bridged USDC (6 decimals)
let lsct;              // Mock Lazy SCT (burnable)
let prngGenerator;     // PRNG contract
let delegateRegistry;  // Lazy delegate registry
let wlPurchaseToken;   // Token for WL purchases (optional)
```

### Test Constants
```javascript
const EDITION_MAX_SUPPLY = 10;
const PRIZE_MAX_SUPPLY = 1; // Can be > 1 for multiple winners
const MINT_PRICE_HBAR = ethers.utils.parseEther("10");
const MINT_PRICE_LAZY = ethers.utils.parseUnits("100", 1); // decimal 1
const MINT_PRICE_USDC = ethers.utils.parseUnits("5", 6); // 6 decimals
const WL_DISCOUNT = 20; // 20%
const LAZY_BURN_PERCENTAGE = 50; // 50%
const MAX_MINT_PER_TX = 5;
const MAX_MINT_PER_WALLET = 3;
const WL_SPOTS_PER_ADDRESS = 2;
```

---

## Test Suite Structure

### Suite 1: Contract Deployment & Initialization

#### Test 1.1: Contract Deployment
```javascript
describe("Deployment", function() {
  it("Should deploy with correct initial state", async function() {
    // Deploy contract with constructor parameters:
    //   - lazyToken, lsct, lazyBurnPerc
    //   - prngGenerator, delegateRegistry  
    //   - usdcNative (6 decimals), usdcBridged (6 decimals)
    // Verify owner is set
    // Verify phase is NOT_INITIALIZED
    // Verify Lazy token address stored
    // Verify LSCT address stored
    // Verify burn percentage set correctly
    // Verify USDC addresses stored correctly
    // Verify contract is associated with all tokens (LAZY, USDC native, USDC bridged)
  });
  
  it("Should revert if association with Lazy fails", async function() {
    // Deploy with invalid Lazy token
    // Expect AssociationFailed error
  });
});
```

#### Test 1.2: Edition Token Initialization
```javascript
describe("Edition Token Initialization", function() {
  it("Should initialize edition token correctly", async function() {
    // Call initializeEditionToken with valid params
    // Verify edition token address set
    // Verify maxSupply stored
    // Verify CID stored
    // Verify totalMinted = 0
    // Verify EditionTokenCreated event emitted
    // Verify phase remains NOT_INITIALIZED (prize not yet created)
  });
  
  it("Should create token with SUPPLY and WIPE keys", async function() {
    // Initialize edition token
    // Query token keys via HTS
    // Verify SUPPLY key = contract address
    // Verify WIPE key = contract address
  });
  
  it("Should handle royalties correctly", async function() {
    // Initialize with royalty fees
    // Verify fees set on token
    // Test with fallback fee
    // Test with multiple royalties
  });
  
  it("Should revert if already initialized", async function() {
    // Initialize edition token
    // Try to initialize again
    // Expect AlreadyInitialized error
  });
  
  it("Should revert if memo too long", async function() {
    // Call with memo > 100 chars
    // Expect MemoTooLong error
  });
  
  it("Should revert if too many royalties", async function() {
    // Call with > 10 royalties
    // Expect TooManyFees error
  });
  
  it("Should revert if non-owner tries to initialize", async function() {
    // Connect as buyer1
    // Try to initialize
    // Expect Ownable error
  });
});
```

#### Test 1.3: Prize Token Initialization
```javascript
describe("Prize Token Initialization", function() {
  it("Should initialize prize token correctly", async function() {
    // Call initializePrizeToken with valid params
    // Verify prize token address set
    // Verify prize CID stored
    // Verify prize minted (serial = 1)
    // Verify contract owns prize NFT
    // Verify PrizeTokenCreated event emitted
  });
  
  it("Should transition to EDITION_MINTING after both tokens initialized", async function() {
    // Initialize edition token
    // Verify phase = NOT_INITIALIZED
    // Initialize prize token
    // Verify phase = EDITION_MINTING
  });
  
  it("Should work in either order (edition first or prize first)", async function() {
    // Test 1: Edition then Prize
    // Test 2: Prize then Edition
    // Both should end in EDITION_MINTING
  });
  
  it("Should create prize with maxSupply = 1", async function() {
    // Initialize prize token
    // Query token supply
    // Verify max supply = 1
    // Verify current supply = 1
  });
  
  it("Should revert if already initialized", async function() {
    // Initialize prize token
    // Try to initialize again
    // Expect AlreadyInitialized error
  });
});
```

---

### Suite 2: Edition Minting - Basic Functionality

#### Test 2.1: Simple Minting with Hbar
```javascript
describe("Basic Hbar Minting", function() {
  beforeEach(async function() {
    // Initialize both tokens
    // Set hbar price only (Lazy = 0)
  });
  
  it("Should mint single edition with exact hbar payment", async function() {
    // buyer1 mints 1 edition
    // Verify serial returned
    // Verify buyer1 owns the NFT
    // Verify totalMinted = 1
    // Verify EditionMinted event emitted
    // Verify contract hbar balance increased
  });
  
  it("Should mint multiple editions in one transaction", async function() {
    // buyer1 mints 3 editions
    // Verify 3 serials returned
    // Verify buyer1 owns all 3 NFTs
    // Verify totalMinted = 3
    // Verify correct hbar charged (3x price)
  });
  
  it("Should revert if insufficient hbar sent", async function() {
    // buyer1 sends less than price
    // Expect InsufficientHbar error
  });
  
  it("Should handle hbar overpayment correctly", async function() {
    // buyer1 sends more than price
    // Transaction succeeds
    // Verify exact price charged (no change given for simplicity)
  });
});
```

#### Test 2.2: Minting with Lazy
```javascript
describe("Lazy Token Minting", function() {
  beforeEach(async function() {
    // Initialize both tokens
    // Set Lazy price only (hbar = 0)
    // Mint Lazy to buyers
    // Buyers approve contract
  });
  
  it("Should mint with Lazy payment", async function() {
    // buyer1 mints 1 edition with Lazy
    // Verify NFT transferred
    // Verify Lazy transferred to contract
    // Verify burn occurred (50% of payment)
    // Verify LazyBurned event
  });
  
  it("Should revert if insufficient Lazy balance", async function() {
    // buyer1 has 0 Lazy
    // Try to mint
    // Expect InsufficientLazy error
  });
  
  it("Should revert if insufficient Lazy allowance", async function() {
    // buyer1 has Lazy but no approval
    // Try to mint
    // Expect InsufficientLazy error
  });
  
  it("Should burn correct percentage of Lazy", async function() {
    // Set burn to 50%
    // buyer1 mints for 100 Lazy
    // Verify 50 Lazy burned
    // Verify 50 Lazy in contract
    
    // Change burn to 25%
    // buyer2 mints for 100 Lazy
    // Verify 25 Lazy burned
    // Verify 75 Lazy in contract (50 + 25)
  });
  
  it("Should handle 0% burn (all retained)", async function() {
    // Set burn to 0%
    // buyer1 mints
    // Verify 0 Lazy burned
    // Verify all Lazy in contract
  });
  
  it("Should handle 100% burn (none retained)", async function() {
    // Set burn to 100%
    // buyer1 mints
    // Verify all Lazy burned
    // Verify 0 Lazy in contract
  });
});
```

#### Test 2.3: USDC Payments
```javascript
describe("USDC Token Minting", function() {
  beforeEach(async function() {
    // Initialize both tokens
    // Set USDC price only (others = 0)
    // Buyers approve both USDC tokens
  });
  
  it("Should mint with native USDC payment", async function() {
    // buyer1 mints 1 edition with native USDC
    // Verify native USDC transferred to owner
    // Verify NFT transferred to buyer1
  });
  
  it("Should mint with bridged USDC payment", async function() {
    // buyer1 has no native USDC allowance
    // buyer1 mints with bridged USDC
    // Verify bridged USDC transferred to owner
  });
  
  it("Should prioritize native USDC over bridged", async function() {
    // buyer1 has allowance for both
    // Mint cost requires both tokens
    // Verify native used first, bridged for remainder
  });
  
  it("Should revert if insufficient total USDC", async function() {
    // buyer1 has partial allowances
    // Total < required amount
    // Expect NotEnoughUsdc error
  });
});
```

#### Test 2.4: Multi-Token Hybrid Payments
```javascript
describe("Multi-Token Hybrid Minting", function() {
  beforeEach(async function() {
    // Set all three prices (HBAR + LAZY + USDC)
    // Setup buyer1 with all token approvals
  });
  
  it("Should accept HBAR + LAZY + USDC payment", async function() {
    // buyer1 mints with all three
    // Verify all payments processed correctly
    // Verify NFT transferred
  });
  
  it("Should revert if any payment insufficient", async function() {
    // Test each insufficient payment type
    // Expect specific error for each
  });
});
```

---

### Suite 3: Minting Validations & Limits

#### Test 3.1: Quantity Validations
```javascript
describe("Quantity Validations", function() {
  it("Should revert if quantity = 0", async function() {
    // buyer1 tries to mint 0
    // Expect BadQuantity error
  });
  
  it("Should revert if quantity exceeds maxMint", async function() {
    // Set maxMint = 3
    // buyer1 tries to mint 5
    // Expect MaxMintExceeded error
  });
  
  it("Should revert if would exceed edition supply", async function() {
    // Edition supply = 10
    // buyer1 mints 8
    // buyer2 tries to mint 3 (would be 11 total)
    // Expect MintedOut error
  });
  
  it("Should allow minting exactly to maxSupply", async function() {
    // Edition supply = 10
    // Multiple buyers mint total of exactly 10
    // All succeed
    // Verify phase = EDITION_SOLD_OUT
  });
});
```

#### Test 3.2: Max Mint Per Wallet
```javascript
describe("Max Mint Per Wallet", function() {
  beforeEach(async function() {
    // Set maxMintPerWallet = 3
  });
  
  it("Should track mints per wallet correctly", async function() {
    // buyer1 mints 2
    // Verify tracking = 2
    // buyer1 mints 1 more
    // Verify tracking = 3
  });
  
  it("Should revert if wallet exceeds max", async function() {
    // buyer1 mints 2
    // buyer1 tries to mint 2 more (would be 4)
    // Expect MaxMintPerWalletExceeded error
  });
  
  it("Should allow exactly max mints", async function() {
    // buyer1 mints 3 (exactly max)
    // Should succeed
  });
  
  it("Should enforce limit across multiple transactions", async function() {
    // buyer1 mints 1
    // buyer1 mints 1
    // buyer1 mints 1 (total 3, should succeed)
    // buyer1 tries to mint 1 more
    // Expect MaxMintPerWalletExceeded error
  });
  
  it("Should track wallets independently", async function() {
    // buyer1 mints 3 (max)
    // buyer2 should still be able to mint 3
  });
  
  it("Should work with maxMintPerWallet = 0 (unlimited)", async function() {
    // Set to 0
    // buyer1 mints 5
    // buyer1 mints 3 more
    // Both succeed (no limit)
  });
});
```

#### Test 3.3: Pause & Timing Controls
```javascript
describe("Pause and Timing", function() {
  it("Should revert if minting is paused", async function() {
    // Owner pauses minting
    // buyer1 tries to mint
    // Expect MintPaused error
  });
  
  it("Should allow minting after unpause", async function() {
    // Owner pauses
    // Owner unpauses
    // buyer1 mints
    // Should succeed
  });
  
  it("Should revert if before mint start time", async function() {
    // Set start time = now + 1 hour
    // buyer1 tries to mint
    // Expect MintNotStarted error
  });
  
  it("Should allow minting after start time", async function() {
    // Set start time = now + 10 seconds
    // Advance time 11 seconds
    // buyer1 mints
    // Should succeed
  });
});
```

---

### Suite 4: Whitelist Functionality

#### Test 4.1: Manual Whitelist
```javascript
describe("Manual Whitelist", function() {
  beforeEach(async function() {
    // Set WL discount = 20%
    // Set maxWlAddressMint = 2
  });
  
  it("Should add addresses to whitelist", async function() {
    // Owner adds [wlUser1, wlUser2]
    // Verify both in WL with 2 spots each
    // Verify WhitelistAdded events
  });
  
  it("Should remove addresses from whitelist", async function() {
    // Owner adds wlUser1
    // Owner removes wlUser1
    // Verify wlUser1 not in WL
    // Verify WhitelistRemoved event
  });
  
  it("Should clear entire whitelist", async function() {
    // Owner adds multiple addresses
    // Owner clears WL
    // Verify all removed
    // Verify return count correct
  });
  
  it("Should apply discount to WL users", async function() {
    // Base price = 100 hbar
    // WL discount = 20%
    // Owner adds wlUser1
    // wlUser1 gets cost
    // Verify cost = 80 hbar
  });
  
  it("Should not apply discount to non-WL users", async function() {
    // buyer1 (not WL) gets cost
    // Verify cost = 100 hbar (no discount)
  });
  
  it("Should consume WL spots on mint", async function() {
    // Owner adds wlUser1 with 2 spots
    // wlUser1 mints 1
    // Verify spots = 1
    // wlUser1 mints 1 more
    // Verify spots = 0
  });
  
  it("Should revert if WL spots exhausted", async function() {
    // Owner adds wlUser1 with 2 spots
    // wlUser1 mints 2
    // wlUser1 tries to mint 1 more
    // Expect InsufficientWlSlots error
  });
});
```

#### Test 4.2: WL-Only Mode
```javascript
describe("WL-Only Mode", function() {
  beforeEach(async function() {
    // Add wlUser1 to WL
    // Enable WL-only mode
  });
  
  it("Should allow WL users to mint", async function() {
    // wlUser1 mints
    // Should succeed
  });
  
  it("Should revert if non-WL user tries to mint", async function() {
    // buyer1 (not WL) tries to mint
    // Expect NotWhitelisted error
  });
  
  it("Should allow non-WL after disabling WL-only", async function() {
    // Disable WL-only mode
    // buyer1 (not WL) mints
    // Should succeed (no discount)
  });
});
```

#### Test 4.3: Buy WL with Lazy
```javascript
describe("Buy WL with Lazy", function() {
  beforeEach(async function() {
    // Set buyWlWithLazy = 1000 Lazy
    // Set maxWlAddressMint = 2
    // Mint Lazy to buyer1
    // buyer1 approves contract
  });
  
  it("Should allow buying WL spots with Lazy", async function() {
    // buyer1 calls buyWlWithLazy
    // Verify buyer1 in WL with 2 spots
    // Verify Lazy transferred
    // Verify Lazy burned (burn %)
    // Verify WlPurchasedWithLazy event
  });
  
  it("Should allow multiple purchases (spots accumulate)", async function() {
    // buyer1 buys WL (gets 2 spots)
    // buyer1 buys WL again (gets 2 more = 4 total)
    // Verify spots = 4
  });
  
  it("Should revert if buyWlWithLazy = 0 (disabled)", async function() {
    // Set to 0
    // buyer1 tries to buy
    // Expect WlPurchaseFailed error
  });
  
  it("Should revert if insufficient Lazy", async function() {
    // buyer1 has less Lazy than price
    // buyer1 tries to buy
    // Expect InsufficientLazy error
  });
});
```

#### Test 4.4: Buy WL with Token
```javascript
describe("Buy WL with Token", function() {
  beforeEach(async function() {
    // Deploy mock WL purchase token
    // Mint serials 1, 2, 3 to tokenHolder
    // Set wlToken address in contract
    // Set maxWlAddressMint = 2
  });
  
  it("Should allow buying WL with token serials", async function() {
    // tokenHolder calls buyWlWithTokens([1, 2])
    // Verify tokenHolder in WL with 4 spots (2 serials * 2)
    // Verify serials 1, 2 marked as used
    // Verify WlPurchasedWithToken events
  });
  
  it("Should revert if serial already used", async function() {
    // tokenHolder buys with serial 1
    // tokenHolder tries to buy with serial 1 again
    // Expect WlTokenAlreadyUsed error
  });
  
  it("Should revert if caller doesn't own serial", async function() {
    // buyer1 (doesn't own any tokens) tries to buy with serial 1
    // Expect NotTokenOwner error
  });
  
  it("Should revert if no WL token set", async function() {
    // Set wlToken = address(0)
    // tokenHolder tries to buy
    // Expect NoWlToken error
  });
  
  it("Should allow mix of token and Lazy purchases", async function() {
    // tokenHolder buys with token (gets 2 spots)
    // tokenHolder buys with Lazy (gets 2 more = 4 spots)
    // Verify total spots = 4
  });
});
```

---

### Suite 5: Winner Selection (PRNG)

#### Test 5.1: Basic Winner Selection
```javascript
describe("Winner Selection", function() {
  beforeEach(async function() {
    // Initialize tokens
    // Mint all editions (sell out)
    // Verify phase = EDITION_SOLD_OUT
  });
  
  it("Should select winner(s) when sold out", async function() {
    // Anyone calls selectWinner
    // Verify WinnerSelectedEvent with serials array
    // Verify all serials in range [1, maxSupply]
    // Verify number of winners = prizeMaxSupply
    // Verify phase = WINNER_SELECTED
    // Verify EnumerableSet contains all winning serials
    // Verify O(1) isWinningSerial() function works
  });
  
  it("Should allow anyone to call selectWinner (permissionless)", async function() {
    // buyer1 (not owner) calls selectWinner
    // Should succeed
    // buyer2 calls selectWinner in another test
    // Should succeed
  });
  
  it("Should emit event with PRNG seed for verification", async function() {
    // Call selectWinner
    // Capture WinnerSelected event
    // Verify seed is non-zero bytes32
    // Verify timestamp and blockNumber set
  });
  
  it("Should query correct owner from ERC721", async function() {
    // buyer1 owns serial 3
    // buyer2 owns serial 7
    // Call selectWinner
    // Verify winning serial selected
    // NOTE: Owner address NOT stored or emitted
    // Serial is bearer asset - current owner can claim
  });
});
```

#### Test 5.2: Winner Selection Validations
```javascript
describe("Winner Selection Validations", function() {
  it("Should revert if not sold out", async function() {
    // Only 5 of 10 minted
    // Try to select winner
    // Expect WrongPhase error
  });
  
  it("Should revert if winner already selected", async function() {
    // Mint all editions
    // Select winner
    // Try to select winner again
    // Expect WrongPhase error
  });
  
  it("Should work immediately after sold out", async function() {
    // buyer1 mints last edition (triggers sold out)
    // Same block, call selectWinner
    // Should succeed
  });
});
```

#### Test 5.3: PRNG Integration
```javascript
describe("PRNG Integration", function() {
  it("Should use PRNG contract for randomness", async function() {
    // Mock PRNG to return specific value
    // Select winner
    // Verify contract queried PRNG
    // Verify random number in expected range
  });
  
  it("Should handle PRNG returning edge values", async function() {
    // Mock PRNG to return 1 (minimum)
    // Verify winner serial = 1
    // Mock PRNG to return maxSupply (maximum)
    // Verify winner serial = maxSupply
  });
  
  it("Should allow updating PRNG address", async function() {
    // Owner updates PRNG address
    // New PRNG used in next selection
  });
});
```

---

### Suite 6: Prize Claiming

#### Test 6.1: Successful Prize Claim
```javascript
describe("Prize Claim - Success", function() {
  beforeEach(async function() {
    // Setup and mint all editions
    // Select winner (winner = buyer1, serial = 3)
    // Associate buyer1 with prize token
  });
  
  it("Should allow winner to claim prize", async function() {
    // buyer1 calls claimPrize
    // Verify edition serial 3 wiped from buyer1
    // Verify prize transferred to buyer1
    // Verify PrizeClaimed event emitted
    // Verify phase = PRIZE_CLAIMED
  });
  
  it("Should wipe edition using wipe key", async function() {
    // buyer1 has edition serial 3
    // buyer1 claims prize
    // Verify buyer1 no longer owns serial 3
    // Verify edition total supply decreased by 1
  });
  
  it("Should transfer prize NFT to winner", async function() {
    // Before: contract owns prize serial 1
    // buyer1 claims
    // After: buyer1 owns prize serial 1
  });
  
  it("Should emit detailed claim event", async function() {
    // buyer1 claims
    // Capture PrizeClaimed event
    // Verify winner address
    // Verify edition serial wiped
    // Verify prize serial transferred
    // Verify timestamp
  });
});
```

#### Test 6.2: Prize Claim Validations
```javascript
describe("Prize Claim Validations", function() {
  beforeEach(async function() {
    // Select winner (winning serial = 3)
  });
  
  it("Should revert if non-owner of winning serial tries to claim", async function() {
    // buyer2 (doesn't own serial 3) tries to claim
    // Expect error (not owner of winning serial)
  });
  
  it("Should allow NEW owner if winning serial was transferred", async function() {
    // buyer1 owns serial 3 (winning serial)
    // buyer1 transfers serial 3 to buyer2
    // buyer2 (new owner) can claim (bearer asset!)
    // buyer1 (original owner) cannot claim
  });
  
  it("Should revert if claimer not associated with prize token", async function() {
    // Current owner of serial 3 not associated
    // Try to claim
    // Expect PrizeNotAssociated error
  });
  
  it("Should revert if prize already claimed", async function() {
    // Serial owner claims prize
    // Try to claim again
    // Expect WrongPhase error
  });
  
  it("Should revert if winner not selected yet", async function() {
    // Mint all editions
    // Don't select winner
    // Someone tries to claim
    // Expect WrongPhase error
  });
});
```

#### Test 6.3: Edge Cases
```javascript
describe("Prize Claim Edge Cases", function() {
  it("Should handle winning serial being traded (bearer asset)", async function() {
    // Select winner (serial 3)
    // buyer1 owns serial 3
    // buyer1 sells serial 3 to buyer2
    // buyer2 (new owner) can claim prize
    // buyer1 (original owner at selection) cannot claim
    // This is CORRECT BEHAVIOR - NFT is bearer asset
  });
  
  it("Should verify ownership at claim time, not selection time", async function() {
    // Select winner (serial 3)
    // buyer1 owns serial 3 at selection time
    // buyer1 transfers serial 3 to buyer2
    // buyer2 must associate with prize token
    // buyer2 can claim successfully
    // Winning serial is a tradeable asset!
  });
  
  it("Should allow different royalties for edition vs prize", async function() {
    // Edition token has 5% royalty
    // Prize token has 15% royalty
    // Transfer edition - 5% royalty applies
    // Transfer prize - 15% royalty applies
    // Verify independent royalty structures
  });
});
```

---

### Suite 7: Configuration & Management
_(Condensed for space - see full version for complete tests)_

- Pricing updates (hbar, Lazy)
- WL configuration (discount, max mints, buy price)
- Other parameters (max mint, max wallet, burn %, start time)
- Access controls (only owner)

---

### Suite 8: Fund Withdrawal

#### Test 8.1: HBAR Withdrawal
```javascript
describe("HBAR Withdrawal", function() {
  it("Should allow owner to withdraw HBAR", async function() {
    // Owner calls appropriate withdrawal function
    // Verify HBAR transferred to owner
  });
  
  it("Should revert if non-owner tries to withdraw", async function() {
    // buyer1 tries to withdraw
    // Expect Ownable error
  });
});
```

#### Test 8.2: USDC Withdrawal
```javascript
describe("USDC Withdrawal", function() {
  it("Should withdraw both native and bridged USDC", async function() {
    // Contract has both USDC types
    // Owner calls withdrawUSDC()
    // Verify both balances transferred to owner
  });
  
  it("Should handle zero balances gracefully", async function() {
    // Contract has no USDC
    // Owner calls withdrawUSDC()
    // Should succeed (no-op)
  });
});
```

#### Test 8.3: LAZY Withdrawal
```javascript
describe("LAZY Withdrawal", function() {
  it("Should allow owner to withdraw remaining LAZY", async function() {
    // Contract has LAZY after burn
    // Owner withdraws
    // Verify transfer successful
  });
});
```

---

### Suite 9: View Functions & Queries
_(Condensed for space)_

- Token addresses
- Supply info
- Phase & winner data
- Economics & timing
- Minting stats

---

### Suite 10: Integration Tests (Full Flows)

#### Complete Journey Tests
```javascript
describe("Integration: Full Journey", function() {
  it("Should complete small edition (5 copies)", async function() {
    // Deploy → Init → Mint → Select → Claim → Withdraw
  });
  
  it("Should handle WL + non-WL correctly", async function() {
    // Mix of WL and non-WL mints with different prices
  });
  
  it("Should handle Lazy economics end-to-end", async function() {
    // Mint with Lazy → Burn → Retain → Withdraw
  });
  
  it("Should handle all WL purchase methods", async function() {
    // Manual + Lazy purchase + Token purchase
  });
});
```

---

## Test Helpers & Utilities

```javascript
// Setup
async function deployFullSetup(config = {})

// Operations
async function associateUserWithToken(user, token)
async function mintLazyToUser(user, amount)
async function mintEditions(user, quantity, overrides = {})

// Verification
async function verifyOwnership(token, serial, expectedOwner)
async function verifyBalance(user, expectedHbar, expectedLazy)

// Phase Management
async function advanceToPhase(targetPhase)

// Events
async function expectEventWithArgs(tx, eventName, args)
```

---

## Test Execution

```bash
# All tests
npm test

# Specific suite
npm test -- --grep "Winner Selection"

# With coverage
npm run coverage

# Testnet
npm run test:testnet
```

---

## Coverage Goals
- **Line Coverage**: > 95%
- **Branch Coverage**: > 90%
- **Function Coverage**: 100%

---

## Testnet Testing Checklist

- [ ] Deploy to testnet
- [ ] Verify on HashScan
- [ ] Initialize tokens
- [ ] Configure pricing & WL
- [ ] Mint editions (multiple accounts)
- [ ] Sell out
- [ ] Select winner
- [ ] Claim prize
- [ ] Withdraw funds
- [ ] Verify all events/balances

---

## Summary

Comprehensive testing covering:
- ✅ All functionality
- ✅ Edge cases
- ✅ Integration flows
- ✅ Whitelist mechanics
- ✅ Lazy economics
- ✅ PRNG winner selection
- ✅ Prize claiming with wipe

Reuse patterns from MinterContract.test.js!
