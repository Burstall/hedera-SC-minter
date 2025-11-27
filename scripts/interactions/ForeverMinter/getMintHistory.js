const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { getTokenDetails } = require('../../../utils/hederaMirrorHelpers');

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

		// Get mint count using correct function
		const mintCountCommand = minterIface.encodeFunctionData('getWalletMintCount', [targetAddress]);
		const mintCountResult = await readOnlyEVMFromMirrorNode(env, contractId, mintCountCommand, operatorId, false);
		const mintCount = Number(minterIface.decodeFunctionResult('getWalletMintCount', mintCountResult)[0]);

		if (mintCount === 0) {
			console.log('❌ No mint history found for this account');
			return;
		}

		// Get max per wallet and LAZY token info for context
		const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
		const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult)[0];
		const maxPerWallet = Number(economics[5]); // maxMintPerWallet

		// Get LAZY token details
		const lazyDetailsCommand = minterIface.encodeFunctionData('getLazyDetails');
		const lazyDetailsResult = await readOnlyEVMFromMirrorNode(env, contractId, lazyDetailsCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', lazyDetailsResult)[0];
		const lazyTokenId = TokenId.fromSolidityAddress(lazyDetails[0]);
		const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
		const lazyDecimals = parseInt(lazyTokenInfo.decimals);

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

		// Get base prices for reference
		const baseHbar = new Hbar(Number(economics[0]) / 100000000); // mintPriceHbar
		const baseLazy = Number(economics[1]) / Math.pow(10, lazyDecimals); // mintPriceLazy

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 Base Mint Prices');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Base HBAR Price: ${baseHbar.toString()} per NFT`);
		console.log(`Base ${lazyTokenInfo.symbol} Price: ${baseLazy.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol} per NFT`);

		console.log('\n💡 Note: Actual costs may be lower with discounts (sacrifice, holder, whitelist)');


		console.log('\n💡 Use checkDiscounts.js to see your available discounts');
		console.log('💡 Use checkMintCost.js to preview costs with your holdings');

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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
