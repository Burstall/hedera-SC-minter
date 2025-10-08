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
	if (process.argv.length < 5) {
		console.log('Usage: node addToBadgeWhitelist.js <badgeId> <accountsList> <quantitiesList>');
		console.log('Example: node addToBadgeWhitelist.js 1 "0.0.12345,0.0.12346" "2,1"');
		console.log('Example: node addToBadgeWhitelist.js 2 "0.0.12345,0x123abc" "0,0"');
		console.log('Note: quantity of 0 means unlimited mints for that address');
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
	const accountsInput = process.argv[3];
	const quantitiesInput = process.argv[4];

	// Parse comma-separated lists
	const accountStrings = accountsInput.split(',').map(s => s.trim());
	const quantities = quantitiesInput.split(',').map(s => parseInt(s.trim()));

	if (accountStrings.length !== quantities.length) {
		console.log('Error: Number of accounts must match number of quantities');
		return;
	}

	// Convert accounts to EVM addresses
	const evmAddresses = [];
	for (const accountString of accountStrings) {
		try {
			let evmAddress;
			if (accountString.startsWith('0.0.')) {
				// Hedera account ID format - use homebrewPopulateAccountEvmAddress for proper EVM routing
				const accountId = AccountId.fromString(accountString);
				try {
					evmAddress = await homebrewPopulateAccountEvmAddress(env, accountId);
				}
				catch {
					evmAddress = accountId.toSolidityAddress();
				}
			}
			else if (accountString.startsWith('0x')) {
				// Already EVM address
				evmAddress = accountString;
			}
			else {
				// Try to lookup account by alias using mirror node
				console.log(`Looking up account: ${accountString}`);
				const lookupResult = await homebrewPopulateAccountEvmAddress(env, accountString);
				if (lookupResult) {
					evmAddress = lookupResult;
				}
				else {
					throw new Error(`Could not resolve account: ${accountString}`);
				}
			}
			evmAddresses.push(evmAddress);
		}
		catch (error) {
			console.log(`Error processing account ${accountString}:`, error.message);
			return;
		}
	}

	console.log('\n===========================================');
	console.log('ADD TO BADGE WHITELIST');
	console.log('===========================================');
	console.log('Badge ID:', badgeId);
	console.log('Accounts to whitelist:');

	for (let i = 0; i < accountStrings.length; i++) {
		console.log(`  ${i + 1}. ${accountStrings[i]} (${evmAddresses[i]})`);
		console.log(`     Quantity: ${quantities[i] === 0 ? 'Unlimited' : quantities[i]}`);
	}

	const proceed = readlineSync.question('\nProceed to add these addresses to the whitelist? (y/N): ');
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
			'addToBadgeWhitelist',
			[badgeId, evmAddresses, quantities],
			600_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'addToBadgeWhitelist',
			[
				badgeId,
				evmAddresses,
				quantities,
			],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ Addresses added to whitelist successfully!');
			logTransactionResult(result, 'Whitelist Update', gasInfo);
		}
		else {
			console.log('❌ Failed to add to whitelist:', result[0]?.status?.toString());
			if (result[2]?.transactionId) {
				console.log('📝 Failed Transaction ID:', result[2].transactionId.toString());
			}
			if (result[0]?.status?.name === 'NotAdmin') {
				console.log('Error: You are not an admin of this contract.');
			}
			else if (result[0]?.status?.name === 'TypeNotFound') {
				console.log('Error: Badge ID not found.');
			}
		}
	}
	catch (error) {
		console.log('❌ Error adding to whitelist:', error.message);
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