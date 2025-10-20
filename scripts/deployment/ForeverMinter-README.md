````markdown
# ForeverMinter v1.0.5 Deployment Guide

This guide covers deploying the ForeverMinter contract to Hedera networks.

## Overview

ForeverMinter is a sophisticated NFT distribution system that manages a pool of existing NFTs and distributes them with advanced discount mechanisms including:
- **Sacrifice Discount**: Trade existing NFTs for discounts on new ones
- **Holder Discount**: NFT-based discounts with per-serial usage tracking
- **Whitelist Discount**: Address-based discounts with slot management
- **Refund System**: Time-window based refunds
- **Dual Currency**: Support for HBAR and/or LAZY token payments

---

## Prerequisites

### 1. Environment Setup

Ensure your `.env` file contains the required variables:

```env
# Operator Account
PRIVATE_KEY=your_ed25519_private_key
ACCOUNT_ID=0.0.your_account_id
ENVIRONMENT=TEST  # or MAIN, PREVIEW, LOCAL

# Required Dependencies
NFT_TOKEN_ID=0.0.xxxxx              # NFT collection to distribute
PRNG_CONTRACT_ID=0.0.xxxxx          # PrngGenerator contract
LAZY_TOKEN_ID=0.0.xxxxx             # LAZY token (optional if HBAR-only)
LAZY_GAS_STATION_CONTRACT_ID=0.0.xxxxx  # LazyGasStation contract
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.xxxxx  # LazyDelegateRegistry contract
```

### 2. Compiled Contract

Ensure the contract is compiled:
```bash
npx hardhat compile
```

### 3. Deployed Dependencies

Before deploying ForeverMinter, ensure these contracts are deployed:

#### A. PrngGenerator
```bash
# Deploy if not already deployed
node scripts/deployment/deploy-PrngGenerator.js
```

#### B. LAZY Token & LSCT (FungibleTokenCreator)
```bash
# Deploy LAZY token creator if needed
node scripts/deployment/deploy-FTC.js
```

#### C. LazyGasStation
```bash
# Deploy LazyGasStation with LAZY token
node scripts/deployment/deploy-LazyGasStation.js
```

#### D. LazyDelegateRegistry
```bash
# Deploy registry (or use dummy address)
node scripts/deployment/deploy-LazyDelegateRegistry.js
```

#### E. NFT Collection
The NFT collection must already exist and contain the serials you want to distribute.

---

## Deployment Steps

### Step 1: Prepare Dependencies

Ensure all 5 dependencies are deployed and their addresses are in your `.env` file:

```env
NFT_TOKEN_ID=0.0.1234567           # Your NFT collection
PRNG_CONTRACT_ID=0.0.2345678       # PRNG contract
LAZY_TOKEN_ID=0.0.3456789          # LAZY token
LAZY_GAS_STATION_CONTRACT_ID=0.0.4567890  # LazyGasStation
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.5678901  # Registry
```

**Alternatively**, you can pass them as command-line arguments:
```bash
node scripts/deployment/deploy-ForeverMinter.js \
  0.0.nftToken \
  0.0.prngGenerator \
  0.0.lazyToken \
  0.0.lazyGasStation \
  0.0.lazyDelegateRegistry
```

### Step 2: Run Deployment Script

```bash
node scripts/deployment/deploy-ForeverMinter.js
```

The script will:
1. ✅ Validate all dependencies are set
2. ✅ Display deployment summary
3. ✅ Ask for confirmation
4. ✅ Deploy ForeverMinter contract
5. ✅ Display post-deployment instructions
6. ✅ Save deployment info to JSON file

