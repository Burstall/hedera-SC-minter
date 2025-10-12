# SoulboundMinter Contract

## Overview

The `SoulboundMinter` contract is a comprehensive Hedera Token Service (HTS) based NFT minting contract that creates **Soulbound Tokens (SBTs)** - non-transferable NFTs that are permanently bound to the recipient's account. This contract provides advanced minting capabilities with whitelist management, payment systems, cooldowns, and administrative controls.

## Key Features

### 1. Soulbound Token Mechanics
- **Non-Transferable**: NFTs are automatically frozen upon minting, making them soulbound
- **Revocable**: Owner can revoke (wipe) soulbound tokens if configured as revocable during deployment
- **Permanent Binding**: Tokens cannot be transferred between accounts once minted

### 2. Advanced Minting System
- **Batch Minting**: Efficient batch processing for multiple NFTs in a single transaction
- **On-Behalf Minting**: Gas abstraction allowing minting for other users
- **Fixed/Dynamic Editions**: Support for both fixed edition (repeated metadata) and unique metadata per NFT
- **Supply Management**: Configurable maximum supply with unlimited supply option

### 3. Whitelist Management
- **Address-Based Whitelisting**: Add addresses with specific allocation quantities
- **WL Token Integration**: Use existing NFT holdings to gain whitelist access
- **Lazy Token Purchase**: Buy whitelist spots using $LAZY tokens
- **Per-Address Limits**: Configure maximum mints per whitelisted address

### 4. Payment Systems
- **Dual Currency**: Accept both HBAR and $LAZY token payments
- **Flexible Pricing**: Different pricing for whitelisted vs public mints
- **Discount System**: Configurable percentage discounts for whitelisted users
- **Token Burning**: Automatic $LAZY token burning mechanism on each mint

### 5. Access Control & Security
- **Owner-Only Functions**: Critical administrative functions restricted to contract owner
- **Reentrancy Protection**: Built-in protection against reentrancy attacks
- **Comprehensive Error Handling**: Detailed error messages for all failure scenarios
- **State Validation**: Extensive validation of contract state and user inputs

### 6. Timing & Cooldown Controls
- **Mint Windows**: Configure when minting is available
- **Cooldown Periods**: Prevent rapid successive mints from the same address
- **Pause Functionality**: Ability to pause minting operations
- **Whitelist-Only Periods**: Restrict minting to whitelisted users only

### 7. Refund & Burn Mechanisms
- **Refund Windows**: Allow users to burn NFTs for refunds within specified timeframes
- **Flexible Burn Logic**: Support for different refund calculations
- **Serial Tracking**: Track mint timestamps for refund eligibility

## Technical Architecture

### Contract Inheritance
```solidity
contract SoulboundMinter is ExpiryHelper, Ownable, ReentrancyGuard
```

### Key Structs
- **MintTiming**: Controls timing, cooldowns, and access restrictions
- **MintEconomics**: Manages pricing, limits, and payment configurations
- **LazyDetails**: Handles $LAZY token integration and burning mechanics

### State Management
- **Whitelist Tracking**: EnumerableMap for address-to-quantity mappings
- **Mint History**: Comprehensive tracking of all minting activity
- **Serial Monitoring**: Timestamp tracking for refund eligibility
- **Usage Analytics**: Per-address mint counting for limit enforcement

## Deployment Configuration

### Constructor Parameters
```solidity
constructor(
    address lsct,        // Lazy Smart Contract Treasury address
    address lazy,        // $LAZY token address
    uint256 lazyBurnPerc, // Percentage of $LAZY to burn per mint
    bool _revocable      // Whether SBTs can be revoked by owner
)
```

### Initial Configuration
- **Payment System**: $LAZY token association and burn percentage setup
- **Default Settings**: Conservative defaults (1 mint per wallet, paused state)
- **Revocable Setting**: Immutable decision set at deployment

## Core Functions

### Token Creation
```solidity
function initialiseNFTMint(
    string memory _name,
    string memory _symbol,
    string memory _memo,
    string memory _cid,
    int64 _maxSupply,
    bool _fixedEdition,
    bool _unlimitedSupply
) external payable onlyOwner returns (address, uint256)
```
Creates the NFT token with specified parameters and metadata structure.

### Minting Functions
```solidity
function mintNFT(uint256 _numberToMint) 
    external payable returns (int64[] memory, bytes[] memory)

function mintNFTOnBehalf(uint256 _numberToMint, address _onBehalfOf) 
    external payable returns (int64[] memory, bytes[] memory)
```
Main minting functions with comprehensive validation and soulbound token creation.

### Whitelist Management
```solidity
function addToWhitelist(address[] memory _newAddresses) external onlyOwner
function buyWlWithLazy() external returns (uint256)
```
Administrative whitelist management and user-initiated whitelist purchases.

### Revocation System
```solidity
function revokeSBT(address _user, uint256 serialToBurn) 
    external onlyOwner returns (int256)
```
Owner-only function to revoke (wipe) soulbound tokens from user accounts.

### Administrative Controls
```solidity
function updateMintStartTime(uint256 _startTime) external onlyOwner
function updateMaxMint(uint256 _maxMint) external onlyOwner
function updateWlDiscount(uint256 _wlDiscount) external onlyOwner
function updateCooldown(uint256 _cooldownPeriod) external onlyOwner
function updateRefundWindow(uint256 _refundWindow) external onlyOwner
function updateMaxMintPerWallet(uint256 _max) external onlyOwner
```
Comprehensive configuration management for all contract parameters.

## Query Functions

### Contract State
```solidity
function getNFTTokenAddress() external view returns (address)
function getPRNGContractAddress() external view returns (address)
function getLazyToken() external view returns (address)
function getLSCT() external view returns (address)
```

