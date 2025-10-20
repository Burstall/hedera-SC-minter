# ForeverMinter - Business Logic & User Guide

## Overview

ForeverMinter is a next-generation NFT distribution system that allows projects to manage a pool of existing NFTs and distribute them to users with sophisticated pricing mechanics. Unlike traditional minting, ForeverMinter respects marketplace royalties and offers flexible discount structures.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Pricing Mechanics](#pricing-mechanics)
3. [Discount System](#discount-system)
4. [Sacrifice Mechanism](#sacrifice-mechanism)
5. [Refund System](#refund-system)
6. [User Workflows](#user-workflows)
7. [FAQ](#faq)

---

## How It Works

### The Pool

Think of ForeverMinter as a vending machine for NFTs. Instead of creating new NFTs, it holds a pool of existing ones and distributes them randomly.

**Pool Sources:**
1. **Treasury Deposits:** Project sends NFTs to contract
2. **User Donations:** Anyone can add NFTs to the pool
3. **Refunded NFTs:** Returned NFTs go back in the pool
4. **Sacrificed NFTs:** If configured, sacrificed NFTs return to pool

**Random Distribution:**
- When you mint, the contract uses a random number generator
- You get random serials from the available pool
- No way to predict which serial you'll receive
- Fair distribution ensures no one can "snipe" rare serials

---

## Pricing Mechanics

### Base Price

Every NFT has a base price set by the project:
- **HBAR Price:** e.g., 1,000 HBAR
- **LAZY Price:** e.g., 50,000 LAZY
- Prices can be set independently (HBAR only, LAZY only, or both)

### Payment Options

1. **HBAR Only:** Pay in HBAR
2. **LAZY Only:** Pay in $LAZY token
3. **Hybrid:** Some projects require both

**Example:**
```
Base Price: 1,000 HBAR + 10,000 LAZY
You pay: 1,000 HBAR AND 10,000 LAZY per NFT
```

### LAZY Burn Mechanism

When you pay with $LAZY:
- A percentage is automatically burned (e.g., 20%)
- Reduces total supply
- Handled by LazyGasStation contract
- You must approve LazyGasStation (NOT ForeverMinter) to spend your LAZY

---

## Discount System

### Three Types of Discounts

#### 1. Whitelist (WL) Discount

**How to Get WL:**
- Project adds you manually, OR
- Purchase WL spot with $LAZY

**How It Works:**
- Fixed discount percentage (e.g., 10%)
- Applies to all your mints
- Can be combined with holder discounts
- Cannot be combined with sacrifice discount

**Example:**
```
Base Price: 1,000 HBAR
WL Discount: 10%
Your Price: 900 HBAR per NFT
```

**Purchasing WL with LAZY:**
```solidity
// Project sets cost (e.g., 50,000 LAZY for WL spot)
Call: buyWlWithLazy()
Result: You're added to whitelist, LAZY is burned
```

#### 2. Holder Discounts (NFT-Based)

**Concept:**
- Own certain NFTs = get discounts
- Each NFT serial has a "discount capacity"
- Discounts are attached to the NFT, not your wallet

**Configuration Example:**
```
LSH Generation 1:
- Discount: 25%
- Uses per serial: 8 mints

LSH Generation 2:
- Discount: 10%
- Uses per serial: 3 mints
```

**How It Works:**

1. **Check Your Discounts:**
   - Frontend queries: Which NFTs do you own?
   - Contract returns: How many discount uses each has left

2. **Use Discounts:**
   - You specify which NFT serials to use for discounts
   - Contract checks: Do you own them? Any uses left?
   - Applies discount to as many mints as possible

3. **Discount Tracking:**
   - Each use is recorded globally per serial
   - If you sell the NFT, new owner gets remaining uses
   - No double-dipping (same serial can't be used beyond its limit)

**Example Scenario:**

You own LSH Gen1 #1234:
- Max uses: 8
- Previous owner used: 3
- Remaining: 5 uses

You mint 2 NFTs:
- Uses Gen1 #1234 for both
- Remaining after: 3 uses
- You sell Gen1 #1234 to Alice
- Alice can use the remaining 3 discounts

**Stacking with WL:**

Holder discounts STACK with WL discounts!

```
Base Price: 1,000 HBAR
WL Discount: 10%
Holder Discount: 25%
Total Discount: 35%
Your Price: 650 HBAR per NFT
```

**Multiple Holder Discounts:**

If you own multiple discount NFTs, they're used in the order you provide:

```
You own:
- 2x LSH Gen1 (25% off, 8 uses each = 16 total)
- 1x LSH Gen2 (10% off, 3 uses)

You mint 20 NFTs:
- First 16 at 25% off (using both Gen1s)
- Next 3 at 10% off (using Gen2)
- Last 1 at base price
```

**Important:**
- You must OWN the discount NFT at mint time
- You can use the same NFT across multiple mint transactions (until uses exhausted)
- Discounts don't expire (only use count matters)

#### 3. Sacrifice Discount

**Concept:**
- Sacrifice existing NFTs for a bigger discount
- Get new random NFTs in return
- "Re-rolling" mechanism

**How It Works:**

1. **Sacrifice Requirement:**
   - You must sacrifice EXACTLY the number of NFTs you're minting
   - Example: Want 5 new NFTs? Sacrifice 5 old ones

2. **Discount Applied:**
   - Typically higher than other discounts (e.g., 50%)
   - Applies to all minted NFTs

3. **What Happens to Sacrificed NFTs:**
   - Option A: Go to specific address (e.g., burn wallet)
   - Option B: Return to pool (project config)

**Exclusive Rule:**
- Sacrifice discount CANNOT be combined with WL or holder discounts
- It's either sacrifice mode OR discount mode, not both

**Example:**

```
Base Price: 1,000 HBAR
Sacrifice Discount: 50%

You sacrifice 5 NFTs:
- Cost: 5 × (1,000 × 50%) = 2,500 HBAR
- You receive: 5 random new NFTs
- Your old 5 NFTs: Sent to sacrifice destination
```

**Use Cases:**

1. **Don't Like Your Roll:**
   - Minted #1234 but want something different
   - Sacrifice it for 50% discount on new mint
   - Get random new serial

2. **Bulk Re-rolling:**
   - Have 10 NFTs you don't want
   - Sacrifice all 10 for 50% off 10 new ones
   - Pay 5,000 HBAR instead of 10,000 HBAR

3. **Strategic Play:**
   - If sacrifice destination is the pool itself
   - Your sacrificed NFTs might come back out (to others)
   - Effectively trading NFTs at 50% cost

---

## Payment Calculation Examples

### Scenario 1: Simple Mint (No Discounts)

```
Base: 1,000 HBAR + 10,000 LAZY
Quantity: 3 NFTs

Total Cost:
- HBAR: 3 × 1,000 = 3,000 HBAR
- LAZY: 3 × 10,000 = 30,000 LAZY
  (If 20% burn: 6,000 LAZY burned, 24,000 to contract)
```

### Scenario 2: WL Discount Only

```
Base: 1,000 HBAR
WL Discount: 10%
Quantity: 5 NFTs

Calculation:
- Discounted Price: 1,000 × (100% - 10%) = 900 HBAR
- Total: 5 × 900 = 4,500 HBAR
```

### Scenario 3: Holder Discount Only

```
Base: 1,000 HBAR
Own: 1× LSH Gen1 #100 (25% off, 3 uses left)
Quantity: 5 NFTs

Calculation:
- 3 NFTs with Gen1 discount: 3 × (1,000 × 75%) = 2,250 HBAR
- 2 NFTs at base price: 2 × 1,000 = 2,000 HBAR
- Total: 4,250 HBAR
```

### Scenario 4: WL + Holder (Stacking)

```
Base: 1,000 HBAR
WL Discount: 10%
Own: 1× LSH Gen1 #100 (25% off, 5 uses left)
Quantity: 3 NFTs

Calculation:
- Stacked Discount: 10% + 25% = 35%
- Price per NFT: 1,000 × (100% - 35%) = 650 HBAR
- Total: 3 × 650 = 1,950 HBAR
- Gen1 #100 uses remaining after: 5 - 3 = 2
```

### Scenario 5: Multiple Holders + WL

```
Base: 1,000 HBAR
WL Discount: 10%
Own:
- 1× LSH Gen1 #100 (25% off, 2 uses)
- 1× LSH Gen2 #200 (10% off, 3 uses)
Quantity: 6 NFTs

Calculation:
- 2 NFTs with Gen1 + WL: 2 × (1,000 × 65%) = 1,300 HBAR
- 3 NFTs with Gen2 + WL: 3 × (1,000 × 80%) = 2,400 HBAR
- 1 NFT with WL only: 1 × (1,000 × 90%) = 900 HBAR
- Total: 4,600 HBAR
```

### Scenario 6: Sacrifice (No Stacking)

```
Base: 1,000 HBAR
Sacrifice Discount: 50%
Sacrifice: 10 NFTs
Mint: 10 NFTs

Calculation:
- Price per NFT: 1,000 × 50% = 500 HBAR
- Total: 10 × 500 = 5,000 HBAR
- Plus: You must own the 10 NFTs to sacrifice
```

### Scenario 7: Complex Multi-Holder

```
Base: 1,000 HBAR
Not WL
Own:
- 2× LSH Gen1 (25% off, 8 uses each = 16 total)
- 3× LSH Gen2 (10% off, 3 uses each = 9 total)
Quantity: 30 NFTs

Calculation:
- 16 NFTs with Gen1: 16 × (1,000 × 75%) = 12,000 HBAR
- 9 NFTs with Gen2: 9 × (1,000 × 90%) = 8,100 HBAR
- 5 NFTs at base: 5 × 1,000 = 5,000 HBAR
- Total: 25,100 HBAR
```

---

## Refund System

### How Refunds Work

**Don't like what you got? Get a refund!**

**Eligibility:**
1. You must own the NFT
2. Must be within refund window (e.g., 60 minutes)
3. NFT must have been acquired via this contract

**Refund Amount:**
- Percentage of what you actually paid (e.g., 95%)
- Tracks your exact payment (accounts for any discounts)
- Refunded in same currencies (HBAR and/or LAZY)

**What Happens:**
1. You return the NFT to contract
2. NFT goes back into available pool
3. You receive refund
4. Your mint count decreases (frees up wallet limit)

### Refund Examples

**Example 1: Base Price Mint**
```
Minted 1 NFT for 1,000 HBAR
Refund window: 60 minutes
Refund percentage: 95%

Within 60 minutes:
- Return NFT
- Receive: 950 HBAR
- Contract keeps: 50 HBAR (5%)
```

**Example 2: Discounted Mint**
```
Minted with WL discount:
- Base: 1,000 HBAR
- WL discount: 10%
- Paid: 900 HBAR

Refund percentage: 95%
- Refund: 900 × 95% = 855 HBAR
- Not 1,000 HBAR! Only what you paid.
```

**Example 3: Multiple NFTs**
```
Minted 3 NFTs with different discounts:
- NFT #1: Paid 650 HBAR (WL+Holder)
- NFT #2: Paid 900 HBAR (WL only)
- NFT #3: Paid 1,000 HBAR (base)

Refund all 3:
- NFT #1: 650 × 95% = 617.5 HBAR
- NFT #2: 900 × 95% = 855 HBAR
- NFT #3: 1,000 × 95% = 950 HBAR
- Total: 2,422.5 HBAR
```

**Example 4: Sacrificed NFTs**
```
Sacrificed 5 NFTs, minted 5 new ones:
- Paid: 2,500 HBAR (50% discount)

Refund 2 of the new NFTs:
- Each paid: 500 HBAR
- Refund per NFT: 500 × 95% = 475 HBAR
- Total refund: 950 HBAR
- Original 5 sacrificed NFTs: NOT returned (they're gone)
```

### Refund Window

**Time-Based:**
- Starts when NFT is distributed
- Typical: 60 minutes
- Project configurable

**After Window Expires:**
- No refunds available
- NFT is yours permanently
- Sell on secondary market if unwanted

**Checking Eligibility:**
```
Call: getRefundInfo(serial)
Returns:
- eligible: true/false
- timeRemaining: seconds left
- refundHbar: amount you'd get
- refundLazy: amount you'd get
```

---

## User Workflows

### Workflow 1: Simple Mint (HBAR)

**Prerequisites:**
- Have enough HBAR

**Steps:**
1. Check available supply: `getAvailableSupply()`
2. Check price: `previewMintCost(yourAddress, quantity, [], [])`
3. Call `mintNFT(quantity, [], [])` with exact HBAR
4. Receive random NFT serials
5. Check your new NFTs in wallet

**Example Transaction:**
```javascript
// Mint 3 NFTs for 3,000 HBAR
mintNFT(
  3,           // _numberToMint
  [],          // _discountSerials (none)
  []           // _sacrificeSerials (none)
  { value: parseUnits("3000", 8) } // 3,000 HBAR in tinybar
)
```

### Workflow 2: Mint with LAZY

**Prerequisites:**
- Have enough $LAZY
- Approve LazyGasStation to spend your LAZY

**Steps:**
1. Approve LazyGasStation: `LAZY.approve(lazyGasStation, amount)`
2. Check price: `previewMintCost(...)`
3. Call `mintNFT(quantity, [], [])`
4. LAZY is transferred and burned automatically
5. Receive NFTs

**Important:** Approve LazyGasStation, NOT ForeverMinter!

### Workflow 3: Mint with Holder Discounts

**Prerequisites:**
- Own discount-eligible NFTs (e.g., LSH Gen1)
- Check discount availability

**Steps:**

1. **Get Your Discount NFTs:**
```javascript
// Query mirror node for your NFTs
myNFTs = [serial1, serial2, serial3]
```

2. **Check Discount Capacity:**
```javascript
// Ask contract about these serials
info = getBatchSerialDiscountInfo(myNFTs)
// Returns: eligible, remainingUses, discountPercent for each
```

3. **Plan Your Mint:**
```
You own Gen1 #100 with 5 uses left (25% off)
Want to mint 3 NFTs
All 3 will get 25% discount
```

4. **Execute Mint:**
```javascript
mintNFT(
  3,        // quantity
  [100],    // use Gen1 #100 for discounts
  []        // no sacrifice
  { value: hbarAmount }
)
```

5. **Verify:**
```
Gen1 #100 now has 2 uses remaining
```

### Workflow 4: Mint with WL + Holder

**Prerequisites:**
- Be on whitelist
- Own discount NFTs

**Steps:**

1. **Check Your Status:**
```javascript
isWL = isAddressWL(yourAddress)
// Returns: inWl=true, qty=10 (spots)
```

2. **Check Discounts:**
```javascript
discounts = getBatchSerialDiscountInfo([serial1, serial2])
```

3. **Preview Cost:**
```javascript
cost = previewMintCost(
  yourAddress,
  5,              // want 5 NFTs
  [serial1],      // use this for discount
  []
)
// Shows: Stacked discount applied (WL + Holder)
```

4. **Mint:**
```javascript
mintNFT(5, [serial1], [])
```

**Result:**
- Get 5 NFTs at stacked discount price
- WL spots decrease by 5
- Discount NFT uses decrease

### Workflow 5: Sacrifice Mint

**Prerequisites:**
- Own NFTs you want to sacrifice
- They must be from the same collection as ForeverMinter distributes

**Steps:**

1. **Select Sacrifices:**
```
Want to mint: 5 new NFTs
Must sacrifice: 5 existing NFTs
Choose serials: [111, 222, 333, 444, 555]
```

2. **Check Sacrifice Price:**
```javascript
cost = previewMintCost(
  yourAddress,
  5,              // quantity
  [],             // no holder discounts (exclusive)
  [111,222,333,444,555]  // sacrificing these
)
// Shows: 50% discount applied
```

3. **Approve NFT Transfer:**
```javascript
// Approve ForeverMinter to move your NFTs
NFT.setApprovalForAll(foreverMinterAddress, true)
```

4. **Execute Sacrifice:**
```javascript
mintNFT(
  5,
  [],             // no holder discounts allowed
  [111,222,333,444,555],
  { value: hbarAmount }
)
```

5. **Result:**
- Your 5 old NFTs: Sent to sacrifice destination
- You receive: 5 new random NFTs
- Paid: 50% of base price

### Workflow 6: Refund

**Prerequisites:**
- Own NFT from this contract
- Within refund window

**Steps:**

1. **Check Eligibility:**
```javascript
info = getRefundInfo(serial)
// Returns: eligible, timeRemaining, refundHbar, refundLazy
```

2. **Approve Return:**
```javascript
NFT.setApprovalForAll(foreverMinterAddress, true)
```

3. **Execute Refund:**
```javascript
refundNFT([serial])
```

4. **Receive Refunds:**
- HBAR sent to your wallet
- LAZY sent to your wallet
- NFT transferred to contract
- Goes back into available pool

### Workflow 7: Purchase WL with LAZY

**Prerequisites:**
- Have enough $LAZY
- WL purchase enabled by project

**Steps:**

1. **Check Cost:**
```javascript
economics = getMintEconomics()
// economics.buyWlWithLazy = cost in LAZY
```

2. **Approve LAZY:**
```javascript
LAZY.approve(lazyGasStation, amount)
```

3. **Purchase WL:**
```javascript
buyWlWithLazy()
```

4. **Verify:**
```javascript
isWL = isAddressWL(yourAddress)
// Now returns: inWl=true
```

---

## FAQ

### General Questions

**Q: What's the difference between this and regular minting?**

A: Regular minting creates new NFTs. ForeverMinter distributes existing NFTs from a pool. This allows for royalty compliance and secondary market integration.

**Q: Can I choose which serial I get?**

A: No. Selection is random via PRNG. This ensures fairness and prevents sniping rare serials.

**Q: What happens if the pool runs out?**

A: Minting fails with "MintedOut" error. Wait for admins to refill pool or for refunds to return NFTs to pool.

### Discount Questions

**Q: Can I stack all three discount types?**

A: No. Sacrifice is exclusive. WL and Holder discounts can stack together.

```
✅ WL + Holder
✅ Sacrifice only
❌ WL + Holder + Sacrifice
❌ Holder + Sacrifice
❌ WL + Sacrifice
```

**Q: If I use my discount NFT and then sell it, can the buyer use it again?**

A: Yes! Discounts are attached to the NFT, not your wallet. The new owner gets the remaining uses.

**Q: How do I know if my NFT has discount uses left?**

A: Call `getSerialDiscountInfo(serial)` or `getBatchSerialDiscountInfo([serial1, serial2, ...])`. It returns remaining uses.

**Q: Can I use multiple discount NFTs in one mint?**

A: Yes! List all serials in `_discountSerials` parameter. The contract uses them in order until capacity is exhausted.

**Q: What if my discount NFT only has 2 uses left but I'm minting 5?**

A: First 2 get the discount, remaining 3 at regular price (or WL price if applicable).

### Payment Questions

**Q: Do I need to approve ForeverMinter to spend my LAZY?**

A: No! Approve LazyGasStation instead. It handles the transfer and burn.

**Q: What if I send too much HBAR?**

A: Excess is automatically refunded in the same transaction.

**Q: Can I mint with only HBAR if the project requires both HBAR and LAZY?**

A: No. You must pay the full price in all required currencies.

**Q: What percentage of LAZY is burned?**

A: Project configurable. Typically 10-20%. Check `getLazyBurnPercentage()`.

### Sacrifice Questions

**Q: Do sacrificed NFTs count toward my mint limit?**

A: The new NFTs you receive count toward your mint limit, not the sacrificed ones.

**Q: Where do my sacrificed NFTs go?**

A: Depends on project config. Either:
- Back into the pool (you might get them back later!)
- Specific address (e.g., burn wallet, treasury)

Check `sacrificeDestination` to see.

**Q: Can I sacrifice NFTs from a different collection?**

A: No. Only NFTs from the same collection ForeverMinter distributes.

**Q: Can I sacrifice more NFTs than I'm minting?**

A: No. Must be exactly 1:1 ratio.

### Refund Questions

**Q: How long do I have to refund?**

A: Project configurable. Typical: 60 minutes. Check `getMintTiming().refundWindow`.

**Q: Do I get a full refund?**

A: No. Typically 90-95%. Check `getMintTiming().refundPercentage`.

**Q: If I got a discount, what do I get refunded?**

A: The actual amount you paid (discounted price), not the base price.

**Q: Can I refund just one NFT from a batch mint?**

A: Yes! Refund any or all NFTs individually.

**Q: What if I refund and then mint again with the same discount NFT?**

A: Your discount NFT uses that were consumed don't come back. Refunding only returns the minted NFT to pool, not discount capacity.

**Q: Can I refund sacrificed NFTs?**

A: You can refund the NEW NFTs you received, but your sacrificed NFTs are gone forever.

### Technical Questions

**Q: Why do I need to approve the contract before sacrificing or refunding?**

A: The contract needs permission to move NFTs from your wallet. Use `setApprovalForAll()`.

**Q: What's the max I can mint in one transaction?**

A: Typically 50 NFTs. Check `getMintEconomics().maxMint`.

**Q: What's the max I can sacrifice in one transaction?**

A: Typically 20 NFTs. Check `getMintEconomics().maxSacrifice`.

**Q: Is there a per-wallet mint limit?**

A: Potentially. Check `getMintEconomics().maxMintPerWallet`. 0 means unlimited.

**Q: How do I check how many I've minted?**

A: Call `getNumberMintedByAddress()` (requires your wallet connected).

**Q: Can I preview exactly how many discount slots will be consumed before minting? (v1.0.5)**

A: Yes! Call `calculateMintCost()` which returns 5 values:
1. Total HBAR cost
2. Total LAZY cost
3. Total discount percentage
4. **Holder discount slots that will be consumed**
5. **WL slots that will be consumed**

This lets frontends show users: "This mint will consume 3 uses from your Gen1 NFT and 2 WL slots."

Example:
```javascript
const [hbar, lazy, discount, holderSlots, wlSlots] = 
    await contract.calculateMintCost(user, quantity, discountSerials, []);

console.log(`You'll consume ${holderSlots} holder slots and ${wlSlots} WL slots`);
```

**Q: What changed in v1.0.5?**

A: Enhanced cost calculation to prevent slot over-consumption bugs:
- `calculateMintCost()` now returns 5 values instead of 3
- Added slot usage tracking to preview consumption
- Fixed edge cases where slots could be over-consumed
- Frontend devs: Update your contract calls to handle 5 return values!

### Troubleshooting

**Q: Transaction failed with "NotEnoughHbar"**

A: Send more HBAR. Check price with `previewMintCost()` first.

**Q: Transaction failed with "NotOwner"**

A: You don't own one of the NFTs you're trying to use (discount or sacrifice).

**Q: Transaction failed with "CannotMixSacrificeAndDiscount"**

A: Remove either sacrifice NFTs OR discount NFTs. Can't use both.

**Q: Transaction failed with "RefundWindowExpired"**

A: Too late for refund. Check timestamp with `getRefundInfo(serial)`.

**Q: Transaction failed with "DiscountAlreadyFullyUsed"**

A: The discount NFT you're trying to use has no uses left. Check with `getSerialDiscountInfo(serial)`.

---

## Summary

ForeverMinter offers a flexible, fair, and feature-rich NFT distribution system:

✅ **Fair:** Random selection prevents sniping
✅ **Flexible:** Multiple discount types
✅ **Forgiving:** Refund window for buyer's remorse
✅ **Innovative:** Sacrifice mechanism for re-rolling
✅ **Compliant:** Respects royalties
✅ **Transparent:** All parameters on-chain and queryable

Whether you're a casual minter or a discount optimizer, ForeverMinter has options for you!

---

**For Developers:** See `ForeverMinter-DESIGN.md` for technical specifications.

**For Admins:** See `ForeverMinter-TODO.md` for deployment checklist.

**For Testers:** See `ForeverMinter-TESTING.md` for test scenarios.
