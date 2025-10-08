# SoulboundBadgeMinter - Type-Based Badge System

## Overview

The `SoulboundBadgeMinter` contract is an enhanced version of the original SoulboundMinter that introduces a sophisticated type-based badge system. This allows for different categories of badges (types) to be minted on the same token, each with their own metadata, whitelist, and supply limits.

## Testing

The contract includes a comprehensive test suite in `test/SoulboundBadgeMinter.test.js` that covers:

- **Deployment & Initialization**: Contract deployment with both revocable and non-revocable configurations
- **Admin Management**: Adding/removing admins, access control verification
- **Badge Type Management**: Creating, updating, activating/deactivating badge types
- **Whitelist Management**: Adding/removing users from type-specific whitelists
- **Minting Operations**: Type-specific minting with eligibility and limit enforcement
- **Burn Operations**: NFT burning with proper tracking updates
- **Revocation Operations**: NFT revocation with proper tracking updates  
- **Query Functions**: All read-only functions for checking state and eligibility
- **Capacity Management**: Validation of supply limits and capacity constraints
- **Error Handling**: Comprehensive testing of all error conditions

Run tests with: `npm run test-badges`

## Key Features

### 1. Multi-Admin System
- **Enumerable Admin Set**: Contract supports multiple admins who can manage types and whitelists
- **Admin Control**: Admins can add/remove other admins (with last admin protection)
- **Owner Authority**: Contract owner is always considered an admin
- **Last Admin Protection**: Cannot remove the last admin to prevent contract orphaning
- **Admin Functions**: Admins can create types, manage whitelists, and control type activation

### 2. Type-Based Badge System
- **Badge Types**: Each type has a unique ID, name, metadata, max supply, and active status
- **Type-Specific Whitelists**: Each type maintains its own whitelist with configurable quantities per user
- **Per-Type Tracking**: System tracks how many badges of each type each user has minted
- **Granular Control**: Types can be activated/deactivated individually

### 3. Enhanced Minting
- **Type-Specific Minting**: Users mint badges of specific types using `mintBadge()` or `mintBadgeOnBehalf()`
- **Whitelist Enforcement**: Only whitelisted users can mint each type
- **Supply Limits**: Each type can have its own supply limit (0 = unlimited)
- **Mint Tracking**: System prevents users from exceeding their allowed quantities per type

### 4. Burn Tracking
- **Proper Cleanup**: When tokens are burned, mint counts are properly reduced
- **Type Mapping**: Serial numbers are mapped to types for accurate burn tracking
- **User Count Updates**: User's mint counts per type are decremented on burn

### 5. Comprehensive Query Functions
- **Eligibility Checking**: Check if a user can mint a specific type and how many
- **Type Details**: Get complete information about any badge type (active or inactive)
- **Badge State Query**: `getBadge()` works for both active and inactive badges, showing the `active` status
- **Whitelist Queries**: View whitelist for any type
- **Remaining Supply**: Check remaining supply for any type
- **User Statistics**: Check how many of each type a user has minted
- **Capacity Analysis**: Advanced functions for analyzing token and badge capacity constraints

### 6. Revocation Support (Revocable Contracts Only)
- **SBT Revocation**: Owner can revoke (wipe) specific NFTs from user accounts
- **Whitelist Removal**: Revocation automatically removes user from that badge type's whitelist
- **Proper Tracking**: All mint counts and mappings are updated when revoking
- **Access Control**: Only contract owner can revoke SBTs

## Core Functions

### Admin Management
```solidity
function addAdmin(address _admin) external onlyAdmin
function removeAdmin(address _admin) external onlyAdmin  
function isAdmin(address _address) external view returns (bool)
function getAdmins() external view returns (address[] memory)
```

*Note: Admin functions protect against removing the last admin to prevent contract orphaning. Contract owner is always considered an admin.*

### Token Initialization
```solidity
function initialiseNFTMint(
    string memory _name,
    string memory _symbol,
    string memory _memo,
    int64 _maxSupply,
    bool _unlimitedSupply
) external payable onlyOwner returns (address _createdTokenAddress, uint256 _tokenSupply)
```

