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
const { homebrewPopulateAccountEvmAddress } = require('../../../utils/hederaMirrorHelpers');
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
	if (process.argv.length !== 4) {
		console.log('Usage: node revokeSBT.js <userAccount> <serialNumber>');
		console.log('Example: node revokeSBT.js 0.0.12345 42');
		console.log('Example: node revokeSBT.js 0x000000000000000000000000000000000000beef 42');
		console.log('Note: This only works if the contract was deployed as revocable');
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

	const userAccountInput = process.argv[2];
	const serialNumber = parseInt(process.argv[3]);

	// Convert account to EVM address
	let userEvmAddress;
	if (userAccountInput.startsWith('0.0.')) {
		const accountId = AccountId.fromString(userAccountInput);
		try {
			userEvmAddress = await homebrewPopulateAccountEvmAddress(env, accountId);
		}
		catch {
			userEvmAddress = accountId.toSolidityAddress();
		}
	}
	else if (userAccountInput.startsWith('0x')) {
		userEvmAddress = userAccountInput;
	}
	else {
		console.log('Invalid account format. Use either 0.0.xxxxx or 0x...');
		return;
	}

	console.log('\n===========================================');
	console.log('REVOKE SOULBOUND TOKEN');
	console.log('===========================================');
	console.log('User Account:', userAccountInput);
	console.log('EVM Address:', userEvmAddress);
	console.log('Serial Number:', serialNumber);

	console.log('\n⚠️  WARNING: This action will:');
	console.log('   - Permanently remove the NFT from the user\'s account');
	console.log('   - Remove the user from the whitelist for this badge type');
	console.log('   - Cannot be undone');
	console.log('   - Only works if contract was deployed as revocable');

	const proceed = readlineSync.question('\nAre you sure you want to revoke this SBT? (y/N): ');
	if (proceed.toLowerCase() !== 'y') {
		console.log('Cancelled.');
		return;
	}

	const finalConfirm = readlineSync.question('Type "REVOKE" to confirm: ');
	if (finalConfirm !== 'REVOKE') {
		console.log('Cancelled - confirmation text did not match.');
		return;
	}

	try {
		console.log('\n🔥 Revoking SBT...');

		// Estimate gas for the operation
		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'revokeSBT',
			[userEvmAddress, serialNumber],
			800_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'revokeSBT',
			[
				userEvmAddress,
				serialNumber,
			],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SBT revoked successfully!');
			logTransactionResult(result, 'SBT Revocation', gasInfo);
			console.log('\nThe NFT has been removed from the user\'s account and they have been removed from the whitelist.');
		}
		else {
			console.log('❌ Failed to revoke SBT:', result[0]?.status?.toString());
			if (result[2]?.transactionId) {
				console.log('📝 Failed Transaction ID:', result[2].transactionId.toString());
			}
			if (result[0]?.status?.name === 'NotAdmin') {
				console.log('Error: You are not an admin of this contract.');
			}
			else if (result[0]?.status?.name === 'NotRevocable') {
				console.log('Error: This contract was not deployed as revocable.');
			}
			else if (result[0]?.status?.name === 'NFTNotOwned') {
				console.log('Error: The user does not own this NFT serial.');
			}
			else if (result[0]?.status?.name === 'TypeNotFound') {
				console.log('Error: Badge type not found for this serial.');
			}
		}
	}
	catch (error) {
		console.log('❌ Error revoking SBT:', error.message);
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