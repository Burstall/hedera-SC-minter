# EditionWithPrize Contract

## Overview

The **EditionWithPrize** contract is an advanced NFT minting system that creates edition NFTs with identical metadata, then awards unique 1-of-1 prize tokens to randomly selected edition holders. This creates an engaging gamified minting experience with fair, verifiable on-chain randomness.

## 🎯 Core Concept

1. **Edition Minting Phase**: Users mint edition NFTs (identical metadata)
2. **Winner Selection Phase**: Random winners selected using PRNG after sellout
3. **Prize Claiming Phase**: Winners exchange edition NFTs for unique prize tokens

## 🔗 Contract Inheritance

```solidity
contract EditionWithPrize is KeyHelper, ExpiryHelper, Ownable, ReentrancyGuard
```

- **KeyHelper**: HTS key management utilities
- **ExpiryHelper**: Token expiry configuration
- **Ownable**: Access control for admin functions
- **ReentrancyGuard**: Protection against reentrancy attacks

## 📋 Table of Contents

- [Contract Phases](#contract-phases)
- [Payment System](#payment-system)
- [Whitelist System](#whitelist-system)
- [Prize Mechanism](#prize-mechanism)
- [Configuration](#configuration)
- [View Functions](#view-functions)
- [Events](#events)
- [Security Features](#security-features)
- [Gas Optimization](#gas-optimization)

## 🔄 Contract Phases

The contract operates through a strict phase progression:

### Phase 0: NOT_INITIALIZED
- Contract deployed, tokens not created
- Only token initialization allowed

### Phase 1: EDITION_MINTING
- Edition NFTs being minted by users
- Payment processing active
- Whitelist enforcement (if enabled)

### Phase 2: EDITION_SOLD_OUT
- All editions minted, awaiting winner selection
- `selectWinner()` can be called by anyone

### Phase 3: WINNER_SELECTED
- Winners chosen via PRNG
- Prize claiming available for winners

### Phase 4: PRIZE_CLAIMED
- All prizes claimed, contract complete
- Final state reached

## 💰 Payment System

The contract supports **three payment methods** that can be used individually or in combination:

### HBAR (Native)
- Paid via `msg.value`
- Excess automatically refunded using OpenZeppelin's `Address.sendValue`

### LAZY Token
- Paid via allowance mechanism
- Supports burn percentage (configurable 0-100%)
- Can be paid by contract (sponsorship mode)

### USDC (Dual Token Support)
- **Native USDC**: `0x000000000000000000000000000000000006f89a`
- **Bridged USDC**: `0x0000000000000000000000000000000000101Ae3`
- Smart prioritization: Uses native first, then bridged
- Supports mixed allowances across both tokens

### Whitelist Discounts
- Configurable discount percentage (0-100%)
- Applied to all three payment methods
- Automatic application for whitelisted addresses

## 🎫 Whitelist System

### Manual Whitelist
```solidity
function addToWhitelist(
    address[] memory _addresses,
    uint256[] memory _quantities
) external onlyOwner
```
- Owner can manually add addresses
- Quantities: `0` = unlimited, `>0` = specific allocation

### LAZY Token Purchase
```solidity
function purchaseWhitelistWithLazy() external nonReentrant
```
- Purchase whitelist slots with LAZY tokens
- Configurable cost and slots granted per purchase

### Token-Based Whitelist
```solidity
function purchaseWhitelistWithToken(uint256 _serial) external nonReentrant
```
- Use specific NFT serial to gain whitelist access
- Supports staked tokens via delegate registry
- Serial marked as used to prevent reuse

## 🏆 Prize Mechanism

### Winner Selection
- Uses PRNG for verifiable on-chain randomness
- Supports multiple winners (configurable)
- Can be called by anyone once edition sold out

### Prize Claiming
```solidity
function claimPrize(uint256 _editionSerial) external nonReentrant
```

**Process:**
1. Verify serial is a winner (O(1) EnumerableSet lookup)
2. Verify caller owns the winning edition NFT
3. **Wipe** the edition NFT from winner's account
4. **Mint** new prize token with unique metadata
5. **Transfer** prize token to winner

**Key Features:**
- Atomic exchange (edition NFT destroyed, prize NFT created)
- Uses wipe key for clean UX (no manual burning required)
- Bearer asset model (ownership = eligibility)

## ⚙️ Configuration

### Economics Configuration
```solidity
struct MintEconomics {
    bool lazyFromContract;      // Contract pays LAZY (sponsorship)
    uint256 mintPriceHbar;      // Price in tinybars
    uint256 mintPriceLazy;      // Price in LAZY tokens
    uint256 mintPriceUsdc;      // Price in USDC (6 decimals)
    uint256 wlDiscount;         // Whitelist discount (0-100%)
    uint256 maxMint;            // Max per transaction (0 = unlimited)
    uint256 buyWlWithLazy;      // LAZY cost for WL purchase
    uint256 wlSlotsPerPurchase; // WL slots per purchase
    uint256 maxWlAddressMint;   // Max mints for WL addresses
    uint256 maxMintPerWallet;   // Max total per wallet
    address wlToken;            // Token for WL purchase
}
```

### Timing Configuration
```solidity
struct MintTiming {
    uint256 lastMintTime;       // Last mint timestamp
    uint256 mintStartTime;      // Mint start time
    bool mintPaused;            // Emergency pause
    bool wlOnly;                // Whitelist-only minting
}
```

## 📊 View Functions

### Contract State
```solidity
function getContractState() 
    returns (Phase, uint256, uint256, uint256, uint256, uint256[])
```

### Whitelist Status
```solidity
function getWhitelistStatus(address _address) 
    returns (bool, uint256, uint256, uint256)
```

### Mint Cost Calculation
```solidity
function calculateMintCost(uint256 _quantity, address _address) 
    returns (uint256, uint256, uint256)
```

### Eligibility Checks
```solidity
function canAddressMint(address _address, uint256 _quantity) 
    returns (bool, string memory)
```

### Winner Information
```solidity
function getWinningSerials() returns (uint256[] memory)
function isWinningSerial(uint256 _serial) returns (bool)
```

## 📡 Events

### Core Events
```solidity
event EditionMintEvent(address indexed minter, bool isLazyPayment, uint256 quantity, uint256 totalPaid)
event WinnerSelectedEvent(uint256[] winningSerials, uint256 timestamp)
event PrizeClaimedEvent(address indexed claimer, uint256 indexed editionSerial, uint256 timestamp)
```

### Configuration Events
```solidity
event EditionWithPrizeEvent(ContractEventType indexed eventType, address indexed msgAddress, uint256 msgNumeric)
```

Event types include:
- `PHASE_CHANGE`
- `EDITION_INITIALIZED` / `PRIZE_INITIALIZED`
- `EDITION_MINTED` / `WINNER_SELECTED` / `PRIZE_CLAIMED`
- `PAUSE` / `UNPAUSE`
- `WL_ADD` / `WL_REMOVE` / `WL_PURCHASE_LAZY` / `WL_PURCHASE_TOKEN`
- Configuration updates for all parameters

## 🛡️ Security Features

### Access Control
- **Owner-only functions**: All administrative operations
- **Phase restrictions**: Functions only available in appropriate phases
- **Pause mechanism**: Emergency stop functionality

### Reentrancy Protection
- All state-modifying external functions use `nonReentrant`
- Follows Checks-Effects-Interactions pattern throughout

### Input Validation
- Comprehensive parameter validation
- Array length matching
- Range checks (percentages, quantities)
- Zero address protection

### Payment Security
- **HBAR**: Secure refunds using OpenZeppelin's Address.sendValue
- **ERC20**: Allowance-based transfers with proper error handling
- **USDC**: Smart dual-token handling with fallback logic

### Mathematical Safety
- Solidity 0.8.18+ (built-in overflow protection)
- SafeCast for type conversions
- Proper percentage calculations

## ⚡ Gas Optimization

### Data Structures
- **EnumerableSet** for O(1) winner lookups
- **EnumerableMap** for efficient address tracking
- Packed structs where possible

### Algorithmic Efficiency
- Single-pass validations
- Batch operations support
- Optimized storage reads

### Winner Tracking Optimization
**Before**: `uint256[] public winningSerials` (O(n) lookups)
**After**: `EnumerableSet.UintSet private winningSerials` (O(1) lookups)

This optimization significantly reduces gas costs for prize claiming operations.

## 🔧 Usage Examples

### Basic Minting
```javascript
// Mint 3 editions with HBAR payment
await contract.mint(3, { value: hbarCost });
```

### Mixed Payment Minting
```javascript
// Approve LAZY and USDC allowances
await lazyToken.approve(contractAddress, lazyCost);
await usdcToken.approve(contractAddress, usdcCost);

// Mint with combined payment
await contract.mint(quantity, { value: hbarCost });
```

### Winner Selection & Claiming
```javascript
// Anyone can select winners after sellout
await contract.selectWinner();

// Winners claim prizes
await contract.claimPrize(winningSerial);
```

### Whitelist Management
```javascript
// Add manual whitelist
await contract.addToWhitelist([address1, address2], [5, 0]); // 5 slots, unlimited

// Purchase with LAZY
await lazyToken.approve(contractAddress, wlCost);
await contract.purchaseWhitelistWithLazy();

// Purchase with token
await contract.purchaseWhitelistWithToken(serialNumber);
```

## 📈 Contract Metrics

- **Deployed Size**: ~20.3 KiB (under 24KB limit)
- **Solidity Version**: 0.8.18
- **Security Grade**: A+
- **Gas Efficiency**: Optimized for minimal gas usage

## 🚀 Deployment Checklist

### Required Parameters
1. **LAZY Token**: Address of LAZY token contract
2. **LSCT**: Address of Lazy Smart Contract Treasury (for burn)
3. **Burn Percentage**: LAZY burn percentage (0-100%)
4. **PRNG Generator**: Address of PRNG contract
5. **Delegate Registry**: Address of delegate registry
6. **USDC Native**: Address of native USDC token (network-specific)
7. **USDC Bridged**: Address of bridged USDC token (network-specific)

### Network-Specific USDC Addresses
#### Mainnet
- **USDC Native**: `0x000000000000000000000000000000000006f89a`
- **USDC Bridged**: `0x0000000000000000000000000000000000101Ae3`

#### Testnet
- **USDC Native**: Custom test token (create with 6 decimals)
- **USDC Bridged**: Custom test token (create with 6 decimals)

> ⚠️ **Important**: USDC test tokens should be created with **6 decimals** to match production behavior

### Initialization Steps
1. Deploy contract with constructor parameters
2. Initialize edition token (`initializeEditionToken`)
3. Initialize prize token (`initializePrizeToken`)
4. Configure economics (`updateMintCost`, etc.)
5. Set timing (`setMintStartTime`)
6. Unpause when ready (`setPaused(false)`)

## 🔗 Integration Notes

### Frontend Integration
- Use view functions for real-time cost calculation
- Monitor events for state changes
- Implement proper allowance management for ERC20 payments

### Backend Integration
- Listen for all events for complete audit trail
- Monitor phase transitions
- Track winner selection and prize claiming

## 📝 License

GPL-3.0

## 👥 Development Team

**Lazy Superheroes**  
The OG Hedera Project

- Website: http://lazysuperheroes.com/
- DApp: https://dapp.lazysuperheroes.com/

---

*This contract represents a sophisticated NFT minting system with gamification, multi-token payments, and verifiable randomness, all built with security and gas efficiency as primary concerns.*