const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

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
		console.log('\n===========================================');
		console.log('ADMIN LIST');
		console.log('===========================================');

		// Get all admins
		const encodedCommand = minterIface.encodeFunctionData('getAdmins');

		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const adminList = minterIface.decodeFunctionResult('getAdmins', result);
		const admins = adminList[0];

		if (admins.length === 0) {
			console.log('No admins found (this should not happen).');
		}
		else {
			console.log(`Found ${admins.length} admin(s):\n`);

			for (let i = 0; i < admins.length; i++) {
				const adminAddress = admins[i];

				// Try to convert EVM address back to Hedera account ID
				try {
					const accountId = AccountId.fromEvmAddress(0, 0, adminAddress);
					console.log(`${i + 1}. ${accountId.toString()} (${adminAddress})`);
				}
				catch {
					console.log(`${i + 1}. ${adminAddress} (EVM address only)`);
				}

				// Check if this is the current operator
				if (adminAddress.toLowerCase() === operatorId.toEvmAddress().toLowerCase()) {
					console.log('   ^ This is you (current operator)');
				}
			}
		}

		// Also check if the current operator is an admin
		console.log('\n===========================================');
		console.log('OPERATOR ADMIN STATUS');
		console.log('===========================================');

		const isAdminCommand = minterIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);

		const isAdminResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			isAdminCommand,
			operatorId,
			false,
		);

		const isAdmin = minterIface.decodeFunctionResult('isAdmin', isAdminResult);

		if (isAdmin[0]) {
			console.log('✅ Current operator IS an admin');
		}
		else {
			console.log('❌ Current operator is NOT an admin');
		}

	}
	catch (error) {
		console.log('❌ Error fetching admin list:', error.message);
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