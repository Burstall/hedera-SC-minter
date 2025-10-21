# Hedera Smart Contract Minter Suite

> **A comprehensive collection of NFT minting contracts for the Hedera network**  
> Version: 2.0 (v1.0 for ForeverMinter, SoulboundBadgeMinter)  
> Solidity: 0.8.18  
> Branch: `refactor-base-minter`

---

## Overview

This repository provides **four specialized NFT minting contracts**, each optimized for different use cases on the Hedera network. All contracts support $LAZY token integration, whitelist systems, and are production-ready with comprehensive testing.

### 🎯 Quick Contract Selector

**Need transferable NFTs?**
- Standard sales → **MinterContract**
- Pool-based distribution with royalties → **ForeverMinter**

**Need soulbound (non-transferable) NFTs?**
- Single badge/certificate type → **SoulboundMinter**
- Multiple badge types in one contract → **SoulboundBadgeMinter**

---

## Contract Comparison

| Feature | MinterContract | SoulboundMinter | ForeverMinter | SoulboundBadgeMinter |
|---------|----------------|-----------------|---------------|----------------------|
| **Token Type** | Transferable NFT | Soulbound NFT | Transferable NFT | Soulbound NFT |
| **Distribution** | Create & mint | Create & mint | Pool-based | Create & mint |
| **Primary Use Case** | Standard NFT sales | Badges/Certificates | Complex distribution | Multi-badge system |
| **Transferability** | ✅ Yes | ❌ No (Frozen) | ✅ Yes | ❌ No (Frozen) |
| **Royalty Compliance** | ❌ Bypassed | N/A | ✅ Respected | N/A |
| **Whitelist System** | ✅ Address + Token-gated | ✅ Address + Token-gated | ✅ Address + Holder | ✅ Per-badge whitelist |
| **Payment Types** | HBAR + $LAZY | HBAR + $LAZY | HBAR + $LAZY | HBAR only |
| **Discount Types** | WL only | WL only | WL + Holder + Sacrifice | Per-badge config |
| **Discount Stacking** | ❌ No | ❌ No | ✅ WL+Holder | ❌ No |
| **Refund System** | ✅ Time-based | ✅ Time-based | ✅ Pool return | ❌ No |
| **Batch Minting** | ✅ Unlimited | ✅ Unlimited | ✅ 50 max | ✅ Unlimited |
| **On-Behalf Minting** | ❌ No | ✅ Yes | ❌ No | ✅ Yes |
| **Revocation** | ❌ No | ✅ Optional | ❌ No | ✅ Optional |
| **Sacrifice System** | ❌ No | ❌ No | ✅ Burn NFTs for discount | ❌ No |
| **Admin System** | Owner only | Owner only | Multi-admin | Multi-admin |
| **Supply Management** | Fixed/Unlimited | Fixed/Unlimited | Pool-based | Fixed per badge |
| **Contract Size** | 19.402 KiB | 20.436 KiB | 18.874 KiB | 14.824 KiB |
| **Architecture** | v2.0 (Refactored) | v2.0 (Refactored) | v1.0 | v1.0 |
| **Documentation** | ✅ Complete | ✅ Complete | ✅ Extensive (6 docs) | ✅ Complete |

---

## Detailed Contract Overview

### 1. MinterContract
**📄 Documentation:** [MinterContract-README.md](MinterContract-README.md)  
**🔧 Contract:** `contracts/MinterContract.sol`  
**🧪 Tests:** `test/MinterContract.test.js`  
**📦 Size:** 19.402 KiB | **Headroom:** 5.174 KiB

#### Purpose
Standard transferable NFT minting with flexible pricing, whitelist access, and refund mechanics.

#### When to Use
✅ Traditional NFT collection launches  
✅ Transferable collectibles with standard economics  
✅ Projects needing refund/burn mechanics  
✅ Token-gated NFT access  
✅ Simple whitelist discount systems  

#### Key Features
- Create and mint NFTs on-demand
- HBAR + $LAZY dual payment system
- Time-based refund window with burn mechanism
- Whitelist + token-gated access
- Fixed or unlimited supply options
- Sequential or random metadata selection
- Comprehensive refund tracking

