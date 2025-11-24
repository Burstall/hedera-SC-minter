# ForeverMinter Event Scanner

Comprehensive event scanning utility for the ForeverMinter contract that fetches, parses, and displays events from the Hedera mirror node.

## Features

- **Event Filtering**: Filter by specific event types or view all events
- **Pagination Support**: Fetch all historical events or limit to recent ones
- **Multiple Output Formats**: Console display, JSON export, or CSV export
- **Human-Readable Formatting**: Automatically formats addresses, amounts, and timestamps
- **Interactive & CLI Modes**: Use interactively or with command-line arguments

## Usage

### Interactive Mode

Run the script without arguments for guided prompts:

```bash
node scripts/interactions/ForeverMinter/scanEvents.js
```

You'll be prompted to:
1. Select event type to filter (or all events)
2. Choose whether to fetch all historical events
3. Set the number of recent events if not fetching all
4. Select output format (console/JSON/CSV/all)

### Command Line Mode

Use flags for scripting and automation:

```bash
# Fetch last 50 events, display in console
node scripts/interactions/ForeverMinter/scanEvents.js --limit 50

# Fetch all NFTMinted events, save to JSON
node scripts/interactions/ForeverMinter/scanEvents.js --all --filter NFTMinted --output json

# Fetch last 100 events, save to CSV
node scripts/interactions/ForeverMinter/scanEvents.js --limit 100 --output csv

# Fetch all events, output to console + JSON + CSV
node scripts/interactions/ForeverMinter/scanEvents.js --all --output all
```

### Command Line Flags

- `--all` - Fetch all historical events (with pagination)
- `--filter <EventName>` - Filter by specific event type
- `--limit <number>` - Number of recent events to fetch (default: 100)
- `--output <format>` - Output format: `console`, `json`, `csv`, or `all`

## Event Types

The scanner supports all ForeverMinter contract events:

### Minting Events
- **NFTMinted** - NFT minting transactions
  - Displays: minter, quantity, serials, HBAR paid, LAZY paid, discount
- **NFTRefunded** - NFT refund transactions
  - Displays: refunder, serials, HBAR refunded, LAZY refunded

### Pool Management Events
- **NFTsAddedToPool** - NFTs added to the minting pool
  - Displays: source, serials added, new pool size
- **NFTsRemovedFromPool** - NFTs removed from pool
  - Displays: serials removed, new pool size

### Configuration Events
- **DiscountTierUpdated** - Discount tier added/updated/removed
  - Displays: token, tier index, discount %, max uses, action
- **EconomicsUpdated** - Mint pricing and economics updated
  - Displays: HBAR price, LAZY price, WL discount, sacrifice discount
- **TimingUpdated** - Timing configuration updated
  - Displays: mint start time, paused status, refund window, WL-only mode

### Access Control Events
- **WhitelistUpdated** - Whitelist changes
  - Displays: account, action (ADDED/REMOVED)
- **AdminUpdated** - Admin role changes
  - Displays: account, action (ADDED/REMOVED)

### Financial Events
- **FundsWithdrawn** - Contract funds withdrawn
  - Displays: recipient, HBAR amount, LAZY amount
- **LazyPaymentEvent** - LAZY token payment processed
  - Displays: payer, amount, burn amount, burn %

## Output Files

Files are saved to `scripts/interactions/ForeverMinter/event-logs/`:

- **JSON Format**: `ForeverMinter_events_[filter]_YYYY-MM-DD.json`
  - Structured JSON with full event details
  - Easy to parse programmatically

- **CSV Format**: `ForeverMinter_events_[filter]_YYYY-MM-DD.csv`
  - Spreadsheet-compatible format
  - Columns: Timestamp, Type, Block, Transaction, Details (JSON string)

## Examples

### Track Minting Activity

```bash
# See all mints from the past week
node scripts/interactions/ForeverMinter/scanEvents.js --filter NFTMinted --limit 100

# Export all minting history to CSV for analysis
node scripts/interactions/ForeverMinter/scanEvents.js --all --filter NFTMinted --output csv
```

### Monitor Configuration Changes

```bash
# Check recent admin changes
node scripts/interactions/ForeverMinter/scanEvents.js --filter AdminUpdated

# Track all economics updates
node scripts/interactions/ForeverMinter/scanEvents.js --all --filter EconomicsUpdated --output json
```

### Audit Financial Activity

```bash
# Review all withdrawals
node scripts/interactions/ForeverMinter/scanEvents.js --all --filter FundsWithdrawn

# Check LAZY payment history
node scripts/interactions/ForeverMinter/scanEvents.js --filter LazyPaymentEvent --limit 200
```

### Build Discount Token Registry

```bash
# Export all discount tier updates to track which tokens provide discounts
node scripts/interactions/ForeverMinter/scanEvents.js --all --filter DiscountTierUpdated --output json
```

## Integration with Other Scripts

The event scanner provides visibility into contract configuration and activity. The mint script now automatically discovers discount tokens by scanning these events, so no manual configuration is needed.

### Automatic Discount Token Discovery

The `mint.js` script now uses the same event scanning logic to automatically discover eligible discount tokens:

```bash
node scripts/interactions/ForeverMinter/mint.js
```

The script will:
1. Automatically scan for `DiscountTierUpdated` events
2. Identify active discount tokens (those with percentage > 0)
3. Check which ones you own NFTs for
4. Display them as selectable options during minting

No `.env` configuration required!

## Technical Details

### Event Parsing
- Uses `parseContractEvents()` helper from `hederaMirrorHelpers.js`
- Automatically handles pagination for large datasets
- Rate-limited to avoid mirror node throttling
- Robust error handling for malformed events

### Data Formatting
- Account addresses converted to Hedera format (0.0.x)
- Token addresses converted to token IDs
- HBAR amounts formatted with proper units
- Timestamps converted to human-readable dates
- Arrays truncated for console display (full in JSON/CSV)

### Performance
- Mirror node queries batched at 100 events per request
- 100ms delay between paginated requests
- Filters applied after fetching to reduce API calls
- Efficient async processing for address resolution

## Troubleshooting

### No Events Found
- Verify `FOREVER_MINTER_CONTRACT_ID` is set in `.env`
- Check contract is deployed on the correct network (TEST/MAIN)
- Confirm contract has emitted events (may be new deployment)

### Slow Performance
- Use `--limit` to fetch fewer events
- Filter specific event types with `--filter`
- Consider fetching incrementally rather than `--all`

### Mirror Node Errors
- Mirror nodes may occasionally timeout
- Script will continue processing partial results
- Retry after a few seconds if needed

## Related Scripts

- **mint.js** - Automatically scans for and displays discount tokens
- **getContractInfo.js** - Displays current contract state
- **checkDiscounts.js** - Check discount eligibility for specific tokens

## Configuration

Set these environment variables in your `.env` file:

```env
# Required
FOREVER_MINTER_CONTRACT_ID=0.0.12345
ENVIRONMENT=TEST
```
