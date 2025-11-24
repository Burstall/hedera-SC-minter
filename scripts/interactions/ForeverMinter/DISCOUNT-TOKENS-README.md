# Discount Tokens Configuration

This document explains how to configure and use discount tokens from the `.env` file in the ForeverMinter minting flow.

## Overview

The ForeverMinter contract doesn't provide a reverse lookup to enumerate which tokens belong to each discount tier. To solve this, we've implemented an `.env`-based configuration that lets you specify discount tokens, which the mint script will then check for ownership and display.

## Configuration

### Adding Discount Tokens to .env

Add a comma-separated list of discount token IDs to your `.env` file:

```env
# ForeverMinter Configuration
# Comma-separated list of discount token IDs (no spaces)
DISCOUNT_TOKENS=0.0.12345,0.0.67890,0.0.11111
```

**Format Requirements:**
- Use Hedera token ID format: `0.0.xxxxx`
- Separate multiple tokens with commas
- No spaces between token IDs
- Leave empty if no discount tokens configured

### Finding Discount Tokens

Use the event scanner to discover which tokens have been configured as discount tokens:

```bash
# Export all discount tier updates
node scripts/interactions/ForeverMinter/scanEvents.js --all --filter DiscountTierUpdated --output json
```

Review the output JSON file to see:
- Which tokens were added as discount tokens
- When they were added
- Their discount percentage
- Max uses per serial

## Usage in Mint Script

### Enhanced Discount Display

When you run the mint script, it will:

1. **Parse Tokens from .env**
   ```bash
   node scripts/interactions/ForeverMinter/mint.js
   ```

2. **Display Discount Token Information**
   ```
   📋 Discount Tokens (from .env):
      ✅ 0.0.12345: 25% discount, 3 uses/serial
         👉 You own 5 NFTs: [1, 2, 3, 4, 5]
      ✅ 0.0.67890: 15% discount, 5 uses/serial
         ⚠️  You don't own any of these NFTs
      ✅ 0.0.11111: 10% discount, 10 uses/serial
         👉 You own 2 NFTs: [100, 101]
   ```

3. **Simplified Serial Selection**
   - Script shows which tokens you own
   - Select tokens by ID from the list
   - Type 'all' to use all owned serials
   - Or manually enter specific serial numbers

### Interactive Discount Selection

When prompted for discount tokens:

```
Would you like to use holder discount serials? (y/N): y

📋 Select discount tokens to use:
   Enter token IDs from the list above (comma separated)
   Or press Enter to enter custom addresses

Discount tokens to use: 0.0.12345,0.0.11111

   Using 0.0.12345 (25% discount)
   Available serials: [1, 2, 3, 4, 5]
   Enter serials to use (comma separated, or 'all' for all): all
   ✅ Using all 5 serials

   Using 0.0.11111 (10% discount)
   Available serials: [100, 101]
   Enter serials to use (comma separated, or 'all' for all): 100,101
```

## Benefits

### 1. **No Contract Changes Required**
- Existing ForeverMinter contract doesn't need updates
- Configuration managed entirely off-chain
- No gas costs for changes

### 2. **User-Friendly Display**
- See which discount tokens you actually own
- Know your discount percentages before minting
- Quick serial selection with 'all' option

### 3. **Flexibility**
- Add/remove tokens by editing `.env`
- Different configurations for different projects
- Manual entry still available as fallback

### 4. **Maintenance**
- Use event scanner to keep list updated
- Single source of truth in `.env` file
- Easy to share configuration with team

## Examples

### Example 1: Single Discount Token

```env
DISCOUNT_TOKENS=0.0.4421922
```

Result:
- Mint script checks if you own any NFTs from token 0.0.4421922
- Displays discount tier information
- Shows your owned serials

### Example 2: Multiple Discount Tokens

```env
DISCOUNT_TOKENS=0.0.111111,0.0.222222,0.0.333333
```

Result:
- Checks all three tokens
- Shows ownership status for each
- Lets you select which to use for minting

### Example 3: No Discount Tokens

```env
DISCOUNT_TOKENS=
```

