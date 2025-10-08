# SoulboundBadgeMinter Interaction Scripts

This folder contains comprehensive interaction scripts for the `SoulboundBadgeMinter` contract. These scripts provide a complete interface for all contract functionality through command-line tools.

## Prerequisites

1. **Environment Setup**: Ensure your `.env` file contains:
   ```
   PRIVATE_KEY=your_ed25519_private_key
   ACCOUNT_ID=your_hedera_account_id
   CONTRACT_ID=deployed_contract_id
   ENVIRONMENT=TEST  # or MAIN, PREVIEW, LOCAL
   ```

2. **Dependencies**: All required Node.js dependencies should be installed:
   ```bash
   npm install
   ```

## Script Categories

### 🔧 Administrative Scripts

#### **prepareBadgeMinter.js**
Initialize and manage the basic contract setup.
```bash
# Initialize a new token (required first step)
node prepareBadgeMinter.js -init -name "MyBadges" -symbol "BADGE" -memo "Badge Collection" -max 1000

# Initialize unlimited supply token
node prepareBadgeMinter.js -init -name "MyBadges" -symbol "BADGE" -memo "Badge Collection" -max 0

# Reset contract data (if supported)
node prepareBadgeMinter.js -reset

# Hard reset including token ID (if supported)
node prepareBadgeMinter.js -hardreset
```

#### **addAdmin.js**
Add new administrators to the contract.
```bash
node addAdmin.js 0.0.12345
node addAdmin.js 0x000000000000000000000000000000000000beef
```

#### **removeAdmin.js**
Remove administrators from the contract.
```bash
node removeAdmin.js 0.0.12345
node removeAdmin.js 0x000000000000000000000000000000000000beef
```

#### **listAdmins.js**
View all current administrators.
```bash
node listAdmins.js
```

#### **transferHbar.js**
Withdraw HBAR from the contract.
```bash
# Transfer to operator account
node transferHbar.js 1000000

# Transfer to specific account
node transferHbar.js 1000000 0.0.12345
```

### 🏅 Badge Management Scripts

#### **createBadge.js**
Create new badge types.
```bash
# Limited supply badge
node createBadge.js "Bronze Badge" "ipfs://bronze-metadata.json" 100

# Unlimited supply badge
node createBadge.js "Silver Badge" "ipfs://silver-metadata.json" 0
```

#### **updateBadge.js**
Update existing badge information.
```bash
node updateBadge.js 1 "Bronze Badge Updated" "ipfs://bronze-v2.json" 150
```

#### **activateBadge.js**
Activate or deactivate badge types.
```bash
# Activate badge
node activateBadge.js 1 true

# Deactivate badge
node activateBadge.js 1 false
```

#### **getBadge.js**
View badge information.
```bash
# Get specific badge info
node getBadge.js 1

# Get all badges info
node getBadge.js
```

### 👥 Whitelist Management Scripts

#### **addToBadgeWhitelist.js**
Add users to badge-specific whitelists.
```bash
# Add users with specific quantities
node addToBadgeWhitelist.js 1 "0.0.12345,0.0.12346" "2,1"

# Add users with unlimited quantities (use 0)
node addToBadgeWhitelist.js 2 "0.0.12345,0x123abc" "0,0"
```

#### **checkUserEligibility.js**
Check user eligibility for badges.
```bash
# Check your eligibility for all badges
node checkUserEligibility.js

# Check your eligibility for specific badge
node checkUserEligibility.js 1

# Check another user's eligibility
node checkUserEligibility.js 1 0.0.12345

# Check another user's eligibility for all badges
node checkUserEligibility.js 0.0.12345
```

### 🎯 Minting Scripts

#### **mintBadge.js**
Mint badges for yourself.
```bash
# Mint 2 of badge type 1
node mintBadge.js 1 2

# Mint 1 of badge type 3
node mintBadge.js 3 1
```

### 🔥 Revocation Scripts

#### **revokeSBT.js**
Revoke soulbound tokens (only for revocable contracts).
```bash
node revokeSBT.js 0.0.12345 42
```