**Expected Output:**
```
╔═══════════════════════════════════════════╗
║   ForeverMinter v1.0.5 Deployment Tool   ║
╚═══════════════════════════════════════════╝

-Using ENVIRONMENT: TEST
-Using Operator: 0.0.123456

📋 Loading deployment dependencies...
✓ Using dependencies from .env file

📦 Dependency Summary:
  NFT Token: 0.0.1234567
  PRNG Generator: 0.0.2345678
  LAZY Token: 0.0.3456789
  LazyGasStation: 0.0.4567890
  LazyDelegateRegistry: 0.0.5678901

⚠️  You are about to deploy ForeverMinter v1.0.5
Do you want to proceed with deployment? (y/N): y

🌐 Deploying to TESTNET

📄 Contract bytecode loaded
  Size: 37658 bytes

🚀 Deploying contract... ForeverMinter
  Gas limit: 6,500,000

✅ Contract deployed successfully!
  Contract ID: 0.0.6789012
  Contract Address: 0x...

===========================================
DEPLOYMENT COMPLETE
===========================================
Contract Name: ForeverMinter
Contract ID: 0.0.6789012
Contract Address: 0x...
NFT Token: 0.0.1234567
PRNG Generator: 0.0.2345678
LAZY Token: 0.0.3456789
LazyGasStation: 0.0.4567890
LazyDelegateRegistry: 0.0.5678901
Environment: TEST
===========================================
```

### Step 3: Save Contract ID

Add the deployed contract ID to your `.env`:
```env
FOREVER_MINTER_CONTRACT_ID=0.0.6789012
```

Or use the generic:
```env
CONTRACT_ID=0.0.6789012
```

---

## Post-Deployment Setup

### Critical: Register with LazyGasStation

ForeverMinter **MUST** be registered with LazyGasStation to process LAZY payments:

```bash
node scripts/deployment/register-FM-with-LGS.js
```

This authorizes ForeverMinter to call:
- `drawLazyFrom()` - Take LAZY from users for minting
- `payoutLazy()` - Refund LAZY to users

**Expected Output:**
```
╔═══════════════════════════════════════════╗
║  Register ForeverMinter with LazyGasStation  ║
╚═══════════════════════════════════════════╝

-Using ENVIRONMENT: TEST
-Using Operator: 0.0.123456

📦 Contract Summary:
  ForeverMinter: 0.0.6789012
  LazyGasStation: 0.0.4567890

⚠️  This will register ForeverMinter as an authorized contract user
   with LazyGasStation, allowing it to process LAZY payments.
Do you want to proceed? (y/N): y

🌐 Using TESTNET

🚀 Registering ForeverMinter with LazyGasStation...
✅ ForeverMinter successfully registered with LazyGasStation!
   Transaction ID: 0.0.123456@1234567890.123456789
```

---

## Configuration Steps

### 1. Configure Mint Economics

Set pricing, discounts, and limits:

```bash
node scripts/interactions/ForeverMinter/admin/updateMintEconomics.js
```

**Example Configuration:**
```javascript
{
  mintPriceHbar: 1000,        // 1000 tinybar per NFT
  mintPriceLazy: 50,          // 50 LAZY per NFT
  wlDiscount: 10,             // 10% whitelist discount
  sacrificeDiscount: 30,      // 30% sacrifice discount
  maxMint: 50,                // Max 50 NFTs per transaction
  maxMintPerWallet: 100,      // Max 100 NFTs per wallet (0 = unlimited)
  buyWlWithLazy: 25,          // Cost 25 LAZY to buy WL slot
  buyWlSlotCount: 1,          // Buying grants 1 slot
  maxSacrifice: 20,           // Max 20 NFTs to sacrifice per tx
  lazyFromContract: false     // Users pay LAZY (not contract)
}
```

### 2. Configure Mint Timing

Set start time, refund window, and pause status:

```bash
node scripts/interactions/ForeverMinter/admin/updateMintTiming.js
```

**Example Configuration:**
```javascript
{
  mintStartTime: 1700000000,  // Unix timestamp (0 = immediate)
  mintPaused: false,          // Unpause minting
  refundWindow: 3600,         // 1 hour refund window (seconds)
  refundPercentage: 90,       // 90% refund
  wlOnly: false              // Allow non-WL users to mint
}
```

### 3. Add Discount Tiers (Optional)

If you have discount holder NFTs:

```bash
node scripts/interactions/ForeverMinter/admin/addDiscountTier.js
```

**Example:**
```javascript
// Tier 0: Generation 1 NFTs
{
  tokenAddress: "0.0.gen1token",
  discountPercentage: 25,      // 25% discount per use
  maxUsesPerSerial: 8          // Each serial can be used 8 times
}

// Tier 1: Generation 2 NFTs
{
  tokenAddress: "0.0.gen2token",
  discountPercentage: 10,      // 10% discount per use
  maxUsesPerSerial: 3          // Each serial can be used 3 times
}
```

