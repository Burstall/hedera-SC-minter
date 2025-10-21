# ForeverMinter - Pool-Based NFT Distribution Contract

## Version 1.0.5 | Hedera Smart Contract | Solidity 0.8.18

> **Status:** ✅ Production Ready  
> **Contract Size:** 18.874 KiB deployed (5.702 KiB headroom)  
> **Architecture:** v1.0 (Original Implementation)

---

## Overview

**ForeverMinter** is a sophisticated pool-based NFT distribution system that manages **existing** NFT collections with advanced discount mechanics and royalty compliance. Unlike standard minting contracts that create new tokens, ForeverMinter distributes pre-existing NFT serials from a managed pool.

### Key Differentiator
ForeverMinter **respects Hedera royalty fees** on all transfers, making it ideal for secondary distribution while maintaining creator royalties.

---

## Primary Use Cases

✅ **Pool-Based NFT Distribution**: Manage and distribute existing NFT collections  
✅ **Staking Rewards**: Users stake NFTs to earn from future sales  
✅ **Sacrifice Mechanics**: Burn old NFTs for discounts on new ones  
✅ **Complex Discount Systems**: Multiple discount tiers (Whitelist + Holder + Sacrifice)  
✅ **Holder Incentives**: NFT ownership-based discounts with usage tracking  
✅ **Large Collections**: Efficient recycling and distribution of extensive collections  
✅ **Secondary Markets**: Royalty-compliant resale mechanisms  

---

## Core Features

### 🎱 Serial Pool Management
- **EnumerableSet** of available NFT serials for O(1) operations
- Fed by: treasury deposits, user stakes, refunds
- Depleted by: mints
- PRNG-based selection for fairness
- Max batch: 50 NFTs per transaction

### 💸 Triple Discount System

**1. Whitelist Discount**
- Fixed percentage (e.g., 15% off)
- Purchasable with $LAZY tokens
- Can stack with Holder discount
- Per-wallet slot tracking

**2. Holder Discount**
- Based on NFT ownership
- Global per-serial usage tracking
- Multiple discount tiers (e.g., 10%, 20%, 30%)
- Prevents re-use across wallets
- Can stack with Whitelist discount

**3. Sacrifice Discount**
- **Exclusive** - Cannot stack with other discounts
- Burn existing NFTs for highest discount
- Burned NFTs permanently removed
- Max 20 NFTs per sacrifice transaction

### 💰 Dual Payment System
- **HBAR**: Direct payment to contract
- **$LAZY**: Via LazyGasStation integration (with burn percentage)
- **Hybrid**: Both payment types simultaneously
- Refund system for time-limited returns

### ♻️ Refund Mechanism
- Time-window based (configurable, e.g., 60 minutes)
- Partial refunds (e.g., 95% of paid amount)
- NFTs return to available pool
- Sacrifice NFTs **not** refundable (already burned)

### 👥 Multi-Admin System
- Role-based access control
- EnumerableSet for admin management
- Owner can add/remove admins
- Admins can manage pool (emergency only)

---

## Technical Architecture

### Inheritance Chain
```
ForeverMinter
  ├─ TokenStakerV2 (NFT staking & royalty-compliant transfers)
  ├─ Ownable (ownership & admin management)
  └─ ReentrancyGuard (mint/refund protection)
```

### Key Dependencies
- **TokenStakerV2**: Handles royalty-compliant NFT transfers
- **LazyGasStation**: Manages $LAZY token transfers and burns
- **IPrngGenerator**: Hedera VRF for random serial selection
- **LazyDelegateRegistry**: Delegation support (optional)

### Contract Parameters (Immutable)
```solidity
address public immutable nftToken;        // Token being distributed
address public immutable prngGenerator;   // PRNG for randomness
```

---

## How It Works

### 1. Pool Initialization
Admin deposits NFT serials into the contract's available pool via staking or direct transfer.

