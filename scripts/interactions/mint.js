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
const readlineSync = require('readline-sync');
const fs = require('fs');
const { ethers } = require('ethers');
const { hex_to_ascii } = require('../../utils/nodeHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails, checkMirrorBalance, checkMirrorAllowance } = require('../../utils/hederaMirrorHelpers');
const { associateTokenToAccount, setFTAllowance } = require('../../utils/hederaHelpers');


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

	const lazyToken = TokenId.fromSolidityAddress(mintIface.decodeFunctionResult('getLazyToken', lazyTokenOutput)[0]);

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

	const costs = mintIface.decodeFunctionResult('getCost', costOutput);

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

	const userTokenBalance = await checkMirrorBalance(env, operatorId, nftToken);

	if (userTokenBalance === null || userTokenBalance === undefined) {
		console.log('User neeeds to associate NFT token with account before minting NFTs.');

		const proceed = readlineSync.keyInYNStrict('Do you wish to associate the NFT token with this account?');
		if (proceed) {
			const result = await associateTokenToAccount(client, operatorId, operatorKey, nftToken);

			console.log('Result:', result);
		}
		else {
			console.log('User aborted.');
			return;
		}
	}

	// ask the user how many they want to mint
	const qty = readlineSync.questionInt('How many NFTs do you want to mint? ');

	// need to set the $LAZY allowance to the contract
	const lazyAllowance = Number(costs[1]) * qty;
	const lazyAllowanceStr = `${lazyAllowance / 10 ** lazyTokenDetails.decimals} ${lazyTokenDetails.symbol}`;

	// get the user's $LAZY allowance
	const userLazyAllowance = await checkMirrorAllowance(env, operatorId, lazyToken, contractId);

	if (userLazyAllowance === null || userLazyAllowance === undefined || userLazyAllowance < lazyAllowance) {

		const lazyAllowanceProceed = readlineSync.keyInYNStrict(`Do you wish to allow the contract to spend ${lazyAllowanceStr}?`);
		if (lazyAllowanceProceed) {
			const result = await setFTAllowance(client, lazyToken, operatorId, AccountId.fromString(contractId.toString()), lazyAllowance);

			console.log('Result:', result);
		}
		else {
			console.log('User aborted.');
			return;
		}
	}

	const proceed = readlineSync.keyInYNStrict(`Do you wish to attempt to mint ${qty} NFTs?`);
	if (proceed) {
		// TODO: potential to add error checks on MaxMint or simulate the tx?
		const result = await contractExecuteFunction(
			contractId,
			mintIface,
			client,
			500_000 + 325_000 * qty,
			'mintNFT',
			[qty],
			new Hbar(Number(costs[0]) * qty, HbarUnit.Tinybar),
		);
		console.log('\nResult:', result[0]?.status?.toString(), '\nserial(s)', result[1][0], '\nmetadata');
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
