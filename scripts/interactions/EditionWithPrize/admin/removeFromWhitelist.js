const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { ethers } = require('ethers');
const {
	contractExecuteFunction,
} = require('../../../../utils/solidityHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
require('dotenv').config();

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractId = ContractId.fromString(process.env.EDITION_WITH_PRIZE_CONTRACT_ID);
const contractName = 'EditionWithPrize';
const env = process.env.ENVIRONMENT ?? null;

let client;
let abi;

const main = async () => {
	console.log('\n╔══════════════════════════════════════════╗');
	console.log('║    Remove from Whitelist (Owner)        ║');
	console.log('╚══════════════════════════════════════════╝\n');

	if (
		operatorKey === undefined ||
		operatorKey == null ||
		operatorId === undefined ||
		operatorId == null
	) {
		console.log('❌ ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in .env file');
		return;
	}

	console.log('Using account:', operatorId.toString());
	console.log('Contract ID:', contractId.toString());
	console.log('Environment:', env);

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
		console.log('❌ ERROR: Must specify either MAIN, TEST, PREVIEW, or LOCAL as environment');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Load contract ABI
	const json = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	abi = new ethers.Interface(json.abi);

	try {
		// Get addresses to remove
		console.log('\n📝 Enter Addresses to Remove from Whitelist:');
		console.log('   Options:');
		console.log('   1. Enter single address');
		console.log('   2. Enter multiple addresses (comma-separated)');
		console.log('   3. Load from file (one address per line)');

		const choice = readlineSync.question('\nChoice [1-3]: ');
		const addresses = [];

		if (choice === '1') {
			const addr = readlineSync.question('Account ID (0.0.xxxxx): ');
			if (!addr || !addr.match(/^\d+\.\d+\.\d+$/)) {
				console.log('❌ Invalid account ID format');
				return;
			}
			addresses.push(addr);
		}
		else if (choice === '2') {
			const addrList = readlineSync.question('Account IDs (comma-separated): ');
			const split = addrList.split(',').map(a => a.trim());

			for (const addr of split) {
				if (!addr.match(/^\d+\.\d+\.\d+$/)) {
					console.log(`❌ Invalid account ID format: ${addr}`);
					return;
				}
				addresses.push(addr);
			}
		}
		else if (choice === '3') {
			const filePath = readlineSync.question('File path: ');
			try {
				const content = fs.readFileSync(filePath, 'utf8');
				const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

				for (const addr of lines) {
					if (!addr.match(/^\d+\.\d+\.\d+$/)) {
						console.log(`❌ Invalid account ID format: ${addr}`);
						return;
					}
					addresses.push(addr);
				}
			}
			catch (error) {
				console.log('❌ Error reading file:', error.message);
				return;
			}
		}
		else {
			console.log('❌ Invalid choice');
			return;
		}

		if (addresses.length === 0) {
			console.log('❌ No addresses provided');
			return;
		}

		// Convert to EVM addresses
		const evmAddresses = [];
		for (const addr of addresses) {
			try {
				const accountId = AccountId.fromString(addr);
				const evmAddr = accountId.toSolidityAddress();
				evmAddresses.push('0x' + evmAddr);
			}
			catch (error) {
				console.log(`❌ Error converting ${addr}:`, error.message);
				return;
			}
		}

		// Display summary
		console.log('\n📋 Addresses to Remove from Whitelist:');
		console.log('═══════════════════════════════════════════');
		addresses.forEach((addr, i) => {
			console.log(`  ${i + 1}. ${addr} → ${evmAddresses[i]}`);
		});
		console.log('\nTotal:', addresses.length, 'address(es)');
		console.log();

		const proceed = readlineSync.keyInYNStrict('Remove these addresses from whitelist?');
		if (!proceed) {
			console.log('❌ Operation cancelled');
			return;
		}

		// Estimate gas
		console.log('\n⛽ Estimating gas...');
		const gasEstimate = await estimateGas(
			env,
			contractId,
			abi,
			operatorId,
			'removeFromWhitelist',
			[evmAddresses],
			150_000 + (evmAddresses.length * 10_000),
		);

		console.log(`  Estimated gas: ${gasEstimate.gasLimit.toLocaleString()}`);

		// Execute update
		console.log('\n🚀 Removing from whitelist...');
		const result = await contractExecuteFunction(
			contractId,
			abi,
			client,
			gasEstimate.gasLimit,
			'removeFromWhitelist',
			[evmAddresses],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('❌ ERROR: Failed to remove addresses');
			console.log('Status:', result[0]?.status?.toString());
			return;
		}

		console.log('\n✅ Addresses removed from whitelist successfully!');
		console.log('Transaction ID:', result[2]?.transactionId?.toString());
		console.log('\n✓', addresses.length, 'address(es) removed from whitelist');

		console.log('\n📊 Next Steps:');
		console.log('  • Verify whitelist status:');
		console.log('    node scripts/interactions/EditionWithPrize/checkWLStatus.js');

	}
	catch (error) {
		console.error('\n❌ Error removing from whitelist:', error.message || error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