### 2. User Minting Flow
1. **Calculate Cost**: Frontend calls `calculateMintCost()` to get pricing
2. **Apply Discounts**: 
   - Check WL slots available
   - Check holder discounts (via owned NFTs)
   - Calculate sacrifice discount if burning NFTs
3. **Payment**: User sends HBAR and/or $LAZY
4. **Serial Selection**: PRNG selects random serial(s) from pool
5. **Transfer**: NFTs transferred with royalty compliance
6. **Tracking**: Payment amounts recorded for refund system

### 3. Discount Calculation Waterfall
```
Base Price → WL Discount → Holder Discount → Final Price
                    OR
Base Price → Sacrifice Discount → Final Price (exclusive)
```

### 4. Refund Flow
- User calls `refundNFT()` within time window
- Contract calculates refund (e.g., 95% of actual paid)
- NFT returns to available pool
- Payment returned to user (HBAR and/or $LAZY)

---

## Key Structs

### MintCostResult
```solidity
struct MintCostResult {
    uint256 hbarCost;           // Total HBAR to pay
    uint256 lazyCost;           // Total $LAZY to pay
    uint256 totalDiscount;      // Total discount applied (%)
    uint256 holderSlotsUsed;    // Holder slots consumed
    uint256 wlSlotsUsed;        // WL slots consumed
}
```

### MintPayment
```solidity
struct MintPayment {
    uint256 hbarPaid;           // Actual HBAR paid
    uint256 lazyPaid;           // Actual $LAZY paid
    uint256 timestamp;          // For refund window
}
```

### DiscountTier
```solidity
struct DiscountTier {
    uint256 tokenSerial;        // NFT serial that grants discount
    uint256 discountPercentage; // Discount % (e.g., 15 = 15%)
}
```

---

## Custom Errors (v1.0.5)

ForeverMinter uses custom errors for gas efficiency:

### Pool & Supply Errors
- `PoolEmpty()` - No serials available for minting
- `SerialNotAvailable(uint256 serial)` - Requested serial not in pool
- `InsufficientSerials()` - Not enough serials for batch mint

### Payment Errors
- `InsufficientPayment(uint256 required, uint256 provided)` - Underpayment
- `ExcessPayment(uint256 excess)` - Overpayment (refund failed)
- `PaymentTransferFailed()` - HBAR or $LAZY transfer failed

### Discount Errors
- `InsufficientWLSlots(uint256 requested, uint256 available)` - Not enough WL slots
- `InsufficientHolderSlots(uint256 requested, uint256 available)` - Holder discount depleted
- `SacrificeDiscountNotAvailable()` - Cannot use sacrifice discount
- `DiscountAlreadyUsed(uint256 serial)` - Holder discount already consumed

### Refund Errors
- `RefundWindowClosed(uint256 mintTime, uint256 deadline)` - Too late for refund
- `NoRefundAvailable(uint256 serial)` - Serial not eligible for refund
- `RefundFailed()` - Refund transfer failed

### Access Errors
- `NotAdmin()` - Caller is not admin
- `NotOwner()` - Only owner can perform action
- `ZeroAddress()` - Invalid address provided

---

## Events

### Minting Events
```solidity
event NFTMinted(
    address indexed user,
    uint256 indexed serial,
    uint256 hbarPaid,
    uint256 lazyPaid,
    uint256 discountApplied
);

event BatchMinted(
    address indexed user,
    uint256[] serials,
    uint256 totalHbar,
    uint256 totalLazy,
    uint256 averageDiscount
);
```

### Pool Events
```solidity
event SerialAdded(uint256 indexed serial);
event SerialRemoved(uint256 indexed serial);
event PoolRefilled(address indexed admin, uint256 count);
```

### Refund Events
```solidity
event NFTRefunded(
    address indexed user,
    uint256 indexed serial,
    uint256 hbarRefunded,
    uint256 lazyRefunded
);
```

