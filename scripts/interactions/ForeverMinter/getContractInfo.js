const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	Hbar,
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

	console.log('\n📊 ForeverMinter - Contract Information');
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
		// Get all contract configuration
		console.log('🔍 Loading contract configuration...\n');

		// Get token addresses
		const nftTokenCommand = minterIface.encodeFunctionData('NFT_TOKEN');
		const nftTokenResult = await readOnlyEVMFromMirrorNode(env, contractId, nftTokenCommand, operatorId, false);
		const nftTokenAddress = minterIface.decodeFunctionResult('NFT_TOKEN', nftTokenResult)[0];
		const nftTokenId = TokenId.fromSolidityAddress(nftTokenAddress);

		// Get mint economics
		const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
		const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult)[0];

		// Get timing
		const timingCommand = minterIface.encodeFunctionData('getMintTiming');
		const timingResult = await readOnlyEVMFromMirrorNode(env, contractId, timingCommand, operatorId, false);
		const timing = minterIface.decodeFunctionResult('getMintTiming', timingResult)[0];

		// Get supply
		const supplyCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const supplyResult = await readOnlyEVMFromMirrorNode(env, contractId, supplyCommand, operatorId, false);
		const supply = minterIface.decodeFunctionResult('getRemainingSupply', supplyResult)[0];

		// Get LAZY details
		const lazyCommand = minterIface.encodeFunctionData('getLazyDetails');
		const lazyResult = await readOnlyEVMFromMirrorNode(env, contractId, lazyCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', lazyResult)[0];
		const lazyTokenId = TokenId.fromSolidityAddress(lazyDetails.lazyToken);

		// Get LAZY token info for decimal precision
		const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
		if (!lazyTokenInfo) {
			console.log('❌ Error: Could not fetch LAZY token details');
			return;
		}
		const lazyDecimals = parseInt(lazyTokenInfo.decimals);

		// Get LazyGasStation
		const gasStationCommand = minterIface.encodeFunctionData('lazyGasStation');
		const gasStationResult = await readOnlyEVMFromMirrorNode(env, contractId, gasStationCommand, operatorId, false);
		const gasStationAddress = minterIface.decodeFunctionResult('lazyGasStation', gasStationResult)[0];
		const gasStationId = ContractId.fromSolidityAddress(gasStationAddress);

		// Get discount tier count
		const tierCountCommand = minterIface.encodeFunctionData('getDiscountTierCount');
		const tierCountResult = await readOnlyEVMFromMirrorNode(env, contractId, tierCountCommand, operatorId, false);
		const tierCount = Number(minterIface.decodeFunctionResult('getDiscountTierCount', tierCountResult)[0]);

		// Get all discount tiers
		const discountTiers = [];
		for (let i = 0; i < tierCount; i++) {
			const tierCommand = minterIface.encodeFunctionData('getDiscountTier', [i]);
			const tierResult = await readOnlyEVMFromMirrorNode(env, contractId, tierCommand, operatorId, false);
			const tier = minterIface.decodeFunctionResult('getDiscountTier', tierResult)[0];

			const tierTokenId = TokenId.fromSolidityAddress(tier.tokenAddress);

			discountTiers.push({
				index: i,
				name: tier.tierName,
				tokenId: tierTokenId.toString(),
				discountPerSerial: Number(tier.discountPerSerial),
				maxSerialsPerMint: Number(tier.maxSerialsPerMint),
				maxDiscount: Number(tier.maxDiscount),
			});
		}

		// Display all configuration
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📦 NFT Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`NFT Token ID: ${nftTokenId.toString()}`);
		console.log(`NFT Token Address: ${nftTokenAddress}`);
		console.log(`Total Minted: ${Number(economics.totalMinted)} NFTs`);
		console.log(`Pool Size: ${Number(supply.poolSize)} NFTs`);
		console.log(`Pool Used: ${Number(supply.poolUsed)} NFTs`);
		console.log(`Remaining in Pool: ${Number(supply.poolSize) - Number(supply.poolUsed)} NFTs`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 Pricing Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const hbarPrice = Hbar.fromTinybars(Number(economics.hbarPrice));
		const lazyPrice = Number(economics.lazyPrice) / Math.pow(10, lazyDecimals);
		const wlSlotCost = Number(economics.wlSlotCost) / Math.pow(10, lazyDecimals);

		console.log(`Base Price (HBAR): ${hbarPrice.toString()}`);
		console.log(`Base Price (${lazyTokenInfo.symbol}): ${lazyPrice.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);
		console.log(`Sacrifice Discount: ${Number(economics.sacrificeDiscount)}%`);
		console.log(`Max Per Mint: ${Number(economics.maxPerMint)} NFTs`);
		console.log(`Max Per Wallet: ${Number(economics.maxPerWallet)} NFTs (0 = unlimited)`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('⏰ Timing Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const now = Math.floor(Date.now() / 1000);
		const isPaused = timing.pausedState;
		const startTime = Number(timing.startTime);

		console.log(`Paused: ${isPaused ? '🔴 YES' : '🟢 NO'}`);

		if (startTime > 0) {
			if (startTime > now) {
				const timeUntilStart = startTime - now;
				const hours = Math.floor(timeUntilStart / 3600);
				const minutes = Math.floor((timeUntilStart % 3600) / 60);
				console.log(`Start Time: ${new Date(startTime * 1000).toLocaleString()} (in ${hours}h ${minutes}m)`);
			}
			else {
				console.log(`Start Time: ${new Date(startTime * 1000).toLocaleString()} (started)`);
			}
		}
		else {
			console.log('Start Time: Not set (immediate)');
		}

		console.log(`Refund Window: ${Number(timing.refundWindow) / 3600} hours`);
		console.log(`Refund Percentage: ${Number(timing.refundPercentage)}%`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎟️  Whitelist Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`WL Slot Cost (${lazyTokenInfo.symbol}): ${wlSlotCost.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💎 LAZY Token Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`LAZY Token ID: ${lazyTokenId.toString()}`);
		console.log(`LAZY Token Address: ${lazyDetails.lazyToken}`);
		console.log(`LazyGasStation ID: ${gasStationId.toString()}`);
		console.log(`LazyGasStation Address: ${gasStationAddress}`);
		console.log(`LAZY Burn Percentage: ${Number(lazyDetails.lazyBurnPercentage)}%`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎁 Discount Tiers');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (discountTiers.length === 0) {
			console.log('No discount tiers configured');
		}
		else {
			discountTiers.forEach(tier => {
				console.log(`Tier ${tier.index}: ${tier.name}`);
				console.log(`   Token: ${tier.tokenId}`);
				console.log(`   Discount per Serial: ${tier.discountPerSerial}%`);
				console.log(`   Max Serials per Mint: ${tier.maxSerialsPerMint}`);
				console.log(`   Max Discount: ${tier.maxDiscount}%`);
				console.log('');
			});
		}

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('✅ Configuration loaded successfully');

	}
	catch (error) {
		console.log('❌ Error loading configuration:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
