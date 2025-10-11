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
const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// Check for required arguments
	if (process.argv.length < 5) {
		console.log('Usage: node createBadge.js <name> <metadata> <maxSupply>');
		console.log('Example: node createBadge.js "Bronze Badge" "ipfs://bronze-metadata.json" 100');
		console.log('Example: node createBadge.js "Silver Badge" "ipfs://silver-metadata.json" 0');
		console.log('Note: maxSupply of 0 means unlimited supply');
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

	console.log('\n-Using ENVIRONMENT:', env);
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
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));
	const minterIface = new ethers.Interface(json.abi);

	const badgeName = process.argv[2];
	const badgeMetadata = process.argv[3];
	const maxSupply = parseInt(process.argv[4]);

	console.log('\n===========================================');
	console.log('CREATE BADGE');
	console.log('===========================================');
	console.log('Badge Name:', badgeName);
	console.log('Metadata:', badgeMetadata);
	console.log('Max Supply:', maxSupply === 0 ? 'Unlimited' : maxSupply);

	const proceed = readlineSync.question('\nProceed to create this badge? (y/N): ');
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
			'createBadge',
			[badgeName, badgeMetadata, maxSupply],
			600_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'createBadge',
			[
				badgeName,
				badgeMetadata,
				maxSupply,
			],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			const badgeId = Number(result[1][0]);
			console.log('✅ Badge created successfully!');
			console.log('Badge ID:', badgeId);
		}
		else {
			console.log('❌ Failed to create badge:', result[0]?.status?.toString());
			if (result[2]?.transactionId) {
				console.log('📝 Failed Transaction ID:', result[2].transactionId.toString());
			}
			if (result[0]?.status?.name === 'NotAdmin') {
				console.log('Error: You are not an admin of this contract.');
			}
			else if (result[0]?.status?.name === 'TokenNotInitialized') {
				console.log('Error: Token not initialized. Run prepareBadgeMinter.js -init first.');
			}
			else if (result[0]?.status?.name === 'InsufficientTokenSupply') {
				console.log('Error: Insufficient token supply for this badge capacity.');
			}
		}

		// Centralized transaction result logging
		logTransactionResult(result, 'Badge Creation', gasInfo);
	}
	catch (error) {
		console.log('❌ Error creating badge:', error.message);
	}
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});