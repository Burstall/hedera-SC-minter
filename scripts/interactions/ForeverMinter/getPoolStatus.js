const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'ForeverMinter';
const contractId = ContractId.fromString(process.env.FOREVER_MINTER_CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	if (!operatorId || !operatorKey || !contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing configuration in .env file');
		return;
	}

	// Parse pagination from arguments
	let page = 1;
	let pageSize = 50;

	if (process.argv.length >= 3) {
		page = parseInt(process.argv[2]);
		if (isNaN(page) || page < 1) {
			console.log('❌ Error: Invalid page number');
			return;
		}
	}

	if (process.argv.length >= 4) {
		pageSize = parseInt(process.argv[3]);
		if (isNaN(pageSize) || pageSize < 1 || pageSize > 200) {
			console.log('❌ Error: Invalid page size (must be 1-200)');
			return;
		}
	}

	console.log('\n📦 ForeverMinter - NFT Pool Status');
	console.log('=====================================\n');

	// Setup client
	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
	}
	else {
		console.log('❌ Error: Invalid ENVIRONMENT in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Load ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));
	const minterIface = new ethers.Interface(json.abi);

	try {
		// Get remaining supply
		const supplyCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const supplyResult = await readOnlyEVMFromMirrorNode(env, contractId, supplyCommand, operatorId, false);
		const remainingSupply = Number(minterIface.decodeFunctionResult('getRemainingSupply', supplyResult)[0]);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📊 Pool Overview');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Remaining Supply: ${remainingSupply} NFTs`);

		if (remainingSupply === 0) {
			console.log('\n⚠️  Pool is empty - no NFTs available for minting');
			return;
		}

		// Get paginated serials
		const startIndex = (page - 1) * pageSize;
		const limit = pageSize;

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log(`📋 Available Pool Serials (Page ${page})`);
		console.log(`   Offset: ${startIndex}, Limit: ${limit}`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Get paginated available serials
		const serialsCommand = minterIface.encodeFunctionData('getAvailableSerialsPaginated', [startIndex, limit]);
		const serialsResult = await readOnlyEVMFromMirrorNode(env, contractId, serialsCommand, operatorId, false);
		const serials = minterIface.decodeFunctionResult('getAvailableSerialsPaginated', serialsResult)[0];

		if (serials.length === 0) {
			if (startIndex === 0) {
				console.log('No serials available in pool\n');
			}
			else {
				console.log(`❌ No serials at offset ${startIndex}`);
				console.log(`   Pool may have fewer than ${startIndex + 1} serials\n`);
			}
			return;
		}

		// Display serials
		console.log(`Found ${serials.length} serials:\n`);

		// Display in rows of 10
		for (let i = 0; i < serials.length; i += 10) {
			const chunk = serials.slice(i, Math.min(i + 10, serials.length));
			const serialNumbers = chunk.map(s => Number(s));
			console.log(`   ${serialNumbers.join(', ')}`);
		}

		// Pagination info
		const hasMore = serials.length === limit;

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📖 Pagination');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Page ${page} (showing ${serials.length} serials)`);
		console.log(`Remaining in pool: ${remainingSupply}`);

		if (page > 1) {
			console.log(`\n⬅️  Previous page: node getPoolStatus.js ${page - 1} ${pageSize}`);
		}

		if (hasMore) {
			console.log(`➡️  Next page: node getPoolStatus.js ${page + 1} ${pageSize}`);
		}

		console.log('\n💡 Usage:');
		console.log('   node getPoolStatus.js [page] [pageSize]');
		console.log('   • page: Page number (default: 1)');
		console.log('   • pageSize: Serials per page (default: 50, max: 200)');

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.log('❌ Error loading pool status:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
