# ForeverMinter Interaction Scripts

Comprehensive CLI tools for interacting with the ForeverMinter v1.0.5 smart contract.

## Overview

ForeverMinter is an NFT distribution system with advanced discount mechanisms:
- **Waterfall Discount System**: Progressive discount application (Sacrifice → Holder → WL → Full Price)
- **Whitelist Slots**: Per-address slot grants for WL discounts
- **Holder Discounts**: Multi-tier discount system based on holding specific NFTs
- **Sacrifice Mechanism**: Trade existing NFTs for new ones with discount
- **Refund System**: Time-based refund window with percentage-based refunds

## Quick Start

### Configuration

Set up your `.env` file with:
```env
ACCOUNT_ID=0.0.xxxxx
PRIVATE_KEY=xxxxxx
CONTRACT_ID=0.0.xxxxx
ENVIRONMENT=TEST  # or MAIN, PREVIEW, LOCAL
```

### Basic Usage

**Mint NFTs:**
```bash
node scripts/interactions/ForeverMinter/mint.js
```
Interactive flow will guide you through:
1. Token association check
2. Discount token selection (if any available)
3. Sacrifice selection (if any eligible NFTs)
4. Cost preview
5. Allowance setup
6. Final confirmation

**Check Mint Cost:**
```bash
node scripts/interactions/ForeverMinter/checkMintCost.js 5
```

**Refund NFTs:**
```bash
node scripts/interactions/ForeverMinter/refund.js 123 456 789
```

**View Contract Info:**
```bash
node scripts/interactions/ForeverMinter/getContractInfo.js
```

## User Scripts

### Minting & Purchasing

| Script | Description | Usage |
|--------|-------------|-------|
| `mint.js` | Interactive minting with discount selection | `node mint.js [quantity]` |
| `checkMintCost.js` | Preview mint cost before purchasing | `node checkMintCost.js <quantity>` |
| `refund.js` | Refund NFTs within refund window | `node refund.js <serial1> [serial2] ...` |
| `buyWhitelistSlots.js` | Purchase WL slots with LAZY tokens | `node buyWhitelistSlots.js [quantity]` |

### Query Scripts

| Script | Description | Usage |
|--------|-------------|-------|
| `getContractInfo.js` | View contract configuration | `node getContractInfo.js` |
| `getPoolStatus.js` | Check available NFTs in pool | `node getPoolStatus.js` |
| `checkDiscounts.js` | View your available discounts | `node checkDiscounts.js [address]` |
| `checkWLSlots.js` | View WL slot balance | `node checkWLSlots.js [address]` |
| `checkRefundEligibility.js` | Check which NFTs are refundable | `node checkRefundEligibility.js <serial1> [serial2] ...` |
| `getMintHistory.js` | View your mint history | `node getMintHistory.js [address]` |

## Admin Scripts

### Configuration

| Script | Description | Usage |
|--------|-------------|-------|
| `configureEconomics.js` | Update prices and limits | `node configureEconomics.js` |
| `configureTiming.js` | Update timing and refund settings | `node configureTiming.js` |
| `pauseMinting.js` | Emergency pause toggle | `node pauseMinting.js [true\|false]` |

### Discount Management

| Script | Description | Usage |
|--------|-------------|-------|
| `addDiscountTier.js` | Add/update discount tier | `node addDiscountTier.js <token> <discount%> <maxUses>` |
| `removeDiscountTier.js` | Remove discount tier | `node removeDiscountTier.js <token>` |
| `viewDiscountTiers.js` | List all discount tiers | `node viewDiscountTiers.js` |

### Whitelist Management

| Script | Description | Usage |
|--------|-------------|-------|
| `addToWhitelist.js` | Grant WL slots to addresses | `node addToWhitelist.js <address> <slots>` |
| `batchAddWhitelist.js` | Grant slots to multiple addresses | `node batchAddWhitelist.js <file.json>` |
| `removeFromWhitelist.js` | Remove WL slots | `node removeFromWhitelist.js <address1> [address2] ...` |

### Pool Management

| Script | Description | Usage |
|--------|-------------|-------|
| `registerNFTs.js` | Register NFTs already in contract | `node registerNFTs.js <serial1> [serial2] ...` |
| `addNFTsToPool.js` | Donate/add NFTs to pool | `node addNFTsToPool.js <serial1> [serial2] ...` |
| `emergencyWithdraw.js` | Emergency withdraw NFTs | `node emergencyWithdraw.js <recipient> <serial1> [serial2] ...` |

### Financial

| Script | Description | Usage |
|--------|-------------|-------|
| `withdrawHbar.js` | Withdraw HBAR from contract | `node withdrawHbar.js <recipient> <amount>` |

### Admin Management

| Script | Description | Usage |
|--------|-------------|-------|
| `addAdmin.js` | Add new admin | `node addAdmin.js <address>` |
| `removeAdmin.js` | Remove admin | `node removeAdmin.js <address>` |
| `listAdmins.js` | List all admins | `node listAdmins.js` |

## Script Features

All scripts include:
- ✅ **Input validation** - Checks for valid parameters before execution
- ✅ **Association checks** - Auto-detects and prompts for token association
- ✅ **Allowance verification** - Checks and sets up required allowances
- ✅ **Interactive prompts** - User-friendly guided workflows
- ✅ **Cost previews** - Shows expected costs before confirmation
- ✅ **Gas estimation** - Calculates and displays expected gas costs
- ✅ **Transaction logging** - Detailed output with transaction IDs
- ✅ **Error handling** - Graceful error messages with helpful hints

## Mint Flow Example

