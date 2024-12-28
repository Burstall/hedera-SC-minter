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
const { contractExecuteFunction } = require('../../utils/solidityHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? 'MinterContract';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

// check-out the deployed script - test read-only method
const main = async () => {

	// check for 1 argument (a comma separated list of account IDs)
	if (process.argv.length !== 3) {
		console.log('Usage: node addToWhiteList.js <accountID>,<accountID>,<accountID>,...<accountID>');
		console.log('Example: node addToWhiteList.js 0.0.12345,0.0.12346,0.0.12347,0x00000027t1hjgjh');
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

	console.log('\n-Using ENIVRONMENT:', env);
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

	// parse the list of account IDs
	const accountList = process.argv[2].split(',');

	// if the user has supplied more than 80 accounts, warn them on maxing out the transaction size
	if (accountList.length > 75) {
		console.log('WARNING: Adding more than 75 accounts in a single transaction may exceed the transaction size limit.');
		console.log('Consider breaking up the list into multiple transactions.');
		const keepGoing = readlineSync.keyInYNStrict('Do you wish to continue?');
		if (!keepGoing) {
			console.log('User aborted.');
			return;
		}
	}

	const evmAddressList = [];
	console.log('Adding the following accounts to the whitelist:', accountList);
	for (let i = 0; i < accountList.length; i++) {
		const account = accountList[i];
		let accountId;
		try {
			accountId = AccountId.fromString(account);
		}
		catch {
			console.error('ERROR: Invalid account ID:', account);
			return;
		}
		try {
			const evmAddress = (await accountId.populateAccountEvmAddress(client)).evmAddress;
			evmAddressList.push(evmAddress);
		}
		catch {
			evmAddressList.push(accountId.toSolidityAddress());
		}
		console.log(`Account ${i + 1}:`, account, '->', evmAddressList[i]);
	}

	client.setOperator(operatorId, operatorKey);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const mintIface = new ethers.Interface(json.abi);

	const proceed = readlineSync.keyInYNStrict('Do you wish to add these addresses to the WL?');
	if (proceed) {
		const result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			250_000 + (125_000 * evmAddressList.length),
			'addToWhitelist',
			[evmAddressList.map(a => `0x${a.toString()}`)],
		);

		console.log('Result:', result[0]?.status.toString(), 'transaction ID:', result[2].transactionId.toString());
	}
	else {
		console.log('User aborted.');
	}


};

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