### Discount Events
```solidity
event DiscountApplied(
    address indexed user,
    string discountType,
    uint256 percentage
);

event HolderDiscountUsed(
    uint256 indexed serial,
    address indexed user,
    uint256 discountPercentage
);

event SacrificeCompleted(
    address indexed user,
    uint256[] sacrificedSerials,
    uint256 discountEarned
);
```

---

## Comprehensive Documentation

ForeverMinter has extensive documentation in the `docs/` folder:

### 📄 Available Documents

1. **[ForeverMinter-SUMMARY.md](docs/ForeverMinter-SUMMARY.md)**
   - Overview of all documentation
   - Quick reference guide
   - Implementation roadmap
   - Version history

2. **[ForeverMinter-DESIGN.md](docs/ForeverMinter-DESIGN.md)**
   - Complete technical specification
   - Architecture details
   - Function-by-function implementation
   - Gas optimization strategies
   - **Audience:** Developers, Auditors

3. **[ForeverMinter-BUSINESS-LOGIC.md](docs/ForeverMinter-BUSINESS-LOGIC.md)**
   - User guide (plain English)
   - All discount types explained with examples
   - Payment calculation walkthroughs
   - 40+ FAQ entries
   - **Audience:** Frontend Developers, Users

4. **[ForeverMinter-TODO.md](docs/ForeverMinter-TODO.md)**
   - 23-phase implementation checklist
   - ~300 checkboxes for tracking progress
   - Time estimates and priorities
   - **Audience:** Implementation Team

5. **[ForeverMinter-TESTING.md](docs/ForeverMinter-TESTING.md)**
   - Comprehensive test plan
   - 200+ test cases specified
   - Unit, integration, and security tests
   - Coverage goals (>95%)
   - **Audience:** QA Engineers

6. **[ForeverMinter-IMPLEMENTATION-SUMMARY.md](docs/ForeverMinter-IMPLEMENTATION-SUMMARY.md)**
   - Implementation progress tracking
   - Deployment details
   - **Audience:** Project Managers

---

## Quick Start Examples

### Cost Calculation
```javascript
// Get mint cost with discounts
const result = await foreverMinter.calculateMintCost(
    userAddress,
    quantity,
    useHolderDiscount,
    useSacrifice
);

console.log(`HBAR Cost: ${result.hbarCost}`);
console.log(`LAZY Cost: ${result.lazyCost}`);
console.log(`Discount: ${result.totalDiscount}%`);
console.log(`Holder Slots Used: ${result.holderSlotsUsed}`);
console.log(`WL Slots Used: ${result.wlSlotsUsed}`);
```

### Minting with HBAR
```javascript
await foreverMinter.mintNFT(
    quantity,
    0,                  // 0 = use HBAR only
    useHolderDiscount,
    useSacrifice,
    sacrificeSerials,   // NFTs to burn
    { value: hbarCost }
);
```

### Minting with $LAZY
```javascript
// First approve LazyGasStation
await lazyToken.approve(lazyGasStationAddress, lazyCost);

// Mint using $LAZY
await foreverMinter.mintNFT(
    quantity,
    lazyCost,           // Amount of $LAZY to use
    useHolderDiscount,
    useSacrifice,
    sacrificeSerials
);
```

### Refunding NFT
```javascript
// Within refund window
await foreverMinter.refundNFT(serialNumber);
// Returns 95% of HBAR/LAZY paid, NFT returns to pool
```

---

## Configuration

### Admin Functions
```solidity
// Pool management
addSerialToPool(uint256 serial)
removeSerialFromPool(uint256 serial)
batchAddSerials(uint256[] serials)

// Pricing
setBasePrice(uint256 hbar, uint256 lazy)
setWLPrice(uint256 lazy)
setWLDiscount(uint256 percentage)

// Discounts
setHolderDiscounts(DiscountTier[] tiers)
setSacrificeDiscount(uint256 percentage)

// Timing
setRefundWindow(uint256 seconds)
setRefundPercentage(uint256 percentage)

// Admin management
addAdmin(address admin)
removeAdmin(address admin)
```

