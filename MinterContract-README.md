# MinterContract

## Overview

The `MinterContract` is a feature-rich Hedera Token Service (HTS) based NFT minting contract designed for creating **transferable NFTs** with advanced minting mechanics, economic systems, and comprehensive administrative controls. Unlike soulbound tokens, this contract creates standard NFTs that can be freely transferred between accounts while maintaining sophisticated minting controls and payment systems.

## Key Features

### 1. Standard NFT Minting
- **Transferable Tokens**: Creates standard HTS NFTs that can be freely transferred
- **Batch Minting**: Efficient batch processing for multiple NFTs in a single transaction
- **Metadata Management**: Support for both fixed edition and unique metadata per NFT
- **Supply Control**: Configurable maximum supply with unlimited supply option

### 2. Advanced Economic System
- **Dual Currency Support**: Accept both HBAR and $LAZY token payments
- **Dynamic Pricing**: Separate pricing for whitelisted vs public mints
- **Discount Mechanisms**: Configurable percentage discounts for whitelisted users
- **Token Economics**: Automatic $LAZY token burning on each mint

### 3. Comprehensive Whitelist System
- **Multi-Tier Access**: Address-based whitelisting with quantity allocations
- **Token-Gated Access**: Use existing NFT holdings for whitelist eligibility
- **$LAZY Purchases**: Buy whitelist spots using $LAZY tokens
- **Flexible Limits**: Per-address and per-wallet minting limits

### 4. Timing & Access Controls
- **Scheduled Launches**: Configure specific start times for minting
- **Cooldown Periods**: Prevent rapid successive mints from the same address
- **Pause Functionality**: Administrative ability to pause/resume minting
- **Whitelist-Only Phases**: Restrict minting to whitelisted users only

### 5. Refund & Burn System
- **Time-Based Refunds**: Allow users to burn NFTs for refunds within specified windows
- **Flexible Economics**: Configurable refund calculations and burn mechanics
- **Serial Tracking**: Comprehensive tracking of mint timestamps for refund eligibility

### 6. Administrative Features
- **Owner Controls**: Comprehensive administrative functions for contract management
- **Parameter Updates**: Dynamic updating of all contract parameters
- **Emergency Controls**: Pause and emergency management capabilities
- **Query Functions**: Extensive read-only functions for contract state monitoring

## Technical Architecture

### Contract Inheritance
```solidity
contract MinterContract is ExpiryHelper, Ownable, ReentrancyGuard
```

### Core Dependencies
- **HederaTokenService**: Native HTS integration for NFT operations
- **OpenZeppelin**: Security and utility libraries
- **MinterLibrary**: Shared functionality library for space optimization
- **Custom Interfaces**: IHRC719 for token association, IBurnableHTS for burn operations

### Key Data Structures

#### MintTiming
```solidity
struct MintTiming {
    uint256 lastMintTime;      // Last recorded mint timestamp
    uint256 mintStartTime;     // When minting becomes available
    bool mintPaused;           // Pause state for minting
    uint256 cooldownPeriod;    // Required time between mints per address
    uint256 refundWindow;      // Time window for refund eligibility
    bool wlOnly;               // Whitelist-only minting mode
}
```

#### MintEconomics
```solidity
struct MintEconomics {
    bool lazyFromContract;     // Whether contract pays $LAZY fees
    uint256 mintPriceHbar;     // Price in tinybar (10^-8 HBAR)
    uint256 mintPriceLazy;     // Price in $LAZY tokens
    uint256 wlDiscount;        // Whitelist discount percentage
    uint256 maxMint;           // Maximum mint per transaction
    uint256 buyWlWithLazy;     // $LAZY cost for whitelist spot
    uint256 maxWlAddressMint;  // Maximum mints per whitelisted address
    uint256 maxMintPerWallet;  // Maximum mints per wallet (all users)
    address wlToken;           // Token contract for token-gated whitelist
}
```