### Minting Information
```solidity
function getRemainingMint() external view returns (uint256)
function getBatchSize() external view returns (uint256)
function getTotalMinted() external view returns (uint256)
function getMaxSupply() external view returns (uint256)
```

### User & Whitelist Queries
```solidity
function getWhiteListLength() external view returns (uint256)
function getQtyWhiteListed(address _user) external view returns (uint256)
function getNumberOfWLUsed(address _address) external view returns (uint256)
function getNumMintedByAddress(address _user) external view returns (uint256)
```

### Economic Information
```solidity
function getCost() external view returns (uint256 _hbar, uint256 _lazy)
function getMintTiming() external view returns (MintTiming memory)
function getMintEconomics() external view returns (MintEconomics memory)
```

## Usage Examples

### Basic Deployment and Setup
```javascript
// Deploy contract
const soulboundMinter = await SoulboundMinter.deploy(
    lsctAddress,
    lazyTokenAddress,
    10, // 10% burn percentage
    true // revocable
);

// Initialize NFT token
await soulboundMinter.initialiseNFTMint(
    "MySoulboundNFT",
    "SBNFT",
    "Soulbound NFT Collection",
    "QmYourIPFSHash",
    1000, // max supply
    false, // not fixed edition
    false  // not unlimited
);

// Configure minting parameters
await soulboundMinter.updateMintStartTime(Math.floor(Date.now() / 1000));
await soulboundMinter.updateMaxMint(5);
await soulboundMinter.updateWlDiscount(20); // 20% discount
```

### Whitelist Management
```javascript
// Add addresses to whitelist
const addresses = ["0x123...", "0x456...", "0x789..."];
await soulboundMinter.addToWhitelist(addresses);

// User buys whitelist spot with $LAZY
await soulboundMinter.buyWlWithLazy();
```

### Minting Process
```javascript
// Regular minting
const mintTx = await soulboundMinter.mintNFT(2, {
    value: ethers.utils.parseEther("1.0") // HBAR payment
});

// On-behalf minting (gas abstraction)
const onBehalfTx = await soulboundMinter.mintNFTOnBehalf(
    1, 
    userAddress,
    { value: ethers.utils.parseEther("0.5") }
);
```

### Administrative Management
```javascript
// Pause minting
await soulboundMinter.pause();

// Update pricing
await soulboundMinter.updatePricing(
    ethers.utils.parseEther("0.5"), // HBAR price
    ethers.utils.parseUnits("100", 8) // $LAZY price
);

// Revoke a soulbound token
await soulboundMinter.revokeSBT(userAddress, serialNumber);
```

## Error Handling

The contract implements comprehensive error handling with specific error types:

### Validation Errors
- `NotReset()`: Token already initialized
- `BadQuantity()`: Invalid mint quantity
- `BadArguments()`: Invalid function arguments

### Access Control Errors
- `NotOpen()`: Minting not started
- `Paused()`: Minting temporarily paused
- `NotWL()`: Address not whitelisted during WL-only period

### Economic Errors
- `NotEnoughHbar()`: Insufficient HBAR payment
- `NotEnoughLazy()`: Insufficient $LAZY token balance
- `NotEnoughWLSlots()`: Insufficient whitelist allocation

### Limit Errors
- `MintedOut()`: No more NFTs available
- `MaxMintExceeded()`: Exceeds maximum mint per transaction
- `MaxMintPerWalletExceeded()`: Exceeds per-wallet limit

### Cooldown Errors
- `LazyCooldown()`: $LAZY payment cooldown active
- `HbarCooldown()`: HBAR payment cooldown active

### Technical Errors
- `FailedNFTMint()`: NFT minting operation failed
- `NFTTransferFailed()`: Token transfer failed
- `FreezingFailed()`: Failed to freeze tokens (make soulbound)
- `AssociationFailed()`: Token association failed

## Implementation Details

### Soulbound Mechanism
The contract implements soulbound functionality by automatically freezing NFTs upon minting:
```solidity
// Freeze tokens to make them soulbound
int32 responseCode = freezeToken(token, _onBehalfOf);
if (responseCode != HederaResponseCodes.SUCCESS) {
    revert FreezingFailed();
}
```

### Security Features
- **Reentrancy Protection**: All external functions use `nonReentrant` modifier
- **Comprehensive Validation**: Multiple layers of input and state validation
- **Safe Mathematical Operations**: Uses OpenZeppelin's SafeCast for type conversions
- **Access Control**: Critical functions restricted to contract owner

### Gas Optimization
- **Batch Processing**: Efficient handling of multiple NFT mints
- **Minimal Storage**: Optimized state variable usage
- **Library Functions**: Gas-expensive operations moved to external libraries

### Event Emission
- **Detailed Logging**: Comprehensive event emission for all major operations
- **Integration Support**: Events designed for easy integration with off-chain systems
- **State Change Tracking**: All state modifications properly logged

## Integration Considerations

### Frontend Integration
- Use `estimateGas()` for accurate gas estimation
- Implement proper error handling for all custom errors
- Monitor events for real-time updates
- Handle asynchronous token association requirements

### Backend Monitoring
- Track `MintEvent` for minting analytics
- Monitor `BurnEvent` for refund processing
- Use `MinterContractMessage` for general contract activity
- Implement rate limiting based on cooldown periods

### Testing Requirements
- Test all error conditions thoroughly
- Verify soulbound token behavior (non-transferability)
- Test revocation functionality if enabled
- Validate all economic calculations

## Conclusion

The `SoulboundMinter` contract provides a robust, feature-rich platform for creating and managing soulbound NFTs on the Hedera network. Its comprehensive feature set, security measures, and flexible configuration options make it suitable for a wide range of soulbound token use cases, from achievement badges and certificates to membership tokens and identity verification systems.