const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const readlineSync = require('readline-sync');
const fs = require('fs');
const { ethers } = require('ethers');
const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
const { getArgFlag, getArg } = require('../../../utils/nodeHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;

const env = process.env.ENVIRONMENT ?? null;
let client, minterIface;
let gas = 1_000_000;

const main = async () => {
	if (getArgFlag('h')) {
		console.log('Usage: prepareBadgeMinter.js [-gas X] [-init|-reset|-hardreset]');
		console.log('			-gas X								where X is the gas override to use');
		console.log('			-init [-max MM] -name NNN -symbol SSS -memo MMM');
		console.log('			-reset								remove all badge data');
		console.log('			-hardreset							remove data & token ID');
		console.log('			-revocable							deploy with revocable SBTs (default: false)');
		return;
	}

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('CONTRACT NAME:', contractName);

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
	minterIface = new ethers.Interface(json.abi);

	if (getArgFlag('gas')) {
		gas = getArg('gas');
		console.log('Using gas override:', gas);
	}

	if (getArgFlag('init')) {
		await initialiseContract();
	}
	else {
		console.log('No action specified. Use -h for help.');
	}
};

async function initialiseContract() {
	console.log('\n-Initializing SoulboundBadgeMinter...');

	const name = getArg('name') || readlineSync.question('Enter token name: ');
	const symbol = getArg('symbol') || readlineSync.question('Enter token symbol: ');
	const memo = getArg('memo') || readlineSync.question('Enter token memo: ');
	const maxSupplyInput = getArg('max') || readlineSync.question('Enter max supply (0 for unlimited): ');
	const maxSupply = maxSupplyInput === '' ? 0 : parseInt(maxSupplyInput);
	const unlimited = maxSupply === 0;

	console.log('\nInitializing with:');
	console.log('Name:', name);
	console.log('Symbol:', symbol);
	console.log('Memo:', memo);
	console.log('Max Supply:', unlimited ? 'Unlimited' : maxSupply);

	const proceed = readlineSync.question('Proceed? (y/N): ');
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
			'initialiseNFTMint',
			[name, symbol, memo, unlimited ? 0 : maxSupply, unlimited],
			gas,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'initialiseNFTMint',
			[
				name,
				symbol,
				memo,
				unlimited ? 0 : maxSupply,
				unlimited,
			],
			MINT_PAYMENT,
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ Token initialized successfully!');
			console.log('Token Address:', result[1][0]);
			console.log('Max Supply:', result[1][1].toString());
		}
		logTransactionResult(result, 'Token Initialization', gasInfo);
	}
	catch (error) {
		console.log('❌ Error during initialization:', error.message);
	}
}

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});