#### LazyDetails
```solidity
struct LazyDetails {
    address lazyToken;         // $LAZY token contract address
    uint256 lazyBurnPerc;      // Percentage of $LAZY to burn per mint
    IBurnableHTS lazySCT;      // Lazy Smart Contract Treasury interface
}
```

## Deployment & Initialization

### Constructor Parameters
```solidity
constructor(
    address lsct,           // Lazy Smart Contract Treasury address
    address lazy,           // $LAZY token contract address
    uint256 lazyBurnPerc    // Percentage of $LAZY to burn per mint (0-100)
)
```

### Initial Setup Process
1. **Token Association**: Automatically associates with $LAZY token
2. **Default Configuration**: Sets conservative default parameters
3. **State Initialization**: Prepares contract for token creation

### Token Creation
```solidity
function initialiseNFTMint(
    string memory _name,           // Token name
    string memory _symbol,         // Token symbol
    string memory _memo,           // Token description
    string memory _cid,            // IPFS CID for metadata
    string[] memory _metadata,     // Metadata array for NFTs
    int64 _maxSupply              // Maximum token supply (-1 for unlimited)
) external payable onlyOwner returns (address, uint256)
```

## Core Functionality

### Primary Minting Function
```solidity
function mintNFT(uint256 _numberToMint) 
    external payable nonReentrant 
    returns (int64[] memory _serials, bytes[] memory _metadataForMint)
```

**Process Flow:**
1. **Validation**: Checks quantity, timing, pause state, and availability
2. **Access Control**: Validates whitelist status and mint limits
3. **Payment Processing**: Handles HBAR and $LAZY token payments
4. **Metadata Selection**: Randomly or sequentially selects metadata
5. **Token Minting**: Creates NFTs via HTS in batches
6. **Token Transfer**: Transfers minted NFTs to user
7. **State Updates**: Updates tracking maps and mint counts

### Whitelist Management

#### Administrative Whitelist Addition
```solidity
function addToWhitelist(address[] memory _newAddresses) external onlyOwner
```
Adds addresses to whitelist with default allocation quantity.

#### User-Initiated Whitelist Purchase
```solidity
function buyWlWithLazy() external returns (uint256 _wlSpotsPurchased)
```
Allows users to purchase whitelist spots using $LAZY tokens.

#### Token-Gated Whitelist Access
Users can gain whitelist access by owning specific NFTs, with serials tracked to prevent double-spending of whitelist privileges.

### Burn & Refund System
```solidity
function burnForRefund(int64[] memory _serials) 
    external returns (uint256 _refundHbar, uint256 _refundLazy)
```

**Refund Logic:**
- Validates user ownership of NFTs
- Checks refund window eligibility
- Calculates proportional refunds based on original payment
- Burns NFTs and transfers refunds
- Updates contract state

## Administrative Functions

### Economic Parameter Updates
```solidity
function updatePricing(uint256 _hbarPrice, uint256 _lazyPrice) external onlyOwner
function updateWlDiscount(uint256 _wlDiscount) external onlyOwner
function updateLazyBurnPercentage(uint256 _lbp) external onlyOwner
function updateMaxMint(uint256 _maxMint) external onlyOwner
function updateMaxMintPerWallet(uint256 _max) external onlyOwner
```

### Timing & Access Control Updates
```solidity
function updateMintStartTime(uint256 _startTime) external onlyOwner
function updateCooldown(uint256 _cooldownPeriod) external onlyOwner
function updateRefundWindow(uint256 _refundWindow) external onlyOwner
function pause() external onlyOwner
function unpause() external onlyOwner
function toggleWlOnly() external onlyOwner
```

### Contract Configuration Updates
```solidity
function updateLSCT(address _lsct) external onlyOwner
function updateLazyToken(address _lazy) external onlyOwner
function updateWlToken(address _wlToken) external onlyOwner
function updateCID(string memory _cid) external onlyOwner
function updatePrng(address _prng) external onlyOwner
```

