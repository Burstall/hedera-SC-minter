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

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'ForeverMinter';
const contractId = ContractId.fromString(process.env.FOREVER_MINTER_CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	if (!operatorId || !operatorKey || !contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing configuration in .env file');
		return;
	}

	// Optional: Check specific address
	let targetAddress = operatorId.toSolidityAddress();

	if (process.argv.length >= 3) {
		try {
			const targetId = AccountId.fromString(process.argv[2]);
			targetAddress = targetId.toSolidityAddress();
		}
		catch {
			console.log('❌ Error: Invalid account ID');
			console.log('   Usage: node getMintHistory.js [accountId]');
			return;
		}
	}

	console.log('\n📊 ForeverMinter - Mint History');
	console.log('==================================\n');

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
		console.log('❌ Error: Invalid ENVIRONMENT in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Load ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));
	const minterIface = new ethers.Interface(json.abi);

	try {
		const targetAccountId = AccountId.fromSolidityAddress(targetAddress);

		console.log(`Account: ${targetAccountId.toString()}`);
		console.log('');

		// Get mint count
		const mintCountCommand = minterIface.encodeFunctionData('getUserMintCount', [targetAddress]);
		const mintCountResult = await readOnlyEVMFromMirrorNode(env, contractId, mintCountCommand, operatorId, false);
		const mintCount = Number(minterIface.decodeFunctionResult('getUserMintCount', mintCountResult)[0]);

		if (mintCount === 0) {
			console.log('❌ No mint history found for this account');
			return;
		}

		// Get average payment
		const avgPaymentCommand = minterIface.encodeFunctionData('getAveragePayment', [targetAddress]);
		const avgPaymentResult = await readOnlyEVMFromMirrorNode(env, contractId, avgPaymentCommand, operatorId, false);
		const avgPayment = minterIface.decodeFunctionResult('getAveragePayment', avgPaymentResult)[0];

		const avgHbar = Number(avgPayment.averageHbar);
		const avgLazy = Number(avgPayment.averageLazy);

		// Get max per wallet for context
		const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
		const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult)[0];
		const maxPerWallet = Number(economics.maxPerWallet);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📈 Mint Statistics');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Total Mints: ${mintCount} NFTs`);

		if (maxPerWallet > 0) {
			const remaining = Math.max(0, maxPerWallet - mintCount);
			console.log(`Wallet Limit: ${maxPerWallet} NFTs`);
			console.log(`Remaining: ${remaining} NFTs`);

			const usedPercent = ((mintCount / maxPerWallet) * 100).toFixed(2);
			console.log(`Usage: ${usedPercent}%`);
		}
		else {
			console.log('Wallet Limit: Unlimited');
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 Average Payment per Mint');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Average HBAR: ${avgHbar} tℏ`);
		console.log(`Average LAZY: ${avgLazy} tokens`);

		console.log('\nTotal Spent:');
		console.log(`   HBAR: ${avgHbar * mintCount} tℏ`);
		console.log(`   LAZY: ${avgLazy * mintCount} tokens`);

		// Get base prices for comparison
		const baseHbar = Number(economics.hbarPrice);
		const baseLazy = Number(economics.lazyPrice);

		if (avgHbar < baseHbar || avgLazy < baseLazy) {
			const hbarSavings = (baseHbar - avgHbar) * mintCount;
			const lazySavings = (baseLazy - avgLazy) * mintCount;
			const hbarDiscountPercent = ((1 - (avgHbar / baseHbar)) * 100).toFixed(2);
			const lazyDiscountPercent = ((1 - (avgLazy / baseLazy)) * 100).toFixed(2);

			console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('💎 Discount Performance');
			console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

			console.log(`Base Price: ${baseHbar} tℏ + ${baseLazy} LAZY`);
			console.log(`Your Average: ${avgHbar} tℏ + ${avgLazy} LAZY`);

			console.log('\nAverage Discount:');
			console.log(`   HBAR: ${hbarDiscountPercent}%`);
			console.log(`   LAZY: ${lazyDiscountPercent}%`);

			console.log('\nTotal Savings:');
			console.log(`   HBAR: ${hbarSavings} tℏ`);
			console.log(`   LAZY: ${lazySavings} tokens`);
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('💡 Note: Average payment reflects actual costs paid after discounts');

	}
	catch (error) {
		console.log('❌ Error loading mint history:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
