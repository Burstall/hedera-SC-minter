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
	if (process.argv.length < 6) {
		console.log('Usage: node updateBadge.js <badgeId> <name> <metadata> <maxSupply>');
		console.log('Example: node updateBadge.js 1 "Bronze Badge Updated" "ipfs://bronze-metadata-v2.json" 150');
		console.log('Example: node updateBadge.js 2 "Silver Badge" "ipfs://silver-metadata.json" 0');
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

	const badgeId = parseInt(process.argv[2]);
	const badgeName = process.argv[3];
	const badgeMetadata = process.argv[4];
	const maxSupply = parseInt(process.argv[5]);

	console.log('\n===========================================');
	console.log('UPDATE BADGE');
	console.log('===========================================');
	console.log('Badge ID:', badgeId);
	console.log('New Name:', badgeName);
	console.log('New Metadata:', badgeMetadata);
	console.log('New Max Supply:', maxSupply === 0 ? 'Unlimited' : maxSupply);

	const proceed = readlineSync.question('\nProceed to update this badge? (y/N): ');
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
			'updateBadge',
			[badgeId, badgeName, badgeMetadata, maxSupply],
			600_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'updateBadge',
			[
				badgeId,
				badgeName,
				badgeMetadata,
				maxSupply,
			],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ Badge updated successfully!');
			logTransactionResult(result, 'Badge Update', gasInfo);
		}
		else {
			console.log('❌ Failed to update badge:', result[0]?.status?.toString());
			if (result[2]?.transactionId) {
				console.log('📝 Failed Transaction ID:', result[2].transactionId.toString());
			}
			if (result[0]?.status?.name === 'NotAdmin') {
				console.log('Error: You are not an admin of this contract.');
			}
			else if (result[0]?.status?.name === 'TypeNotFound') {
				console.log('Error: Badge ID not found.');
			}
			else if (result[0]?.status?.name === 'InsufficientTokenSupply') {
				console.log('Error: New max supply would exceed available token capacity.');
			}
		}
	}
	catch (error) {
		console.log('❌ Error updating badge:', error.message);
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