## Query Functions

### Contract State Information
```solidity
function getNFTTokenAddress() external view returns (address)
function getLazyToken() external view returns (address)
function getLSCT() external view returns (address)
function getPaused() external view returns (bool)
function getWlOnly() external view returns (bool)
```

### Supply & Minting Information
```solidity
function getTotalMinted() external view returns (uint256)
function getMaxSupply() external view returns (uint256)
function getRemainingMint() external view returns (uint256)
function getBatchSize() external view returns (uint256)
function getMetadataLength() external view returns (uint256)
```

### Economic Information
```solidity
function getCost() external view returns (uint256 _hbar, uint256 _lazy)
function getLazyBurnPercentage() external view returns (uint256)
function getMintTiming() external view returns (MintTiming memory)
function getMintEconomics() external view returns (MintEconomics memory)
```

### User & Whitelist Queries
```solidity
function getWhiteListLength() external view returns (uint256)
function getQtyWhiteListed(address _user) external view returns (uint256)
function checkEligibility(address _user, uint256 _qty) external view returns (bool)
function getNumberOfWLUsed(address _address) external view returns (uint256)
function getNumMintedByAddress(address _user) external view returns (uint256)
function getWLTokensUsed() external view returns (uint256[] memory)
function getWlSerialsUsed() external view returns (uint256[] memory)
```

### Timing & Cooldown Queries
```solidity
function getWalletMintTime(address _user) external view returns (uint256)
function getSerialMintTime(uint256 _serial) external view returns (uint256)
function checkMintTiming(address _user) external view returns (bool)
function checkCooldown(address _user) external view returns (bool)
```

## Usage Examples

### Complete Deployment & Configuration
```javascript
// Deploy the contract
const minterContract = await MinterContract.deploy(
    lsctAddress,           // Lazy Smart Contract Treasury
    lazyTokenAddress,      // $LAZY token address
    15                     // 15% burn percentage
);

// Initialize NFT collection
const metadataArray = [
    "metadata1.json",
    "metadata2.json",
    "metadata3.json"
    // ... more metadata files
];

await minterContract.initialiseNFTMint(
    "MyNFTCollection",     // name
    "MYNFT",               // symbol
    "An amazing NFT collection", // memo
    "QmYourIPFSCID",       // IPFS CID
    metadataArray,         // metadata array
    1000                   // max supply
);

// Configure economic parameters
await minterContract.updatePricing(
    ethers.utils.parseEther("1.0"),      // 1 HBAR
    ethers.utils.parseUnits("50", 8)     // 50 $LAZY
);

await minterContract.updateWlDiscount(25);   // 25% discount for WL
await minterContract.updateMaxMint(10);      // Max 10 per transaction
await minterContract.updateMaxMintPerWallet(25); // Max 25 per wallet

// Set timing parameters
await minterContract.updateMintStartTime(
    Math.floor(Date.now() / 1000) + 3600  // Start in 1 hour
);
await minterContract.updateCooldown(300);     // 5 minute cooldown
await minterContract.updateRefundWindow(86400); // 24 hour refund window
```

### Whitelist Management
```javascript
// Add addresses to whitelist
const whitelistAddresses = [
    "0x1234567890123456789012345678901234567890",
    "0x2345678901234567890123456789012345678901",
    "0x3456789012345678901234567890123456789012"
];

await minterContract.addToWhitelist(whitelistAddresses);

// Configure whitelist-only period
await minterContract.toggleWlOnly(); // Enable whitelist-only minting

// Later, open to public
await minterContract.toggleWlOnly(); // Disable whitelist-only minting
```

