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
	console.log('║     Set WL-Only Mode (Owner)            ║');
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
		console.log('\n📊 Checking current WL-only state...');

		const wlOnlyCmd = abi.encodeFunctionData('wlOnly');
		const wlOnlyResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			wlOnlyCmd,
			operatorId,
			false,
		);
		const currentWlOnly = abi.decodeFunctionResult('wlOnly', wlOnlyResult)[0];

		console.log('\nCurrent State:', currentWlOnly ? '🎟️  WL-ONLY' : '🌐 PUBLIC');
		console.log('═══════════════════════════════════════════');

		if (currentWlOnly) {
			console.log('  Only whitelisted addresses can mint');
		}
		else {
			console.log('  Any address can mint (subject to timing/pause)');
		}

		// Get new state
		console.log('\n📝 Select New WL-Only Mode:');
		console.log('  1. 🎟️  Enable WL-Only (whitelist required)');
		console.log('  2. 🌐 Disable WL-Only (public minting)');
		console.log('  3. Cancel');

		const choice = readlineSync.question('\nChoice [1-3]: ');

		let newWlOnly;
		if (choice === '1') {
			newWlOnly = true;
		}
		else if (choice === '2') {
			newWlOnly = false;
		}
		else {
			console.log('❌ Operation cancelled');
			return;
		}

		if (newWlOnly === currentWlOnly) {
			console.log('⚠️  No change - mode is already', newWlOnly ? 'WL-ONLY' : 'PUBLIC');
			return;
		}

		console.log('\n📋 Mode Change:');
		console.log('═══════════════════════════════════════════');
		console.log('  From:', currentWlOnly ? '🎟️  WL-ONLY' : '🌐 PUBLIC');
		console.log('  To:', newWlOnly ? '🎟️  WL-ONLY' : '🌐 PUBLIC');
		console.log();

		if (newWlOnly) {
			console.log('  ⚠️  Warning: Only whitelisted addresses can mint');
			console.log('     Ensure whitelist is configured');
		}
		else {
			console.log('  ✓ Public minting will be enabled');
			console.log('    Any address can mint (subject to timing/pause)');
		}
		console.log();

		const proceed = readlineSync.keyInYNStrict('Proceed with mode change?');
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
			'setWlOnly',
			[newWlOnly],
			100_000,
		);

		console.log(`  Estimated gas: ${gasEstimate.gasLimit.toLocaleString()}`);

		// Execute update
		console.log('\n🚀 Updating WL-only mode...');
		const result = await contractExecuteFunction(
			contractId,
			abi,
			client,
			gasEstimate.gasLimit,
			'setWlOnly',
			[newWlOnly],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('❌ ERROR: Update failed');
			console.log('Status:', result[0]?.status?.toString());
			return;
		}

		console.log('\n✅ WL-only mode updated successfully!');
		console.log('Transaction ID:', result[2]?.transactionId?.toString());
		console.log('\nNew Mode:', newWlOnly ? '🎟️  WL-ONLY' : '🌐 PUBLIC');

		if (newWlOnly) {
			console.log('\n📊 Next Steps:');
			console.log('  • Verify whitelist:');
			console.log('    node scripts/interactions/EditionWithPrize/admin/addToWhitelist.js');
		}

	}
	catch (error) {
		console.error('\n❌ Error setting WL-only mode:', error.message || error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
