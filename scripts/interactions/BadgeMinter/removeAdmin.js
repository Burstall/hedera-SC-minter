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
	// check for 1 argument (account ID to remove as admin)
	if (process.argv.length !== 3) {
		console.log('Usage: node removeAdmin.js <accountID>');
		console.log('Example: node removeAdmin.js 0.0.12345');
		console.log('Example: node removeAdmin.js 0x000000000000000000000000000000000000beef');
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

	const accountToRemove = process.argv[2];
	let adminAddress;

	// Convert account ID to EVM address if needed
	if (accountToRemove.startsWith('0.0.')) {
		const accountId = AccountId.fromString(accountToRemove);
		try {
			adminAddress = await homebrewPopulateAccountEvmAddress(env, accountId);
		}
		catch {
			adminAddress = accountId.toSolidityAddress();
		}
	}
	else if (accountToRemove.startsWith('0x')) {
		adminAddress = accountToRemove;
	}
	else {
		console.log('Invalid account format. Use either 0.0.xxxxx or 0x...');
		return;
	}

	console.log('\n===========================================');
	console.log('REMOVING ADMIN');
	console.log('===========================================');
	console.log('Account to remove:', accountToRemove);
	console.log('EVM Address:', adminAddress);

	console.log('\n⚠️  WARNING: This will remove admin privileges from this account.');
	console.log('⚠️  Make sure this is not the last admin, or you will lose access to the contract!');

	const proceed = readlineSync.question('\nProceed to remove this admin? (y/N): ');
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
			'removeAdmin',
			[adminAddress],
			400_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'removeAdmin',
			[adminAddress],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ Admin removed successfully!');
			logTransactionResult(result, 'Remove Admin', gasInfo);
		}
		else {
			console.log('❌ Failed to remove admin:', result[0]?.status?.toString());
			if (result[2]?.transactionId) {
				console.log('📝 Failed Transaction ID:', result[2].transactionId.toString());
			}
			if (result[0]?.status?.name === 'NotAdmin') {
				console.log('Error: You are not an admin of this contract.');
			}
			else if (result[0]?.status?.name === 'CannotRemoveLastAdmin') {
				console.log('Error: Cannot remove the last admin. Add another admin first.');
			}
			else if (result[0]?.status?.name === 'AdminDoesNotExist') {
				console.log('Error: This address is not currently an admin.');
			}
		}
	}
	catch (error) {
		console.log('❌ Error removing admin:', error.message);
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