### User Minting Process
```javascript
// Check eligibility and cost
const [hbarCost, lazyCost] = await minterContract.getCost();
const canMint = await minterContract.checkEligibility(userAddress, 3);

if (canMint) {
    // Approve $LAZY tokens if needed
    if (lazyCost > 0) {
        await lazyToken.approve(
            minterContract.address, 
            lazyCost.mul(3) // For 3 NFTs
        );
    }
    
    // Mint NFTs
    const mintTx = await minterContract.mintNFT(3, {
        value: hbarCost.mul(3) // HBAR payment
    });
    
    const receipt = await mintTx.wait();
    console.log("Minted NFTs:", receipt);
}
```

### Whitelist Purchase with $LAZY
```javascript
// User buys whitelist spot
const buyTx = await minterContract.buyWlWithLazy();
const receipt = await buyTx.wait();

// Check how many spots were purchased
const spotsPurchased = receipt.events.find(
    e => e.event === 'MinterContractMessage'
)?.args?._msgNumeric;

console.log(`Purchased ${spotsPurchased} whitelist spots`);
```

### Refund Process
```javascript
// Check refund eligibility
const userNFTs = await getUserNFTSerials(userAddress); // Custom function
const eligibleSerials = [];

for (const serial of userNFTs) {
    const mintTime = await minterContract.getSerialMintTime(serial);
    const refundWindow = await minterContract.getMintTiming().refundWindow;
    
    if (block.timestamp - mintTime <= refundWindow) {
        eligibleSerials.push(serial);
    }
}

if (eligibleSerials.length > 0) {
    // Burn NFTs for refund
    const burnTx = await minterContract.burnForRefund(eligibleSerials);
    const receipt = await burnTx.wait();
    
    // Extract refund amounts from events
    const burnEvent = receipt.events.find(e => e.event === 'BurnEvent');
    console.log("Refund processed:", burnEvent);
}
```

### Administrative Management
```javascript
// Monitor contract state
const mintTiming = await minterContract.getMintTiming();
const mintEconomics = await minterContract.getMintEconomics();
const totalMinted = await minterContract.getTotalMinted();
const remainingMint = await minterContract.getRemainingMint();

console.log("Contract Status:", {
    paused: mintTiming.mintPaused,
    wlOnly: mintTiming.wlOnly,
    totalMinted,
    remainingMint,
    hbarPrice: mintEconomics.mintPriceHbar,
    lazyPrice: mintEconomics.mintPriceLazy
});

// Emergency pause
if (emergencyCondition) {
    await minterContract.pause();
}

// Update pricing based on market conditions
await minterContract.updatePricing(
    ethers.utils.parseEther("1.5"),      // New HBAR price
    ethers.utils.parseUnits("75", 8)     // New $LAZY price
);
```

## Error Handling

### Validation Errors
- `NotReset(address)`: Token already initialized with given address
- `BadQuantity(uint256)`: Invalid mint quantity provided
- `BadArguments()`: Invalid function arguments
- `TooMuchMetadata()`: Metadata array exceeds limits
- `EmptyMetadata()`: No metadata provided

### Access & Timing Errors
- `NotOpen()`: Minting hasn't started yet
- `Paused()`: Minting is currently paused
- `NotWL()`: Address not whitelisted during WL-only period
- `LazyCooldown()`: User must wait before next $LAZY payment
- `HbarCooldown()`: User must wait before next HBAR payment

### Economic Errors
- `NotEnoughHbar()`: Insufficient HBAR sent with transaction
- `NotEnoughLazy()`: Insufficient $LAZY token balance
- `NotEnoughWLSlots()`: Insufficient whitelist allocation remaining
- `FailedToPayLazy()`: $LAZY token transfer failed

### Limit Errors
- `MintedOut()`: All available NFTs have been minted
- `MaxMintExceeded()`: Requested quantity exceeds per-transaction limit
- `MaxMintPerWalletExceeded()`: Would exceed per-wallet minting limit
- `MaxSerials()`: Attempting to mint too many serials at once

### Technical Errors
- `FailedToMint()`: Token creation failed
- `FailedNFTMint()`: NFT minting operation failed
- `NFTTransferFailed()`: Token transfer operation failed
- `AssociationFailed()`: Token association failed
- `BurnFailed()`: Token burn operation failed

