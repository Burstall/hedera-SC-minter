const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	HbarUnit,
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
		console.log('Usage: node withdrawHbar.js <recipient> <amount>');
		console.log('\nExample: node withdrawHbar.js 0.0.123456 100');
		console.log('\n💡 Amount is in HBAR');
		return;
	}

	const recipientStr = process.argv[2];
	const amountHbar = parseFloat(process.argv[3]);

	let recipientId;
	try {
		recipientId = AccountId.fromString(recipientStr);
	}
	catch {
		console.log('❌ Error: Invalid recipient account ID');
		return;
	}

	if (isNaN(amountHbar) || amountHbar <= 0) {
		console.log('❌ Error: Amount must be positive');
		return;
	}

	console.log('\n💰 ForeverMinter - Withdraw HBAR');
	console.log('===================================\n');

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
		console.log('💰 HBAR Withdrawal');
		console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Recipient: ${recipientId.toString()}`);
		console.log(`Amount: ${amountHbar} HBAR`);

		console.log('\n⚠️  Warning: This will withdraw HBAR from the contract');
		console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with HBAR withdrawal? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		console.log('\n🔄 Withdrawing HBAR...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'withdrawHbar',
			[recipientId.toSolidityAddress(), Hbar.from(amountHbar, HbarUnit.Hbar).toTinybars().toString()],
			200_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'withdrawHbar',
			[recipientId.toSolidityAddress(), Hbar.from(amountHbar, HbarUnit.Hbar).toTinybars().toString()],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! HBAR withdrawn');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n💰 Details:');
			console.log(`   Amount: ${amountHbar} HBAR`);
			console.log(`   Recipient: ${recipientId.toString()}`);
		}
		else {
			console.log('❌ Failed to withdraw:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Withdraw HBAR', gasInfo);

	}
	catch (error) {
		console.log('❌ Error withdrawing HBAR:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
