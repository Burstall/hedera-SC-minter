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

	if (process.argv.length < 4) {
		console.log('Usage: node emergencyWithdrawNFT.js <recipient> <serial1> [serial2] [serial3] ...');
		console.log('\nExample: node emergencyWithdrawNFT.js 0.0.123456 123 456 789');
		console.log('\n⚠️  WARNING: Emergency use only - withdraws NFTs from contract');
		return;
	}

	const recipientStr = process.argv[2];
	const serials = process.argv.slice(3).map(s => parseInt(s));

	let recipientId;
	try {
		recipientId = AccountId.fromString(recipientStr);
	}
	catch {
		console.log('❌ Error: Invalid recipient account ID');
		return;
	}

	if (serials.some(s => isNaN(s) || s < 1)) {
		console.log('❌ Error: All serials must be positive numbers');
		return;
	}

	console.log('\n🚨 ForeverMinter - Emergency NFT Withdrawal');
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
		console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🚨 EMERGENCY NFT WITHDRAWAL');
		console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Recipient: ${recipientId.toString()}`);
		console.log(`Serials to Withdraw: ${serials.length}`);
		console.log(`   ${serials.join(', ')}`);

		console.log('\n⚠️  WARNING: This is an emergency function');
		console.log('   • NFTs will be transferred to specified recipient');
		console.log('   • They will be removed from the minting pool');
		console.log('   • Use only in exceptional circumstances');
		console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Are you sure you want to proceed? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		const doubleConfirm = readlineSync.question('Type "EMERGENCY" to confirm: ');
		if (doubleConfirm !== 'EMERGENCY') {
			console.log('❌ Cancelled - confirmation failed');
			return;
		}

		console.log('\n🔄 Processing emergency withdrawal...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'emergencyWithdrawNFTs',
			[recipientId.toSolidityAddress(), serials],
			300_000 + (serials.length * 50_000),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'emergencyWithdrawNFTs',
			[recipientId.toSolidityAddress(), serials],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Emergency withdrawal completed');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n📊 Details:');
			console.log(`   Serials Withdrawn: ${serials.length}`);
			console.log(`   Serials: ${serials.join(', ')}`);
			console.log(`   Destination: ${recipientId.toString()}`);

			console.log('\n💡 Verify with: node getPoolStatus.js');
		}
		else {
			console.log('❌ Failed to withdraw:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Emergency Withdraw NFT', gasInfo);

	}
	catch (error) {
		console.log('❌ Error during emergency withdrawal:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
