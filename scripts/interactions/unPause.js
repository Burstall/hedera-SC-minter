const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../utils/solidityHelpers');
const readlineSync = require('readline-sync');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? 'MinterContract';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

// check-out the deployed script - test read-only method
const main = async () => {
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

	client.setOperator(operatorId, operatorKey);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const mintIface = new ethers.Interface(json.abi);

	// get current pause status vis getMintTiming from mirror nodes
	const encodedCommand = mintIface.encodeFunctionData('getMintTiming');

	const mintTimingOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const mintTiming = mintIface.decodeFunctionResult('getMintTiming', mintTimingOutput)[0];

	console.log('Current mint timing:');
	console.log('last mint:', mintTiming[0], ' -> ', new Date(Number(mintTiming[0]) * 1000).toISOString());
	console.log('mint start:', mintTiming[1], ' -> ', new Date(Number(mintTiming[1]) * 1000).toISOString());
	console.log('PAUSE STATUS:', Boolean(mintTiming[2]));
	console.log('Cooldown period:', Number(mintTiming[3]), ' seconds');
	console.log('Refund Window (if applicable):', Number(mintTiming[4]));
	console.log('WL ONLY:', Boolean(mintTiming[5]));

	const proceed = readlineSync.keyInYNStrict('Do you wish to *UNPAUSE* the contract?');
	if (proceed) {
		const result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			350_000,
			'updatePauseStatus',
			[false],
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
