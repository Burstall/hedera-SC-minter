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
	readOnlyEVMFromMirrorNode,
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
	console.log('║        Set Pause State (Owner)          ║');
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
		// Check current state
		console.log('\n📊 Checking current pause state...');

		const pausedCmd = abi.encodeFunctionData('paused');
		const pausedResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			pausedCmd,
			operatorId,
			false,
		);
		const currentPaused = abi.decodeFunctionResult('paused', pausedResult)[0];

		console.log('\nCurrent State:', currentPaused ? '⏸️  PAUSED' : '▶️  ACTIVE');
		console.log('═══════════════════════════════════════════');

		if (currentPaused) {
			console.log('  Minting is currently DISABLED');
			console.log('  Users cannot call mint()');
		}
		else {
			console.log('  Minting is currently ENABLED');
			console.log('  Users can mint (subject to timing/WL)');
		}

		// Get new state
		console.log('\n📝 Select New Pause State:');
		console.log('  1. ▶️  Unpause (enable minting)');
		console.log('  2. ⏸️  Pause (disable minting)');
		console.log('  3. Cancel');

		const choice = readlineSync.question('\nChoice [1-3]: ');

		let newPaused;
		if (choice === '1') {
			newPaused = false;
		}
		else if (choice === '2') {
			newPaused = true;
		}
		else {
			console.log('❌ Operation cancelled');
			return;
		}

		if (newPaused === currentPaused) {
			console.log('⚠️  No change - state is already', newPaused ? 'PAUSED' : 'ACTIVE');
			return;
		}

		console.log('\n📋 State Change:');
		console.log('═══════════════════════════════════════════');
		console.log('  From:', currentPaused ? '⏸️  PAUSED' : '▶️  ACTIVE');
		console.log('  To:', newPaused ? '⏸️  PAUSED' : '▶️  ACTIVE');
		console.log();

		if (newPaused) {
			console.log('  ⚠️  Warning: This will DISABLE all minting');
			console.log('     Users will not be able to call mint()');
		}
		else {
			console.log('  ✓ This will ENABLE minting');
			console.log('    Users can mint (check timing/WL settings)');
		}
		console.log();

		const proceed = readlineSync.keyInYNStrict('Proceed with state change?');
		if (!proceed) {
			console.log('❌ Update cancelled');
			return;
		}

		// Estimate gas
		console.log('\n⛽ Estimating gas...');
		const gasEstimate = await estimateGas(
			env,
			contractId,
			abi,
			operatorId,
			'setPause',
			[newPaused],
			100_000,
		);

		console.log(`  Estimated gas: ${gasEstimate.gasLimit.toLocaleString()}`);

		// Execute update
		console.log('\n🚀 Updating pause state...');
		const result = await contractExecuteFunction(
			contractId,
			abi,
			client,
			gasEstimate.gasLimit,
			'setPause',
			[newPaused],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('❌ ERROR: Update failed');
			console.log('Status:', result[0]?.status?.toString());
			return;
		}

		console.log('\n✅ Pause state updated successfully!');
		console.log('Transaction ID:', result[2]?.transactionId?.toString());
		console.log('\nNew State:', newPaused ? '⏸️  PAUSED' : '▶️  ACTIVE');

		if (!newPaused) {
			console.log('\n📊 Next Steps:');
			console.log('  • Verify minting works:');
			console.log('    node scripts/interactions/EditionWithPrize/mint.js');
			console.log('  • Check contract state:');
			console.log('    node scripts/interactions/EditionWithPrize/getContractState.js');
		}

	}
	catch (error) {
		console.error('\n❌ Error setting pause state:', error.message || error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