#### Architecture (v2.0)
```
MinterContract
  ├─ ExpiryHelperV2 (NFT expiry management)
  ├─ FeeHelperV2 (custom fee handling)
  ├─ KeyHelperV2 (key management with Bits library)
  ├─ HederaTokenServiceV2 (HTS integration)
  ├─ ReentrancyGuard (security)
  └─ Ownable (ownership)
```

#### v2.0 Improvements
- ✅ Custom errors (~90% gas savings on errors)
- ✅ MinterLibrary eliminated (DRY with KeyHelper)
- ✅ KeyHelper Bits library integration
- ✅ 86-byte contract size reduction
- ✅ ~40% cheaper deployment
- ✅ Enhanced maintainability

---

### 2. SoulboundMinter
**📄 Documentation:** [SoulboundMinter-README.md](SoulboundMinter-README.md)  
**🔧 Contract:** `contracts/SoulboundMinter.sol`  
**🧪 Tests:** `test/SoulboundMinter.test.js`  
**📦 Size:** 20.436 KiB | **Headroom:** 4.140 KiB

#### Purpose
Non-transferable (soulbound) NFT minting for badges, certificates, and identity tokens.

#### When to Use
✅ Educational certificates & credentials  
✅ Achievement/completion badges  
✅ Non-transferable membership tokens  
✅ Attendance/participation proofs  
✅ Identity verification NFTs  
✅ Single-type soulbound token systems  
✅ Gas abstraction (on-behalf minting)  

#### Key Features
- **Frozen tokens** - Non-transferable by design
- Optional revocation system
- On-behalf minting (gas abstraction for users)
- HBAR + $LAZY dual payment
- Time-based refunds
- Whitelist + token-gated access
- Optional FREEZE + WIPE keys

#### Soulbound Mechanism
```solidity
// Tokens are frozen at mint
IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
keys[0] = getSingleKey(KeyType.FREEZE, ...);  // Required
keys[1] = getSingleKey(KeyType.WIPE, ...);    // Optional (for revocation)
```

#### Architecture (v2.0)
```
SoulboundMinter
  ├─ ExpiryHelperV2 (NFT expiry management)
  ├─ FeeHelperV2 (custom fee handling)
  ├─ KeyHelperV2 (unified key management)
  ├─ HederaTokenServiceV2 (HTS integration)
  ├─ ReentrancyGuard (security)
  └─ Ownable (ownership)
```

#### v2.0 Improvements
- ✅ Custom errors (gas efficient)
- ✅ Unified KeyType enum with KeyHelper
- ✅ MinterLibrary dependency removed
- ✅ 78-byte contract size reduction
- ✅ Improved code quality via DRY

---

### 3. ForeverMinter
**📄 Documentation:** [ForeverMinter-README.md](ForeverMinter-README.md)  
**📚 Extended Docs:** `docs/ForeverMinter-*.md` (6 comprehensive documents)  
**🔧 Contract:** `contracts/ForeverMinter.sol`  
**🧪 Tests:** `test/ForeverMinter.test.js`  
**📦 Size:** 18.874 KiB | **Headroom:** 5.702 KiB

#### Purpose
Pool-based distribution of **existing** NFT collections with advanced discount mechanics and royalty compliance.

#### When to Use
✅ Distributing existing NFT collections  
✅ Respecting creator royalties is critical  
✅ Complex discount mechanics (holder incentives, sacrifice)  
✅ Staking/recycling systems for NFTs  
✅ Multiple discount tiers with stacking  
✅ Large collections requiring efficient distribution  
✅ Multi-admin team management  

#### Key Features
- **Pool-based distribution** (not minting new tokens)
- **Royalty compliance** via TokenStakerV2
- **Triple discount system:**
  1. Whitelist discount (stackable)
  2. Holder discount (global per-serial tracking, stackable)
  3. Sacrifice discount (exclusive, highest %)
- Burn existing NFTs for discounts
- Time-based refund with pool return
- PRNG serial selection
- Multi-admin system

#### Unique Mechanics
```javascript
// Sacrifice existing NFTs for discount
await foreverMinter.mintNFT(
    quantity,
    lazyAmount,
    true,              // Use holder discount
    true,              // Use sacrifice discount
    [serial1, serial2] // NFTs to burn
);

// Refund returns NFT to pool
await foreverMinter.refundNFT(serial);
// Serial back in availableSerials, 95% payment returned
```

