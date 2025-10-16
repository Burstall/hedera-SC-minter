# SoulboundBadgeMinter Deployment Guide

This guide covers deploying the SoulboundBadgeMinter contract to Hedera networks.

## Prerequisites

1. **Environment Setup**: Ensure your `.env` file contains:
   ```
   PRIVATE_KEY=your_ed25519_private_key
   ACCOUNT_ID=0.0.your_account_id
   ENVIRONMENT=TEST  # or MAIN, PREVIEW, LOCAL
   ```

2. **Compiled Contract**: Run `npx hardhat compile` to ensure artifacts are ready

## Deployment Steps

### 1. Run Deployment Script

```bash
node scripts/deployment/deploy-SoulboundBadgeMinter.js
```

**Optional: Using Pre-uploaded Bytecode**
```bash
node scripts/deployment/deploy-SoulboundBadgeMinter.js 0.0.file_id
```

### 2. Interactive Configuration

The script will prompt you to:
- **Confirm revocable status**: Whether the contract supports SBT revocation (immutable choice)
- **Confirm deployment**: Final confirmation before deploying

### 3. Deployment Output

Upon successful deployment, you'll see:
```
===========================================
DEPLOYMENT COMPLETE
===========================================
Contract Name: SoulboundBadgeMinter
Contract ID: 0.0.123456
Contract Address: 0x...
Revocable: false
Environment: TEST
===========================================

📝 Next Steps:
1. Add CONTRACT_ID to your .env file:
   CONTRACT_ID=0.0.123456
2. Run initialization script:
   node scripts/interactions/BadgeMinter/prepareBadgeMinter.js -init
3. Create badge types and whitelist users
4. Start minting badges!
```

## Post-Deployment Setup

### 1. Update Environment File

Add the deployed contract ID to your `.env`:
```
CONTRACT_ID=0.0.123456
```

### 2. Initialize the Minter

Run the initialization script to create the NFT token:
```bash
node scripts/interactions/BadgeMinter/prepareBadgeMinter.js -init
```

### 3. Create Badge Types

Create your first badge types:
```bash
node scripts/interactions/BadgeMinter/createBadge.js "Bronze Badge" "ipfs://bronze-metadata.json" 100
node scripts/interactions/BadgeMinter/createBadge.js "Silver Badge" "ipfs://silver-metadata.json" 0
```

### 4. Set Up Whitelists

Add users to badge whitelists:
```bash
node scripts/interactions/BadgeMinter/addToBadgeWhitelist.js 1 0.0.alice_id 2  # Alice can mint 2 Bronze badges
node scripts/interactions/BadgeMinter/addToBadgeWhitelist.js 2 0.0.alice_id 0  # Alice can mint unlimited Silver badges
```

### 5. Start Minting

Users can now mint their badges:
```bash
node scripts/interactions/BadgeMinter/mintBadge.js 1 1     # Mint 1 Bronze badge for yourself
node scripts/interactions/BadgeMinter/associateToken.js   # Associate token if needed
```

## Gas Limits

The deployment uses a gas limit of **4,800,000** gas units, consistent with test patterns.

## Network Support

- **Testnet**: `ENVIRONMENT=TEST`
- **Mainnet**: `ENVIRONMENT=MAIN` 
- **Previewnet**: `ENVIRONMENT=PREVIEW`
- **Local**: `ENVIRONMENT=LOCAL`

## Constructor Parameters

The SoulboundBadgeMinter constructor takes:
- `revocable` (boolean): Whether SBTs can be revoked by admins

This choice is **immutable** after deployment - choose carefully!

## Troubleshooting

- **"Environment required"**: Set `ENVIRONMENT` in `.env`
- **"Account ID required"**: Set `ACCOUNT_ID` and `PRIVATE_KEY` in `.env`
- **Gas errors**: The script uses optimized gas limits from test analysis
- **Network connection**: Ensure stable internet for mirror node communication

## Security Notes

1. **Private Key Protection**: Never commit `.env` files with private keys
2. **Admin Management**: The deploying account becomes the initial admin
3. **Revocable Choice**: This setting cannot be changed after deployment
4. **Multi-signature**: Consider using multi-sig accounts for mainnet deployments
