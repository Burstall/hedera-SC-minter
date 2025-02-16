const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const readlineSync = require('readline-sync');
const fs = require('fs');
const { ethers } = require('ethers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getSerialsOwned, getNFTApprovedForAllAllowances } = require('../../utils/hederaMirrorHelpers');
const { setNFTAllowanceAll } = require('../../utils/hederaHelpers');


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


	// get the token ID and ensure the user has it associated -> use getNFTTokenAddress from mirror nodes
	const encodedCommand = mintIface.encodeFunctionData('getNFTTokenAddress');

	const nftTokenOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const nftToken = TokenId.fromSolidityAddress(mintIface.decodeFunctionResult('getNFTTokenAddress', nftTokenOutput)[0]);

	// get the serials of the NFTs
	const usersSerials = await getSerialsOwned(env, operatorId, nftToken);

	if (usersSerials === null || usersSerials === undefined || usersSerials.length === 0) {
		console.log('No NFTs found in user account, unable to burn.');
		process.exit(1);
	}

	// ask the user which NFT(s) they want to burn
	console.log('Serials owned:', usersSerials);
	const serials = readlineSync.question('Enter the serial number(s) of the NFT(s) you want to burn (comma separated): ');

	const serialArr = serials.split(',').map(Number);

	if (serialArr.length === 0) {
		console.log('No serials entered, aborting.');
		process.exit(1);
	}

	// check if the user owns the NFTs
	const ownedSerials = usersSerials.filter(serial => serialArr.includes(serial));

	if (ownedSerials.length !== serialArr.length) {
		console.log('User does not own all the NFTs specified.');
		process.exit(1);
	}

	let proceed = readlineSync.keyInYNStrict(`Do you wish to attempt to burn serial #${serialArr} NFTs?`);

	if (!proceed) {
		console.log('User aborted.');
		return;
	}

	// need to check there is an allowance to the contract to enable the burn
	const nftAllowances = await getNFTApprovedForAllAllowances(env, operatorId);

	if (!nftAllowances.has(contractId.toString()) || !nftAllowances.get(contractId.toString()).includes(nftToken.toString())) {
		// check user is happy to set the allowance
		proceed = readlineSync.keyInYNStrict('Do you wish to allow the contract to burn NFTs on your behalf? Required for burn');
		if (proceed) {
			const nftAllowanceRes = await setNFTAllowanceAll(client, [nftToken], operatorId, contractId);
			console.log('Setting NFT All serial Allowance:', nftAllowanceRes);
		}
	}


	proceed = readlineSync.keyInYNStrict('LAST CHANCE: Do you wish to procced with the burn?');
	if (proceed) {
		// TODO: potential to add error checks on MaxMint or simulate the tx?
		const result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			500_000 + 225_000 * serialArr.length,
			'burnNFTs',
			[serialArr],
		);
		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Transaction failed:', result[0]);
		}
		else {

			console.log('\nResult:', result[0]?.status?.toString());
			console.log('\nTransaction ID:', result[2].transactionId.toString());
		}
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