---

## Comparison with Other Contracts

| Feature | ForeverMinter | MinterContract | SoulboundMinter |
|---------|---------------|----------------|-----------------|
| **Token Type** | Existing NFTs | New NFTs | New Soulbound NFTs |
| **Distribution** | Pool-based | On-demand mint | On-demand mint |
| **Royalties** | ✅ Respected | ❌ Bypassed | ❌ N/A (frozen) |
| **Transferable** | ✅ Yes | ✅ Yes | ❌ No (frozen) |
| **Discount Types** | 3 (WL + Holder + Sacrifice) | 1 (WL only) | 1 (WL only) |
| **Discount Stacking** | ✅ WL+Holder | ❌ No | ❌ No |
| **Sacrifice System** | ✅ Yes (burn NFTs) | ❌ No | ❌ No |
| **Refund System** | ✅ Pool return | ✅ Burn-based | ✅ Burn-based |
| **Admin System** | Multi-admin | Owner only | Owner only |
| **Max Batch** | 50 NFTs | Unlimited | Unlimited |
| **Payment Types** | HBAR + $LAZY | HBAR + $LAZY | HBAR + $LAZY |
| **Use Case** | Pool distribution | Standard sales | Badges/Certificates |

### When to Use ForeverMinter

✅ **Distributing existing NFT collections** (not creating new tokens)  
✅ **Respecting creator royalties** is critical  
✅ **Complex discount mechanics** needed (holder incentives, sacrifice)  
✅ **Staking/recycling systems** for NFT collections  
✅ **Multiple discount tiers** and stacking logic  
✅ **Large collections** requiring efficient distribution  
✅ **Multi-admin team** management  

---

## Version History

### Version 1.0.5 (October 2025) - Current
**Status:** Production Ready

**Key Changes:**
- ✅ DRY Architecture Refactoring (single-source-of-truth for slot consumption)
- ✅ `calculateMintCost()` returns 5 values (added holderSlotsUsed, wlSlotsUsed)
- ✅ New `MintCostResult` struct to avoid stack-too-deep errors
- ✅ Fixed holder/WL slot over-consumption edge cases
- ✅ Eliminated duplicate waterfall logic in mintNFT

**Technical Improvements:**
- Contract size: 18.874 KiB (optimized)
- Enhanced maintainability via DRY principles
- Simplified mintNFT logic

**Breaking Changes:**
- `calculateMintCost()` signature changed from 3 to 5 return values
  - **Old:** `(uint256 hbar, uint256 lazy, uint256 discount)`
  - **New:** `(uint256 hbar, uint256 lazy, uint256 discount, uint256 holderSlots, uint256 wlSlots)`

### Version 1.0.4
- Initial working implementation
- Known slot consumption issues (fixed in 1.0.5)

### Version 1.0
- Original specification and design
- Full feature set documented

---

## Testing

```bash
# Run ForeverMinter tests
npm run test-forever

# Compile all contracts
npx hardhat compile

# Check contract sizes
npx hardhat compile --force
```

---

## Support & Resources

### Documentation
- **This File**: Quick reference and overview
- **docs/ForeverMinter-DESIGN.md**: Complete technical specification
- **docs/ForeverMinter-BUSINESS-LOGIC.md**: User guide and examples
- **docs/ForeverMinter-TESTING.md**: Test plan and coverage

### Related Contracts
- **MinterContract**: Standard transferable NFT minting
- **SoulboundMinter**: Non-transferable badge minting
- **SoulboundBadgeMinter**: Multi-badge soulbound system
- **TokenStakerV2**: Underlying staking mechanism (parent contract)

### Community
- **GitHub**: [Burstall/hedera-SC-minter](https://github.com/Burstall/hedera-SC-minter)
- **Branch**: refactor-base-minter

---

**Last Updated:** October 2025  
**Contract Version:** 1.0.5  
**Solidity Version:** 0.8.18  
**Status:** ✅ Production Ready
