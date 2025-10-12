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
const { homebrewPopulateAccountEvmAddress, homebrewPopulateAccountNum } = require('../../../utils/hederaMirrorHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// check for 1 argument (account ID to add as admin)
	if (process.argv.length !== 3) {
		console.log('Usage: node addAdmin.js <accountID>');
		console.log('Example: node addAdmin.js 0.0.12345');
		console.log('Example: node addAdmin.js 0x000000000000000000000000000000000000beef');
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

	const accountToAdd = process.argv[2];
	let adminAddress;

	let accountId;

	// Convert account ID to EVM address if needed
	if (accountToAdd.startsWith('0.0.')) {
		accountId = AccountId.fromString(accountToAdd);
		try {
			adminAddress = await homebrewPopulateAccountEvmAddress(env, accountId);
		}
		catch {
			adminAddress = accountId.toSolidityAddress();
		}
	}
	else if (accountToAdd.startsWith('0x')) {
		adminAddress = accountToAdd;
		accountId = await homebrewPopulateAccountNum(env, accountToAdd);
	}
	else {
		console.log('Invalid account format. Use either 0.0.xxxxx or 0x...');
		return;
	}

	console.log('\n===========================================');
	console.log('ADDING ADMIN');
	console.log('===========================================');
	console.log('Account to add:', accountId.toString());
	console.log('EVM Address:', adminAddress);

	const proceed = readlineSync.question('\nProceed to add this admin? (y/N): ');
	if (proceed.toLowerCase() !== 'y') {
		console.log('Cancelled.');
		return;
	}

	try {
		// Estimate gas for the operation
		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'addAdmin',
			[adminAddress],
			400_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'addAdmin',
			[adminAddress],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ Admin added successfully!');
		}

		// Centralized transaction result logging
		logTransactionResult(result, 'Add Admin', gasInfo);
	}
	catch (error) {
		console.log('❌ Error adding admin:', error.message);
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