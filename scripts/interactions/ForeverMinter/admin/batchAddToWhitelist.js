const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
const { estimateGas, logTransactionResult } = require('../../../../utils/gasHelpers');

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

	if (process.argv.length < 3) {
		console.log('Usage: node batchAddToWhitelist.js <accounts_file>');
		console.log('\nFile format (CSV): accountId,slots');
		console.log('Example file content:');
		console.log('   0.0.123456,5');
		console.log('   0.0.789012,10');
		console.log('   0.0.345678,3');
		return;
	}

	const filename = process.argv[2];

	console.log('\n🎟️  ForeverMinter - Batch Add to Whitelist');
	console.log('=============================================\n');

	// Read and parse file
	const accounts = [];
	try {
		const fileContent = fs.readFileSync(filename, 'utf8');
		const lines = fileContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));

		for (const line of lines) {
			const [accountIdStr, slotsStr] = line.trim().split(',');

			if (!accountIdStr || !slotsStr) {
				console.log(`⚠️  Skipping invalid line: ${line}`);
				continue;
			}

			try {
				const accountId = AccountId.fromString(accountIdStr.trim());
				const slots = parseInt(slotsStr.trim());

				if (isNaN(slots) || slots < 1) {
					console.log(`⚠️  Skipping invalid slots for ${accountIdStr}: ${slotsStr}`);
					continue;
				}

				accounts.push({ accountId, slots });
			}
			catch {
				console.log(`⚠️  Skipping invalid account: ${accountIdStr}`);
			}
		}

		if (accounts.length === 0) {
			console.log('❌ Error: No valid accounts found in file');
			return;
		}

	}
	catch (error) {
		console.log('❌ Error reading file:', error.message);
		return;
	}

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
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 Batch Whitelist Addition');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Total Accounts: ${accounts.length}`);
		console.log('');

		// Display first 10 entries
		const preview = accounts.slice(0, 10);
		for (const { accountId, slots } of preview) {
			console.log(`   ${accountId.toString()}: ${slots} slot(s)`);
		}

		if (accounts.length > 10) {
			console.log(`   ... and ${accounts.length - 10} more`);
		}

		const totalSlots = accounts.reduce((sum, acc) => sum + acc.slots, 0);
		console.log(`\nTotal Slots: ${totalSlots}`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with batch addition? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		console.log('\n🔄 Adding accounts to whitelist...\n');

		// Prepare arrays
		const addresses = accounts.map(a => a.accountId.toSolidityAddress());
		const slots = accounts.map(a => a.slots);

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'batchAddToWhitelist',
			[addresses, slots],
			300_000 + (accounts.length * 50_000),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'batchAddToWhitelist',
			[addresses, slots],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Batch added to whitelist');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n📊 Summary:');
			console.log(`   Accounts Added: ${accounts.length}`);
			console.log(`   Total Slots: ${totalSlots}`);

			console.log('\n💡 Verify individual accounts with: node checkWLSlots.js <accountId>');
		}
		else {
			console.log('❌ Failed to batch add:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Batch Add to Whitelist', gasInfo);

	}
	catch (error) {
		console.log('❌ Error during batch addition:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