### 📊 Information Scripts

#### **getContractInfo.js**
Get comprehensive contract information.
```bash
node getContractInfo.js
```

## Common Workflows

### 1. Initial Setup
```bash
# 1. Deploy contract first (using deployment scripts)
# 2. Initialize token
node prepareBadgeMinter.js -init -name "MyBadges" -symbol "BADGE" -memo "Badge Collection" -max 1000

# 3. Add additional admins if needed
node addAdmin.js 0.0.12346

# 4. Create badge types
node createBadge.js "Bronze Badge" "ipfs://bronze.json" 100
node createBadge.js "Silver Badge" "ipfs://silver.json" 50

# 5. Set up whitelists
node addToBadgeWhitelist.js 1 "0.0.12345,0.0.12346" "2,1"
```

### 2. User Minting Flow
```bash
# 1. Check eligibility
node checkUserEligibility.js 1

# 2. Mint badges
node mintBadge.js 1 2
```

### 3. Administrative Management
```bash
# Check contract status
node getContractInfo.js

# View all badges
node getBadge.js

# Check admin list
node listAdmins.js

# Withdraw funds
node transferHbar.js 1000000
```

### 4. Badge Lifecycle Management
```bash
# Create new badge
node createBadge.js "Gold Badge" "ipfs://gold.json" 25

# Update existing badge
node updateBadge.js 1 "Bronze Badge V2" "ipfs://bronze-v2.json" 150

# Deactivate badge temporarily
node activateBadge.js 1 false

# Reactivate badge
node activateBadge.js 1 true
```

## Error Handling

All scripts include comprehensive error handling and will display specific error messages for common issues:

- **NotAdmin**: You don't have admin privileges
- **TokenNotInitialized**: Run `prepareBadgeMinter.js -init` first
- **TypeNotFound**: Badge ID doesn't exist
- **NotWhitelistedForType**: User not whitelisted for this badge
- **InsufficientBadgeSupply**: Badge has reached maximum supply
- **CannotRemoveLastAdmin**: Cannot remove the last admin

## Gas Limits

Default gas limits are set conservatively for each operation type:
- Simple queries: No gas (read-only)
- Admin operations: 400,000 gas
- Badge creation/updates: 600,000 gas
- Minting operations: 800,000 gas

You can override gas limits by modifying the scripts if needed.

## Network Support

All scripts support multiple Hedera networks:
- **TEST**: Hedera Testnet
- **MAIN**: Hedera Mainnet
- **PREVIEW**: Hedera Previewnet
- **LOCAL**: Local development network

Set the `ENVIRONMENT` variable in your `.env` file accordingly.

## Security Notes

1. **Private Key**: Never commit your private key to version control
2. **Admin Rights**: Only give admin privileges to trusted accounts
3. **Revocation**: Revocation is only available if the contract was deployed with `revocable=true`
4. **Whitelist Management**: Be careful when setting unlimited quantities (use 0 carefully)
5. **HBAR Withdrawal**: Only admins can withdraw HBAR from the contract

## Troubleshooting

### Common Issues

1. **"Contract ID required"**: Set `CONTRACT_ID` in your `.env` file
2. **"Token not initialized"**: Run the initialization script first
3. **"Not an admin"**: Ensure you're using an admin account
4. **"Association failed"**: Users must associate tokens before minting
5. **"Mirror node lag"**: Wait a few seconds between operations for mirror node sync

### Debug Mode

For debugging, you can add console logs or use the Hedera SDK's debug features:
```javascript
// Add to any script for verbose logging
console.log('Debug:', result);
```

## Integration Examples

These scripts can be integrated into larger applications or used as reference for building custom interfaces. Each script demonstrates proper:

- Parameter validation
- Error handling
- User confirmation prompts
- Result formatting
- Network configuration

## Support

For issues or questions about these scripts:
1. Check the error messages for specific guidance
2. Verify your environment configuration
3. Ensure you have the latest contract ABI
4. Review the SoulboundBadgeMinter contract documentation

---

**Note**: Always test scripts on testnet before using on mainnet, especially for administrative operations.