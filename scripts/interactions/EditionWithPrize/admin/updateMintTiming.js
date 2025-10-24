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
	console.log('║     Update Mint Timing (Owner)          ║');
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
		console.log('\n📊 Checking current mint timing...');

		const startTimeCmd = abi.encodeFunctionData('mintStartTime');
		const startTimeResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			startTimeCmd,
			operatorId,
			false,
		);
		const currentStartTime = abi.decodeFunctionResult('mintStartTime', startTimeResult)[0];

		const pausedCmd = abi.encodeFunctionData('paused');
		const pausedResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			pausedCmd,
			operatorId,
			false,
		);
		const currentPaused = abi.decodeFunctionResult('paused', pausedResult)[0];

		const wlOnlyCmd = abi.encodeFunctionData('wlOnly');
		const wlOnlyResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			wlOnlyCmd,
			operatorId,
			false,
		);
		const currentWlOnly = abi.decodeFunctionResult('wlOnly', wlOnlyResult)[0];

		const now = Math.floor(Date.now() / 1000);
		const startDate = new Date(Number(currentStartTime) * 1000);

		console.log('\nCurrent Mint Timing:');
		console.log('═══════════════════════════════════════════');
		console.log('  Start Time:', currentStartTime.toString(), `(${startDate.toLocaleString()})`);
		console.log('  Current Time:', now, `(${new Date(now * 1000).toLocaleString()})`);
		console.log('  Status:', currentPaused ? '⏸️  PAUSED' : '▶️  ACTIVE');
		console.log('  Mode:', currentWlOnly ? '🎟️  WL-ONLY' : '🌐 PUBLIC');

		if (Number(currentStartTime) > now) {
			const hoursUntil = Math.floor((Number(currentStartTime) - now) / 3600);
			console.log(`  ⏰ Mint starts in ${hoursUntil} hours`);
		}

		// Get new values
		console.log('\n📝 Enter New Mint Timing:');
		console.log('   (Press Enter to keep current value)\n');

		console.log('Start Time Options:');
		console.log('  1. Now (immediate)');
		console.log('  2. Specific date/time');
		console.log('  3. Unix timestamp');
		console.log('  4. Keep current');

		const choice = readlineSync.question('\nChoice [1-4]: ');
		let newStartTime = currentStartTime;

		if (choice === '1') {
			newStartTime = BigInt(now);
			console.log(`✓ Set to: ${new Date(now * 1000).toLocaleString()}`);
		}
		else if (choice === '2') {
			const dateStr = readlineSync.question('Enter date (YYYY-MM-DD HH:MM): ');
			try {
				const timestamp = Math.floor(new Date(dateStr).getTime() / 1000);
				if (isNaN(timestamp)) throw new Error('Invalid date');
				newStartTime = BigInt(timestamp);
				console.log(`✓ Set to: ${new Date(timestamp * 1000).toLocaleString()}`);
			}
			catch {
				console.log('❌ Invalid date format');
				return;
			}
		}
		else if (choice === '3') {
			const timestamp = readlineSync.question('Enter unix timestamp: ');
			newStartTime = BigInt(timestamp);
			console.log(`✓ Set to: ${new Date(Number(newStartTime) * 1000).toLocaleString()}`);
		}

		let newPaused = currentPaused;
		let newWlOnly = currentWlOnly;

		const changePaused = readlineSync.keyInYNStrict('\nChange pause state?');
		if (changePaused) {
			newPaused = !currentPaused;
			console.log(`✓ Set to: ${newPaused ? '⏸️  PAUSED' : '▶️  ACTIVE'}`);
		}

		const changeWlOnly = readlineSync.keyInYNStrict('\nChange WL-only mode?');
		if (changeWlOnly) {
			newWlOnly = !currentWlOnly;
			console.log(`✓ Set to: ${newWlOnly ? '🎟️  WL-ONLY' : '🌐 PUBLIC'}`);
		}

		// Display summary
		console.log('\n📋 New Mint Timing:');
		console.log('═══════════════════════════════════════════');
		console.log('  Start Time:', new Date(Number(newStartTime) * 1000).toLocaleString());
		console.log('  Status:', newPaused ? '⏸️  PAUSED' : '▶️  ACTIVE');
		console.log('  Mode:', newWlOnly ? '🎟️  WL-ONLY' : '🌐 PUBLIC');
		console.log();

		if (newPaused) {
			console.log('  ⚠️  Minting will be paused - users cannot mint');
		}
		else if (newWlOnly) {
			console.log('  ⚠️  Only whitelisted addresses can mint');
		}
		else {
			console.log('  ✓ Public minting will be enabled');
		}
		console.log();

		const proceed = readlineSync.keyInYNStrict('Update mint timing?');
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
			'updateMintTiming',
			[newStartTime, newPaused, newWlOnly],
			100_000,
		);

		console.log(`  Estimated gas: ${gasEstimate.gasLimit.toLocaleString()}`);

		// Execute update
		console.log('\n🚀 Updating mint timing...');
		const result = await contractExecuteFunction(
			contractId,
			abi,
			client,
			gasEstimate.gasLimit,
			'updateMintTiming',
			[newStartTime, newPaused, newWlOnly],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('❌ ERROR: Update failed');
			console.log('Status:', result[0]?.status?.toString());
			return;
		}

		console.log('\n✅ Mint timing updated successfully!');
		console.log('Transaction ID:', result[2]?.transactionId?.toString());

		console.log('\n📊 Next Steps:');
		console.log('  • Verify state:');
		console.log('    node scripts/interactions/EditionWithPrize/getContractState.js');
		if (newWlOnly) {
			console.log('  • Manage whitelist:');
			console.log('    node scripts/interactions/EditionWithPrize/admin/addToWhitelist.js');
		}

	}
	catch (error) {
		console.error('\n❌ Error updating mint timing:', error.message || error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