#### Architecture (v1.0)
```
ForeverMinter
  ├─ TokenStakerV2 (royalty-compliant transfers)
  ├─ Ownable (ownership)
  └─ ReentrancyGuard (security)
```

#### Extended Documentation
- **ForeverMinter-SUMMARY.md**: Documentation overview & roadmap
- **ForeverMinter-DESIGN.md**: Complete technical specification (1700+ lines)
- **ForeverMinter-BUSINESS-LOGIC.md**: User guide with 40+ FAQs
- **ForeverMinter-TODO.md**: 23-phase implementation checklist
- **ForeverMinter-TESTING.md**: 200+ test cases
- **ForeverMinter-IMPLEMENTATION-SUMMARY.md**: Progress tracking

---

### 4. SoulboundBadgeMinter
**📄 Documentation:** [SoulboundBadgeMinter-README.md](SoulboundBadgeMinter-README.md)  
**🔧 Contract:** `contracts/SoulboundBadgeMinter.sol`  
**🧪 Tests:** `test/SoulboundBadgeMinter.test.js`  
**📦 Size:** 14.824 KiB | **Headroom:** 9.752 KiB

#### Purpose
Multi-badge soulbound NFT system with per-badge configuration and team management.

#### When to Use
✅ Multiple badge types in one contract  
✅ Organization/company badge programs  
✅ Per-badge supply limits and whitelists  
✅ Flexible multi-tier badge systems  
✅ Team-based admin management  
✅ Badge-specific pricing and configuration  

#### Key Features
- **Multiple badge types** in single contract
- **Per-badge configuration:**
  - Individual supply limits
  - Separate whitelists
  - Badge-specific pricing
  - Custom metadata per badge
- Multi-admin team system
- On-behalf minting (gas abstraction)
- Optional revocation per badge
- HBAR-only payments (simpler)

#### Badge Management
```solidity
// Each badge is independent
struct BadgeConfig {
    string name;
    string symbol;
    uint256 maxSupply;
    uint256 price;
    bool revocable;
    address[] whitelist;
    string metadataURI;
}
```

#### Architecture (v1.0)
```
SoulboundBadgeMinter
  ├─ KeyHelper (key management)
  ├─ HederaTokenService (HTS integration)
  ├─ ReentrancyGuard (security)
  └─ Ownable (ownership)
```

---

## Repository Structure

```
hedera-SC-minter/
├── contracts/
│   ├── MinterContract.sol          # v2.0 - Standard NFT minting
│   ├── SoulboundMinter.sol         # v2.0 - Single soulbound type
│   ├── ForeverMinter.sol           # v1.0 - Pool distribution
│   ├── SoulboundBadgeMinter.sol    # v1.0 - Multi-badge system
│   ├── ExpiryHelperV2.sol          # NFT expiry management
│   ├── FeeHelperV2.sol             # Custom fee handling
│   ├── KeyHelperV2.sol             # Key management (Bits library)
│   ├── HederaTokenServiceV2.sol    # HTS integration
│   ├── TokenStakerV2.sol           # Staking mechanics
│   ├── FungibleTokenCreator.sol    # v2.0 - Fungible token support
│   └── interfaces/                 # Contract interfaces
│
├── test/
│   ├── MinterContract.test.js
│   ├── SoulboundMinter.test.js
│   ├── ForeverMinter.test.js
│   ├── SoulboundBadgeMinter.test.js
│   └── FungibleTokenCreator.test.js
│
├── docs/
│   ├── ForeverMinter-SUMMARY.md
│   ├── ForeverMinter-DESIGN.md
│   ├── ForeverMinter-BUSINESS-LOGIC.md
│   ├── ForeverMinter-TODO.md
│   ├── ForeverMinter-TESTING.md
│   └── ForeverMinter-IMPLEMENTATION-SUMMARY.md
│
├── abi/                            # Contract ABIs
├── scripts/                        # Deployment & interaction scripts
├── utils/                          # Helper utilities
├── MinterContract-README.md        # Complete documentation
├── SoulboundMinter-README.md       # Complete documentation
├── ForeverMinter-README.md         # Quick reference (NEW)
├── SoulboundBadgeMinter-README.md  # Complete documentation
├── DEV-README.md                   # Development setup
└── README.md                       # This file
```

---

## Technology Stack

