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
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
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

	console.log('\n⚙️  ForeverMinter - Update Mint Timing');
	console.log('=========================================\n');

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
		// Fetch current timing configuration
		console.log('🔍 Fetching current timing configuration...\n');
		console.log(`   Contract ID: ${contractId.toString()}`);
		console.log(`   Environment: ${env}\n`);

		const encodedCommand = minterIface.encodeFunctionData('getMintTiming');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);

		if (!queryResult || queryResult === '0x' || queryResult.length <= 2) {
			console.log('❌ Error: Contract returned empty data');
			console.log('   This usually means:');
			console.log('   1. The FOREVER_MINTER_CONTRACT_ID in .env is incorrect');
			console.log('   2. The contract is not deployed on this network');
			console.log('   3. The contract has not been initialized\n');
			console.log(`   Current FOREVER_MINTER_CONTRACT_ID: ${contractId.toString()}`);
			console.log(`   Current ENVIRONMENT: ${env}`);
			return;
		}

		const currentTiming = minterIface.decodeFunctionResult('getMintTiming', queryResult)[0];

		// Extract current values
		const currentStartTime = Number(currentTiming[1]);
		const currentMintPaused = currentTiming[2];
		const currentRefundWindow = Number(currentTiming[3]);
		const currentRefundPercentage = Number(currentTiming[4]);
		const currentWlOnly = currentTiming[5];

		console.log('📊 Current Timing Configuration:');
		console.log(`   Start Time: ${currentStartTime === 0 ? 'Immediate' : new Date(currentStartTime * 1000).toLocaleString()} (${currentStartTime})`);
		console.log(`   Mint Paused: ${currentMintPaused}`);
		console.log(`   Refund Window: ${currentRefundWindow} seconds (${currentRefundWindow / 3600} hours)`);
		console.log(`   Refund Percentage: ${currentRefundPercentage}%`);
		console.log(`   Whitelist Only: ${currentWlOnly}`);

		console.log('\n📋 Enter new mint timing values:');
		console.log('   (Press Enter to keep current value)\n');

		// Collect inputs
		const startTimeInput = readlineSync.question('Start Time (Unix timestamp, 0 = immediate): ');
		const mintPausedInput = readlineSync.question('Mint Paused (true/false): ');
		const refundWindowInput = readlineSync.question('Refund Window (seconds): ');
		const refundPercentageInput = readlineSync.question('Refund Percentage (0-100): ');
		const wlOnlyInput = readlineSync.question('Whitelist Only (true/false): ');

		// Validate and convert
		// Default to current values
		const startTime = startTimeInput.trim() ? parseInt(startTimeInput) : currentStartTime;
		const mintPaused = mintPausedInput.trim() ? mintPausedInput.toLowerCase() === 'true' : currentMintPaused;
		const refundWindow = refundWindowInput.trim() ? parseInt(refundWindowInput) : currentRefundWindow;
		const refundPercentage = refundPercentageInput.trim() ? parseInt(refundPercentageInput) : currentRefundPercentage;
		const wlOnly = wlOnlyInput.trim() ? wlOnlyInput.toLowerCase() === 'true' : currentWlOnly;

		// Validate values
		if (isNaN(startTime) || startTime < 0) {
			console.log('❌ Error: Invalid start time');
			return;
		}

		if (isNaN(refundWindow) || refundWindow < 0) {
			console.log('❌ Error: Invalid refund window');
			return;
		}

		if (isNaN(refundPercentage) || refundPercentage < 0 || refundPercentage > 100) {
			console.log('❌ Error: Invalid refund percentage (must be 0-100)');
			return;
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 SUMMARY - Parameters to be sent');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Calculate what's changing
		const startChanged = startTime !== currentStartTime;
		const pausedChanged = mintPaused !== currentMintPaused;
		const windowChanged = refundWindow !== currentRefundWindow;
		const percentageChanged = refundPercentage !== currentRefundPercentage;
		const wlOnlyChanged = wlOnly !== currentWlOnly;

		const changeMarker = (changed) => changed ? ' ⭐ CHANGED' : '';

		// Show all parameters with change indicators
		if (startTime === 0) {
			console.log(`Start Time: Immediate (no delay)${changeMarker(startChanged)}`);
		}
		else {
			console.log(`Start Time: ${new Date(startTime * 1000).toLocaleString()}${changeMarker(startChanged)}`);
			console.log(`   (Unix timestamp: ${startTime})`);
		}

		console.log(`Mint Paused: ${mintPaused}${changeMarker(pausedChanged)}`);

		const hours = refundWindow / 3600;
		console.log(`Refund Window: ${refundWindow} seconds (${hours} hours)${changeMarker(windowChanged)}`);

		console.log(`Refund Percentage: ${refundPercentage}%${changeMarker(percentageChanged)}`);

		console.log(`Whitelist Only: ${wlOnly}${changeMarker(wlOnlyChanged)}`);

		console.log('\n⚠️  Warning: This will update the contract configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with update? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		// Prepare arguments for updateTiming()
		// All 5 parameters are required by the contract
		const params = [
			startTime,
			mintPaused,
			refundWindow,
			refundPercentage,
			wlOnly,
		];

		console.log('\n🔄 Updating mint timing...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateTiming',
			params,
			250_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'updateTiming',
			params,
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Mint timing updated');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n📊 Updated Values:');

			if (startTime === 0) {
				console.log(`   Start Time: Immediate (no delay)${changeMarker(startChanged)}`);
			}
			else {
				console.log(`   Start Time: ${new Date(startTime * 1000).toLocaleString()}${changeMarker(startChanged)}`);
			}

			console.log(`   Mint Paused: ${mintPaused}${changeMarker(pausedChanged)}`);
			console.log(`   Refund Window: ${refundWindow / 3600} hours${changeMarker(windowChanged)}`);
			console.log(`   Refund Percentage: ${refundPercentage}%${changeMarker(percentageChanged)}`);
			console.log(`   Whitelist Only: ${wlOnly}${changeMarker(wlOnlyChanged)}`);

			if (startChanged || pausedChanged || windowChanged || percentageChanged || wlOnlyChanged) {
				console.log('\n   ⭐ = Value changed from current');
			}

			console.log('\n💡 Verify with: node getContractInfo.js');
		}
		else {
			console.log('❌ Failed to update:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Update Mint Timing', gasInfo);

	}
	catch (error) {
		console.log('❌ Error updating mint timing:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
