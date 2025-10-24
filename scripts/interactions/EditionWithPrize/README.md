# EditionWithPrize Interaction Scripts

This directory contains all interaction scripts for the EditionWithPrize v1.0 contract.

## 📂 Directory Structure

```
EditionWithPrize/
├── README.md                      # This file
├── mint.js                        # Mint editions with HBAR/LAZY/USDC
├── selectWinner.js                # Select winner(s) after sold out (⚠️ gas warning)
├── claimPrize.js                  # Claim prize with winning serial
├── getContractState.js            # View full contract state
├── getWinnerList.js               # Display all winners and claim status
├── checkMintCost.js               # Calculate mint costs with WL discount
├── checkWLStatus.js               # Check whitelist eligibility
├── purchaseWLWithLazy.js          # Buy WL slots with LAZY
├── purchaseWLWithToken.js         # Buy WL slots with NFT serials
└── admin/                         # Owner-only functions
    ├── initializeEditionToken.js  # Initialize edition NFT collection
    ├── initializePrizeToken.js    # Initialize prize NFT collection
    ├── updateMintEconomics.js     # Configure pricing (HBAR/LAZY/USDC)
    ├── updateMintTiming.js        # Configure timing & pause
    ├── addToWhitelist.js          # Add addresses to whitelist
    ├── removeFromWhitelist.js     # Remove addresses from whitelist
    ├── setWlPurchaseOptions.js    # Configure WL purchase settings
    ├── setPause.js                # Pause/unpause minting
    ├── setWlOnly.js               # Toggle whitelist-only mode
    ├── withdrawHbar.js            # Withdraw HBAR proceeds
    ├── withdrawLazy.js            # Withdraw LAZY proceeds
    └── withdrawUsdc.js            # Withdraw USDC proceeds (both types)
```

## 🚀 Quick Start

### 1. Setup (Owner)
```bash
# Initialize tokens
node admin/initializeEditionToken.js
node admin/initializePrizeToken.js

# Configure economics
node admin/updateMintEconomics.js
node admin/updateMintTiming.js

# Optional: Setup whitelist
node admin/addToWhitelist.js
node admin/setWlPurchaseOptions.js

# Unpause minting
node admin/setPause.js
```

### 2. Minting (Users)
```bash
# Check mint cost
node checkMintCost.js

# Mint editions
node mint.js

# Purchase WL (if available)
node purchaseWLWithLazy.js
# or
node purchaseWLWithToken.js
```

### 3. Winner Selection & Prize Claiming
```bash
# After sold out - select winners
# ⚠️ IMPORTANT: Use 2-3x gas if prizeMaxSupply > 1
node selectWinner.js

# Winners claim prizes
node claimPrize.js
```

### 4. Withdrawal (Owner)
```bash
node admin/withdrawHbar.js
node admin/withdrawLazy.js
node admin/withdrawUsdc.js
```

## ⚠️ Important Notes

### Gas Requirements for Winner Selection
When `prizeMaxSupply > 1`, the `selectWinner()` function may require **2-3x the estimated gas** due to potential duplicate handling in the PRNG algorithm. The script will automatically apply this multiplier.

**Why?** The robust algorithm ensures exactly `prizeMaxSupply` unique winners even if PRNG returns duplicates, requiring additional iterations in worst-case scenarios.

### Bearer Asset Model
Winning edition serials are **bearer assets** - whoever owns the winning serial at claim time receives the prize, NOT the original owner at selection time. This creates a tradeable "winning ticket" NFT market.

### Payment Types
Contracts support three payment methods (individually or combined):
- **HBAR**: Native cryptocurrency
- **LAZY**: Fungible token with burn mechanism
- **USDC**: Dual-token support (native + bridged)

All payment types receive the same WL discount percentage.

## 📖 Script Details

### User Scripts

#### `mint.js`
Mint edition NFTs with automatic:
- Token association checking
- Payment method handling (HBAR/LAZY/USDC)
- WL discount application
- Gas estimation
- Balance verification

