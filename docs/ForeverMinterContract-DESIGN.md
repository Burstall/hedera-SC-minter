# ForeverMinterContract - Technical Design Specification

## Version: 1.0
## Date: October 12, 2025
## Author: Burstall
## Status: FINAL - Ready for Implementation

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [State Variables](#state-variables)
4. [Core Functions](#core-functions)
5. [Discount System](#discount-system)
6. [Payment Processing](#payment-processing)
7. [Admin System](#admin-system)
8. [Events & Errors](#events--errors)
9. [Gas Optimization](#gas-optimization)
10. [Security Considerations](#security-considerations)

---

## 1. Overview

### Purpose
ForeverMinterContract is a distribution mechanism for pre-existing NFTs that respects Hedera network royalties. Unlike MinterContract which creates and mints NFTs on-the-fly, ForeverMinterContract manages a pool of existing NFT serials and distributes them to users based on various pricing and discount mechanisms.

### Key Differences from MinterContract

| Aspect | MinterContract | ForeverMinterContract |
|--------|----------------|----------------------|
| Token Creation | Creates token at initialization | Takes existing token address |
| Treasury Role | Contract is treasury | Contract is NOT treasury |
| Transfer Method | `transferNFTs()` (ignores royalties) | `TokenStakerV2` WITHDRAWAL (respects royalties) |
| Supply Management | Generates from metadata array | Manages pool of existing serials |
| Selection | PRNG selects metadata to mint | PRNG selects serial to distribute |

### Core Features

1. **Serial Pool Management**: Maintains an `EnumerableSet` of available NFT serials
2. **Holder Discount System**: NFT-based discounts with global usage tracking per serial
3. **Sacrifice Mechanism**: Users can sacrifice existing NFTs for discounts on new ones
4. **Refund Window**: Time-limited refunds based on actual payment amounts
5. **Whitelist System**: WL-based discounts purchasable with $LAZY
6. **Admin Multi-sig**: Role-based access control with multiple admins
7. **Royalty Compliance**: All transfers respect embedded royalty fees

---

## 2. Architecture

### Inheritance Chain

```solidity
contract ForeverMinterContract is 
    TokenStakerV2,      // NFT transfer mechanics with royalty compliance
    Ownable,            // Base ownership (owner becomes first admin)
    ReentrancyGuard     // Protection for mint/refund functions
```

### Constructor Signature

```solidity
constructor(
    address _nftToken,              // IMMUTABLE - Token to distribute
    address _lazyToken,             // For payments & burns
    address _lazyGasStation,        // For gas refills and LAZY transfers
    address _prngGenerator,         // IMMUTABLE - Random number generation
    address _lazyDelegateRegistry   // For TokenStakerV2 (can be dummy)
)
```

**Initialization Flow:**
1. Call `TokenStakerV2.initContracts(_lazyToken, _lazyGasStation, _lazyDelegateRegistry)`
2. Set immutable addresses (`nftToken`, `prngGenerator`)
3. Add `msg.sender` to `adminSet`
4. Associate contract with `nftToken`
5. Set default values for economics and timing

---

## 3. State Variables

### 3.1 Immutable Core

```solidity
address public immutable nftToken;           // Token being distributed
address public immutable prngGenerator;      // IPrngGenerator for randomness
```

### 3.2 Serial Management

```solidity
using EnumerableSet for EnumerableSet.UintSet;

EnumerableSet.UintSet private availableSerials;  // Pool of distributable serials

struct MintPayment {
    uint256 hbarPaid;        // Actual HBAR paid for this serial
    uint256 lazyPaid;        // Actual LAZY paid for this serial
    address minter;          // Who minted this serial
}

mapping(uint256 => uint256) private serialMintTime;           // serial => timestamp
mapping(uint256 => MintPayment) private serialPaymentTracking; // For accurate refunds
```

**Design Rationale:**
- `EnumerableSet` provides O(1) lookups, additions, and removals
- `serialPaymentTracking` ensures refunds match actual paid amounts (accounts for discounts)
- `serialMintTime` enables time-based refund window enforcement

### 3.3 Economics

```solidity
struct MintEconomics {
    uint256 mintPriceHbar;          // Base price in tinybar
    uint256 mintPriceLazy;          // Base price in LAZY (decimal adjusted)
    uint256 wlDiscount;             // WL discount percentage (0-100)
    uint256 sacrificeDiscount;      // Sacrifice discount percentage (0-100)
    uint256 maxMint;                // Max per transaction (50 default)
    uint256 maxMintPerWallet;       // Max per wallet total (0 = unlimited)
    uint256 buyWlWithLazy;          // Cost to buy WL spot in LAZY
    uint256 maxWlAddressMint;       // Max mints for WL addresses (0 = unlimited)
    uint256 maxSacrifice;           // Max NFTs to sacrifice per tx (20 default)
}

MintEconomics private mintEconomics;
```

**Key Constraints:**
- All percentage values: 0-100
- `maxMint`: Network limitation ~50 due to batching in TokenStakerV2 (0 = unlimited, uses collection size)
- `maxSacrifice`: 20 max due to multiple transfer operations

### 3.4 Timing & Control

```solidity
struct MintTiming {
    uint256 lastMintTime;           // Timestamp of last successful mint
    uint256 mintStartTime;          // When minting opens (0 = immediate)
    bool mintPaused;                // Emergency pause switch
    uint256 refundWindow;           // Seconds after mint for refund eligibility
    uint256 refundPercentage;       // Percentage refunded (0-100)
    bool wlOnly;                    // If true, only WL can mint
}

MintTiming private mintTiming;
```

### 3.5 Discount System (NFT-Level)

```solidity
struct DiscountTier {
    uint256 discountPercentage;     // Discount % per use (0-100)
    uint256 maxUsesPerSerial;       // Max discounted mints per serial (global)
}

DiscountTier[] private discountTiers;

mapping(address => uint256) private tokenToTierIndex;  // Token => index in discountTiers
mapping(address => bool) private isDiscountToken;      // Quick eligibility check

// Global tracking: token address => serial => uses consumed
mapping(address => mapping(uint256 => uint256)) private serialDiscountUsage;
```

**Design Rationale:**
- **Array-based tiers**: Flexible for any project to configure (LSH Gen1/Gen2/Mutants, etc.)
- **Global serial tracking**: Discount is property of the NFT, not the holder
- **Prevents gaming**: Once an NFT's discount capacity is used, it's used regardless of ownership changes
- **Supports partial usage**: If Gen1 offers 8 discounts and user only uses 3, remaining 5 stay with the NFT

**Example Configuration:**
```solidity
// LSH Gen 1: 25% discount, 8 uses per serial
discountTiers[0] = DiscountTier(25, 8);
tokenToTierIndex[0x...Gen1Address...] = 0;

// LSH Gen 2: 10% discount, 3 uses per serial
discountTiers[1] = DiscountTier(10, 3);
tokenToTierIndex[0x...Gen2Address...] = 1;
```

### 3.6 Whitelist & Wallet Tracking

```solidity
using EnumerableMap for EnumerableMap.AddressToUintMap;

EnumerableMap.AddressToUintMap private whitelistedAddressQtyMap;  // WL spots per address
EnumerableMap.AddressToUintMap private addressToNumMintedMap;     // All mints per wallet
EnumerableMap.AddressToUintMap private wlAddressToNumMintedMap;   // WL mints per wallet
```

**Design Note - Whitelist System:**
The whitelist serves dual purposes:
1. **WL-Only Phases:** Restrict minting to WL addresses during launch/controlled access
2. **Discount Mechanism:** WL addresses get discount percentage even when WL-only mode is OFF

**Key Feature:** Users can purchase WL spots with $LAZY (`buyWlWithLazy()`), making it a consumable premium currency use case. WL spots can also be:
- Airdropped as prizes/rewards
- Gifted for community engagement
- Sold for $LAZY (burns LAZY on purchase)

**Pricing Behavior:** WL discount applies whenever user is on WL, regardless of `wlOnly` mode. This ensures WL has value beyond just early access.

### 3.7 Lazy Token Configuration

```solidity
struct LazyDetails {
    address lazyToken;              // $LAZY token address
    uint256 lazyBurnPerc;           // Percentage to burn (0-100)
}

LazyDetails private lazyDetails;
ILazyGasStation public lazyGasStation;  // For gas refills and LAZY transfers
```

**Key Change from MinterContract:**
- No longer stores `IBurnableHTS lazySCT`
- Uses `ILazyGasStation.drawLazyFrom()` instead of manual transfer + burn
- LazyGasStation handles both transfer from user and burning in one call

### 3.8 Sacrifice Configuration

```solidity
address public sacrificeDestination;  // Where sacrificed NFTs go (can be address(this))
```

**Behavior:**
- If `address(this)`: Sacrificed NFTs go back into available pool (re-rolling)
- If external address: Sacrificed NFTs transferred to that address (burning/collecting)

### 3.9 Admin System

```solidity
using EnumerableSet for EnumerableSet.AddressSet;

EnumerableSet.AddressSet private adminSet;  // Multi-sig admin addresses
```

**Rules:**
1. At least one admin must always exist
2. Cannot remove last admin
3. Admins can add/remove other admins
4. All `onlyOwner` functions from MinterContract become `onlyAdmin`

---

## 4. Core Functions

### 4.1 Initialization

```solidity
function initialize(
    MintEconomics memory _economics,
    MintTiming memory _timing,
    address _sacrificeDestination
) external onlyAdmin
```

**Purpose:** Configure contract economics and timing after deployment

**Validations:**
- Only callable by admin
- Can be called multiple times to update parameters
- Validates percentage values are 0-100

**State Changes:**
- Sets `mintEconomics`
- Sets `mintTiming`
- Sets `sacrificeDestination`

---

### 4.2 NFT Pool Management

#### 4.2.1 Register NFTs

```solidity
function registerNFTs(uint256[] memory _serials) external onlyAdmin
```

**Purpose:** Register treasury-sent NFTs as available for distribution

**Prerequisites:**
- Treasury must have already sent NFTs to contract
- Each serial must be owned by contract

**Flow:**
1. For each serial in `_serials`:
   - Verify `IERC721(nftToken).ownerOf(serial) == address(this)`
   - Add to `availableSerials` set
2. Emit `NFTsAddedToPool` event

**Use Case:** Treasury sends batch of NFTs to contract, then calls this to register them

#### 4.2.2 Add NFTs to Pool

```solidity
function addNFTsToPool(uint256[] memory _serials) external
```

**Purpose:** Accept NFT donations to the pool from any address (uses STAKING transfer)

**Flow:**
1. Calculate hbar for transfer: `int64 hbarAmount = int64(uint64(_serials.length))`
2. Call `batchMoveNFTs(TransferDirection.STAKING, nftToken, _serials, msg.sender, false, hbarAmount)`
3. For each serial, add to `availableSerials`
4. Emit `NFTsAddedToPool` event

**Access:** Public (anyone can donate to pool)

**Use Case:** 
- Admin adds NFTs to pool
- Community member donates NFTs to pool
- Refunded NFTs automatically go back to pool

#### 4.2.3 Emergency Withdrawal

```solidity
function emergencyWithdrawNFTs(
    uint256[] memory _serials,
    address _recipient
) external onlyAdmin
```

**Purpose:** Remove NFTs from pool (admin control)

**Restrictions:**
- Requires `mintTiming.mintPaused == true`
- Only callable by admin

**Flow:**
1. Require contract is paused
2. For each serial:
   - Verify exists in `availableSerials`
   - Remove from `availableSerials`
3. Call `batchMoveNFTs(TransferDirection.WITHDRAWAL, nftToken, _serials, _recipient, false, 1)`
4. Emit `NFTsRemovedFromPool` event

**Use Case:** Emergency situation requiring NFT removal

---

### 4.3 Main Mint Function

```solidity
function mintNFT(
    uint256 _numberToMint,
    uint256[] memory _discountSerials,
    uint256[] memory _sacrificeSerials
) external payable nonReentrant returns (
    uint256[] memory _receivedSerials,
    uint256 _totalHbarPaid,
    uint256 _totalLazyPaid
)
```

**Purpose:** Primary user-facing function to acquire NFTs from the pool

#### 4.3.1 Validation Phase

```solidity
// Quantity checks
require(_numberToMint > 0, "BadQuantity");
if (mintEconomics.maxMint > 0) {
    require(_numberToMint <= mintEconomics.maxMint, "MaxMintExceeded");
}
require(_sacrificeSerials.length <= mintEconomics.maxSacrifice, "MaxSacrificeExceeded");

// Mutual exclusivity: cannot mix sacrifice and holder discounts
if (_sacrificeSerials.length > 0) {
    require(_discountSerials.length == 0, "CannotMixSacrificeAndDiscount");
    require(_sacrificeSerials.length == _numberToMint, "MustMatchQuantity");
}

// Timing checks
if (mintTiming.mintStartTime != 0 && block.timestamp < mintTiming.mintStartTime) {
    revert NotOpen();
}
require(!mintTiming.mintPaused, "Paused");

// Supply check
require(_numberToMint <= availableSerials.length(), "MintedOut");

// Wallet limits
if (mintEconomics.maxMintPerWallet > 0) {
    (bool found, uint256 previousMints) = addressToNumMintedMap.tryGet(msg.sender);
    uint256 totalAfterMint = (found ? previousMints : 0) + _numberToMint;
    require(totalAfterMint <= mintEconomics.maxMintPerWallet, "MaxMintPerWalletExceeded");
}

// WL-only mode
if (mintTiming.wlOnly) {
    require(whitelistedAddressQtyMap.contains(msg.sender), "NotWL");
    if (mintEconomics.maxWlAddressMint > 0) {
        (bool found, uint256 wlQty) = whitelistedAddressQtyMap.tryGet(msg.sender);
        require(found && wlQty >= _numberToMint, "NotEnoughWLSlots");
    }
}
```

#### 4.3.2 Serial Selection (Step 1 - User Friendly)

**Critical Design Decision:** Select serials BEFORE processing sacrifices to avoid handing back the same NFT that was just sacrificed.

```solidity
uint256[] memory selectedSerials = selectRandomSerials(_numberToMint);
```

**Internal Logic of `selectRandomSerials`:**
```solidity
function selectRandomSerials(uint256 _count) internal returns (uint256[] memory) {
    uint256[] memory selected = new uint256[](_count);
    uint256 poolSize = availableSerials.length();
    
    for (uint256 i = 0; i < _count; i++) {
        // Generate random index
        uint256 randomIndex = IPrngGenerator(prngGenerator).getPseudorandomNumber(
            0, 
            poolSize - 1, 
            i  // Use iteration as seed modifier
        );
        
        // Get serial at random index
        selected[i] = availableSerials.at(randomIndex);
        
        // Remove from available pool (swap with last and pop pattern)
        availableSerials.remove(selected[i]);
        poolSize--;
    }
    
    return selected;
}
```

#### 4.3.3 Cost Calculation (Step 2)

```solidity
(uint256 totalHbar, uint256 totalLazy, uint256[] memory discountUsage) = 
    calculateMintCost(msg.sender, _numberToMint, _discountSerials, _sacrificeSerials);
```

See [Section 5](#5-discount-system) for detailed calculation logic.

#### 4.3.4 Process Sacrifices (Step 3)

```solidity
if (_sacrificeSerials.length > 0) {
    // Validate ownership
    for (uint256 i = 0; i < _sacrificeSerials.length; i++) {
        require(
            IERC721(nftToken).ownerOf(_sacrificeSerials[i]) == msg.sender,
            "NotOwner"
        );
    }
    
    // STAKE sacrificed NFTs into contract (1 tinybar per NFT)
    batchMoveNFTs(
        TransferDirection.STAKING,
        nftToken,
        _sacrificeSerials,
        msg.sender,
        false,
        hbarForTransfer
    );
    
    // Route based on destination
    if (sacrificeDestination == address(this)) {
        // Add back to pool (re-roll mechanism)
        for (uint256 i = 0; i < _sacrificeSerials.length; i++) {
            availableSerials.add(_sacrificeSerials[i]);
        }
        emit SacrificeEvent(msg.sender, _sacrificeSerials, address(this));
    } else {
        // Send to external destination
        batchMoveNFTs(
            TransferDirection.WITHDRAWAL,
            nftToken,
            _sacrificeSerials,
            sacrificeDestination,
            false,
            1
        );
        emit SacrificeEvent(msg.sender, _sacrificeSerials, sacrificeDestination);
    }
}
```

#### 4.3.5 Payment Collection (Step 4)

```solidity
// Take LAZY payment
if (totalLazy > 0) {
    takeLazyPayment(totalLazy, msg.sender);
}

// Take HBAR payment
if (totalHbar > 0) {
    require(msg.value >= totalHbar, "NotEnoughHbar");
}
```

**Internal `takeLazyPayment`:**
```solidity
function takeLazyPayment(uint256 _amount, address _payer) internal {
    // Use LazyGasStation to handle transfer + burn in one call
    lazyGasStation.drawLazyFrom(_payer, _amount, lazyDetails.lazyBurnPerc);
    
    emit LazyPaymentEvent(_payer, _amount, lazyDetails.lazyBurnPerc);
}
```

**Key Change:** Uses `ILazyGasStation.drawLazyFrom()` instead of manual transfer + burn via LSCT.

#### 4.3.6 Update Discount Usage (Step 5)

```solidity
if (_discountSerials.length > 0) {
    for (uint256 i = 0; i < _discountSerials.length; i++) {
        if (discountUsage[i] > 0) {
            address discountToken = getDiscountTokenForSerial(_discountSerials[i]);
            serialDiscountUsage[discountToken][_discountSerials[i]] += discountUsage[i];
            
            emit DiscountUsed(
                msg.sender,
                discountToken,
                _discountSerials[i],
                discountUsage[i]
            );
        }
    }
}
```

#### 4.3.7 Transfer NFTs to User (Step 6)

```solidity
// Transfer NFTs to user (1 tinybar per NFT)
batchMoveNFTs(
    TransferDirection.WITHDRAWAL,
    nftToken,
    selectedSerials,
    msg.sender,
    false,
    hbarForTransfer
);
```

**Note:** `WITHDRAWAL` direction ensures royalties are properly calculated and paid.

#### 4.3.8 Update Tracking (Step 7)

```solidity
uint256 hbarPerSerial = totalHbar / _numberToMint;
uint256 lazyPerSerial = totalLazy / _numberToMint;

for (uint256 i = 0; i < selectedSerials.length; i++) {
    serialMintTime[selectedSerials[i]] = block.timestamp;
    serialPaymentTracking[selectedSerials[i]] = MintPayment({
        hbarPaid: hbarPerSerial,
        lazyPaid: lazyPerSerial,
        minter: msg.sender
    });
}

// Update global mint time
mintTiming.lastMintTime = block.timestamp;

// Update wallet tracking
bool isWlMint = whitelistedAddressQtyMap.contains(msg.sender);
updateWalletMintTracking(msg.sender, _numberToMint, isWlMint);

// Update WL spots if applicable
if (isWlMint && mintEconomics.maxWlAddressMint > 0) {
    uint256 currentSpots = whitelistedAddressQtyMap.get(msg.sender);
    whitelistedAddressQtyMap.set(msg.sender, currentSpots - _numberToMint);
}
```

#### 4.3.9 Emit Events and Return (Step 8)

```solidity
emit MintEvent(msg.sender, selectedSerials, totalHbar, totalLazy);

return (selectedSerials, totalHbar, totalLazy);
```

---

### 4.4 Refund Function

```solidity
function refundNFT(uint256[] memory _serials) external nonReentrant returns (
    uint256 _refundedHbar,
    uint256 _refundedLazy
)
```

**Purpose:** Allow users to return unwanted NFTs within refund window

#### 4.4.1 Validation & Calculation

```solidity
for (uint256 i = 0; i < _serials.length; i++) {
    uint256 serial = _serials[i];
    
    // Check ownership
    require(IERC721(nftToken).ownerOf(serial) == msg.sender, "NotOwner");
    
    // Check refund window
    require(
        block.timestamp <= serialMintTime[serial] + mintTiming.refundWindow,
        "RefundWindowExpired"
    );
    
    // Get payment info
    MintPayment memory payment = serialPaymentTracking[serial];
    
    // Calculate refund (based on what was actually paid)
    _refundedHbar += (payment.hbarPaid * mintTiming.refundPercentage) / 100;
    _refundedLazy += (payment.lazyPaid * mintTiming.refundPercentage) / 100;
}
```

**Key Design:** Refund based on `serialPaymentTracking` ensures users get back the correct amount even if they used discounts.

#### 4.4.2 Receive NFTs Back

```solidity
// Receive NFTs back (1 tinybar per NFT)
batchMoveNFTs(
    TransferDirection.STAKING,
    nftToken,
    _serials,
    msg.sender,
    false,
    hbarForTransfer
);
```

#### 4.4.3 Return to Pool

```solidity
for (uint256 i = 0; i < _serials.length; i++) {
    availableSerials.add(_serials[i]);
}
```

#### 4.4.4 Issue Refunds

```solidity
if (_refundedHbar > 0) {
    Address.sendValue(payable(msg.sender), _refundedHbar);
}

if (_refundedLazy > 0) {
    // Request refund from LazyGasStation (it holds the LAZY)
    lazyGasStation.payoutLazy(msg.sender, _refundedLazy, 0); // 0 burn for refunds
}
```

#### 4.4.5 Update Tracking

```solidity
// Decrement mint counts
updateWalletMintTrackingRefund(msg.sender, _serials.length);

// Clean up tracking data
for (uint256 i = 0; i < _serials.length; i++) {
    delete serialMintTime[_serials[i]];
    delete serialPaymentTracking[_serials[i]];
}

emit RefundEvent(msg.sender, _serials, _refundedHbar, _refundedLazy);
```

---

## 5. Discount System

### 5.1 Cost Calculation Logic

```solidity
function calculateMintCost(
    address _user,
    uint256 _quantity,
    uint256[] memory _discountSerials,
    uint256[] memory _sacrificeSerials
) public view returns (
    uint256 _totalHbar,
    uint256 _totalLazy,
    uint256[] memory _discountUsage
)
```

#### 5.1.1 Sacrifice Mode (Exclusive)

```solidity
if (_sacrificeSerials.length > 0) {
    // Validate all serials are owned by user
    for (uint256 i = 0; i < _sacrificeSerials.length; i++) {
        require(
            IERC721(nftToken).ownerOf(_sacrificeSerials[i]) == _user,
            "NotOwner"
        );
    }
    
    // Calculate base cost
    uint256 baseHbar = mintEconomics.mintPriceHbar * _quantity;
    uint256 baseLazy = mintEconomics.mintPriceLazy * _quantity;
    
    // Apply sacrifice discount (no other discounts allowed)
    _totalHbar = (baseHbar * (100 - mintEconomics.sacrificeDiscount)) / 100;
    _totalLazy = (baseLazy * (100 - mintEconomics.sacrificeDiscount)) / 100;
    
    // No discount usage tracking for sacrifice
    return (_totalHbar, _totalLazy, new uint256[](0));
}
```

**Example:**
- Base price: 1000 HBAR
- Sacrifice 5 NFTs for 5 mints
- Sacrifice discount: 50%
- Total cost: 5 × (1000 × 50%) = 2,500 HBAR

#### 5.1.2 WL + Holder Discount Mode (Stacking)

```solidity
bool isWl = whitelistedAddressQtyMap.contains(_user);
uint256 remainingToMint = _quantity;
_discountUsage = new uint256[](_discountSerials.length);

// Process each discount serial
for (uint256 i = 0; i < _discountSerials.length && remainingToMint > 0; i++) {
    (bool eligible, uint256 remainingUses, uint256 discountPercent) = 
        getSerialDiscountInfo(_discountSerials[i]);
    
    if (eligible && remainingUses > 0) {
        // Verify user owns this discount NFT
        address discountToken = getDiscountTokenForSerial(_discountSerials[i]);
        require(
            IERC721(discountToken).ownerOf(_discountSerials[i]) == _user,
            "NotOwner"
        );
        
        // Calculate uses for this serial
        uint256 usesThisMint = Math.min(remainingUses, remainingToMint);
        _discountUsage[i] = usesThisMint;
        
        // Stack WL + Holder discount
        uint256 effectiveDiscount = discountPercent;
        if (isWl) {
            effectiveDiscount += mintEconomics.wlDiscount;
            effectiveDiscount = Math.min(effectiveDiscount, 100); // Cap at 100%
        }
        
        // Calculate discounted price
        uint256 discountedHbar = (mintEconomics.mintPriceHbar * (100 - effectiveDiscount)) / 100;
        uint256 discountedLazy = (mintEconomics.mintPriceLazy * (100 - effectiveDiscount)) / 100;
        
        _totalHbar += discountedHbar * usesThisMint;
        _totalLazy += discountedLazy * usesThisMint;
        
        remainingToMint -= usesThisMint;
    }
}

// Handle remaining mints without holder discounts (but possibly WL)
if (remainingToMint > 0) {
    uint256 effectiveDiscount = isWl ? mintEconomics.wlDiscount : 0;
    uint256 priceHbar = (mintEconomics.mintPriceHbar * (100 - effectiveDiscount)) / 100;
    uint256 priceLazy = (mintEconomics.mintPriceLazy * (100 - effectiveDiscount)) / 100;
    
    _totalHbar += priceHbar * remainingToMint;
    _totalLazy += priceLazy * remainingToMint;
}
```

**Example Scenarios:**

**Scenario 1: WL + Single Holder Discount**
- Base price: 1000 HBAR
- WL discount: 10%
- Owns 1x LSH Gen1 (25% discount, 3 uses remaining)
- Mints: 5 NFTs

Calculation:
- 3 mints with Gen1 + WL: `1000 × (100 - 25 - 10)% = 650 HBAR each` → 1,950 HBAR
- 2 mints with WL only: `1000 × (100 - 10)% = 900 HBAR each` → 1,800 HBAR
- **Total: 3,750 HBAR**

**Scenario 2: Multiple Holder Discounts**
- Base price: 1000 HBAR
- Owns 2x LSH Gen1 (25% discount, 8 uses each = 16 total)
- Owns 1x LSH Gen2 (10% discount, 3 uses)
- Not WL
- Mints: 20 NFTs

Calculation:
- 16 mints with Gen1: `1000 × 75% = 750 HBAR each` → 12,000 HBAR
- 3 mints with Gen2: `1000 × 90% = 900 HBAR each` → 2,700 HBAR
- 1 mint at base: `1000 HBAR` → 1,000 HBAR
- **Total: 15,700 HBAR**

**Scenario 3: WL + Multiple Holder Discounts (Stacking)**
- Base price: 1000 HBAR
- WL discount: 10%
- Owns 1x LSH Gen1 (25% discount, 2 uses)
- Owns 1x LSH Gen2 (10% discount, 3 uses)
- Mints: 6 NFTs

Calculation:
- 2 mints with Gen1 + WL: `1000 × (100 - 25 - 10)% = 650 HBAR each` → 1,300 HBAR
- 3 mints with Gen2 + WL: `1000 × (100 - 10 - 10)% = 800 HBAR each` → 2,400 HBAR
- 1 mint with WL only: `1000 × 90% = 900 HBAR` → 900 HBAR
- **Total: 4,600 HBAR**

### 5.2 Serial Discount Info

```solidity
function getSerialDiscountInfo(uint256 _serial) public view returns (
    bool _eligible,
    uint256 _remainingUses,
    uint256 _discountPercent
)
```

**Logic:**
```solidity
// Find which discount token this serial belongs to
address tokenAddress = findTokenForSerial(_serial);

if (!isDiscountToken[tokenAddress]) {
    return (false, 0, 0);
}

uint256 tierIndex = tokenToTierIndex[tokenAddress];
DiscountTier memory tier = discountTiers[tierIndex];

uint256 usedCount = serialDiscountUsage[tokenAddress][_serial];
uint256 remainingUses = tier.maxUsesPerSerial > usedCount 
    ? tier.maxUsesPerSerial - usedCount 
    : 0;

return (true, remainingUses, tier.discountPercentage);
```

**Returns:**
- `(false, 0, 0)` → Not a discount-eligible NFT
- `(true, 0, 25)` → Was eligible for 25% discount, all uses consumed
- `(true, 5, 25)` → Eligible for 25% discount, 5 uses remaining

### 5.3 Batch Discount Check

```solidity
function getBatchSerialDiscountInfo(uint256[] memory _serials) external view returns (
    bool[] memory _eligible,
    uint256[] memory _remainingUses,
    uint256[] memory _discountPercent
)
```

**Purpose:** Frontend calls this with user's owned serials (from mirror node) to show available discounts

**Usage Example (Frontend):**
1. Query mirror node: Get all NFTs owned by user
2. Filter to discount-eligible collections
3. Call `getBatchSerialDiscountInfo([serial1, serial2, ...])
4. Display to user: "You can get 8 discounted mints using your Gen1 #1234"

---

## 6. Payment Processing

### 6.1 LAZY Payment (via LazyGasStation)

```solidity
function takeLazyPayment(uint256 _amount, address _payer) internal {
    lazyGasStation.drawLazyFrom(_payer, _amount, lazyDetails.lazyBurnPerc);
    emit LazyPaymentEvent(_payer, _amount, lazyDetails.lazyBurnPerc);
}
```

**Benefits of LazyGasStation:**
- Single call handles: approval check, transfer, and burn
- Centralized burn accounting
- Gas efficient
- Consistent behavior across all contracts

**Prerequisites:**
- User must have approved LazyGasStation (not ForeverMinterContract) to spend LAZY
- LazyGasStation must be authorized to interact with LSCT for burns

### 6.2 HBAR Payment

```solidity
// In mintNFT function
if (totalHbar > 0) {
    require(msg.value >= totalHbar, "NotEnoughHbar");
}

// Refund excess
if (msg.value > totalHbar) {
    Address.sendValue(payable(msg.sender), msg.value - totalHbar);
}
```

### 6.3 Withdrawal (Admin Only, with Cooldown)

```solidity
function withdrawHbar(
    address payable _recipient,
    uint256 _amount
) external onlyAdmin {
    require(
        block.timestamp >= mintTiming.lastMintTime + mintTiming.refundWindow,
        "CooldownActive"
    );
    
    Address.sendValue(_recipient, _amount);
    emit HbarWithdrawn(_recipient, _amount);
}

function withdrawLazy(
    address _recipient,
    uint256 _amount
) external onlyAdmin {
    require(
        block.timestamp >= mintTiming.lastMintTime + mintTiming.refundWindow,
        "CooldownActive"
    );
    
    bool success = IERC20(lazyDetails.lazyToken).transfer(_recipient, _amount);
    require(success, "LazyTransferFailed");
    emit LazyWithdrawn(_recipient, _amount);
}
```

**Design Rationale:**
- Cooldown ensures contract has enough funds for refunds
- Cooldown = `refundWindow` (e.g., if refund window is 60 minutes, can't withdraw until 60 minutes after last mint)

---

## 7. Admin System

### 7.1 Admin Set Management

```solidity
using EnumerableSet for EnumerableSet.AddressSet;

EnumerableSet.AddressSet private adminSet;

modifier onlyAdmin() {
    require(adminSet.contains(msg.sender), "NotAdmin");
    _;
}
```

### 7.2 Admin Functions

```solidity
function addAdmin(address _newAdmin) external onlyAdmin returns (bool) {
    require(_newAdmin != address(0), "ZeroAddress");
    bool added = adminSet.add(_newAdmin);
    if (added) {
        emit AdminAdded(_newAdmin, msg.sender);
    }
    return added;
}

function removeAdmin(address _admin) external onlyAdmin returns (bool) {
    require(adminSet.length() > 1, "CannotRemoveLastAdmin");
    require(_admin != msg.sender, "CannotRemoveSelf"); // Optional safety
    
    bool removed = adminSet.remove(_admin);
    if (removed) {
        emit AdminRemoved(_admin, msg.sender);
    }
    return removed;
}

function isAdmin(address _address) external view returns (bool) {
    return adminSet.contains(_address);
}

function getAdmins() external view returns (address[] memory) {
    uint256 length = adminSet.length();
    address[] memory admins = new address[](length);
    for (uint256 i = 0; i < length; i++) {
        admins[i] = adminSet.at(i);
    }
    return admins;
}

function getRemainingSupply() external view returns (uint256) {
    return availableSerials.length();
}
```

### 7.3 Protected Functions

All functions marked `onlyOwner` in MinterContract become `onlyAdmin`:

**Economics:**
- `updateCost`
- `updateWlDiscount`
- `updateSacrificeDiscount`
- `updateMaxMint`
- `updateMaxSacrifice`
- `updateMaxMintPerWallet`

**Timing:**
- `updateMintStartTime`
- `updateRefundWindow`
- `updateRefundPercentage`
- `updatePauseStatus`
- `updateWlOnlyStatus`

**Whitelist:**
- `addToWhitelist`
- `removeFromWhitelist`
- `clearWhitelist`

**Discount Tiers:**
- `addDiscountTier`
- `updateDiscountTier`
- `removeDiscountTier`

**Configuration:**
- `setSacrificeDestination`
- `updateLazyBurnPercentage`
- `updateLazyGasStation`

**Pool Management:**
- `depositNFTsFromTreasury`
- `emergencyWithdrawNFTs`

**Withdrawals:**
- `withdrawHbar`
- `withdrawLazy`

---

## 8. Events & Errors

### 8.1 Events

```solidity
// Minting Events
event MintEvent(
    address indexed minter,
    uint256[] serials,
    uint256 hbarPaid,
    uint256 lazyPaid
);

event RefundEvent(
    address indexed refunder,
    uint256[] serials,
    uint256 hbarRefunded,
    uint256 lazyRefunded
);

// Sacrifice Events
event SacrificeEvent(
    address indexed sacrificer,
    uint256[] sacrificedSerials,
    address indexed destination
);

// Pool Management Events
event NFTsAddedToPool(
    address indexed contributor,
    uint256[] serials,
    uint256 newPoolSize
);

event NFTsRemovedFromPool(
    address indexed admin,
    uint256[] serials,
    uint256 newPoolSize
);

// Discount Events
event DiscountTierAdded(
    address indexed tokenAddress,
    uint256 discountPercentage,
    uint256 maxUsesPerSerial
);

event DiscountTierUpdated(
    address indexed tokenAddress,
    uint256 discountPercentage,
    uint256 maxUsesPerSerial
);

event DiscountTierRemoved(
    address indexed tokenAddress
);

event DiscountUsed(
    address indexed user,
    address indexed discountToken,
    uint256 serial,
    uint256 usesConsumed
);

// Payment Events
event LazyPaymentEvent(
    address indexed payer,
    uint256 amount,
    uint256 burnPercentage
);

event HbarWithdrawn(
    address indexed recipient,
    uint256 amount
);

event LazyWithdrawn(
    address indexed recipient,
    uint256 amount
);

// Admin Events
event AdminAdded(
    address indexed newAdmin,
    address indexed addedBy
);

event AdminRemoved(
    address indexed removedAdmin,
    address indexed removedBy
);

// Configuration Events
event EconomicsUpdated(
    string parameter,
    uint256 oldValue,
    uint256 newValue
);

event TimingUpdated(
    string parameter,
    uint256 oldValue,
    uint256 newValue
);

event SacrificeDestinationUpdated(
    address indexed oldDestination,
    address indexed newDestination
);

// Whitelist Events
event WhitelistAdded(
    address indexed user,
    uint256 spots
);

event WhitelistRemoved(
    address indexed user
);

event WhitelistPurchased(
    address indexed user,
    uint256 spotsPurchased,
    uint256 lazyPaid
);
```

### 8.2 Errors

```solidity
// Initialization Errors
error NotInitialized();
error AlreadyInitialized();

// Quantity Errors
error BadQuantity(uint256 quantity);
error MaxMintExceeded(uint256 requested, uint256 max);
error MaxSacrificeExceeded(uint256 requested, uint256 max);
error MaxMintPerWalletExceeded(uint256 totalAfterMint, uint256 max);
error MustMatchQuantity();

// State Errors
error NotOpen();
error Paused();
error MintedOut();

// Access Errors
error NotAdmin();
error NotWL();
error NotOwner();
error NotEligibleForDiscount();

// Payment Errors
error NotEnoughHbar();
error NotEnoughLazy();
error LazyTransferFailed();

// Discount Errors
error CannotMixSacrificeAndDiscount();
error InvalidDiscountSerial(uint256 serial);
error DiscountAlreadyFullyUsed(uint256 serial);

// Refund Errors
error RefundWindowExpired(uint256 serial, uint256 expiredAt);
error NotEligibleForRefund();

// Pool Management Errors
error SerialNotOwnedByContract(uint256 serial);
error SerialNotInPool(uint256 serial);
error EmergencyWithdrawOnlyWhenPaused();

// Admin Errors
error CannotRemoveLastAdmin();
error CannotRemoveSelf();
error ZeroAddress();

// Cooldown Errors
error CooldownActive(uint256 timeRemaining);

// Configuration Errors
error InvalidPercentage(uint256 value);
error InvalidConfiguration();
```

---

## 9. Gas Optimization

### 9.1 EnumerableSet for Serials

**Choice:** Use `EnumerableSet.UintSet` for `availableSerials`

**Pros:**
- O(1) additions and removals
- O(1) contains check
- Built-in length tracking
- Random access via `at(index)`

**Cons:**
- Slightly higher gas for iteration
- More storage slots

**Verdict:** Optimal for this use case due to frequent random access

### 9.2 Batching in TokenStakerV2

TokenStakerV2 already handles batching internally:
- Splits large arrays into chunks of 8 NFTs
- Processes multiple transfers efficiently
- Supports up to 50 NFTs per transaction

### 9.3 Memory vs Storage

**Optimization Points:**
- Use `memory` for temporary arrays in view functions
- Use `storage` pointers for struct access
- Minimize SLOAD operations by caching storage values

### 9.4 Unchecked Arithmetic

Use `unchecked` blocks where overflow is impossible:

```solidity
for (uint256 i = 0; i < length; ) {
    // ... operations ...
    unchecked {
        ++i;
    }
}
```

---

## 10. Security Considerations

### 10.1 Reentrancy Protection

**Protected Functions:**
- `mintNFT` → `nonReentrant`
- `refundNFT` → `nonReentrant`

**Rationale:** Both functions involve external calls (token transfers, payments) and state changes

### 10.2 Checks-Effects-Interactions Pattern

**Mint Flow:**
1. ✅ Checks: Validate all conditions
2. ✅ Effects: Update state (remove serials, update tracking)
3. ✅ Interactions: Transfer NFTs, take payments

**Refund Flow:**
1. ✅ Checks: Validate eligibility, ownership
2. ✅ Effects: Update state (add serials back, clear tracking)
3. ✅ Interactions: Transfer NFTs back, issue refunds

### 10.3 Integer Overflow/Underflow

**Mitigation:**
- Using Solidity 0.8.x (built-in overflow protection)
- Additional checks for critical calculations (percentages, costs)

### 10.4 Front-Running

**Considerations:**
- Serial selection is non-deterministic (PRNG-based)
- Discount usage is first-come-first-served
- No MEV opportunities for sandwich attacks

### 10.5 Admin Key Management

**Recommendations:**
1. Use multi-sig wallet as initial admin
2. Add multiple trusted admins for redundancy
3. Never remove all admins (enforced by contract)
4. Consider timelock for critical parameter changes

### 10.6 Emergency Procedures

**Pause Mechanism:**
- Admin can pause minting instantly
- Refunds still work when paused
- Emergency withdrawals require pause state

**Recovery Options:**
- Emergency withdrawal of NFTs
- Admin can adjust parameters
- Multiple admins prevent single point of failure

---

## 11. Deployment Checklist

### 11.1 Constructor Arguments

1. `nftToken` → Verify correct token address
2. `lazyToken` → Verify $LAZY token address
3. `lazyGasStation` → Verify LazyGasStation contract
4. `prngGenerator` → Verify PrngGenerator contract
5. `lazyDelegateRegistry` → Can be dummy address (0x000...001)

### 11.2 Post-Deployment Setup

1. Call `initialize()` with economics and timing
2. Call `addDiscountTier()` for each discount tier
3. Call `setSacrificeDestination()` if using external address
4. Add additional admins via `addAdmin()`
5. Associate contract with NFT token (done in constructor)
6. Fund LazyGasStation with HBAR for gas refills
7. Transfer NFTs to contract (if treasury-owned)
8. Call `depositNFTsFromTreasury()` to register them

### 11.3 Verification Steps

1. Verify all immutable addresses are correct
2. Test mint with HBAR payment
3. Test mint with LAZY payment
4. Test mint with WL discount
5. Test mint with holder discount
6. Test mint with sacrifice
7. Test refund mechanism
8. Test emergency withdrawal
9. Test admin functions
10. Verify events are emitted correctly

---

## 12. Future Enhancements

### 12.1 Potential Features

1. **Dynamic Pricing:** Adjust prices based on supply/demand
2. **Time-based Discounts:** Early bird specials, happy hours
3. **Referral System:** Reward users who bring new minters
4. **Staking Rewards:** Reward users who stake NFTs to pool
5. **Batch Refunds:** Gas-optimized bulk refunds
6. **Discount Trading:** Allow transfer of unused discount capacity
7. **Analytics Dashboard:** On-chain metrics for discount usage, sales

### 12.2 Upgrade Path

**Proxy Pattern Consideration:**
- Current design: Non-upgradeable
- Future: Consider UUPS or Transparent Proxy
- Trade-off: Complexity vs Flexibility

---

## Appendix A: Comparison Matrix

| Feature | MinterContract | ForeverMinterContract |
|---------|----------------|----------------------|
| Token Creation | ✅ Creates token | ❌ Uses existing |
| Royalty Handling | ❌ Ignores (treasury) | ✅ Respects (non-treasury) |
| Transfer Method | `transferNFTs()` | `TokenStakerV2.batchMoveNFTs()` |
| Supply Type | Generated on-demand | Pre-existing pool |
| Selection | PRNG + metadata | PRNG + serial pool |
| Max Per TX | 10 | 50 |
| Sacrifice | ❌ No | ✅ Yes |
| Holder Discounts | ❌ No | ✅ Yes (NFT-level) |
| Refund System | ❌ No | ✅ Yes (time-window) |
| WL Discount | ✅ Yes | ✅ Yes (stacking) |
| Admin System | Single owner | Multi-admin set |
| LAZY Payment | Manual transfer+burn | LazyGasStation |

---

## Appendix B: Gas Estimates

| Function | Estimated Gas | Notes |
|----------|---------------|-------|
| `mintNFT` (1 NFT) | ~500k | Includes WITHDRAWAL transfer + royalty |
| `mintNFT` (10 NFTs) | ~1.5M | Batching efficiency |
| `mintNFT` (50 NFTs) | ~5M | Maximum batch size |
| `mintNFT` with sacrifice | +200k per NFT | Additional STAKING transfers |
| `refundNFT` (1 NFT) | ~400k | Includes STAKING transfer |
| `addDiscountTier` | ~100k | Storage writes |
| `depositNFTsFromTreasury` | ~50k per NFT | EnumerableSet operations |
| `emergencyWithdrawNFTs` | ~400k per NFT | WITHDRAWAL transfers |

*Estimates are approximate and depend on network conditions*

---

## Appendix C: Error Scenarios & Handling

| Scenario | Contract Behavior | User Action |
|----------|------------------|-------------|
| Not enough HBAR sent | Revert with `NotEnoughHbar` | Send more HBAR |
| LAZY allowance too low | Revert in LazyGasStation | Approve LazyGasStation |
| Discount serial not owned | Revert with `NotOwner` | Use owned serials |
| Refund window expired | Revert with `RefundWindowExpired` | No refund available |
| Mint when paused | Revert with `Paused` | Wait for unpause |
| Pool empty | Revert with `MintedOut` | Wait for pool refill |
| Mix sacrifice + discount | Revert with `CannotMixSacrificeAndDiscount` | Choose one method |
| Last admin removal | Revert with `CannotRemoveLastAdmin` | Add new admin first |

---

**END OF TECHNICAL DESIGN SPECIFICATION**