### 4. Set Sacrifice Destination

Choose where sacrificed NFTs go:

```bash
node scripts/interactions/ForeverMinter/admin/setSacrificeDestination.js
```

**Options:**
- **Contract address** (`0.0.6789012`): NFTs return to pool (re-rolling)
- **Burn address** (`0.0.0`): NFTs are burned (destroyed)
- **Collection address**: NFTs sent to specific address

### 5. Configure Withdrawal Cooldown (Optional)

Set admin withdrawal cooldown period:

```bash
node scripts/interactions/ForeverMinter/admin/updateWithdrawalCooldown.js
```

Default: 24 hours (86400 seconds)

### 6. Set LAZY Burn Percentage (Optional)

Configure what % of LAZY is burned on payments:

```bash
node scripts/interactions/ForeverMinter/admin/setLazyBurnPercentage.js
```

Default: 50% (range: 0-100%)

---

## NFT Pool Management

### Add NFTs to Pool

ForeverMinter distributes existing NFTs. You must add them to the pool.

#### Option A: Transfer then Register

1. **Transfer NFTs to contract:**
   ```javascript
   // Use Hedera SDK or HashScan
   await sendNFT(client, nftToken, serials, foreverMinterAddress);
   ```

2. **Register them:**
   ```bash
   node scripts/interactions/ForeverMinter/admin/registerPoolNFTs.js
   ```

   This adds the NFTs to the `availableSerials` pool.

#### Option B: Stake Directly

Use the public `addNFTsToPool()` function:
```bash
node scripts/interactions/ForeverMinter/admin/addToPool.js
```

This transfers NFTs via STAKING (respects royalties) and adds to pool.

---

## Whitelist Management

### Add Single Address

```bash
node scripts/interactions/ForeverMinter/admin/addToWhitelist.js
```

**Example:**
```
Address: 0.0.alice
Slots: 5
```
Alice can now mint with 10% discount (5 times).

### Batch Add from CSV

```bash
node scripts/interactions/ForeverMinter/admin/batchAddToWhitelist.js
```

**CSV Format:**
```csv
address,slots
0.0.alice,5
0.0.bob,10
0.0.charlie,3
```

### Remove from Whitelist

```bash
node scripts/interactions/ForeverMinter/admin/removeFromWhitelist.js
```

---

## Admin Management

### Add Additional Admins

```bash
node scripts/interactions/ForeverMinter/admin/addAdmin.js
```

### Remove Admin

```bash
node scripts/interactions/ForeverMinter/admin/removeAdmin.js
```

**Note:** Cannot remove the last admin.

### List All Admins

```bash
node scripts/interactions/ForeverMinter/admin/listAdmins.js
```

---

## Testing the Deployment

### 1. Check Contract Info

```bash
node scripts/interactions/ForeverMinter/getContractInfo.js
```

Displays:
- Economics settings
- Timing configuration
- LAZY details
- Pool status
- Withdrawal cooldown

### 2. Check Pool Status

```bash
node scripts/interactions/ForeverMinter/getPoolStatus.js
```

Shows available NFT serials (paginated).

### 3. Test Mint Cost Calculation

```bash
node scripts/interactions/ForeverMinter/checkMintCost.js
```

Preview mint costs before actual minting.

### 4. Perform Test Mint

```bash
node scripts/interactions/ForeverMinter/mint.js
```

Interactive minting with full discount discovery.

---

## Gas Limits Reference

From extensive testing (`ForeverMinter.test.js`):

| Operation | Gas Limit | Notes |
|-----------|-----------|-------|
| **Deployment** | 6,500,000 | Constructor + token association |
| **Register with LGS** | 300,000 | AddContractUser call |
| **Update Economics** | 250,000 | All parameters |
| **Update Timing** | 250,000 | All parameters |
| **Add Discount Tier** | 300,000 | New tier |
| **Register NFTs** | 600,000 | Batch registration |
| **Mint (1 NFT)** | 1,200,000 | HBAR only |
| **Mint (10 NFTs)** | 2,500,000 | HBAR only |
| **Mint with LAZY** | 1,500,000 | 1 NFT + LAZY payment |
| **Mint with Sacrifice** | 2,000,000+ | Depends on sacrifice count |
| **Refund** | 800,000 | Per NFT |
| **Add to Whitelist** | 200,000 | Single address |
| **Batch Add WL** | 400,000+ | Depends on batch size |

