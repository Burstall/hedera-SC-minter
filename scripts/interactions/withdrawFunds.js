const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	HbarUnit,
	Hbar,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { getArgFlag, sleep } = require('../../utils/nodeHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { checkMirrorHbarBalance, checkMirrorBalance, getTokenDetails } = require('../../utils/hederaMirrorHelpers');


// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? 'MinterContract';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	const args = process.argv.slice(2);
	if (getArgFlag('-h') || args.length != 1) {
		console.log('Usage: withdrawFunds.js');
		console.log('   pull hbar / $LAZY from contract to operator account');
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

	client.setOperator(operatorId, operatorKey);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const mintIface = new ethers.Interface(json.abi);

	const proceed = readlineSync.keyInYNStrict('Do you want to pull HBAR/$LAZY?');
	if (proceed) {
		// get the $LAZY token of the contract via mirror node -> getLazyToken

		const encodedCommand = mintIface.encodeFunctionData('getLazyToken');

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const lazyToken = TokenId.fromSolidityAddress(mintIface.decodeFunctionResult('getLazyToken', result)[0]);

		const lazyTokenDetails = await getTokenDetails(env, lazyToken);


		// find out the hbar balance of the contract
		let contractBal = await checkMirrorHbarBalance(env, AccountId.fromString(contractId.toString()));
		let contractLazyBal = await checkMirrorBalance(env, AccountId.fromString(contractId.toString()), lazyToken);

		console.log('Contract HBAR balance:', new Hbar(contractBal, HbarUnit.Tinybar).toString());
		console.log('Contract $LAZY balance:', contractLazyBal / 10 ** lazyTokenDetails.decimals, lazyTokenDetails.symbol);

		// withdraw the hbar
		result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			500_000,
			'transferHbar',
			[operatorId.toSolidityAddress(), Number(contractBal)],
		);

		console.log('HBAR Result:', result[0]?.status.toString(), 'transaction ID:', result[2].transactionId.toString());

		result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			500_000,
			'retrieveLazy',
			[operatorId.toSolidityAddress(), Number(contractLazyBal)],
		);

		console.log('$LAZY Result:', result[0]?.status.toString(), 'transaction ID:', result[2].transactionId.toString());

		// sleep to let mirror node catch up
		await sleep(4000);
		contractBal = await checkMirrorHbarBalance(env, AccountId.fromString(contractId.toString()));
		contractLazyBal = await checkMirrorBalance(env, AccountId.fromString(contractId.toString()), lazyToken);

		console.log('Contract HBAR balance:', new Hbar(contractBal, HbarUnit.Tinybar).toString());
		console.log('Contract $LAZY balance:', contractLazyBal / 10 ** lazyTokenDetails.decimals, lazyTokenDetails.symbol);
	}
	else {
		console.log('User aborted');
		return;
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
