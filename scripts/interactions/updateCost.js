const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	HbarUnit,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const readlineSync = require('readline-sync');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');


// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? 'MinterContract';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

// check-out the deployed script - test read-only method
const main = async () => {
	const args = process.argv.slice(2);
	if (getArgFlag('-h') || args.length != 2) {
		console.log('Usage: updateCost.js XX YY');
		console.log('   where XX is price in Hbar and YY is price in Lazy allowinf for decimal so 10 == 1 $LAZY');
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

	// getMintEconomics from mirror nodes
	let encodedCommand = mintIface.encodeFunctionData('getMintEconomics');

	const mintEconOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const mintEcon = mintIface.decodeFunctionResult('getMintEconomics', mintEconOutput)[0];

	// get the $LAZY token details
	encodedCommand = mintIface.encodeFunctionData('getLazyToken');

	const lazyTokenOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const lazyToken = TokenId.fromSolidityAddress(mintIface.decodeFunctionResult('getLazyToken', lazyTokenOutput)[0]);

	const lazyTokenDetails = await getTokenDetails(env, lazyToken);

	console.log('Current mint economics:');
	console.log('Contract Pays $LAZY:', Boolean(mintEcon[0]));
	console.log('HBAR Px:', new Hbar(Number(mintEcon[1]), HbarUnit.Tinybar).toString());
	console.log('$LAZY Px:', Number(mintEcon[2]) / 10 ** lazyTokenDetails.decimals, lazyTokenDetails.symbol);
	console.log('WL discount (during WL period):', Number(mintEcon[3]), '%');
	console.log('Max Mints (per tx):', Number(mintEcon[4]));
	console.log('WL cost in $LAZY (0 = N/A):', Number(mintEcon[5]) ? `${Number(mintEcon[5]) / 10 ** lazyTokenDetails.decimals} ${lazyTokenDetails.symbol}` : 'N/A');
	console.log('WL slots per purchase (0 = uncapped):', Number(mintEcon[6]));
	console.log('Max Mints per Wallet:', Number(mintEcon[7]));
	console.log('Token to buy WL with:', TokenId.fromSolidityAddress(mintEcon[8]).toString());

	const hbarCost = new Hbar(Number(args[0]), HbarUnit.Hbar);
	const lazyCost = Number(args[1]) * 10 ** lazyTokenDetails.decimals;

	console.log('New cost to mint:\nHbar:', hbarCost.toString(), '\n$LAZY:', Number(args[1]), lazyTokenDetails.symbol);

	const proceed = readlineSync.keyInYNStrict('Do you want to update mint price?');
	if (proceed) {
		const result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			500_000,
			'updateCost',
			[BigInt(hbarCost.toTinybars()), lazyCost],
		);

		console.log('Result:', result[0]?.status.toString(), 'transaction ID:', result[2].transactionId.toString());
	}
	else {
		console.log('User aborted');
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
