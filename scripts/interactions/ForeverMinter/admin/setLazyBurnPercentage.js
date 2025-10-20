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
		console.log('Usage: node setLazyBurnPercentage.js <percentage>');
		console.log('\nExample: node setLazyBurnPercentage.js 25');
		console.log('\n💡 Percentage of LAZY tokens to burn (0-100)');
		console.log('   Remaining percentage goes to contract owner');
		return;
	}

	const percentage = parseInt(process.argv[2]);

	if (isNaN(percentage) || percentage < 0 || percentage > 100) {
		console.log('❌ Error: Percentage must be between 0 and 100');
		return;
	}

	console.log('\n💎 ForeverMinter - Set LAZY Burn Percentage');
	console.log('==============================================\n');

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
		console.log('📋 LAZY Burn Percentage Update');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`New Burn Percentage: ${percentage}%`);
		console.log(`Owner Receives: ${100 - percentage}%`);

		console.log('\n💡 How it works:');
		console.log(`   • ${percentage}% of LAZY payments will be burned`);
		console.log(`   • ${100 - percentage}% will go to contract owner`);
		console.log('   • This applies to future mints and WL slot purchases');

		console.log('\n⚠️  Warning: This affects LAZY token economics');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with update? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		console.log('\n🔄 Updating LAZY burn percentage...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'setLazyBurnPercentage',
			[percentage],
			150_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'setLazyBurnPercentage',
			[percentage],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! LAZY burn percentage updated');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n📊 New Split:');
			console.log(`   Burn: ${percentage}%`);
			console.log(`   Owner: ${100 - percentage}%`);

			console.log('\n💡 Verify with: node getContractInfo.js');
		}
		else {
			console.log('❌ Failed to update:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Set LAZY Burn Percentage', gasInfo);

	}
	catch (error) {
		console.log('❌ Error updating LAZY burn percentage:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
