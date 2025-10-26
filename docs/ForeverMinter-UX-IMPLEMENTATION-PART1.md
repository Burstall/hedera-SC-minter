# ForeverMinter - UX Implementation Guide (Part 1: Core Concepts & System Understanding)

**Version:** 1.0.5  
**Last Updated:** October 26, 2025  
**Contract:** ForeverMinter.sol v1.0.5  

---

## Table of Contents

1. [Overview](#overview)
2. [Contract Architecture](#contract-architecture)
3. [The NFT Pool System](#the-nft-pool-system)
4. [Discount System Deep Dive](#discount-system-deep-dive)
5. [Payment Mechanics](#payment-mechanics)
6. [State Query Methods](#state-query-methods)
7. [View Functions Reference](#view-functions-reference)
8. [Network Configuration](#network-configuration)
9. [Error Handling](#error-handling)

---

## Overview

ForeverMinter is a next-generation NFT distribution system that manages a pool of **existing** NFTs and distributes them randomly with sophisticated discount mechanics. Unlike traditional minting contracts that create new tokens, ForeverMinter respects marketplace royalties and offers flexible pricing strategies.

### Key Features

- **Existing NFT Distribution**: Distributes pre-minted NFTs from a pool
- **Random Selection**: Uses Hedera PRNG for fair distribution
- **Multi-Tier Discounts**: Whitelist, Holder, and Sacrifice discount systems
- **Discount Stacking**: Combine Whitelist + Holder discounts (up to 100%)
- **Refund System**: Time-windowed refunds for buyer's remorse
- **Multi-Payment**: HBAR and/or LAZY token payments
- **Royalty-Compliant**: Uses TokenStakerV2 for proper royalty handling
- **Gas-Optimized**: Batch operations support up to 50 NFTs per transaction

### What Makes ForeverMinter Unique

**vs Traditional Minting:**
- ✅ Respects secondary market royalties (via STAKING/WITHDRAWAL)
- ✅ Random distribution prevents serial sniping
- ✅ Refund system reduces buyer risk
- ✅ Sophisticated discount economics

**vs MinterContract:**
- ForeverMinter distributes existing NFTs (pool-based)
- MinterContract creates new NFTs (generation-based)
- ForeverMinter supports up to 50 NFTs/tx (vs 10)
- ForeverMinter has 3 discount types (vs 1)

### Target Audience

This guide is for frontend developers, UI/UX designers, and integration engineers building interfaces for ForeverMinter-powered NFT distributions.

---

## Contract Architecture

### Core Components

```
ForeverMinter Contract
├── NFT Pool (EnumerableSet)
│   ├── Available serials
│   ├── Mint time tracking
│   └── Payment tracking
├── Discount System
│   ├── Whitelist slots (consumable)
│   ├── Holder discounts (NFT-based)
│   └── Sacrifice discounts (burn-to-discount)
├── Payment Processing
│   ├── HBAR (native)
│   └── LAZY (via LazyGasStation)
├── Refund System
│   ├── Time-windowed eligibility
│   └── Percentage-based refunds
└── Admin System (Multi-admin)
```

### Inheritance Chain

```
ForeverMinter
├── TokenStakerV2 (royalty-compliant transfers)
│   └── HederaTokenService
├── Ownable (OpenZeppelin)
└── ReentrancyGuard (OpenZeppelin)
```

### Dependencies

- **TokenStakerV2**: Handles NFT transfers via STAKING/WITHDRAWAL for royalty compliance
- **IPrngGenerator**: Provides random numbers for serial selection
- **LazyGasStation**: Manages LAZY token payments and burns
- **LazyDelegateRegistry**: Verifies token ownership including delegated holdings

### Key Design Decisions

1. **Pool-Based Distribution**: Pre-existing NFTs are registered and randomly selected
2. **Bearer Asset Model**: Once minted, NFTs can be freely traded
3. **Waterfall Discount Logic**: Applies best available discounts in order
4. **Slot Consumption**: Discounts are finite and tracked per-serial
5. **Refund Returns to Pool**: Refunded NFTs go back into available pool

---

## The NFT Pool System

### How the Pool Works

Think of ForeverMinter as a vending machine that holds existing NFTs and dispenses them randomly.

#### Pool Sources

1. **Treasury Deposits**: Project sends NFTs to contract, then calls `registerNFTs()`
2. **User Donations**: Anyone can call `addNFTsToPool()` to donate NFTs
3. **Refunded NFTs**: When users refund, NFTs return to the pool
4. **Sacrificed NFTs**: If configured, sacrificed NFTs can return to pool

#### Random Distribution

```javascript
// When user mints 3 NFTs:
1. Contract has pool of [#5, #12, #47, #88, #92, #100, ...]
2. PRNG selects 3 random indices
3. User receives [#47, #5, #100]
4. Pool now contains [#12, #88, #92, ...]
```

**Key Points:**
- No way to predict which serial you'll receive
- Fair distribution ensures no "sniping" of rare serials
- Each serial can only be distributed once per cycle
- Pool size decreases with each mint (until refills)

### Pool States

```
Full Pool: [#1, #2, #3, #4, #5, #6, #7, #8, #9, #10]
After Mint 3: [#1, #2, #4, #6, #7, #8, #10]  (User got #3, #5, #9)
After Refund #5: [#1, #2, #4, #5, #6, #7, #8, #10]
After Emergency Withdraw #1: [#2, #4, #5, #6, #7, #8, #10]
```

### Checking Pool Status

```javascript
// Get total available NFTs
const available = await contract.getRemainingSupply();

// Check if specific serial is available
const isAvailable = await contract.isSerialAvailable(42);

// Get all available serials (use pagination for large pools!)
const allSerials = await contract.getAvailableSerialsPaginated(0, 100);
```

**UI Recommendations:**
- Display "X NFTs Available" prominently
- Show "Sold Out" when `getRemainingSupply() === 0`
- Update count after each mint transaction
- Consider real-time updates via event listeners

---

## Discount System Deep Dive

ForeverMinter's discount system is its most powerful and complex feature. Understanding it is critical for proper UX implementation.

### Three Discount Types

```
┌─────────────┬──────────────┬────────────┬─────────────────┐
│ Type        │ Source       │ Stackable? │ Typical Amount  │
├─────────────┼──────────────┼────────────┼─────────────────┤
│ Whitelist   │ Admin-added  │ Yes        │ 10-20%          │
│ Holder      │ Own NFTs     │ Yes        │ 10-50%          │
│ Sacrifice   │ Burn NFTs    │ NO         │ 30-70%          │
└─────────────┴──────────────┴────────────┴─────────────────┘
```

### 1. Whitelist Discount

**Concept**: Project pre-approves addresses for discounts.

**How It Works:**
- Admin adds addresses with slot counts: `addToWhitelist(address, slots)`
- Each slot = 1 discounted mint
- Slots are **consumable** (decrease with each mint)
- Applies to all mints by whitelisted addresses

**Configuration:**
```solidity
// In MintEconomics struct
wlDiscountPercentage: 10    // 10% discount for WL addresses
maxWlAddressMint: 20        // Max 20 mints per WL address
```

**Checking WL Status:**
```javascript
const wlSlots = await contract.whitelistSlots(userAddress);
const isWL = wlSlots > 0;

// Display: "You have 5 whitelist mints remaining"
```

**Purchasing WL with LAZY:**
```javascript
const economics = await contract.getEconomics();
const lazyPerWLGroup = economics.buyWlWithLazy;

// User can buy WL access by burning LAZY
await contract.buyWhitelistWithLazy(1); // Buy 1 group of slots
```

### 2. Holder Discount

**Concept**: Own certain NFTs = get discounts. The discount "capacity" is attached to the NFT serial, not your wallet.

**How It Works:**

1. **Discount Tiers**: Admin configures which NFT collections provide discounts

```javascript
// Example tier configuration
Tier 0: LSH Generation 1
  - Token Address: 0x123...
  - Discount: 25%
  - Max Uses Per Serial: 8 mints

Tier 1: LSH Generation 2
  - Token Address: 0x456...
  - Discount: 10%
  - Max Uses Per Serial: 3 mints
```

2. **Per-Serial Tracking**: Each NFT serial has a "discount capacity"

```javascript
Gen1 #1234:
  - Discount: 25%
  - Max Uses: 8
  - Used: 3
  - Remaining: 5 uses

Gen2 #5678:
  - Discount: 10%
  - Max Uses: 3
  - Used: 0
  - Remaining: 3 uses
```

3. **Usage Tracking is Global**: If you use Gen1 #1234 for 2 mints, then sell it, the buyer gets the remaining 6 uses (not 8).

**Checking Your Discounts:**

```javascript
// Step 1: Get user's NFTs from mirror node or contract
const userNFTs = await getUserOwnedNFTs(userAddress, lshGen1Address);
// Returns: [1234, 5678, 9012]

// Step 2: Check discount info for these NFTs
const discountInfo = await contract.getBatchSerialDiscountInfo(
  [lshGen1Address, lshGen1Address, lshGen1Address],
  [1234, 5678, 9012]
);

// Returns for each serial:
// {
//   discountPercentage: 25,
//   usesRemaining: 5,
//   isEligible: true
// }
```

**Using Discounts:**

```javascript
// User wants to mint 5 NFTs
// User owns Gen1 #1234 (5 uses left, 25% off)

await contract.mintNFT(
  5,                           // quantity
  [lshGen1Address],           // discount tokens
  [[1234]],                   // serials for each token
  [],                         // no sacrifice
  { value: calculatedHbar }
);

// Result: 
// - All 5 NFTs get 25% discount
// - Gen1 #1234 now has 0 uses remaining
```

**Multiple Discount NFTs:**

```javascript
// User owns:
// - Gen1 #100 (25% off, 2 uses left)
// - Gen1 #200 (25% off, 8 uses left)
// - Gen2 #300 (10% off, 3 uses left)

// Mint 15 NFTs with optimal discount:
await contract.mintNFT(
  15,
  [lshGen1Address, lshGen1Address, lshGen2Address],
  [[100, 200], [], [300]],  // Can provide serials for some tokens
  []
);

// Waterfall application:
// - NFTs 1-2: 25% off (using Gen1 #100)
// - NFTs 3-10: 25% off (using Gen1 #200)
// - NFTs 11-13: 10% off (using Gen2 #300)
// - NFTs 14-15: WL discount only (if WL) or base price
```

**Important Notes:**
- ✅ Discounts are attached to NFT serials, not wallets
- ✅ Serials can be traded; new owner gets remaining uses
- ✅ Must own (or have delegation for) discount NFT at mint time
- ✅ Contract checks ownership via `_canUseSerial()` which supports LazyDelegateRegistry
- ⚠️ Uses don't reset; once exhausted, serial provides no discount

### 3. Sacrifice Discount

**Concept**: Burn existing NFTs to get a bigger discount on new ones. Think of it as "re-rolling."

**How It Works:**

1. **1:1 Ratio**: Must sacrifice exactly as many NFTs as you're minting
2. **Exclusive**: Cannot combine with Holder or WL discounts
3. **Destination**: Sacrificed NFTs go to configured address (burn wallet or back to pool)

```javascript
// Configuration
sacrificeDiscountPercentage: 50  // 50% off
sacrificeDestination: 0xdead     // Burn address
maxSacrifice: 20                 // Max 20 per transaction
```

**Use Cases:**

1. **Don't Like Your Roll**: Got #1234 but want something different? Sacrifice it for 50% off a new random one.

2. **Bulk Re-rolling**: Have 10 NFTs you don't want? Sacrifice them for 10 new random ones at 50% cost.

3. **Strategic Play**: If sacrifice destination is the pool itself, you're effectively trading NFTs at 50% cost while keeping the pool full.

**Using Sacrifice:**

```javascript
// User owns ForeverMinter NFTs [#11, #22, #33, #44, #55]
// Wants to sacrifice them for 5 new ones

// Step 1: Approve contract to move NFTs
await nftContract.setApprovalForAll(foreverMinterAddress, true);

// Step 2: Calculate cost
const cost = await contract.calculateMintCost(
  userAddress,
  5,          // minting 5
  [],         // no holder discount tokens
  [],         // no holder discount serials
  5           // sacrificing 5
);
// Returns: (hbarCost, lazyCost, 50, 0, 0)
// 50 = 50% discount applied

// Step 3: Mint with sacrifice
await contract.mintNFT(
  5,
  [],
  [],
  [11, 22, 33, 44, 55],  // sacrifice these
  { value: cost[0] }     // pay discounted HBAR
);

// Result:
// - Old NFTs [#11, #22, #33, #44, #55] sent to sacrifice destination
// - Receive 5 new random NFTs (e.g., [#7, #19, #88, #92, #101])
// - Paid 50% of base price
```

**Sacrifice Rules:**
- ❌ Cannot use holder discounts when sacrificing
- ❌ Cannot use WL discounts when sacrificing
- ✅ Can only sacrifice NFTs from the same collection ForeverMinter distributes
- ✅ Must own all NFTs being sacrificed
- ✅ Sacrifice count must equal mint count

### Discount Stacking Rules

```
┌──────────────────────────────────────────────────┐
│ Discount Combination Matrix                      │
├──────────────┬─────────┬─────────┬───────────────┤
│ Combination  │ Allowed │ Formula │ Example       │
├──────────────┼─────────┼─────────┼───────────────┤
│ WL Only      │ ✅      │ WL%     │ 10%           │
│ Holder Only  │ ✅      │ Holder% │ 25%           │
│ Sacrifice    │ ✅      │ Sac%    │ 50%           │
│ WL + Holder  │ ✅      │ WL + H  │ 10% + 25% = 35% │
│ WL + Sac     │ ❌      │ N/A     │ Not allowed   │
│ Holder + Sac │ ❌      │ N/A     │ Not allowed   │
│ All 3        │ ❌      │ N/A     │ Not allowed   │
└──────────────┴─────────┴─────────┴───────────────┘

Max Total Discount: 100% (price cannot go below 0)
```

### Discount Waterfall Logic

When user mints with holder discounts, the contract applies them in order of highest discount first:

```javascript
// User setup:
User is WL: 10% discount
Owns Gen1 #100: 25% off, 5 uses left
Owns Gen2 #200: 10% off, 3 uses left
Wants to mint: 10 NFTs

// Waterfall application:
NFTs 1-5:  WL (10%) + Gen1 (25%) = 35% off
NFTs 6-8:  WL (10%) + Gen2 (10%) = 20% off
NFTs 9-10: WL (10%) only = 10% off

// Gen1 #100 remaining uses: 0
// Gen2 #200 remaining uses: 0
// User's WL slots: decreased by 10
```

**Important v1.0.5 Update:**

In v1.0.5, the cost calculation function was enhanced to return slot consumption details:

```javascript
// v1.0.5 signature (5 return values)
const [hbarCost, lazyCost, discount, holderSlots, wlSlots] = 
  await contract.calculateMintCost(user, quantity, tokens, serials, sacrifice);

// holderSlots = total holder discount uses consumed
// wlSlots = total WL slots consumed
```

This allows frontends to show: **"This mint will consume 5 holder discount uses and 10 WL slots"**

---

## Payment Mechanics

### Dual Payment System

ForeverMinter supports two payment currencies:

1. **HBAR** (native Hedera cryptocurrency)
2. **LAZY** (fungible token with burn mechanism)

Projects can require:
- HBAR only
- LAZY only  
- Both HBAR **and** LAZY

### HBAR Payment

**Characteristics:**
- Native cryptocurrency (tinybars, 8 decimals)
- Sent as `msg.value` in transaction
- Excess automatically refunded
- No approval needed

```javascript
// Example: Base price = 1,000 HBAR
const baseHbar = ethers.utils.parseUnits("1000", 8); // 100000000000 tinybars

// Send transaction
await contract.mintNFT(quantity, [], [], [], { 
  value: baseHbar.mul(quantity) 
});
```

### LAZY Payment

**Characteristics:**
- Fungible token (8 decimals)
- Processed via LazyGasStation contract
- Percentage automatically burned (e.g., 20%)
- Requires approval of **LazyGasStation** (not ForeverMinter!)

```javascript
// Example: Base price = 50,000 LAZY
const baseLazy = ethers.utils.parseUnits("50000", 8);

// IMPORTANT: Approve LazyGasStation, not ForeverMinter
const lazyGasStation = await contract.lazyDetails().lazyGasStation;
await lazyToken.approve(lazyGasStation, baseLazy.mul(quantity));

// Then mint
await contract.mintNFT(quantity, [], [], []);
```

**LAZY Burn Mechanism:**
```javascript
// Project config: 20% burn
User pays: 50,000 LAZY
Burned: 10,000 LAZY (20%)
To contract: 40,000 LAZY (80%)
```

**Getting LAZY Config:**
```javascript
const lazyDetails = await contract.getLazyDetails();
// Returns:
// {
//   lazyToken: "0x...",          // LAZY token address
//   lazyGasStation: "0x...",     // LazyGasStation address
//   lazyBurnPercentage: 2000     // 2000 = 20%
// }
```

### Hybrid Payment

When project requires both currencies:

```javascript
// Configuration
mintPriceHbar: 1000 HBAR
mintPriceLazy: 50000 LAZY

// User must pay BOTH for each NFT
await contract.mintNFT(3, [], [], [], {
  value: hbarPrice.mul(3)  // Send 3,000 HBAR
});
// AND have approved 150,000 LAZY to LazyGasStation
```

### Contract-Sponsored LAZY

Projects can optionally sponsor LAZY costs:

```javascript
// Economics configuration
lazyFromContract: true  // Contract pays LAZY, users only pay HBAR

// User experience:
// - Only need to send HBAR
// - No LAZY approval needed
// - No LAZY balance required
```

---

## State Query Methods

These are gas-free view functions for reading contract state. Call them frequently to keep UI synchronized.

### Critical State Queries

#### 1. Get Remaining Supply

```javascript
const available = await contract.getRemainingSupply();

// Returns: number of NFTs in pool
// Update frequency: After every mint, poll every 10s
```

**UI Display:**
```
"888 NFTs Available"
"SOLD OUT" (if 0)
"Low Stock: Only 5 left!" (if < 10)
```

#### 2. Check Serial Availability

```javascript
const isAvailable = await contract.isSerialAvailable(serialNumber);

// Returns: true/false
// Use case: Check if specific serial is in pool
```

#### 3. Get Available Serials (Paginated)

```javascript
// Get first 100 serials
const serials = await contract.getAvailableSerialsPaginated(0, 100);

// Get next 100
const moreSerials = await contract.getAvailableSerialsPaginated(100, 100);

// Returns: array of serial numbers
```

**⚠️ Warning**: Don't call `getAllAvailableSerials()` for large pools! Use pagination.

#### 4. Get Mint Economics

```javascript
const economics = await contract.getEconomics();

// Returns MintEconomics struct:
// {
//   mintPriceHbar: 100000000000,        // 1,000 HBAR in tinybars
//   mintPriceLazy: 5000000000000,       // 50,000 LAZY
//   wlDiscountPercentage: 10,           // 10%
//   sacrificeDiscountPercentage: 50,    // 50%
//   maxMint: 50,                        // Max per transaction
//   maxMintPerWallet: 0,                // 0 = unlimited
//   buyWlWithLazy: 5000000000000,       // 50,000 LAZY to buy WL
//   maxWlAddressMint: 20,               // Max mints for WL addresses
//   maxSacrifice: 20,                   // Max sacrifice per tx
//   lazyFromContract: false             // User pays LAZY
// }
```

**Update Frequency**: Cache on initial load, refresh if admin might change settings.

#### 5. Get Mint Timing

```javascript
const timing = await contract.getTiming();

// Returns MintTiming struct:
// {
//   mintStart: 1698000000,      // Unix timestamp
//   paused: false,              // Is minting paused?
//   refundWindow: 3600,         // 1 hour in seconds
//   refundPercentage: 9500,     // 95% (9500/10000)
//   wlOnly: false               // Whitelist-only mode?
// }
```

**Update Frequency**: Poll every 30-60 seconds during active minting.

#### 6. Check Whitelist Status

```javascript
const wlSlots = await contract.whitelistSlots(userAddress);
const isWhitelisted = wlSlots > 0;

// Display: "You have 5 whitelist mints remaining"
```

**Update Frequency**: On user connect, after each mint, after WL purchase.

#### 7. Get Wallet Mint Count

```javascript
const mintCount = await contract.getWalletMintCount(userAddress);

// Returns: total NFTs minted by this wallet
// Use case: Check against maxMintPerWallet limit
```

#### 8. Calculate Mint Cost (v1.0.5)

```javascript
const [hbarCost, lazyCost, discount, holderSlots, wlSlots] = 
  await contract.calculateMintCost(
    userAddress,
    quantity,
    discountTokens,     // e.g., [lshGen1Address, lshGen2Address]
    serialsByToken,     // e.g., [[100, 200], [300]]
    sacrificeCount      // e.g., 0 (no sacrifice)
  );

// Returns (v1.0.5):
// [0] hbarCost: Total HBAR in tinybars
// [1] lazyCost: Total LAZY (with 8 decimals)
// [2] discount: Weighted average discount % (0-100)
// [3] holderSlots: Number of holder discount uses consumed
// [4] wlSlots: Number of WL slots consumed
```

**Use Before Every Mint**: Always call this to get accurate pricing!

#### 9. Get Discount Info for Serials

```javascript
const info = await contract.getBatchSerialDiscountInfo(
  [lshGen1Address, lshGen1Address, lshGen2Address],
  [100, 200, 300]
);

// Returns for each serial:
// {
//   discountPercentage: 25,     // Discount %
//   usesRemaining: 5,           // Remaining uses
//   isEligible: true            // Can use for discount?
// }
```

#### 10. Get Refund Info

```javascript
const mintTime = await contract.getSerialMintTime(serialNumber);
const payment = await contract.getSerialPayment(serialNumber);

// payment returns:
// {
//   hbarPaid: 900000000000,     // 900 HBAR (discounted)
//   lazyPaid: 4500000000000,    // 45,000 LAZY (discounted)
//   timestamp: 1698001234
// }

const timing = await contract.getTiming();
const refundDeadline = mintTime + timing.refundWindow;
const isRefundable = Date.now() / 1000 < refundDeadline;
```

---

## View Functions Reference

Complete reference for all read-only contract methods.

### Pool & Supply Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `getRemainingSupply()` | uint256 | Number of NFTs in pool | Free |
| `isSerialAvailable(serial)` | bool | Check if serial is in pool | Free |
| `getAvailableSerialsPaginated(offset, limit)` | uint256[] | Get serials with pagination | Free |
| `getAllAvailableSerials()` | uint256[] | Get all serials (⚠️ use pagination!) | Free |

### Economics Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `getEconomics()` | MintEconomics | All pricing and limits | Free |
| `getTiming()` | MintTiming | Timing and control settings | Free |
| `getLazyDetails()` | LazyDetails | LAZY token configuration | Free |

### Discount Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `getBatchSerialDiscountInfo(tokens, serials)` | arrays | Discount info for multiple serials | Free |
| `getDiscountTierCount()` | uint256 | Number of discount tiers | Free |
| `getDiscountTier(index)` | DiscountTier | Get tier details | Free |
| `getTokenTierIndex(token)` | uint256 | Get tier index for token | Free |
| `isTokenDiscountEligible(token)` | bool | Check if token provides discount | Free |
| `getSerialDiscountUsage(token, serial)` | uint256 | Get usage count for serial | Free |

### User & Wallet Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `whitelistSlots(address)` | uint256 | Get WL slots for address | Free |
| `getWalletMintCount(address)` | uint256 | Get total mints by wallet | Free |
| `getSerialMintTime(serial)` | uint256 | Get mint timestamp | Free |
| `getSerialPayment(serial)` | MintPayment | Get payment details | Free |

### Cost Calculation (v1.0.5)

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `calculateMintCost(...)` | 5 values | Calculate cost + slot usage | Free |

**v1.0.5 Breaking Change**: Now returns 5 values instead of 3!

### Admin Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `isAdmin(address)` | bool | Check admin status | Free |
| `getAdmins()` | address[] | Get all admin addresses | Free |
| `owner()` | address | Get contract owner | Free |

---

## Network Configuration

### Environment Setup

ForeverMinter requires network-specific addresses for token contracts.

#### Detecting Network

```javascript
// Using Hedera SDK
const client = Client.forTestnet(); // or Client.forMainnet()
const networkName = client._network.name;

// Using wallet connection
const network = walletData.network; // "testnet" or "mainnet"
```

#### Token Addresses by Network

```javascript
const NETWORK_CONFIG = {
  testnet: {
    lazyToken: "0.0.6841468",
    lazyGasStation: "0.0.7092284",
    prngContract: "0.0.7091122",
    delegateRegistry: "0.0.7091124",
    // Discount NFT collections (project-specific)
    lshGen1: "0.0.XXXXX",
    lshGen2: "0.0.XXXXX"
  },
  mainnet: {
    lazyToken: process.env.LAZY_TOKEN_ID,
    lazyGasStation: process.env.LAZY_GAS_STATION_CONTRACT_ID,
    prngContract: process.env.PRNG_CONTRACT_ID,
    delegateRegistry: process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
    lshGen1: process.env.LSH_GEN1_TOKEN_ID,
    lshGen2: process.env.LSH_GEN2_TOKEN_ID
  }
};

// Usage
const config = NETWORK_CONFIG[networkName];
```

#### Contract Addresses

ForeverMinter contract address should be configurable per deployment:

```javascript
const FOREVER_MINTER_ADDRESS = process.env.FOREVER_MINTER_CONTRACT_ID;
```

### Token Associations

Users must associate tokens before transacting.

#### Required Associations

1. **NFT Collection**: The token ForeverMinter distributes (to receive minted NFTs)
2. **LAZY Token**: If paying with LAZY (to transfer LAZY)
3. **Discount NFTs**: If using holder discounts (should already own)

#### Checking Associations

```javascript
async function checkTokenAssociations(accountId, nftToken, needsLazy) {
  const requiredTokens = [nftToken];
  
  if (needsLazy) {
    requiredTokens.push(config.lazyToken);
  }
  
  // Query mirror node
  const balances = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/tokens`
  ).then(r => r.json());
  
  const associatedTokens = new Set(
    balances.tokens.map(t => t.token_id)
  );
  
  const missingAssociations = requiredTokens.filter(
    tokenId => !associatedTokens.has(tokenId)
  );
  
  return {
    allAssociated: missingAssociations.length === 0,
    missingAssociations
  };
}
```

#### Pre-Mint Association Check

```javascript
async function validateUserCanMint(userAddress) {
  const economics = await contract.getEconomics();
  
  // Check NFT association
  const nftToken = await contract.NFT_TOKEN();
  const hasNFT = await checkAssociation(userAddress, nftToken);
  
  if (!hasNFT) {
    return {
      canMint: false,
      reason: "NFT token not associated",
      action: "associate",
      tokenId: nftToken
    };
  }
  
  // Check LAZY association if required
  if (economics.mintPriceLazy > 0 && !economics.lazyFromContract) {
    const lazyDetails = await contract.getLazyDetails();
    const hasLazy = await checkAssociation(userAddress, lazyDetails.lazyToken);
    
    if (!hasLazy) {
      return {
        canMint: false,
        reason: "LAZY token not associated",
        action: "associate",
        tokenId: lazyDetails.lazyToken
      };
    }
  }
  
  return { canMint: true };
}
```

---

## Error Handling

### Contract Error Codes

ForeverMinter uses custom errors for specific failure conditions.

#### Common Errors

| Error | Trigger Condition | User Message | UI Action |
|-------|------------------|--------------|-----------|
| `MintedOut()` | Pool is empty | "Sold out! No NFTs available" | Disable mint, show sold out |
| `NotEnoughHbar()` | Insufficient HBAR sent | "Insufficient HBAR payment" | Show correct price |
| `NotEnoughLazy()` | Insufficient LAZY balance/approval | "Insufficient LAZY balance or approval" | Check balance & approval |
| `MintPaused()` | Minting is paused | "Minting is currently paused" | Show pause message |
| `MintNotStarted()` | Before mint start time | "Minting starts at [time]" | Show countdown |
| `WhitelistOnly()` | WL-only mode, user not WL | "Whitelist required to mint" | Show WL purchase option |
| `InvalidQuantity()` | Quantity is 0 or invalid | "Invalid mint quantity" | Validate input |
| `ExceedsMaxMint()` | Quantity > maxMint | "Max 50 NFTs per transaction" | Show limit |
| `ExceedsMaxMintPerWallet()` | User hit wallet limit | "You've reached your mint limit" | Show current count |
| `ExceedsMaxWlMint()` | WL user exceeds limit | "You've reached your whitelist limit" | Show WL count |
| `DiscountSerialNotOwned(serial)` | User doesn't own discount NFT | "You don't own NFT #[serial]" | Refresh ownership |
| `DiscountSerialMaxUsesReached(serial)` | Serial discount exhausted | "NFT #[serial] discount fully used" | Show remaining uses |
| `SacrificeSerialNotOwned(serial)` | User doesn't own sacrifice NFT | "You don't own NFT #[serial] for sacrifice" | Verify ownership |
| `ExceedsMaxSacrifice()` | Too many sacrifice NFTs | "Max 20 NFTs can be sacrificed per transaction" | Show limit |
| `RefundWindowExpired()` | Refund after window closes | "Refund window has expired" | Show deadline |
| `InvalidRefundSerial(serial)` | Serial not mintable via contract | "NFT #[serial] not eligible for refund" | Check eligibility |

#### Transaction Failure Patterns

**Pattern 1: Insufficient Payment**

```javascript
try {
  const tx = await contract.mintNFT(5, [], [], [], { value: tooLow });
  await tx.wait();
} catch (error) {
  if (error.message.includes("NotEnoughHbar")) {
    // Calculate correct amount
    const [correct, ,] = await contract.calculateMintCost(user, 5, [], [], 0);
    showError(`Insufficient HBAR. Need ${formatHbar(correct)}`);
  }
}
```

**Pattern 2: LAZY Approval**

```javascript
try {
  await contract.mintNFT(5, [], [], []);
} catch (error) {
  if (error.message.includes("NotEnoughLazy")) {
    showError("Please approve LAZY token spending in LazyGasStation");
    // Prompt user to approve
    const lazyDetails = await contract.getLazyDetails();
    await lazyToken.approve(lazyDetails.lazyGasStation, amount);
  }
}
```

**Pattern 3: Pool Empty**

```javascript
try {
  await contract.mintNFT(10, [], [], []);
} catch (error) {
  if (error.message.includes("MintedOut")) {
    showError("Collection sold out! Check back for refills.");
    disableMintButton();
  }
}
```

### Validation Helpers

Pre-validate user actions to provide better UX:

```javascript
async function validateMintAction(user, quantity, discountTokens, serials, sacrifice) {
  const errors = [];
  
  // Check pool supply
  const available = await contract.getRemainingSupply();
  if (quantity > available) {
    errors.push(`Only ${available} NFTs available`);
    return { valid: false, errors };
  }
  
  // Check timing
  const timing = await contract.getTiming();
  const now = Math.floor(Date.now() / 1000);
  
  if (timing.paused) {
    errors.push("Minting is currently paused");
  }
  
  if (now < timing.mintStart) {
    const countdown = timing.mintStart - now;
    errors.push(`Minting starts in ${formatTime(countdown)}`);
  }
  
  // Check whitelist if WL-only
  if (timing.wlOnly) {
    const wlSlots = await contract.whitelistSlots(user);
    if (wlSlots === 0) {
      errors.push("Whitelist required to mint");
    } else if (quantity > wlSlots) {
      errors.push(`You only have ${wlSlots} whitelist mints remaining`);
    }
  }
  
  // Check wallet limit
  const economics = await contract.getEconomics();
  if (economics.maxMintPerWallet > 0) {
    const minted = await contract.getWalletMintCount(user);
    const remaining = economics.maxMintPerWallet - minted;
    
    if (quantity > remaining) {
      errors.push(`You can only mint ${remaining} more NFTs`);
    }
  }
  
  // Check discount NFT ownership
  if (serials.length > 0) {
    for (let i = 0; i < serials.length; i++) {
      const token = discountTokens[i];
      const serialList = serials[i];
      
      for (const serial of serialList) {
        const owned = await checkOwnership(user, token, serial);
        if (!owned) {
          errors.push(`You don't own ${token}#${serial}`);
        }
      }
    }
  }
  
  // Check sacrifice NFT ownership
  if (sacrifice.length > 0) {
    const nftToken = await contract.NFT_TOKEN();
    for (const serial of sacrifice) {
      const owned = await checkOwnership(user, nftToken, serial);
      if (!owned) {
        errors.push(`You don't own NFT #${serial} for sacrifice`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

### Error Recovery Strategies

**Strategy 1: State Sync Recovery**

```javascript
async function recoverState() {
  try {
    const [supply, timing, economics, wlSlots, mintCount] = await Promise.all([
      contract.getRemainingSupply(),
      contract.getTiming(),
      contract.getEconomics(),
      contract.whitelistSlots(userAddress),
      contract.getWalletMintCount(userAddress)
    ]);
    
    updateUI({
      available: supply,
      paused: timing.paused,
      wlOnly: timing.wlOnly,
      wlRemaining: wlSlots,
      userMinted: mintCount
    });
    
    return true;
  } catch (error) {
    console.error("State recovery failed:", error);
    return false;
  }
}
```

**Strategy 2: Transaction Status Checking**

```javascript
async function checkTransactionStatus(txHash) {
  const receipt = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/transactions/${txHash}`
  ).then(r => r.json());
  
  if (receipt.result === "SUCCESS") {
    await recoverState();
    return { success: true, message: "Transaction completed" };
  } else {
    return { 
      success: false, 
      message: `Transaction failed: ${receipt.result}` 
    };
  }
}
```

**Strategy 3: Retry with Adjusted Gas**

```javascript
async function mintWithRetry(params, maxRetries = 2) {
  let gasLimit = 1000000; // Start with 1M
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const tx = await contract.mintNFT(...params, { 
        gasLimit,
        value: hbarAmount 
      });
      return await tx.wait();
    } catch (error) {
      if (error.message.includes("out of gas") && attempt < maxRetries - 1) {
        gasLimit = Math.floor(gasLimit * 1.5); // Increase 50%
        console.log(`Retrying with gas: ${gasLimit}`);
      } else {
        throw error;
      }
    }
  }
}
```

---

## Next Steps

Continue to **Part 2: Transaction Flows & Integration** for:
- Complete minting workflows (simple, holder discount, sacrifice)
- Whitelist purchase implementations  
- Refund system integration
- Cost calculation deep dive
- Admin operation guides
- Event handling and real-time updates
- Production-ready code examples
- Complete integration patterns

---

## Reference Links

- **Contract Source**: `contracts/ForeverMinter.sol`
- **Business Logic**: `docs/ForeverMinter-BUSINESS-LOGIC.md`
- **Design Spec**: `docs/ForeverMinter-DESIGN.md`
- **Testing Guide**: `docs/ForeverMinter-TESTING.md`
- **v1.0.5 Migration**: `docs/ForeverMinter-V1.0.5-MIGRATION.md`
- **Interaction Scripts**: `scripts/interactions/ForeverMinter/`

---

**Document Version:** 1.0.5  
**Last Updated:** October 26, 2025  
**Maintained By:** Burstall Development Team
