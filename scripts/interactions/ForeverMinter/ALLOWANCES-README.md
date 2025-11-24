# Allowance Management Utility

## Overview

The `manageAllowances.js` script provides a comprehensive, user-friendly interface for managing HBAR, Fungible Token (FT), and NFT allowances on Hedera. This utility allows users to view, add, and remove allowances without needing to run individual transactions or check the mirror node manually.

## Features

### 📊 View Allowances
- **HBAR Allowances**: View all HBAR allowances with amounts in tinybar
- **FT Allowances**: View fungible token allowances with token names, symbols, and properly formatted amounts
- **NFT Allowances**: View NFT "approved for all" allowances with collection names
- **Parallel Fetching**: All allowances are fetched simultaneously for speed
- **Token Details Caching**: Token metadata is cached to avoid duplicate API calls

### 💎 HBAR Allowance Management
- **Add HBAR Allowance**: Set an allowance for a spender to use your HBAR
- **Remove HBAR Allowance**: Remove an existing allowance (sets to 0)
- **Interactive Selection**: Choose from existing allowances to remove

### 🪙 FT Allowance Management
- **Add FT Allowance**: Set an allowance for fungible tokens with automatic decimal handling
- **Remove FT Allowance**: Remove an existing FT allowance (sets to 0)
- **Token Details**: Automatically fetches and displays token name, symbol, and decimals
- **Smart Formatting**: Amounts are displayed in human-readable format based on token decimals

### 🖼️ NFT Allowance Management
- **Add NFT Allowance**: Approve a spender for all serials of one or more NFT collections
- **Remove NFT Allowance**: Remove "approved for all" allowance using `deleteTokenNftAllowanceAllSerials`
- **Batch Support**: Add multiple NFT collections in a single transaction
- **Collection Names**: Automatically fetches and displays NFT collection names

## Usage

### Prerequisites

Ensure your `.env` file contains:
```env
ACCOUNT_ID=0.0.YOUR_ACCOUNT_ID
PRIVATE_KEY=YOUR_PRIVATE_KEY
ENVIRONMENT=TEST  # or MAIN, PREVIEW, LOCAL
```

### Running the Script

```bash
node scripts/interactions/ForeverMinter/manageAllowances.js
```

### Interactive Menu

The script presents an interactive menu with the following options:

```
╔════════════════════════════════════════════════╗
║      🔐 ALLOWANCE MANAGEMENT UTILITY 🔐       ║
╚════════════════════════════════════════════════╝

What would you like to do?

   1. 📊 View all allowances
   2. 💎 Add HBAR allowance
   3. 💎 Remove HBAR allowance
   4. 🪙 Add FT allowance
   5. 🪙 Remove FT allowance
   6. 🖼️  Add NFT allowance (all serials)
   7. 🖼️  Remove NFT allowance
   8. ❌ Exit
```

## Example Workflows

### Viewing All Allowances

1. Select option `1`
2. The script will fetch and display:
   - All HBAR allowances with amounts in tinybar
   - All FT allowances with token names, symbols, and formatted amounts
   - All NFT "approved for all" allowances with collection names

Example output:
```
💎 HBAR ALLOWANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Spender                   Amount (tℏ)     Granted (tℏ)
   ─────────────────────────────────────────────────────
   0.0.8051302               100000000       100000000

🪙 FUNGIBLE TOKEN ALLOWANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Token                     Symbol    Amount           Spender
   ─────────────────────────────────────────────────────────────────
   0.0.1311037               LAZY      262.0            0.0.7221483

🖼️  NFT ALLOWANCES (Approved for All)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Token                     Name                      Spender
   ─────────────────────────────────────────────────────────────────
   0.0.805923                Cool Cats NFT             0.0.7221488
```

### Adding an HBAR Allowance

1. Select option `2`
2. Enter the spender account/contract ID (e.g., `0.0.8051302`)
3. Enter the amount in tinybar (e.g., `100000000` for 1 HBAR)
4. Review the summary
5. Confirm with `y`

Example:
```
💎 ADD HBAR ALLOWANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Enter spender account/contract ID: 0.0.8051302
Enter HBAR amount in tinybar: 100000000

📋 Summary:
   Spender: 0.0.8051302
   Amount: 100000000 tℏ (1 HBAR)

Proceed with setting HBAR allowance? (y/N): y

⏳ Setting HBAR allowance...
✅ HBAR allowance set successfully!
```

### Adding an FT Allowance

1. Select option `4`
2. Enter the token ID (e.g., `0.0.1311037`)
3. The script fetches token details automatically
4. Enter the spender account/contract ID
5. Enter the amount in token units (not smallest denomination)
6. Review the summary
7. Confirm with `y`

Example:
```
🪙 ADD FUNGIBLE TOKEN ALLOWANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Enter token ID: 0.0.1311037

⏳ Fetching token details...
✅ Token: Lazy Token (LAZY)
   Decimals: 1

Enter spender account/contract ID: 0.0.7221488
Enter amount (in LAZY): 100

📋 Summary:
   Token: 0.0.1311037 (LAZY)
   Spender: 0.0.7221488
   Amount: 100 LAZY (1000 in smallest units)

Proceed with setting FT allowance? (y/N): y

⏳ Setting FT allowance...
✅ FT allowance set successfully!
```