### Badge Management
```solidity
function createBadge(
    string memory _name,
    string memory _metadata,
    uint256 _maxSupply
) external onlyAdmin returns (uint256 _typeId)

function updateBadge(
    uint256 _typeId,
    string memory _name,
    string memory _metadata,
    uint256 _maxSupply
) external onlyAdmin

function setBadgeActive(uint256 _typeId, bool _active) external onlyAdmin

function addToBadgeWhitelist(
    uint256 _typeId,
    address[] memory _addresses,
    uint256[] memory _quantities
) external onlyAdmin

function removeFromBadgeWhitelist(
    uint256 _typeId,
    address[] memory _addresses
) external onlyAdmin
```

### Minting
```solidity
function mintBadge(uint256 _typeId, uint256 _numberToMint) external returns (int64[] memory _serials)
function mintBadgeOnBehalf(uint256 _typeId, uint256 _numberToMint, address _onBehalfOf) external returns (int64[] memory _serials)
```

### Burning
```solidity
function burnNFTs(int64[] memory _serialNumbers) external returns (uint64 _newTotalSupply)
```

### Revocation (Revocable Contracts Only)
```solidity
function revokeSBT(address _user, uint256 _serialToWipe) external onlyOwner returns (int32 responseCode)
```

*Note: Revocation wipes the NFT from the user's account, removes them from that badge type's whitelist, and updates all tracking counters. Only available on contracts deployed with `REVOCABLE = true`.*

### Query Functions
```solidity
function getBadge(uint256 _typeId)
    external
    view
    returns (
        string memory _name,
        string memory _metadata,
        uint256 _totalMinted,
        uint256 _maxSupply,
        bool _active
    )

function getActiveBadgeIds() external view returns (uint256[] memory)

function getUserBadgeEligibility(
    uint256 _typeId,
    address _user
)
    external
    view
    returns (
        bool _eligible,
        uint256 _remainingMints,
        uint256 _alreadyMinted
    )

function getBadgeWhitelist(uint256 _typeId)
    external
    view
    returns (
        address[] memory _addresses,
        uint256[] memory _quantities
    )

function getSerialBadgeId(uint256 _serial) external view returns (uint256 _typeId)

function getBadgeRemainingSupply(uint256 _typeId) external view returns (uint256 _remaining)

function getUserBadgeMintCounts(
    address _user,
    uint256[] memory _typeIds
) external view returns (uint256[] memory _mintCounts)

function getToken() external view returns (address)

function getMaxSupply() external view returns (uint256)

function getRemainingSupply() external view returns (uint256)

function getReservedCapacity() external view returns (uint256)

function getUnreservedCapacity() external view returns (uint256)

function getTotalBadgeCapacity() external view returns (uint256 _totalCapacity)

function getCapacityAnalysis()
    external
    view
    returns (
        uint256 _tokenMaxSupply,
        uint256 _tokenMinted,
        uint256 _tokenRemaining,
        uint256 _totalBadgeCapacity,
        uint256 _reservedCapacity,
        bool _hasUnlimitedBadges
    )
```

## Usage Example

### 1. Deploy the Contract
```solidity
// Deploy with revocable setting (no lazy token dependencies)
SoulboundBadgeMinter minter = new SoulboundBadgeMinter(true); // true = revocable

// Initialize the NFT token with unlimited supply
(address tokenAddress, uint256 tokenSupply) = minter.initialiseNFTMint(
    "Badge Collection", 
    "BADGE", 
    "Soulbound badges for achievements",
    0,        // _maxSupply (ignored when unlimited)
    true      // _unlimitedSupply = true for unlimited
);

// OR initialize with capped supply (e.g., 10,000 badges max)
(address tokenAddress, uint256 tokenSupply) = minter.initialiseNFTMint(
    "Limited Badge Collection", 
    "LBADGE", 
    "Limited edition soulbound badges",
    10000,    // _maxSupply = 10,000 total badges
    false     // _unlimitedSupply = false for capped
);
```

### 2. Create Badge Types
```solidity
// Create different badge types
uint256 earlyAdopterBadge = minter.createBadge("Early Adopter", "ipfs://early-adopter-metadata", 1000);
uint256 contributorBadge = minter.createBadge("Contributor", "ipfs://contributor-metadata", 500);
uint256 vipBadge = minter.createBadge("VIP", "ipfs://vip-metadata", 100);

// Update a badge (including adjusting supply)
minter.updateBadge(earlyAdopterBadge, "Early Adopter - Updated", "ipfs://new-metadata", 1500);
```

