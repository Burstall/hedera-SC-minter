const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');
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
		console.log('Usage: node withdrawLazy.js <recipient> <amount>');
		console.log('\nExample: node withdrawLazy.js 0.0.123456 1000');
		console.log('\n💡 Amount is in LAZY tokens (will use token decimals)');
		return;
	}

	const recipientStr = process.argv[2];
	const amountLazy = parseFloat(process.argv[3]);

	let recipientId;
	try {
		recipientId = AccountId.fromString(recipientStr);
	}
	catch {
		console.log('❌ Error: Invalid recipient account ID');
		return;
	}

	if (isNaN(amountLazy) || amountLazy <= 0) {
		console.log('❌ Error: Amount must be positive');
		return;
	}

	console.log('\n💎 ForeverMinter - Withdraw LAZY');
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
		// Get LAZY token details for decimal precision
		console.log('🔍 Fetching LAZY token details...\n');
		const lazyCommand = minterIface.encodeFunctionData('getLazyDetails');
		const lazyResult = await readOnlyEVMFromMirrorNode(env, contractId, lazyCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', lazyResult)[0];
		const lazyTokenId = TokenId.fromSolidityAddress(lazyDetails.lazyToken);
		const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
		if (!lazyTokenInfo) {
			console.log('❌ Error: Could not fetch LAZY token details');
			return;
		}
		const lazyDecimals = parseInt(lazyTokenInfo.decimals);

		// Convert amount to minimum denomination using actual token decimals
		const amountInMinDenomination = BigInt(Math.floor(amountLazy * Math.pow(10, lazyDecimals)));

		console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💎 LAZY Withdrawal');
		console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Recipient: ${recipientId.toString()}`);
		console.log(`Amount: ${amountLazy.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);

		console.log('\n⚠️  Warning: This will withdraw LAZY tokens from the contract');
		console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with LAZY withdrawal? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		console.log('\n🔄 Withdrawing LAZY...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'withdrawLazy',
			[recipientId.toSolidityAddress(), amountInMinDenomination.toString()],
			200_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'withdrawLazy',
			[recipientId.toSolidityAddress(), amountInMinDenomination.toString()],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! LAZY withdrawn');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n💎 Details:');
			console.log(`   Amount: ${amountLazy.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);
			console.log(`   Recipient: ${recipientId.toString()}`);
		}
		else {
			console.log('❌ Failed to withdraw:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Withdraw LAZY', gasInfo);

	}
	catch (error) {
		console.log('❌ Error withdrawing LAZY:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