Result:
- Mint script shows generic tier information
- Falls back to manual entry mode
- Still fully functional for custom tokens

## Workflow

### Initial Setup

1. **Deploy ForeverMinter Contract**
2. **Add Discount Tiers** (admin script)
   ```bash
   node scripts/interactions/ForeverMinter/admin/addDiscountTier.js
   ```
3. **Scan for Events**
   ```bash
   node scripts/interactions/ForeverMinter/scanEvents.js --filter DiscountTierUpdated
   ```
4. **Update .env**
   ```env
   DISCOUNT_TOKENS=0.0.xxx,0.0.yyy
   ```

### Ongoing Maintenance

1. **When New Discount Tokens Added**
   - Admin adds new tier via contract
   - Re-scan events
   - Update `.env` with new token

2. **When Discount Tokens Removed**
   - Admin removes tier via contract
   - Update `.env` to remove token
   - Or leave it (script will show 0% discount)

## Alternative Approaches

If `.env` configuration doesn't meet your needs, consider:

### Option 1: Contract Enhancement
Add a view function to the contract:
```solidity
function getTierTokens(uint256 _tierIndex) external view returns (address[] memory)
```
- Pros: Single source of truth
- Cons: Requires contract upgrade

### Option 2: Off-Chain Registry
Build an event-monitoring service:
- Indexes all `DiscountTierUpdated` events
- Maintains token→tier mapping
- Serves via API
- Pros: Always up-to-date
- Cons: Infrastructure overhead

### Option 3: Script Parameters
Pass tokens as command-line arguments:
```bash
node scripts/interactions/ForeverMinter/mint.js --discounts 0.0.12345,0.0.67890
```
- Pros: Maximum flexibility per-mint
- Cons: More typing, no persistence

## Troubleshooting

### Token Not Showing as Discount Token

**Check 1:** Verify token was actually added to contract
```bash
node scripts/interactions/ForeverMinter/getContractInfo.js
```

**Check 2:** Ensure token ID format is correct
- Must be: `0.0.xxxxx`
- No spaces
- Comma-separated

**Check 3:** Run event scanner to confirm
```bash
node scripts/interactions/ForeverMinter/scanEvents.js --filter DiscountTierUpdated
```

### Shows 0% Discount

This means the token was removed from the contract or never configured. Update your `.env` to remove it.

### "Invalid token ID format" Error

- Check for typos in token ID
- Ensure proper format: `0.0.xxxxx`
- No extra spaces or characters

## Related Files

- `.env.example` - Template with DISCOUNT_TOKENS configuration
- `scripts/interactions/ForeverMinter/mint.js` - Uses DISCOUNT_TOKENS
- `scripts/interactions/ForeverMinter/scanEvents.js` - Finds discount tokens
- `scripts/interactions/ForeverMinter/EVENT-SCANNER-README.md` - Event scanner docs

## Technical Details

### How It Works

1. **Parse .env**
   ```javascript
   const discountTokenIds = process.env.DISCOUNT_TOKENS 
       ? process.env.DISCOUNT_TOKENS.split(',').map(id => id.trim()).filter(id => id.length > 0)
       : [];
   ```

2. **Query Contract**
   - For each token, call `getTokenTierIndex(tokenAddress)`
   - If successful, token is a discount token
   - Get tier details with `getDiscountTier(tierIndex)`

3. **Check Ownership**
   - Use mirror node API to check owned serials
   - Display counts and list serials

4. **Interactive Selection**
   - User selects which tokens to use
   - User specifies serials (or 'all')
   - Script builds arrays for contract call

### Contract Interaction

The mint script converts your selections into the format expected by the contract:

```javascript
mintNFT(
    uint256 _numberToMint,
    address[] memory _discountTokens,      // EVM addresses
    uint256[][] memory _serialsByToken,    // Serials grouped by token
    uint256[] memory _sacrificeSerials
)
```

Example:
- User selects: `0.0.12345` with serials `[1,2,3]` and `0.0.67890` with serials `[10,11]`
- Script converts to:
  - `_discountTokens = [0x...(12345), 0x...(67890)]`
  - `_serialsByToken = [[1,2,3], [10,11]]`