### 3. Manage Whitelists
```solidity
// Add users to Early Adopter whitelist (max 1 each)
address[] memory earlyUsers = [user1, user2, user3];
uint256[] memory quantities = [1, 1, 1];
minter.addToBadgeWhitelist(earlyAdopterBadge, earlyUsers, quantities);

// Add VIP users (unlimited mints)
address[] memory vipUsers = [vipUser1, vipUser2];
uint256[] memory unlimitedQty = [0, 0]; // 0 = unlimited
minter.addToBadgeWhitelist(vipBadge, vipUsers, unlimitedQty);
```

### 4. Mint Badges
```solidity
// User mints an Early Adopter badge
minter.mintBadge(earlyAdopterBadge, 1);

// Admin mints VIP badge on behalf of someone
minter.mintBadgeOnBehalf(vipBadge, 1, beneficiary);
```

### 5. Query System
```solidity
// Check if user can mint more Early Adopter badges
(bool eligible, uint256 remaining, uint256 minted) = minter.getUserBadgeEligibility(earlyAdopterBadge, user);

// Get all active badge types
uint256[] memory activeBadges = minter.getActiveBadgeIds();

// Check remaining supply for a badge type
uint256 remaining = minter.getBadgeRemainingSupply(contributorBadge);
```

## Architecture Benefits

1. **Scalability**: Support for unlimited badge types
2. **Flexibility**: Each type can have different rules and limits
3. **Transparency**: Comprehensive query functions for frontend integration
4. **Security**: Proper access controls and whitelist management
5. **Efficiency**: Optimized storage and gas usage
6. **Maintainability**: Clean, modular design

## New Contract Implementation

This is a brand new contract implementation that introduces a sophisticated type-based badge system for soulbound NFTs. Unlike traditional single-purpose soulbound tokens, this system allows for multiple categories of badges within a single token contract, each with their own rules and characteristics.

## Key Design Principles

1. **Type-Based Architecture**: Support for unlimited badge types within one contract
2. **Granular Control**: Each type can have different rules, limits, and whitelists  
3. **Frontend Integration**: Comprehensive query functions for easy dApp integration
4. **Admin Flexibility**: Multi-admin system for decentralized management
5. **Gas Efficiency**: Optimized for cost-effective operations
6. **Scalable Design**: Built to handle complex badge ecosystems

## Gas Optimization

- Uses OpenZeppelin's efficient data structures (EnumerableMap, EnumerableSet)
- Batched operations for whitelist management
- Minimal storage operations
- Optimized loops and conditional checks
- DRY (Don't Repeat Yourself) code architecture with helper functions for:
  - Token supply calculations (`_getTokenRemaining()`)
  - Unlimited supply checks (`_hasUnlimitedTokenSupply()`)
  - Badge capacity calculations (`_calculateTotalBadgeCapacity()`)

## Key Implementation Features

### CEI Pattern Compliance
The contract follows the Checks-Effects-Interactions (CEI) pattern for security:
- **Checks**: All validations happen first (`_validateMintParameters`, `_checkMintEligibility`)
- **Effects**: State updates occur before external calls (`_updateMintTracking`)  
- **Interactions**: External calls to Hedera happen last (`_executeMint`)

### Unfreeze/Transfer/Freeze Flow
For minting to users who already have badges:
1. Check if user has existing tokens → If yes, unfreeze
2. Execute mint operation
3. Transfer tokens to user
4. Freeze tokens to maintain soulbound property

### Error Handling
Comprehensive error handling with specific error types:
- `NotAdmin`, `AdminAlreadyExists`, `AdminNotFound`, `CannotRemoveLastAdmin`
- `TypeNotFound`, `TypeInactive`, `NotWhitelistedForType`, `TypeMintedOut`
- `NotRevokable`, `NFTNotOwned` (for revocation operations)
- `UnlimitedBadgeNotAllowed`, `NotEnoughWLSlots`, `BadQuantity`, `BadArguments`

This implementation provides a complete badge system that can handle complex scenarios like achievement badges, role-based access tokens, and tiered membership systems, all within a single soulbound token contract.