```bash
$ node scripts/interactions/ForeverMinter/mint.js

🎯 ForeverMinter - Interactive Minting
========================================

📋 Checking token association...
✅ NFT Token (0.0.12345) is associated

📊 Loading contract configuration...
✅ Contract Info:
   - NFT Token: 0.0.12345
   - Available Supply: 487 NFTs
   - Mint Price: 1000 HBAR + 50 LAZY
   - Max Mint Per Transaction: 50
   - Refund Window: 1 hours (60% refund)

🔍 Checking available discounts...
✅ Found discount eligibility:
   1. GEN1 Token (0.0.11111): 50% discount, 3 uses available
   2. GEN2 Token (0.0.22222): 25% discount, 5 uses available

💰 You have 10 WL slots (10% discount, can stack with holder discounts)

📦 Checking NFTs you own for sacrifice option...
✅ Found 5 eligible NFTs for sacrifice (30% discount, exclusive)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

How many NFTs do you want to mint? (1-50): 10

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💎 DISCOUNT SELECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Would you like to use holder discount serials? (y/N): y

Select holder discounts (enter serial numbers, or 'done' when finished):
Available: GEN1 [serial 5, 12, 23] | GEN2 [serial 3, 7, 8, 15, 22]

Enter serial (or 'done'): 5
✅ Added GEN1 #5 (50% discount, 3 uses)
Discounts collected: 3 slots @ 50% (covers 3 NFTs)

Enter serial (or 'done'): 12
✅ Added GEN1 #12 (50% discount, 3 uses)
Discounts collected: 6 slots @ 50% (covers 6 NFTs)

Enter serial (or 'done'): 3
✅ Added GEN2 #3 (25% discount, 5 uses)
Discounts collected: 11 slots (6@50%, 5@25%) - enough for all 10 NFTs!

Enter serial (or 'done'): done

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 SACRIFICE OPTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Would you like to sacrifice any NFTs for 30% discount? (y/N): n

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 COST CALCULATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Calculating final cost...

Waterfall Discount Breakdown:
   6 NFTs @ 60% discount (50% holder + 10% WL, stacked)  = 2,400 HBAR + 120 LAZY
   4 NFTs @ 35% discount (25% holder + 10% WL, stacked)  = 2,600 HBAR + 130 LAZY
   0 NFTs @ 0% discount (full price)                     = 0 HBAR + 0 LAZY
   ──────────────────────────────────────────────────────────────────────────
   TOTAL COST:                                             5,000 HBAR + 250 LAZY
   
   Weighted Average Discount: 50%
   You save: 5,000 HBAR + 250 LAZY

Holder slots to be consumed: 10 (GEN1: 6 uses, GEN2: 4 uses)
WL slots to be consumed: 10 (all stacked with holder discounts)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔐 ALLOWANCE SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking HBAR allowance...
✅ HBAR allowance sufficient (100 HBAR approved to contract)

Checking LAZY allowance...
⚠️  LAZY allowance insufficient
   Required: 250 LAZY to LazyGasStation (0.0.99999)
   Current: 0 LAZY

Setting up LAZY allowance...
✅ LAZY allowance approved (tx: 0.0.xxxxx@1234567890.123456789)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 FINAL SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Minting 10 NFTs with:
   - Holder Discounts: GEN1 #5, GEN1 #12, GEN2 #3
   - WL Slots: 10 (all stacked with holder)
   - Sacrifice: None
   
Total Cost: 5,000 HBAR + 250 LAZY
Average Discount: 50%

Estimated Gas: ~450,000 gas

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Proceed with minting? (y/N): y

🎯 Minting NFTs...

✅ SUCCESS! Minted 10 NFTs
   Serials: [1023, 1024, 1025, 1026, 1027, 1028, 1029, 1030, 1031, 1032]
   Transaction ID: 0.0.xxxxx@1234567890.123456789
   
💰 Payment:
   HBAR Paid: 5,000 HBAR
   LAZY Paid: 250 LAZY (12.5 LAZY burned, 237.5 LAZY to contract)

📊 Discount Slots Consumed:
   GEN1 #5: 3 uses consumed (0 remaining)
   GEN1 #12: 3 uses consumed (0 remaining)
   GEN2 #3: 4 uses consumed (1 remaining)
   WL Slots: 10 consumed (0 remaining)

⏰ Refund eligible until: 2025-10-19 15:30:00 (1 hour)
   Refund amount: 60% (3,000 HBAR + 150 LAZY)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 Minting complete! Enjoy your NFTs!
```

## Tips

- **Check costs first**: Use `checkMintCost.js` to see final costs before minting
- **Association**: Always check token association before minting
- **Allowances**: Set HBAR allowance = (number of NFTs) × 10 HBAR for safety
- **Discounts**: Sort your discount tokens by tier (highest discount first) for optimal usage
- **Sacrifice**: Sacrifice is exclusive - you can't combine with holder/WL discounts
- **Refunds**: Refund window starts immediately after mint - check eligibility with `checkRefundEligibility.js`

## Troubleshooting

**Error: Token not associated**
```bash
# Associate the NFT token first
node scripts/interactions/ForeverMinter/getContractInfo.js
# Copy the NFT token ID and associate it via HashPack or Kabila
```

**Error: Insufficient allowance**
```bash
# The mint script will automatically offer to set allowances
# Or manually set via wallet interface
```

**Error: MintPaused**
```bash
# Minting is currently paused by admin
# Check contract info for status
node scripts/interactions/ForeverMinter/getContractInfo.js
```

## Support

For issues or questions:
1. Check contract info with `getContractInfo.js`
2. Review this README
3. Check the main project documentation
4. Contact the development team

---

**Happy Minting!** 🎉