#### `selectWinner.js`
Select winner(s) using PRNG:
- **Permissionless** - anyone can call after sold out
- Automatically applies 2-3x gas multiplier for multiple winners
- Verifies EDITION_SOLD_OUT phase
- Returns winning serial array

#### `claimPrize.js`
Claim prize by exchanging winning edition:
- Verifies caller owns winning serial (bearer asset)
- Checks token association
- Wipes edition NFT
- Mints and transfers prize NFT
- Displays transaction details

#### `getContractState.js`
View complete contract state:
- Current phase
- Token addresses
- Supply information
- Economics (pricing, discounts)
- Timing (start time, pause state)
- Winning serials (if selected)

#### `checkMintCost.js`
Calculate exact mint costs:
- Check WL status automatically
- Show per-edition cost in HBAR/LAZY/USDC
- Display total for desired quantity
- Factor in discounts

### Admin Scripts

#### `initializeEditionToken.js`
Initialize edition NFT collection:
- Set name, symbol, memo
- Configure metadata CID
- Set max supply
- Configure royalties (supports multiple recipients)

#### `initializePrizeToken.js`
Initialize prize NFT collection:
- Set name, symbol, memo
- Configure metadata CID
- Set max supply (1 or more for multiple winners)
- Configure royalties (independent from edition)

#### `updateMintEconomics.js`
Configure all pricing:
- HBAR price per edition
- LAZY price per edition
- USDC price per edition
- WL discount percentage
- Max mint per transaction
- Max mint per wallet
- WL purchase pricing

#### `updateMintTiming.js`
Configure timing controls:
- Mint start time
- Pause/unpause state
- WL-only mode toggle

#### `withdrawHbar.js` / `withdrawLazy.js` / `withdrawUsdc.js`
Withdraw proceeds:
- Check contract balances
- Specify withdrawal amounts
- Send to owner or custom address

## 🔧 Environment Variables

Required in `.env`:
```bash
# Contract
EDITION_WITH_PRIZE_CONTRACT_ID=0.0.xxxxx

# Operator
ACCOUNT_ID=0.0.xxxxx
PRIVATE_KEY=302...

# Network
ENVIRONMENT=TEST  # or MAIN, PREVIEW, LOCAL
```

## 📊 Contract Phases

1. **NOT_INITIALIZED**: No tokens created yet
2. **EDITION_MINTING**: Editions available for sale
3. **EDITION_SOLD_OUT**: All editions sold, awaiting winner selection
4. **WINNER_SELECTED**: Winners chosen, awaiting prize claims
5. **PRIZE_CLAIMED**: All prizes claimed (final state)

## 🛡️ Security Features

- All scripts include gas estimation
- Token association verification
- Balance and allowance checking
- Comprehensive error handling
- Transaction confirmation
- Mirror node validation

## 📝 Example Workflow

```bash
# 1. Owner initializes
node admin/initializeEditionToken.js
node admin/initializePrizeToken.js
node admin/updateMintEconomics.js
node admin/setPause.js  # Unpause

# 2. Users mint
node mint.js  # Repeat until sold out

# 3. Anyone selects winners
node selectWinner.js  # After sold out

# 4. Winners claim
node claimPrize.js  # Each winner

# 5. Owner withdraws
node admin/withdrawHbar.js
node admin/withdrawLazy.js
node admin/withdrawUsdc.js
```

## 🐛 Troubleshooting

### "CONTRACT_REVERT_EXECUTED" errors
- Check current phase matches required phase
- Verify token associations
- Ensure sufficient balances/allowances
- Check if minting is paused

### Gas estimation errors
- Increase gas limit manually
- For selectWinner with multiple prizes: use 2-3x estimate
- Check network congestion

### "Not winning serial" errors
- Verify you own the winning serial (bearer asset)
- Check if serial was transferred after selection
- Confirm winner selection has occurred

## 📚 Related Documentation

- [Business Logic](../../../docs/EditionWithPrize-BUSINESS-LOGIC.md)
- [Testing Documentation](../../../docs/EditionWithPrize-TESTING.md)
- [TODO & Implementation](../../../docs/EditionWithPrize-TODO.md)
