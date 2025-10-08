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
const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
const { homebrewPopulateAccountEvmAddress } = require('../../../utils/hederaMirrorHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// Check for required arguments
	if (process.argv.length < 3) {
		console.log('Usage: node transferHbar.js <amount> [recipient]');
		console.log('Example: node transferHbar.js 1000000      # Transfer 0.01 HBAR to operator');
		console.log('Example: node transferHbar.js 1000000 0.0.12345  # Transfer 0.01 HBAR to specific account');
		console.log('Note: amount is in tinybar (1 HBAR = 100,000,000 tinybar)');
		return;
	}

	if (operatorId === undefined || operatorId == null) {
		console.log('Environment required, please specify ACCOUNT_ID in the .env file');
		return;
	}
	else if (contractId === undefined || contractId == null) {
		console.log('Contract ID required, please specify CONTRACT_ID in the .env file');
		return;
	}

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using contract:', contractId.toString());
	console.log('\n-Using contract name:', contractName);

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('interacting in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('interacting in *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('interacting in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('interacting in *LOCAL*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));
	const minterIface = new ethers.Interface(json.abi);

	const amount = parseInt(process.argv[2]);
	const recipientInput = process.argv.length > 3 ? process.argv[3] : operatorId.toString();

	// Convert recipient to EVM address
	let recipientEvmAddress;
	if (recipientInput.startsWith('0.0.')) {
		const accountId = AccountId.fromString(recipientInput);
		try {
			recipientEvmAddress = await homebrewPopulateAccountEvmAddress(env, accountId);
		}
		catch {
			recipientEvmAddress = accountId.toSolidityAddress();
		}
	}
	else if (recipientInput.startsWith('0x')) {
		recipientEvmAddress = recipientInput;
	}
	else {
		console.log('Invalid account format. Use either 0.0.xxxxx or 0x...');
		return;
	}

	const amountInHbar = amount / 100_000_000;

	console.log('\n===========================================');
	console.log('TRANSFER HBAR FROM CONTRACT');
	console.log('===========================================');
	console.log('Amount (tinybar):', amount.toLocaleString());
	console.log('Amount (HBAR):', amountInHbar.toFixed(8));
	console.log('Recipient:', recipientInput);
	console.log('Recipient EVM:', recipientEvmAddress);

	console.log('\n⚠️  WARNING: This will transfer HBAR from the contract to the specified address.');
	console.log('⚠️  Make sure the contract has sufficient balance.');

	const proceed = readlineSync.question('\nProceed with HBAR transfer? (y/N): ');
	if (proceed.toLowerCase() !== 'y') {
		console.log('Cancelled.');
		return;
	}

	try {
		console.log('\n💰 Transferring HBAR...');

		// Estimate gas for the operation
		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'transferHbar',
			[recipientEvmAddress, amount],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'transferHbar',
			[
				recipientEvmAddress,
				amount,
			],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ HBAR transferred successfully!');
			logTransactionResult(result, 'HBAR Transfer', gasInfo);
		}
		else {
			console.log('❌ Failed to transfer HBAR:', result[0]?.status?.toString());
			if (result[2]?.transactionId) {
				console.log('📝 Failed Transaction ID:', result[2].transactionId.toString());
			}
			if (result[0]?.status?.name === 'NotAdmin') {
				console.log('Error: You are not an admin of this contract.');
			}
			else if (result[0]?.status?.name === 'INSUFFICIENT_PAYER_BALANCE') {
				console.log('Error: Contract has insufficient HBAR balance.');
			}
			else if (result[0]?.status?.name === 'INVALID_RECEIVING_NODE_ACCOUNT') {
				console.log('Error: Invalid recipient address.');
			}
		}
	}
	catch (error) {
		console.log('❌ Error transferring HBAR:', error.message);
	}
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});