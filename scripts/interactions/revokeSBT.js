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
const { homebrewPopulateAccountEvmAddress, getSerialsOwned } = require('../../utils/hederaMirrorHelpers');


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

	// check the REVOCABLE status of the contract is true else abort
	let encodedCommand = mintIface.encodeFunctionData('REVOCABLE');
	const revocableVarOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const revocable = mintIface.decodeFunctionResult('REVOCABLE', revocableVarOutput)[0];
	if (!revocable) {
		console.log('Contract is not revocable, aborting.');
		process.exit(1);
	}
	else {
		console.log('Contract is revocable. Proceeding.');
	}


	// get the token ID and ensure the user has it associated -> use getNFTTokenAddress from mirror nodes
	encodedCommand = mintIface.encodeFunctionData('getNFTTokenAddress');

	const nftTokenOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const nftToken = TokenId.fromSolidityAddress(mintIface.decodeFunctionResult('getNFTTokenAddress', nftTokenOutput)[0]);

	// request the user to mint on behalf of and pattern check it for \d\.d\.\d+
	const pattern = /\d\.\d\.\d+/;
	let revokeFor = readlineSync.question(`Enter the account ID to revoke the SBT token [${nftToken.toString()}] from (e.g. 0.0.1234): `);

	if (!pattern.test(revokeFor)) {
		console.log('Invalid account ID entered, aborting.');
		return;
	}

	revokeFor = AccountId.fromString(revokeFor);

	const revokeForAsEVM = await homebrewPopulateAccountEvmAddress(env, revokeFor);

	console.log('Revoking SBT from:', revokeFor.toString(), 'EVM:', revokeForAsEVM);

	// check which serials the user has
	const serials = await getSerialsOwned(env, revokeFor, nftToken);

	if (serials === null || serials === undefined || serials.length === 0) {
		console.log('No NFTs found in user account, unable to revoke.');
		process.exit(1);
	}

	console.log('Serials owned:', serials);

	// ask which serial they want to revoke
	const selectedSerial = Number(readlineSync.question('Enter the serial number of the NFT you want to revoke: '));

	if (!serials.includes(selectedSerial)) {
		console.log('User does not own the NFT specified.');
		process.exit(1);
	}

	const proceed = readlineSync.keyInYNStrict(`Do you wish to revoke #${selectedSerial} of the SBT [${nftToken.toString()}] for ${revokeFor.toString()}?`);
	if (proceed) {
		const result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			500_000,
			'revokeSBT',
			[revokeForAsEVM, selectedSerial],
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