---

## Architecture Overview

### Contract Dependencies

```
ForeverMinter
  ├── NFT_TOKEN (immutable)              # NFT collection being distributed
  ├── PRNG_GENERATOR (immutable)         # Random number generation
  ├── lazyToken                           # LAZY token for payments
  ├── lazyGasStation                      # LAZY payment processor
  └── lazyDelegateRegistry               # TokenStakerV2 delegate system
```

### Key Features

1. **Serial Pool Management**
   - `EnumerableSet` for O(1) operations
   - Random selection via PRNG
   - Automatic pool replenishment from refunds

2. **Discount System**
   - **Sacrifice**: Exclusive, highest discount (e.g., 30%)
   - **Holder**: NFT-based, stackable with WL (e.g., 25%)
   - **Whitelist**: Address-based, stackable with holder (e.g., 10%)
   - Discounts stack: WL + Holder, capped at 100%

3. **Payment Processing**
   - Dual currency: HBAR and/or LAZY
   - LazyGasStation handles LAZY transfers/burns
   - Automatic refund of excess HBAR

4. **Refund System**
   - Time-window based (e.g., 1 hour)
   - Percentage-based (e.g., 90%)
   - Tracks actual payment amounts
   - Returns NFTs to pool

5. **Admin System**
   - Multi-admin support with EnumerableSet
   - Withdrawal cooldown protection (24 hours)
   - Cannot remove last admin
   - Role-based access control

---

## Constructor Parameters

```solidity
constructor(
    address _nftToken,              // NFT collection to distribute
    address _prngGenerator,         // PRNG for random selection
    address _lazyToken,             // LAZY token address
    address _lazyGasStation,        // LazyGasStation for LAZY handling
    address _lazyDelegateRegistry   // Delegate registry for TokenStakerV2
)
```

**Immutable Values:**
- `NFT_TOKEN` - Cannot be changed after deployment
- `PRNG_GENERATOR` - Cannot be changed after deployment

**Mutable Values:**
- `lazyToken` - Can be updated via `updateLazyDetails()`
- `lazyGasStation` - Can be updated via `updateLazyGasStation()`
- All economics and timing parameters - Configurable by admins

---

## Security Considerations

### 1. Private Key Protection
- **Never** commit `.env` files with private keys
- Use hardware wallets for mainnet deployments
- Consider multi-sig wallets for admin accounts

### 2. Admin Management
- Deploying account becomes first admin
- Add multiple admins for redundancy
- Use different accounts for different admin roles
- Cannot remove last admin (safety feature)

### 3. Withdrawal Cooldown
- Default 24-hour cooldown between admin withdrawals
- Protects against rapid fund drainage
- Per-admin tracking (not global)
- Consider longer cooldowns for mainnet

### 4. LazyGasStation Authorization
- **CRITICAL**: ForeverMinter must be registered with LGS
- Without registration, LAZY payments will fail
- Cannot be skipped or bypassed

### 5. Pool Management
- Only admins can emergency withdraw NFTs
- Contract must be paused for emergency withdrawals
- Anyone can add NFTs to pool (donations welcome)
- Refunds automatically return NFTs to pool

### 6. Discount Tracking
- Per-serial global tracking (not per-wallet)
- Discount capacity follows the NFT
- Cannot be reset or gamed
- Verified ownership at mint time

---

## Troubleshooting

### Deployment Issues

**"Environment required"**
- Set `ENVIRONMENT=TEST` (or MAIN/PREVIEW/LOCAL) in `.env`

**"NFT_TOKEN_ID not found"**
- Set all 5 dependency addresses in `.env`
- Or pass as command-line arguments

**"Gas limit exceeded"**
- Ensure you're using the recommended 6,500,000 gas
- Contract size is ~18.8 KiB (well under 24 KiB limit)

### Registration Issues

**"addContractUser FAILED"**
- Verify LazyGasStation address is correct
- Ensure operator is admin of LazyGasStation
- Check network connectivity

### Mint Issues

**"NotEnoughHbar"**
- User didn't send enough HBAR
- Check mint cost with `checkMintCost.js`