### Adding NFT Allowances

1. Select option `6`
2. Enter one or more NFT token IDs (comma separated)
3. The script fetches token details automatically
4. Enter the spender account/contract ID
5. Review the summary
6. Confirm with `y`

Example:
```
🖼️  ADD NFT ALLOWANCE (All Serials)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Enter NFT token IDs: 0.0.805923,0.0.848553

⏳ Fetching token details...

Tokens to approve:
   1. 0.0.805923 - Cool Cats NFT
   2. 0.0.848553 - Space Apes NFT

Enter spender account/contract ID: 0.0.7221488

📋 Summary:
   Tokens: 2 NFT collection(s)
   Spender: 0.0.7221488
   Scope: All serials (approved for all)

Proceed with setting NFT allowance? (y/N): y

⏳ Setting NFT allowance...
✅ NFT allowance set successfully!
```

### Removing Allowances

For removal operations (options 3, 5, 7):

1. Select the remove option
2. The script lists all current allowances of that type
3. Select the allowance to remove by number
4. Review the summary
5. Confirm with `y`

Example (removing FT allowance):
```
🪙 REMOVE FUNGIBLE TOKEN ALLOWANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏳ Fetching token details...

Current FT Allowances:

1. Token: 0.0.1311037 (LAZY), Spender: 0.0.7221483, Amount: 262.0

Select allowance to remove (number): 1

📋 Removing:
   Token: 0.0.1311037 (LAZY)
   Spender: 0.0.7221483
   Current Amount: 262.0

Proceed with removing (setting to 0)? (y/N): y

⏳ Removing FT allowance...
✅ FT allowance removed successfully!
```

## Technical Details

### Mirror Node Integration

The script uses the Hedera Mirror Node REST API to fetch current allowances:

- **HBAR**: `/api/v1/accounts/{accountId}/allowances/crypto`
- **FT**: `/api/v1/accounts/{accountId}/allowances/tokens`
- **NFT**: `/api/v1/accounts/{accountId}/allowances/nfts`

### Token Details Caching

To optimize performance and reduce API calls:
- Token details (name, symbol, decimals) are cached in memory
- Cache is checked before making API requests
- Useful when viewing or managing multiple allowances for the same token

### Parallel Operations

The script runs multiple independent operations in parallel:
- Fetching all three types of allowances simultaneously when viewing
- Fetching token details for all tokens in a list at once
- Reduces overall execution time

### Allowance Removal Methods

Different types of allowances are removed differently:

- **HBAR**: Set allowance to `0` using `approveHbarAllowance`
- **FT**: Set allowance to `0` using `approveTokenAllowance`
- **NFT**: Use `deleteTokenNftAllowanceAllSerials` method (from test suite)

## Use Cases

### ForeverMinter Integration

Before minting on ForeverMinter, users need to set allowances:
1. **HBAR**: For mint payment (contract as spender)
2. **LAZY**: For LAZY token payment (LazyGasStation as spender)
3. **NFT**: For sacrifice discounts (contract as spender)

This utility allows users to check and set these allowances independently.

### General Allowance Management

Beyond ForeverMinter, users can manage allowances for any spender:
- DeFi contracts
- NFT marketplaces
- Token swaps
- Any contract requiring token approvals

### Pre-Mint Checks

Users can run this script to verify allowances are set correctly before attempting to mint, avoiding transaction failures.

### Cleanup

After minting or completing transactions, users can remove allowances to maintain security and reduce attack surface.

## Security Considerations

- **Private Key**: Never share your private key or commit it to version control
- **Allowances**: Only set allowances for trusted contracts
- **Amounts**: Set minimum required allowances, not unlimited amounts
- **Review**: Always review the summary before confirming transactions
- **Cleanup**: Remove allowances after use to minimize risk

## Troubleshooting

### "Failed to fetch token details"
- Verify the token ID exists on the specified network
- Check network connectivity
- Ensure the token hasn't been deleted

### "No allowances to remove"
- Check you're on the correct network (TESTNET vs MAINNET)
- Verify allowances haven't already been removed
- Ensure you're using the correct account ID

### "Allowance set **FAILED**"
- Check account balance is sufficient for transaction fees
- Verify the token is associated to your account (for FT/NFT)
- Ensure spender account/contract ID is valid

## Related Scripts

- `mint.js` - Uses HBAR and LAZY allowances for minting
- `checkWLSlots.js` - Checks whitelist status
- `checkMintCost.js` - Calculates mint costs
- `refund.js` - Refunds minted NFTs within window

## Future Enhancements

Potential improvements:
- Batch allowance operations (set multiple at once)
- Allowance history from mirror node
- Preset allowance amounts for common contracts
- Export/import allowance configurations
- Allowance expiration reminders
