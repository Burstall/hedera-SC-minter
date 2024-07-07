const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
require('dotenv').config();
const readlineSync = require('readline-sync');
const fs = require('fs');
const { ethers } = require('ethers');
const { hex_to_ascii } = require('../../utils/nodeHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');


// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? 'MinterContract';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

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

	// get the $LAZY token details
	let encodedCommand = mintIface.encodeFunctionData('getLazyToken');

	const lazyTokenOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const lazyToken = mintIface.decodeFunctionResult('getLazyToken', lazyTokenOutput)[0];

	const lazyTokenDetails = await getTokenDetails(env, lazyToken);

	// query getCost via mirror node
	encodedCommand = mintIface.encodeFunctionData('getCost');

	const costOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const costs = mintIface.decodeFunctionResult('getCost', costOutput)[0];

	console.log('Cost to mint:\nHbar:', new Hbar(Number(costs[0]), HbarUnit.Tinybar).toString(), '\nLazy:', Number(costs[1]) / 10 ** lazyTokenDetails.decimals, lazyTokenDetails.symbol);

	// call getRemainingMint via mirror node
	encodedCommand = mintIface.encodeFunctionData('getRemainingMint');

	const remainingMintOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const remainingMint = Number(mintIface.decodeFunctionResult('getRemainingMint', remainingMintOutput)[0]);

	console.log('Remaining to mint:', remainingMint);

	// ask the user how many they want to mint
	const qty = readlineSync.questionInt('How many NFTs do you want to mint? ');

	const proceed = readlineSync.keyInYNStrict(`Do you wish to attempt to mint ${qty} NFTs?`);
	if (proceed) {
		// TODO: potential to add error checks on MaxMint or simulate the tx?
		const result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			500_000 * qty,
			'mintNFT',
			[qty],
			Number(costs[0]) * qty,
		);
		console.log('\nResult:', result[0]?.status?.stoString(), '\nserial(s)', result[1][0], '\nmetadata');
		for (let m = 0; m < result[1][1].length; m++) {
			console.log('Serial #', result[1][0][m], ' -> ', hex_to_ascii(result[1][1][m]));
		}

		console.log('\nTransaction ID:', result[2].transactionId.toString());
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