- **Blockchain:** Hedera Hashgraph
- **Solidity:** 0.8.18
- **Framework:** Hardhat
- **Testing:** Mocha, Chai, Hedera SDK
- **Libraries:** 
  - OpenZeppelin (ReentrancyGuard, Ownable, SafeCast, Math, EnumerableMap/Set, Address, Strings)
  - Hedera Token Service (HTS)
  - Custom: KeyHelper with Bits library

---

## Key Features Across All Contracts

### 🔐 Security
- **ReentrancyGuard** on all payment functions
- **Custom errors** for gas-efficient error handling
- **Comprehensive testing** with edge case coverage
- **Access control** via Ownable or multi-admin systems

### 💰 Economics
- **Dual payment:** HBAR + $LAZY token integration
- **Burn mechanism:** Configurable $LAZY burn percentage
- **Whitelist discounts:** Incentivize early supporters
- **Flexible pricing:** Per-contract or per-badge configuration

### 🎲 Randomization
- **PRNG integration** for fair metadata/serial selection
- **Hedera VRF** support via IPrngGenerator
- **Configurable:** Sequential or random distribution

### ♻️ Refund Systems
- **Time-based windows** (configurable)
- **Partial refunds** (e.g., 95% return)
- **Burn tracking** for accountability
- **Gas optimization** via efficient data structures

### 📊 Metadata
- **IPFS integration** for decentralized storage
- **Flexible URIs** per-token or per-badge
- **Sequential or random** metadata assignment

---

## Getting Started

### Installation

```bash
# Clone repository
git clone https://github.com/Burstall/hedera-SC-minter.git
cd hedera-SC-minter
git checkout refactor-base-minter

# Install dependencies
npm install
```

### Configuration

```bash
# Copy environment template
cp .env.example .env

# Configure Hedera credentials
OPERATOR_ID=0.0.xxxxx
OPERATOR_KEY=your-private-key
NETWORK=testnet
```

### Compilation

```bash
# Compile all contracts
npx hardhat compile

# Check contract sizes
npx hardhat compile --force
```

### Testing

```bash
# Run all tests
npm test

# Test specific contracts
npm run test-minter          # MinterContract
npm run test-soulbound       # SoulboundMinter
npm run test-forever         # ForeverMinter
npm run test-badges          # SoulboundBadgeMinter
npm run test-ft              # FungibleTokenCreator

# Run with gas reporting
REPORT_GAS=true npm test
```

### Deployment

```bash
# Deploy to testnet
npx hardhat run scripts/deployment/deploy-minter.js --network testnet

# Deploy specific contract
npx hardhat run scripts/deployment/deploy-soulbound.js --network testnet
```

---

## Gas Estimates

### MinterContract
- **Deploy:** ~6.5M gas (~40% cheaper with v2.0 custom errors)
- **Single Mint:** ~800k gas (with PRNG)
- **Batch Mint (10):** ~6.0M gas base + 325k per NFT
- **Refund:** ~300k gas

### SoulboundMinter
- **Deploy:** ~6.8M gas
- **Single Mint:** ~850k gas (FREEZE key adds overhead)
- **On-Behalf Mint:** +50k gas (gas abstraction)
- **Revoke:** ~250k gas (if enabled)

### ForeverMinter
- **Deploy:** ~7.2M gas
- **Single Mint:** ~700k gas (no token creation)
- **Sacrifice Mint:** ~900k gas (includes burns)
- **Refund with Pool Return:** ~350k gas

### SoulboundBadgeMinter
- **Deploy:** ~5.5M gas (smallest contract)
- **Single Badge Mint:** ~800k gas
- **Multi-Badge Setup:** ~200k per badge configuration

**Note:** Hedera suggests 20% gas buffer over estimates. Hedera refunds up to 20% of unused gas.

---

## v2.0 Refactoring Summary

### MinterContract & SoulboundMinter (v2.0)

**Major Changes:**
- ✅ **MinterLibrary Eliminated:** Single-use helpers inlined
- ✅ **Custom Errors:** Replaced all string-based reverts (~90% gas savings)
- ✅ **KeyHelper Integration:** Uses Bits library and unified KeyType enum
- ✅ **DRY Principles:** Removed code duplication with helper contracts
- ✅ **Size Optimization:** 78-86 byte reduction per contract