**"LazyTransferFailed"**
- User didn't approve LazyGasStation (NOT ForeverMinter!)
- User has insufficient LAZY balance
- ForeverMinter not registered with LGS

**"MintedOut"**
- Pool is empty
- Add more NFTs to pool

**"Paused"**
- Minting is paused
- Unpause with `setPause.js`

**"RefundWindowExpired"**
- Refund period has passed
- Check refund eligibility first

### Pool Issues

**"SerialNotInPool"**
- NFT serial doesn't exist in available pool
- Check pool status with `getPoolStatus.js`

**"SerialNotOwnedByContract"**
- Trying to register NFT not owned by contract
- Transfer NFTs to contract first

---

## Network Support

ForeverMinter supports all Hedera networks:

- **Testnet**: `ENVIRONMENT=TEST` (recommended for initial testing)
- **Mainnet**: `ENVIRONMENT=MAIN` (production)
- **Previewnet**: `ENVIRONMENT=PREVIEW` (latest features)
- **Local**: `ENVIRONMENT=LOCAL` (local node testing)

---

## Contract Size

- **Compiled Size**: 18.829 KiB
- **Size Limit**: 24.0 KiB (Hedera/Ethereum)
- **Available Headroom**: 5.171 KiB
- **Status**: ✅ Well optimized, plenty of room for future enhancements

---

## Version Information

- **Current Version**: v1.0.5
- **Key Features**: Waterfall discount system, DRY slot consumption
- **Breaking Changes**: `calculateMintCost()` returns 5 values (not 3)
- **Contract Size**: 18.829 KiB (optimized from v1.0.4)

See [ForeverMinter-V1.0.5-MIGRATION.md](../../docs/ForeverMinter-V1.0.5-MIGRATION.md) for migration details.

---

## Support & Documentation

### Full Documentation
- **Business Logic**: `docs/ForeverMinter-BUSINESS-LOGIC.md`
- **Technical Design**: `docs/ForeverMinter-DESIGN.md`
- **Testing Plan**: `docs/ForeverMinter-TESTING.md`
- **Implementation TODO**: `docs/ForeverMinter-TODO.md`
- **Migration Guide**: `docs/ForeverMinter-V1.0.5-MIGRATION.md`

### Interaction Scripts
All scripts are in `scripts/interactions/ForeverMinter/`:
- **User Scripts** (10): mint.js, refund.js, checkMintCost.js, etc.
- **Admin Scripts** (19): All configuration and management tools

See `scripts/interactions/ForeverMinter/README.md` for complete guide.

---

## Example: Complete Deployment Workflow

```bash
# 1. Deploy ForeverMinter
node scripts/deployment/deploy-ForeverMinter.js

# 2. Register with LazyGasStation (CRITICAL!)
node scripts/deployment/register-FM-with-LGS.js

# 3. Configure economics
node scripts/interactions/ForeverMinter/admin/updateMintEconomics.js
# Enter values when prompted

# 4. Configure timing
node scripts/interactions/ForeverMinter/admin/updateMintTiming.js
# Set start time, unpause, etc.

# 5. Add discount tiers (if using holder discounts)
node scripts/interactions/ForeverMinter/admin/addDiscountTier.js
# Repeat for each discount tier

# 6. Add NFTs to pool
# Option A: Transfer then register
# Transfer NFTs to contract address via HashScan
node scripts/interactions/ForeverMinter/admin/registerPoolNFTs.js

# Option B: Stake directly
node scripts/interactions/ForeverMinter/admin/addToPool.js

# 7. Add whitelist addresses (optional)
node scripts/interactions/ForeverMinter/admin/batchAddToWhitelist.js
# Upload CSV with addresses and slot counts

# 8. Verify configuration
node scripts/interactions/ForeverMinter/getContractInfo.js

# 9. Check pool status
node scripts/interactions/ForeverMinter/getPoolStatus.js

# 10. Test mint
node scripts/interactions/ForeverMinter/mint.js

# 11. Monitor and manage
node scripts/interactions/ForeverMinter/getMintHistory.js
```

---

## Success!

Your ForeverMinter is now deployed and ready for NFT distribution! 🎉

For questions or issues, refer to the comprehensive documentation in the `docs/` folder.

---

**Happy Minting! 🚀**
````