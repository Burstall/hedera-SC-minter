const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { associateTokenToAccount } = require('../../../utils/hederaHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// Check for optional target account argument
	const targetAccountId = operatorId;
	const targetPrivateKey = operatorKey;

	if (process.argv.length === 3) {
		console.log('Usage: node associateToken.js [targetAccountId]');
		console.log('Examples:');
		console.log('  node associateToken.js                  # Associate token to your account');
		console.log('  node associateToken.js 0.0.123456       # Check association for account 0.0.123456');
		console.log('Note: You can only associate tokens to your own account (the one with the private key)');
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

	try {
		// Get token address
		const tokenCommand = minterIface.encodeFunctionData('getToken');
		const tokenResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			tokenCommand,
			operatorId,
			false,
		);
		const tokenAddress = minterIface.decodeFunctionResult('getToken', tokenResult);

		if (tokenAddress[0] === '0x0000000000000000000000000000000000000000') {
			console.log('❌ Error: Token not initialized. Run prepareBadgeMinter.js -init first.');
			return;
		}

		const tokenId = TokenId.fromSolidityAddress(tokenAddress[0]);

		console.log('\n===========================================');
		console.log('ASSOCIATE TOKEN');
		console.log('===========================================');
		console.log('Token ID:', tokenId.toString());
		console.log('Account:', targetAccountId.toString());

		const proceed = readlineSync.question('\nProceed with token association? (y/N): ');
		if (proceed.toLowerCase() !== 'y') {
			console.log('Cancelled.');
			return;
		}

		console.log('\n🔗 Associating token...');

		try {
			const result = await associateTokenToAccount(client, targetAccountId, targetPrivateKey, tokenId);

			if (result === 'SUCCESS') {
				console.log('✅ Token associated successfully!');
			}
			else {
				console.log('❌ Token association failed:', result);
			}
		}
		catch (error) {
			if (error.message.includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
				console.log('✅ Token is already associated to this account');
			}
			else {
				console.log('❌ Token association failed:', error.message);
			}
		}

	}
	catch (error) {
		console.log('❌ Error during token association:', error.message);
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