**Performance Improvements:**
- Deployment: ~40% cheaper
- Error handling: ~90% gas savings
- Runtime: Eliminated JUMP operations for inlined functions
- Maintainability: Better code organization via DRY

**Breaking Changes:**
- ❌ **None** - All public interfaces unchanged
- ✅ Frontend error handling should parse custom errors (recommended, not required)

### ForeverMinter & SoulboundBadgeMinter (v1.0)
- Original implementations (no refactoring yet)
- May receive v2.0 updates in future

---

## Frontend Integration

### Error Handling (v2.0 Contracts)

```javascript
// Modern approach (v2.0) - parse custom errors
try {
    await contract.mintNFT(amount, { value: cost });
} catch (error) {
    if (error.data) {
        const parsedError = contract.interface.parseError(error.data);
        
        if (parsedError.name === 'InsufficientPayment') {
            const [required, provided] = parsedError.args;
            console.log(`Need ${required}, got ${provided}`);
        }
    }
}

// Legacy approach (still works)
catch (error) {
    if (error.message.includes("InsufficientPayment")) {
        // Handle error
    }
}
```

### Cost Calculation

```javascript
// MinterContract & SoulboundMinter
const cost = await contract.calculateCost(quantity, useWhitelist);

// ForeverMinter (v1.0.5+)
const result = await foreverMinter.calculateMintCost(
    userAddress,
    quantity,
    useHolderDiscount,
    useSacrifice
);
// Returns: {hbarCost, lazyCost, totalDiscount, holderSlotsUsed, wlSlotsUsed}
```

---

## Documentation Quick Links

### Contract Documentation
- **[MinterContract-README.md](MinterContract-README.md)** - Standard transferable NFT minting
- **[SoulboundMinter-README.md](SoulboundMinter-README.md)** - Single-type soulbound badges
- **[ForeverMinter-README.md](ForeverMinter-README.md)** - Pool-based distribution (NEW!)
- **[SoulboundBadgeMinter-README.md](SoulboundBadgeMinter-README.md)** - Multi-badge system

### Extended Documentation (ForeverMinter)
- **[docs/ForeverMinter-SUMMARY.md](docs/ForeverMinter-SUMMARY.md)** - Documentation overview
- **[docs/ForeverMinter-DESIGN.md](docs/ForeverMinter-DESIGN.md)** - Technical specification (1700+ lines)
- **[docs/ForeverMinter-BUSINESS-LOGIC.md](docs/ForeverMinter-BUSINESS-LOGIC.md)** - User guide & FAQ
- **[docs/ForeverMinter-TODO.md](docs/ForeverMinter-TODO.md)** - Implementation checklist
- **[docs/ForeverMinter-TESTING.md](docs/ForeverMinter-TESTING.md)** - Test plan (200+ cases)

### Development
- **[DEV-README.md](DEV-README.md)** - Development environment setup
- **Test Files:** `test/*.test.js` - Comprehensive test suites

---

## Use Case Matrix

| Requirement | Recommended Contract |
|-------------|---------------------|
| Standard NFT sale | **MinterContract** |
| Educational certificates | **SoulboundMinter** |
| Achievement badges (single type) | **SoulboundMinter** |
| Achievement badges (multiple types) | **SoulboundBadgeMinter** |
| Pool-based distribution | **ForeverMinter** |
| Holder incentive discounts | **ForeverMinter** |
| NFT sacrifice mechanics | **ForeverMinter** |
| Royalty compliance required | **ForeverMinter** |
| Multi-admin team | **ForeverMinter** or **SoulboundBadgeMinter** |
| On-behalf minting (gas abstraction) | **SoulboundMinter** or **SoulboundBadgeMinter** |
| Revocable credentials | **SoulboundMinter** or **SoulboundBadgeMinter** |
| Organization badge programs | **SoulboundBadgeMinter** |

---

## Support & Community

- **GitHub:** [Burstall/hedera-SC-minter](https://github.com/Burstall/hedera-SC-minter)
- **Branch:** `refactor-base-minter` (latest)
- **Issues:** [GitHub Issues](https://github.com/Burstall/hedera-SC-minter/issues)

---

## License

See LICENSE file for details.

---

**Last Updated:** October 2025  
**Repository Status:** ✅ Production Ready  
**Latest Version:** v2.0 (MinterContract, SoulboundMinter), v1.0 (ForeverMinter, SoulboundBadgeMinter)