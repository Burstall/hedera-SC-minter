const {
	ContractId,
	TokenId,
	Hbar,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const {
	parseContractEvents,
	homebrewPopulateAccountNum,
} = require('../../../utils/hederaMirrorHelpers');

const contractName = 'ForeverMinter';
const contractId = ContractId.fromString(process.env.FOREVER_MINTER_CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;

// Event type definitions for filtering
const EVENT_TYPES = {
	NFTMinted: 'NFT Minted',
	NFTRefunded: 'NFT Refunded',
	NFTsAddedToPool: 'NFTs Added to Pool',
	NFTsRemovedFromPool: 'NFTs Removed from Pool',
	DiscountTierUpdated: 'Discount Tier Updated',
	EconomicsUpdated: 'Economics Updated',
	TimingUpdated: 'Timing Updated',
	WhitelistUpdated: 'Whitelist Updated',
	AdminUpdated: 'Admin Updated',
	FundsWithdrawn: 'Funds Withdrawn',
	LazyPaymentEvent: 'LAZY Payment',
};

/**
 * Format event data for human-readable display
 */
async function formatEvent(event) {
	const formatted = {
		timestamp: event.timestamp,
		type: EVENT_TYPES[event.name] || event.name,
		blockNumber: event.blockNumber,
		transactionHash: event.transactionHash,
		details: {},
	};

	try {
		switch (event.name) {
		case 'NFTMinted': {
			const { minter, quantity, serials, hbarPaid, lazyPaid, totalDiscount } = event.args;
			const minterId = await homebrewPopulateAccountNum(minter);
			formatted.details = {
				minter: minterId.toString(),
				quantity: Number(quantity),
				serials: serials.map(s => Number(s)),
				hbarPaid: Hbar.fromTinybars(Number(hbarPaid)).toString(),
				lazyPaid: Number(lazyPaid),
				totalDiscount: `${Number(totalDiscount)}%`,
			};
			break;
		}

		case 'NFTRefunded': {
			const { refunder, serials, hbarRefunded, lazyRefunded } = event.args;
			const refunderId = await homebrewPopulateAccountNum(refunder);
			formatted.details = {
				refunder: refunderId.toString(),
				serials: serials.map(s => Number(s)),
				hbarRefunded: Hbar.fromTinybars(Number(hbarRefunded)).toString(),
				lazyRefunded: Number(lazyRefunded),
			};
			break;
		}

		case 'NFTsAddedToPool': {
			const { source, serials, newPoolSize } = event.args;
			const sourceId = await homebrewPopulateAccountNum(source);
			formatted.details = {
				source: sourceId.toString(),
				serialsAdded: serials.map(s => Number(s)),
				count: serials.length,
				newPoolSize: Number(newPoolSize),
			};
			break;
		}

		case 'NFTsRemovedFromPool': {
			const { serials, newPoolSize } = event.args;
			formatted.details = {
				serialsRemoved: serials.map(s => Number(s)),
				count: serials.length,
				newPoolSize: Number(newPoolSize),
			};
			break;
		}

		case 'DiscountTierUpdated': {
			const { token, tierIndex, discountPercentage, maxUsesPerSerial } = event.args;
			const tokenId = TokenId.fromSolidityAddress(token);
			formatted.details = {
				token: tokenId.toString(),
				tierIndex: Number(tierIndex),
				discountPercentage: `${Number(discountPercentage)}%`,
				maxUsesPerSerial: Number(maxUsesPerSerial),
				action: Number(discountPercentage) === 0 ? 'REMOVED' : 'ADDED/UPDATED',
			};
			break;
		}

		case 'EconomicsUpdated': {
			const { mintPriceHbar, mintPriceLazy, wlDiscount, sacrificeDiscount } = event.args;
			formatted.details = {
				mintPriceHbar: Hbar.fromTinybars(Number(mintPriceHbar)).toString(),
				mintPriceLazy: Number(mintPriceLazy),
				wlDiscount: `${Number(wlDiscount)}%`,
				sacrificeDiscount: `${Number(sacrificeDiscount)}%`,
			};
			break;
		}

		case 'TimingUpdated': {
			const { mintStartTime, mintPaused, refundWindow, refundPercentage, wlOnly } = event.args;
			const startDate = new Date(Number(mintStartTime) * 1000);
			formatted.details = {
				mintStartTime: startDate.toLocaleString(),
				mintPaused: mintPaused,
				refundWindow: `${Number(refundWindow) / 3600} hours`,
				refundPercentage: `${Number(refundPercentage)}%`,
				wlOnly: wlOnly,
			};
			break;
		}

		case 'WhitelistUpdated': {
			const { account, added } = event.args;
			const accountId = await homebrewPopulateAccountNum(account);
			formatted.details = {
				account: accountId.toString(),
				action: added ? 'ADDED' : 'REMOVED',
			};
			break;
		}

		case 'AdminUpdated': {
			const { account, added } = event.args;
			const accountId = await homebrewPopulateAccountNum(account);
			formatted.details = {
				account: accountId.toString(),
				action: added ? 'ADDED' : 'REMOVED',
			};
			break;
		}

		case 'FundsWithdrawn': {
			const { recipient, hbarAmount, lazyAmount } = event.args;
			const recipientId = await homebrewPopulateAccountNum(recipient);
			formatted.details = {
				recipient: recipientId.toString(),
				hbarAmount: Hbar.fromTinybars(Number(hbarAmount)).toString(),
				lazyAmount: Number(lazyAmount),
			};
			break;
		}

		case 'LazyPaymentEvent': {
			const { payer, amount, burnAmount } = event.args;
			const payerId = await homebrewPopulateAccountNum(payer);
			formatted.details = {
				payer: payerId.toString(),
				amount: Number(amount),
				burnAmount: Number(burnAmount),
				burnPercentage: amount > 0 ? `${(Number(burnAmount) * 100 / Number(amount)).toFixed(2)}%` : '0%',
			};
			break;
		}

		default:
			// Generic fallback for unknown events
			formatted.details = {};
			for (const [key, value] of Object.entries(event.args)) {
				// Skip numeric indices
				if (isNaN(key)) {
					formatted.details[key] = value.toString();
				}
			}
		}
	}
	catch (error) {
		formatted.details.error = `Failed to format: ${error.message}`;
		formatted.details.rawArgs = event.args;
	}

	return formatted;
}

/**
 * Display events to console
 */
function displayEvents(events, filter = null) {
	console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log('📊 FOREVERMINTER EVENT SCAN');
	console.log(`Contract: ${contractId.toString()}`);
	console.log(`Events Found: ${events.length}`);
	if (filter) {
		console.log(`Filter: ${filter}`);
	}
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	for (const event of events) {
		console.log(`\n[${event.timestamp}] ${event.type}`);
		console.log(`   Block: ${event.blockNumber} | Tx: ${event.transactionHash.substring(0, 20)}...`);

		for (const [key, value] of Object.entries(event.details)) {
			if (Array.isArray(value)) {
				console.log(`   ${key}: [${value.length} items]`);
				if (value.length <= 10) {
					console.log(`      ${value.join(', ')}`);
				}
				else {
					console.log(`      ${value.slice(0, 10).join(', ')}... (${value.length - 10} more)`);
				}
			}
			else if (typeof value === 'object') {
				console.log(`   ${key}: ${JSON.stringify(value, null, 2)}`);
			}
			else {
				console.log(`   ${key}: ${value}`);
			}
		}
	}

	console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Save events to JSON file
 */
function saveEventsToFile(events, filename) {
	const outputDir = path.join(__dirname, 'event-logs');
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const filepath = path.join(outputDir, filename);
	fs.writeFileSync(filepath, JSON.stringify(events, null, 2));
	console.log(`\n✅ Events saved to: ${filepath}`);
	console.log(`   Total events: ${events.length}`);
}

/**
 * Save events to CSV file
 */
function saveEventsToCSV(events, filename) {
	const outputDir = path.join(__dirname, 'event-logs');
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const filepath = path.join(outputDir, filename.replace('.json', '.csv'));

	// Build CSV
	const lines = ['Timestamp,Type,Block,Transaction,Details'];

	for (const event of events) {
		const detailsStr = JSON.stringify(event.details).replace(/"/g, '""');
		lines.push(`"${event.timestamp}","${event.type}",${event.blockNumber},"${event.transactionHash}","${detailsStr}"`);
	}

	fs.writeFileSync(filepath, lines.join('\n'));
	console.log(`\n✅ Events saved to CSV: ${filepath}`);
	console.log(`   Total events: ${events.length}`);
}

/**
 * Main function
 */
const main = async () => {
	// Validate environment
	if (!contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing or invalid FOREVER_MINTER_CONTRACT_ID in .env file');
		return;
	}

	if (!env) {
		console.log('❌ Error: Missing ENVIRONMENT in .env file');
		return;
	}

	console.log('\n🔍 ForeverMinter Event Scanner');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	// Load contract ABI
	const abiPath = path.join(__dirname, '../../../abi', `${contractName}.json`);
	if (!fs.existsSync(abiPath)) {
		console.log(`❌ Error: ABI file not found at ${abiPath}`);
		return;
	}

	const contractJSON = JSON.parse(fs.readFileSync(abiPath));
	const iface = new ethers.Interface(contractJSON);

	// Check for command line arguments
	const args = process.argv.slice(2);
	let fetchAll = false;
	let eventFilter = null;
	// console, json, csv, all
	let outputFormat = 'console';
	let limit = 100;

	// Parse command line arguments
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--all') {
			fetchAll = true;
		}
		else if (args[i] === '--filter' && args[i + 1]) {
			eventFilter = args[i + 1];
			i++;
		}
		else if (args[i] === '--output' && args[i + 1]) {
			outputFormat = args[i + 1];
			i++;
		}
		else if (args[i] === '--limit' && args[i + 1]) {
			limit = parseInt(args[i + 1]);
			i++;
		}
	}

	// Interactive mode if no arguments
	if (args.length === 0) {
		console.log('📋 Available Event Types:');
		const eventNames = Object.keys(EVENT_TYPES);
		eventNames.forEach((name, idx) => {
			console.log(`   ${idx + 1}. ${EVENT_TYPES[name]} (${name})`);
		});
		console.log('   0. All Events\n');

		const filterChoice = readlineSync.question('Select event type to filter (0 for all, or press Enter for all): ');

		if (filterChoice && filterChoice !== '0') {
			const idx = parseInt(filterChoice) - 1;
			if (idx >= 0 && idx < eventNames.length) {
				eventFilter = eventNames[idx];
			}
		}

		const fetchAllChoice = readlineSync.question('\nFetch all historical events? (y/N): ');
		fetchAll = fetchAllChoice.toLowerCase() === 'y';

		if (!fetchAll) {
			const limitInput = readlineSync.question('How many recent events to fetch? (default: 100): ');
			if (limitInput.trim()) {
				limit = parseInt(limitInput);
			}
		}

		console.log('\n📤 Output Options:');
		console.log('   1. Console only');
		console.log('   2. Save to JSON');
		console.log('   3. Save to CSV');
		console.log('   4. All (Console + JSON + CSV)\n');

		const outputChoice = readlineSync.question('Select output format (1-4, default: 1): ');
		switch (outputChoice) {
		case '2': outputFormat = 'json'; break;
		case '3': outputFormat = 'csv'; break;
		case '4': outputFormat = 'all'; break;
		default: outputFormat = 'console'; break;
		}
	}

	console.log('\n🔄 Fetching events from mirror node...');
	if (fetchAll) {
		console.log('   (This may take a while for contracts with many events)');
	}

	// Fetch events
	const rawEvents = await parseContractEvents(env, contractId.toString(), iface, limit, fetchAll, 'desc');

	if (rawEvents.length === 0) {
		console.log('\n⚠️  No events found');
		return;
	}

	console.log(`✅ Fetched ${rawEvents.length} raw events\n`);

	// Filter events if requested
	let filteredEvents = rawEvents;
	if (eventFilter) {
		filteredEvents = rawEvents.filter(e => e.name === eventFilter);
		console.log(`🔍 Filtered to ${filteredEvents.length} ${EVENT_TYPES[eventFilter] || eventFilter} events\n`);
	}

	if (filteredEvents.length === 0) {
		console.log('⚠️  No events match the filter');
		return;
	}

	// Format events
	console.log('📝 Formatting events...');
	const formattedEvents = [];
	for (const event of filteredEvents) {
		const formatted = await formatEvent(event);
		formattedEvents.push(formatted);
	}

	// Output based on selection
	if (outputFormat === 'console' || outputFormat === 'all') {
		displayEvents(formattedEvents, eventFilter ? EVENT_TYPES[eventFilter] : null);
	}

	if (outputFormat === 'json' || outputFormat === 'all') {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
		const filterSuffix = eventFilter ? `_${eventFilter}` : '';
		const filename = `ForeverMinter_events${filterSuffix}_${timestamp}.json`;
		saveEventsToFile(formattedEvents, filename);
	}

	if (outputFormat === 'csv' || outputFormat === 'all') {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
		const filterSuffix = eventFilter ? `_${eventFilter}` : '';
		const filename = `ForeverMinter_events${filterSuffix}_${timestamp}.json`;
		saveEventsToCSV(formattedEvents, filename);
	}

	// Summary statistics
	console.log('\n📊 Event Summary:');
	const eventCounts = {};
	for (const event of formattedEvents) {
		eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
	}

	for (const [type, count] of Object.entries(eventCounts)) {
		console.log(`   ${type}: ${count}`);
	}

	console.log('\n✅ Scan complete!\n');
};

// Run if called directly
if (require.main === module) {
	main()
		.then(() => process.exit(0))
		.catch(error => {
			console.error('\n❌ Error:', error);
			process.exit(1);
		});
}

module.exports = { main, formatEvent, displayEvents };
