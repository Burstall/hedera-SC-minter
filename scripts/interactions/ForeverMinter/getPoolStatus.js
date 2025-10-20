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
const contractId = ContractId.fromString(process.env.CONTRACT_ID || '');
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
		// Get supply information
		const supplyCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const supplyResult = await readOnlyEVMFromMirrorNode(env, contractId, supplyCommand, operatorId, false);
		const supply = minterIface.decodeFunctionResult('getRemainingSupply', supplyResult)[0];

		const poolSize = Number(supply.poolSize);
		const poolUsed = Number(supply.poolUsed);
		const remaining = poolSize - poolUsed;

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📊 Pool Overview');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Total Pool Size: ${poolSize} NFTs`);
		console.log(`Used: ${poolUsed} NFTs`);
		console.log(`Remaining: ${remaining} NFTs`);

		const usedPercent = poolSize > 0 ? ((poolUsed / poolSize) * 100).toFixed(2) : 0;
		console.log(`Usage: ${usedPercent}%`);

		if (remaining === 0) {
			console.log('\n⚠️  Pool is empty - no NFTs available for minting');
			return;
		}

		// Get paginated serials
		const startIndex = (page - 1) * pageSize;
		const endIndex = Math.min(startIndex + pageSize, poolSize);

		if (startIndex >= poolSize) {
			console.log(`\n❌ Error: Page ${page} exceeds available pool size`);
			console.log(`   Pool has ${poolSize} serials, page starts at index ${startIndex}`);
			return;
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log(`📋 Pool Serials (Page ${page})`);
		console.log(`   Showing indices ${startIndex}-${endIndex - 1} of ${poolSize}`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Get serials in batches to avoid large single queries
		const batchSize = 20;
		const serials = [];

		for (let i = startIndex; i < endIndex; i += batchSize) {
			const batchEnd = Math.min(i + batchSize, endIndex);
			const indices = [];

			for (let j = i; j < batchEnd; j++) {
				indices.push(j);
			}

			// Query batch
			const batchCommand = minterIface.encodeFunctionData('getNFTsInPool', [indices]);
			const batchResult = await readOnlyEVMFromMirrorNode(env, contractId, batchCommand, operatorId, false);
			const batchSerials = minterIface.decodeFunctionResult('getNFTsInPool', batchResult)[0];

			for (let k = 0; k < batchSerials.length; k++) {
				serials.push({
					index: indices[k],
					serial: Number(batchSerials[k]),
					used: indices[k] < poolUsed,
				});
			}

			// Progress indicator
			process.stdout.write(`\rLoading serials... ${Math.min(batchEnd, endIndex)} of ${endIndex}`);
		}

		console.log('\n');

		// Display serials
		const available = serials.filter(s => !s.used);
		const used = serials.filter(s => s.used);

		if (available.length > 0) {
			console.log('✅ Available Serials:');
			console.log(`   ${available.map(s => s.serial).join(', ')}`);
		}

		if (used.length > 0) {
			console.log('\n🔴 Used Serials:');
			console.log(`   ${used.map(s => s.serial).join(', ')}`);
		}

		// Pagination info
		const totalPages = Math.ceil(poolSize / pageSize);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📖 Pagination');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Page ${page} of ${totalPages}`);
		console.log(`Showing ${serials.length} serials (${available.length} available, ${used.length} used)`);

		if (page > 1) {
			console.log(`\n⬅️  Previous page: node getPoolStatus.js ${page - 1} ${pageSize}`);
		}

		if (page < totalPages) {
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
