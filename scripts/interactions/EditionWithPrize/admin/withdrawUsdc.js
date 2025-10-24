const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { ethers } = require('ethers');
const {
	contractExecuteFunction,
} = require('../../../../utils/solidityHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
require('dotenv').config();

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractId = ContractId.fromString(process.env.EDITION_WITH_PRIZE_CONTRACT_ID);
const contractName = 'EditionWithPrize';
const env = process.env.ENVIRONMENT ?? null;

let client;
let abi;

const main = async () => {
	console.log('\n╔══════════════════════════════════════════╗');
	console.log('║       Withdraw USDC (Owner)             ║');
	console.log('╚══════════════════════════════════════════╝\n');

	if (
		operatorKey === undefined ||
		operatorKey == null ||
		operatorId === undefined ||
		operatorId == null
	) {
		console.log('❌ ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in .env file');
		return;
	}

	console.log('Using account:', operatorId.toString());
	console.log('Contract ID:', contractId.toString());
	console.log('Environment:', env);

	// Setup client
	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
	}
	else {
		console.log('❌ ERROR: Must specify either MAIN, TEST, PREVIEW, or LOCAL as environment');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Load contract ABI
	const json = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	abi = new ethers.Interface(json.abi);

	try {
		console.log('\n💵 Withdraw USDC Options:');
		console.log('   Contract supports both native and bridged USDC');
		console.log('   1. Native USDC (native HTS token)');
		console.log('   2. Bridged USDC (wormhole, hashport, etc.)');
		console.log('   3. Both');

		const choice = readlineSync.question('\nChoice [1-3]: ');

		const withdrawNative = (choice === '1' || choice === '3');
		const withdrawBridged = (choice === '2' || choice === '3');

		if (!withdrawNative && !withdrawBridged) {
			console.log('❌ Invalid choice');
			return;
		}

		console.log('\n⚠️  Owner must be associated with USDC token(s)');

		const proceed = readlineSync.keyInYNStrict('\nProceed with withdrawal?');
		if (!proceed) {
			console.log('❌ Operation cancelled');
			return;
		}

		// Withdraw native USDC
		if (withdrawNative) {
			console.log('\n💵 Withdrawing native USDC...');

			const gasEstimate = await estimateGas(
				env,
				contractId,
				abi,
				operatorId,
				'withdrawUsdcNative',
				[],
				150_000,
			);

			console.log(`  Estimated gas: ${gasEstimate.gasLimit.toLocaleString()}`);

			const result = await contractExecuteFunction(
				contractId,
				abi,
				client,
				gasEstimate.gasLimit,
				'withdrawUsdcNative',
				[],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('❌ ERROR: Native USDC withdrawal failed');
				console.log('Status:', result[0]?.status?.toString());
			}
			else {
				console.log('✅ Native USDC withdrawn successfully!');
				console.log('Transaction ID:', result[2]?.transactionId?.toString());
			}
		}

		// Withdraw bridged USDC
		if (withdrawBridged) {
			console.log('\n💵 Withdrawing bridged USDC...');

			const gasEstimate = await estimateGas(
				env,
				contractId,
				abi,
				operatorId,
				'withdrawUsdcBridged',
				[],
				150_000,
			);

			console.log(`  Estimated gas: ${gasEstimate.gasLimit.toLocaleString()}`);

			const result = await contractExecuteFunction(
				contractId,
				abi,
				client,
				gasEstimate.gasLimit,
				'withdrawUsdcBridged',
				[],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('❌ ERROR: Bridged USDC withdrawal failed');
				console.log('Status:', result[0]?.status?.toString());
			}
			else {
				console.log('✅ Bridged USDC withdrawn successfully!');
				console.log('Transaction ID:', result[2]?.transactionId?.toString());
			}
		}

		console.log('\n✓ USDC withdrawal(s) complete');
		console.log('✓ All USDC sent to owner account');

	}
	catch (error) {
		console.error('\n❌ Error withdrawing USDC:', error.message || error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
