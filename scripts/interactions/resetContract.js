const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const readlineSync = require('readline-sync');
const fs = require('fs');
const ethers = require('ethers');
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

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('interacting in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('interacting in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);
	console.log('Operator Account ID:', operatorId.toString());
	console.log('CONTRACT NAME:', contractName);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));

	const minterIface = new ethers.Interface(json.abi);

	// check if user wants to remove the token
	const removeToken = readlineSync.keyInYNStrict('Do you want to remove the token?');

	// request batch size (Default 100)
	let batchSize = readlineSync.questionInt('Enter the batch size (Default 100): ');

	if (!batchSize) {
		batchSize = 100;
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to reset the contract?');

	if (proceed) {
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			3_200_000,
			'resetContract',
			[removeToken, batchSize],
		);

		console.log('resetContract result:', result[0]?.status?.toString());
		console.log('resetContract transaction:', result[2]?.transactionId?.toString());
	}
	else {
		console.log('user aborted');
	}
};


main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
