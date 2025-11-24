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
const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { getSerialsOwned } = require('../../../utils/hederaMirrorHelpers');

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

	console.log('\n🎁 ForeverMinter - Discount Eligibility');
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
		console.log('🔍 Checking your discount eligibility...\n');

		// Get discount tier count
		const tierCountCommand = minterIface.encodeFunctionData('getDiscountTierCount');
		const tierCountResult = await readOnlyEVMFromMirrorNode(env, contractId, tierCountCommand, operatorId, false);
		const tierCount = Number(minterIface.decodeFunctionResult('getDiscountTierCount', tierCountResult)[0]);

		if (tierCount === 0) {
			console.log('❌ No discount tiers configured in contract');
			return;
		}

		// Get whitelist slots
		const wlSlotsCommand = minterIface.encodeFunctionData('whitelistSlots', [operatorId.toSolidityAddress()]);
		const wlSlotsResult = await readOnlyEVMFromMirrorNode(env, contractId, wlSlotsCommand, operatorId, false);
		const wlSlots = Number(minterIface.decodeFunctionResult('whitelistSlots', wlSlotsResult)[0]);

		// Get NFT token for sacrifice eligibility
		const nftTokenCommand = minterIface.encodeFunctionData('NFT_TOKEN');
		const nftTokenResult = await readOnlyEVMFromMirrorNode(env, contractId, nftTokenCommand, operatorId, false);
		const nftTokenAddress = minterIface.decodeFunctionResult('NFT_TOKEN', nftTokenResult)[0];
		const nftTokenId = TokenId.fromSolidityAddress(nftTokenAddress);

		const ownedNFTs = await getSerialsOwned(env, operatorId, nftTokenId);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎟️  Whitelist Status');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (wlSlots > 0) {
			console.log(`✅ You have ${wlSlots} whitelist slot(s)`);
			console.log('   Each slot allows 1 mint at full price before holder discounts');
		}
		else {
			console.log('❌ You have 0 whitelist slots');
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🔥 Sacrifice Eligibility');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (ownedNFTs.length > 0) {
			console.log(`✅ You own ${ownedNFTs.length} NFT(s) that can be sacrificed`);
			console.log(`   NFT Token: ${nftTokenId.toString()}`);
			console.log(`   Your Serials: ${ownedNFTs.join(', ')}`);

			// Get sacrifice discount
			const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
			const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
			const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult)[0];
			console.log(`   Sacrifice Discount: ${Number(economics.sacrificeDiscount)}% (applied first!)`);
		}
		else {
			console.log('❌ You do not own any NFTs to sacrifice');
			console.log(`   NFT Token: ${nftTokenId.toString()}`);
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎁 Holder Discount Tiers');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		let hasAnyDiscount = false;

		// Check each discount tier
		for (let i = 0; i < tierCount; i++) {
			const tierCommand = minterIface.encodeFunctionData('getDiscountTier', [i]);
			const tierResult = await readOnlyEVMFromMirrorNode(env, contractId, tierCommand, operatorId, false);
			const tier = minterIface.decodeFunctionResult('getDiscountTier', tierResult)[0];

			const tierTokenId = TokenId.fromSolidityAddress(tier.tokenAddress);

			console.log(`Tier ${i}: ${tier.tierName}`);
			console.log(`   Token: ${tierTokenId.toString()}`);
			console.log(`   Discount: ${Number(tier.discountPerSerial)}% per serial`);
			console.log(`   Max Serials: ${Number(tier.maxSerialsPerMint)} per mint`);
			console.log(`   Max Discount: ${Number(tier.maxDiscount)}%`);

			// Check user's holdings
			try {
				const holdings = await getSerialsOwned(env, operatorId, tierTokenId);

				if (holdings.length > 0) {
					hasAnyDiscount = true;
					const usableSerials = Math.min(holdings.length, Number(tier.maxSerialsPerMint));
					const potentialDiscount = Math.min(
						usableSerials * Number(tier.discountPerSerial),
						Number(tier.maxDiscount),
					);

					console.log(`   ✅ You own ${holdings.length} serial(s)`);
					console.log(`   📊 Can use ${usableSerials} serial(s) per mint`);
					console.log(`   💰 Potential discount: ${potentialDiscount}%`);

					if (holdings.length <= 10) {
						console.log(`   🔢 Your serials: ${holdings.join(', ')}`);
					}
					else {
						console.log(`   🔢 Your serials: ${holdings.slice(0, 10).join(', ')}... (+${holdings.length - 10} more)`);
					}
				}
				else {
					console.log('   ❌ You do not own any serials from this tier');
				}
			}
			catch {
				console.log('   ⚠️  Could not check holdings (token may not exist)');
			}

			console.log('');
		}

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💡 Summary');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('Your Discount Eligibility:');
		console.log(`   Sacrifice: ${ownedNFTs.length > 0 ? '✅ YES' : '❌ NO'}`);
		console.log(`   Holder Discounts: ${hasAnyDiscount ? '✅ YES' : '❌ NO'}`);
		console.log(`   Whitelist: ${wlSlots > 0 ? `✅ YES (${wlSlots} slot(s))` : '❌ NO'}`);

		console.log('\n📋 Discount Order (Waterfall):');
		console.log('   1. Sacrifice (applied first if NFT provided)');
		console.log('   2. Holder Discounts (Tier 0 → Tier N)');
		console.log('   3. Whitelist (if slots remain)');
		console.log('   4. Full Price (remaining quantity)');

		console.log('\n💡 Tips:');
		console.log('   • Use mint.js to see live cost calculation with your holdings');
		console.log('   • Use checkMintCost.js to preview costs without minting');
		console.log('   • Holder discount serials are consumed in order provided');
		console.log('   • Sacrifice discount applies to ALL mints in transaction');

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.log('❌ Error checking discounts:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