### Whitelist Errors
- `NoWLToken()`: No whitelist token configured
- `WLTokenUsed()`: Whitelist token serial already used
- `NotTokenOwner()`: User doesn't own the required whitelist token
- `WLPurchaseFailed()`: Whitelist purchase transaction failed

## Security Considerations

### Reentrancy Protection
All external functions that modify state use the `nonReentrant` modifier to prevent reentrancy attacks.

### Access Control
- Critical administrative functions restricted to contract owner
- Comprehensive input validation on all parameters
- Safe mathematical operations using OpenZeppelin's SafeCast

### Economic Security
- Payment validation before state changes
- Atomic operations for payment and minting
- Proper refund calculations with overflow protection

### State Integrity
- Comprehensive validation of contract state
- Proper event emission for all state changes
- Immutable critical parameters set at deployment

## Integration Guidelines

### Frontend Integration
```javascript
// Essential contract interaction patterns
const contract = new ethers.Contract(address, abi, signer);

// Always check current state before interactions
const timing = await contract.getMintTiming();
const economics = await contract.getMintEconomics();
const paused = timing.mintPaused;
const started = timing.mintStartTime <= Date.now() / 1000;

// Estimate gas before transactions
const gasEstimate = await contract.estimateGas.mintNFT(quantity, {
    value: hbarCost.mul(quantity)
});

// Handle all possible errors
try {
    const tx = await contract.mintNFT(quantity, options);
    const receipt = await tx.wait();
    // Process success
} catch (error) {
    // Handle specific contract errors
    if (error.reason === "NotEnoughHbar") {
        // Show insufficient HBAR message
    } else if (error.reason === "MintedOut") {
        // Show sold out message
    }
    // ... handle other errors
}
```

### Backend Monitoring
```javascript
// Monitor key events
contract.on("MintEvent", (msgAddress, mintType, serial, metadata) => {
    console.log(`Mint: ${msgAddress} -> Serial ${serial}`);
    // Update database, send notifications, etc.
});

contract.on("BurnEvent", (burnerAddress, serials, newSupply) => {
    console.log(`Burn: ${burnerAddress} burned ${serials.length} NFTs`);
    // Process refund, update analytics
});

contract.on("MinterContractMessage", (eventType, msgAddress, msgNumeric) => {
    // Handle various contract events based on eventType
    // INITIALISE, MINT, BURN, PAUSE, etc.
});
```

### Testing Strategies
```javascript
// Comprehensive testing approach
describe("MinterContract", () => {
    // Test all error conditions
    it("should revert with NotEnoughHbar when insufficient payment", async () => {
        await expect(
            contract.mintNFT(1, { value: 0 })
        ).to.be.revertedWith("NotEnoughHbar");
    });
    
    // Test edge cases
    it("should handle maximum mint quantity correctly", async () => {
        const maxMint = await contract.getMintEconomics().maxMint;
        // Test at boundary conditions
    });
    
    // Test economic calculations
    it("should calculate refunds correctly", async () => {
        // Mint, then burn and verify refund amounts
    });
});
```

## Performance Optimization

### Gas Efficiency
- Batch processing for multiple NFT mints
- Optimized storage patterns using EnumerableMaps
- Library usage for complex operations
- Minimal redundant state reads

### Scalability Considerations
- Efficient metadata selection algorithms
- Paginated query functions for large datasets
- Event-based state reconstruction capabilities
- Modular architecture for future upgrades

## Conclusion

The `MinterContract` provides a comprehensive, production-ready solution for NFT minting on the Hedera network. Its rich feature set includes economic controls, whitelist management, refund mechanisms, and extensive administrative capabilities, making it suitable for a wide range of NFT projects from simple collections to complex gamified minting experiences.

The contract's modular design, comprehensive error handling, and extensive query capabilities make it an ideal foundation for building sophisticated NFT applications while maintaining security and gas efficiency.