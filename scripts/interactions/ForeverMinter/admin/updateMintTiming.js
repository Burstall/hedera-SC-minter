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
		console.log('📋 Enter new mint timing values:');
		console.log('   (Press Enter to skip a field and keep current value)\n');

		// Collect inputs
		const startTimeInput = readlineSync.question('Start Time (Unix timestamp, 0 = immediate): ');
		const refundWindowInput = readlineSync.question('Refund Window (seconds): ');
		const refundPercentageInput = readlineSync.question('Refund Percentage (0-100): ');

		// Validate and convert
		const startTime = startTimeInput ? parseInt(startTimeInput) : null;
		const refundWindow = refundWindowInput ? parseInt(refundWindowInput) : null;
		const refundPercentage = refundPercentageInput ? parseInt(refundPercentageInput) : null;

		// Check if any values provided
		if (startTime === null && refundWindow === null && refundPercentage === null) {
			console.log('\n❌ Error: No values provided');
			return;
		}

		// Validate values
		if (startTime !== null && (isNaN(startTime) || startTime < 0)) {
			console.log('❌ Error: Invalid start time');
			return;
		}

		if (refundWindow !== null && (isNaN(refundWindow) || refundWindow < 0)) {
			console.log('❌ Error: Invalid refund window');
			return;
		}

		if (refundPercentage !== null && (isNaN(refundPercentage) || refundPercentage < 0 || refundPercentage > 100)) {
			console.log('❌ Error: Invalid refund percentage (must be 0-100)');
			return;
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 SUMMARY - New Values');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (startTime !== null) {
			if (startTime === 0) {
				console.log('Start Time: Immediate (no delay)');
			}
			else {
				console.log(`Start Time: ${new Date(startTime * 1000).toLocaleString()}`);
				console.log(`   (Unix timestamp: ${startTime})`);
			}
		}

		if (refundWindow !== null) {
			const hours = refundWindow / 3600;
			console.log(`Refund Window: ${refundWindow} seconds (${hours} hours)`);
		}

		if (refundPercentage !== null) {
			console.log(`Refund Percentage: ${refundPercentage}%`);
		}

		console.log('\n⚠️  Warning: This will update the contract configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with update? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		// Prepare arguments
		const args = [
			startTime ?? 0,
			refundWindow ?? 0,
			refundPercentage ?? 0,
		];

		// Prepare flags (0 = skip, 1 = update)
		const flags = [
			startTime !== null ? 1 : 0,
			refundWindow !== null ? 1 : 0,
			refundPercentage !== null ? 1 : 0,
		];

		console.log('\n🔄 Updating mint timing...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateMintTiming',
			[...args, flags],
			250_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'updateMintTiming',
			[...args, flags],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Mint timing updated');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n📊 Updated Values:');

			if (startTime !== null) {
				if (startTime === 0) {
					console.log('   Start Time: Immediate (no delay)');
				}
				else {
					console.log(`   Start Time: ${new Date(startTime * 1000).toLocaleString()}`);
				}
			}

			if (refundWindow !== null) {
				console.log(`   Refund Window: ${refundWindow / 3600} hours`);
			}

			if (refundPercentage !== null) {
				console.log(`   Refund Percentage: ${refundPercentage}%`);
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
