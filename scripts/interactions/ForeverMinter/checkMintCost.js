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
const { homebrewPopulateAccountEvmAddress } = require('../../../utils/hederaMirrorHelpers');

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'ForeverMinter';
const contractId = ContractId.fromString(process.env.CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	if (!operatorId || !operatorKey || !contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing configuration in .env file');
		return;
	}

	// Parse arguments
	const quantity = parseInt(process.argv[2]);
	if (isNaN(quantity) || quantity <= 0) {
		console.log('Usage: node checkMintCost.js <quantity> [--discount-tokens=0x...,0x...] [--discount-serials=1,2,3|4,5,6] [--sacrifice=N]');
		console.log('\nExample: node checkMintCost.js 10 --discount-tokens=0xabc,0xdef --discount-serials=1,2,3|4,5 --sacrifice=2');
		return;
	}

	console.log('\n💰 ForeverMinter - Mint Cost Calculator');
	console.log('==========================================\n');

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
		// Parse optional parameters
		let discountTokens = [];
		let serialsByToken = [];
		let sacrificeCount = 0;

		for (let i = 3; i < process.argv.length; i++) {
			const arg = process.argv[i];

			if (arg.startsWith('--discount-tokens=')) {
				const tokens = arg.split('=')[1].split(',');
				discountTokens = tokens;
			}
			else if (arg.startsWith('--discount-serials=')) {
				const serialGroups = arg.split('=')[1].split('|');
				serialsByToken = serialGroups.map(group =>
					group.split(',').map(s => parseInt(s.trim())),
				);
			}
			else if (arg.startsWith('--sacrifice=')) {
				sacrificeCount = parseInt(arg.split('=')[1]);
			}
		}

		// Validate arrays match
		if (discountTokens.length !== serialsByToken.length && discountTokens.length > 0) {
			console.log('❌ Error: Number of discount tokens must match number of serial groups');
			console.log(`   Tokens: ${discountTokens.length}, Serial groups: ${serialsByToken.length}`);
			return;
		}

		console.log('📊 Calculation Parameters:');
		console.log(`   Quantity: ${quantity}`);
		console.log(`   Discount Tokens: ${discountTokens.length || 'None'}`);
		console.log(`   Sacrifice Count: ${sacrificeCount || 'None'}`);

		// Get economics for reference
		const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
		const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult)[0];

		// Get WL slots
		const wlSlotsCommand = minterIface.encodeFunctionData('whitelistSlots', [
			(await homebrewPopulateAccountEvmAddress(env, operatorId)).startsWith('0x')
				? await homebrewPopulateAccountEvmAddress(env, operatorId)
				: operatorId.toSolidityAddress(),
		]);
		const wlSlotsResult = await readOnlyEVMFromMirrorNode(env, contractId, wlSlotsCommand, operatorId, false);
		const wlSlots = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], wlSlotsResult)[0];

		console.log(`   Your WL Slots: ${Number(wlSlots)}`);
		console.log('');

		// Calculate cost
		console.log('🧮 Calculating costs...\n');

		const costCommand = minterIface.encodeFunctionData('calculateMintCost', [
			quantity,
			discountTokens,
			serialsByToken,
			sacrificeCount,
		]);

		const costResult = await readOnlyEVMFromMirrorNode(env, contractId, costCommand, operatorId, false);
		const [totalHbarCost, totalLazyCost, totalDiscount, holderSlotsUsed, wlSlotsUsed] =
			minterIface.decodeFunctionResult('calculateMintCost', costResult);

		// Calculate base cost (no discounts)
		const baseHbarCost = Number(economics.mintPriceHbar) * quantity;
		const baseLazyCost = Number(economics.mintPriceLazy) * quantity;

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 COST BREAKDOWN');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('Base Cost (no discounts):');
		console.log(`   ${baseHbarCost} tℏ + ${baseLazyCost} LAZY`);

		console.log('\nWith Discounts Applied:');
		console.log(`   ${Number(totalHbarCost)} tℏ + ${Number(totalLazyCost)} LAZY`);

		console.log('\n📊 Discount Summary:');
		console.log(`   Average Discount: ${Number(totalDiscount)}%`);
		console.log(`   You Save: ${baseHbarCost - Number(totalHbarCost)} tℏ + ${baseLazyCost - Number(totalLazyCost)} LAZY`);

		console.log('\n🎫 Slot Usage:');
		console.log(`   Holder Slots Consumed: ${Number(holderSlotsUsed)}`);
		console.log(`   WL Slots Consumed: ${Number(wlSlotsUsed)} (of ${Number(wlSlots)} available)`);

		if (Number(wlSlotsUsed) > Number(wlSlots)) {
			console.log('   ⚠️  Warning: Insufficient WL slots! Some NFTs will have reduced discount.');
		}

		// Show waterfall breakdown
		console.log('\n🌊 Waterfall Discount Order:');
		console.log('   1. Sacrifice Discount (if any)');
		console.log('   2. Holder Discounts (sorted by tier, can stack with WL)');
		console.log('   3. WL-only Discount');
		console.log('   4. Full Price (no discounts)');

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

		console.log('\n💡 To mint with these parameters, run:');
		console.log(`   node mint.js ${quantity}`);
		console.log('   (and follow the interactive prompts)');

	}
	catch (error) {
		console.log('❌ Error calculating cost:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
