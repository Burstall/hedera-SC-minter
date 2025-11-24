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
const contractId = ContractId.fromString(process.env.FOREVER_MINTER_CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	if (!operatorId || !operatorKey || !contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing configuration in .env file');
		return;
	}

	// Parse pause state from arguments
	if (process.argv.length < 3) {
		console.log('Usage: node setPause.js <true|false>');
		console.log('\nExamples:');
		console.log('   node setPause.js true    # Pause minting');
		console.log('   node setPause.js false   # Unpause minting');
		return;
	}

	const pauseInput = process.argv[2].toLowerCase();

	if (pauseInput !== 'true' && pauseInput !== 'false') {
		console.log('❌ Error: Argument must be "true" or "false"');
		return;
	}

	const shouldPause = pauseInput === 'true';

	console.log('\n⏸️  ForeverMinter - Set Pause State');
	console.log('======================================\n');

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
		console.log('📋 Pause State Update');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`New State: ${shouldPause ? '🔴 PAUSED' : '🟢 UNPAUSED'}`);

		if (shouldPause) {
			console.log('\n⚠️  Warning: Pausing will prevent all minting');
			console.log('   Users will not be able to mint NFTs until unpaused');
		}
		else {
			console.log('\n✅ Unpausing will allow minting to resume');
			console.log('   Users will be able to mint NFTs normally');
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with pause state change? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		console.log('\n🔄 Updating pause state...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updatePauseStatus',
			[shouldPause],
			150_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'updatePauseStatus',
			[shouldPause],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Pause state updated');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log(`\n📊 New State: ${shouldPause ? '🔴 PAUSED' : '🟢 UNPAUSED'}`);

			if (shouldPause) {
				console.log('\n⚠️  Minting is now DISABLED');
				console.log('   To re-enable: node setPause.js false');
			}
			else {
				console.log('\n✅ Minting is now ENABLED');
				console.log('   To pause again: node setPause.js true');
			}

			console.log('\n💡 Verify with: node getContractInfo.js');
		}
		else {
			console.log('❌ Failed to update pause state:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Set Pause', gasInfo);

	}
	catch (error) {
		console.log('❌ Error updating pause state:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
