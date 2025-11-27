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

	if (!env) {
		console.log('❌ Error: Missing ENVIRONMENT in .env file');
		return;
	}

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
		const lazyTokenId = TokenId.fromSolidityAddress(lazyDetails[0]);

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

			discountTiers.push({
				index: i,
				// First element is discountPercentage
				discountPercentage: Number(tier[0]),
				// Second element is maxUsesPerSerial
				maxUsesPerSerial: Number(tier[1]),
			});
		}

		// Display all configuration
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📦 NFT Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`NFT Token ID: ${nftTokenId.toString()}`);
		console.log(`NFT Token Address: ${nftTokenAddress}`);
		console.log(`Remaining in Pool: ${Number(supply)} NFTs`);
		console.log('(Note: getRemainingSupply returns available serials count only)');

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 Pricing Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const hbarPrice = new Hbar(Number(economics[0]) / 100000000);
		const lazyPrice = Number(economics[1]) / Math.pow(10, lazyDecimals);
		const wlSlotCost = Number(economics[6]) / Math.pow(10, lazyDecimals);

		console.log(`Base Price (HBAR): ${hbarPrice.toString()}`);
		console.log(`Base Price (${lazyTokenInfo.symbol}): ${lazyPrice.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);
		console.log(`WL Discount: ${Number(economics[2])}%`);
		console.log(`Sacrifice Discount: ${Number(economics[3])}%`);
		console.log(`Max Per Mint: ${Number(economics[4])} NFTs`);
		console.log(`Max Per Wallet: ${Number(economics[5])} NFTs (0 = unlimited)`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('⏰ Timing Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const now = Math.floor(Date.now() / 1000);
		const isPaused = timing[2];
		const startTime = Number(timing[1]);

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

		console.log(`Refund Window: ${Number(timing[3]) / 3600} hours`);
		console.log(`Refund Percentage: ${Number(timing[4])}%`);
		console.log(`WL Only Mode: ${timing[5] ? '🔴 YES' : '🟢 NO'}`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎟️  Whitelist Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`WL Slot Cost (${lazyTokenInfo.symbol}): ${wlSlotCost.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💎 LAZY Token Configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`LAZY Token ID: ${lazyTokenId.toString()}`);
		console.log(`LAZY Token Address: ${lazyDetails[0]}`);
		console.log(`LazyGasStation ID: ${gasStationId.toString()}`);
		console.log(`LazyGasStation Address: ${gasStationAddress}`);
		console.log(`LAZY Burn Percentage: ${Number(lazyDetails[1])}%`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎁 Discount Tiers');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (discountTiers.length === 0) {
			console.log('No discount tiers configured');
		}
		else {
			console.log('Note: Each discount token is assigned to a tier.');
			console.log('Use getTokenTierIndex(tokenAddress) to see which tier a token uses.\n');

			discountTiers.forEach(tier => {
				console.log(`Tier ${tier.index}:`);
				console.log(`   Discount Percentage: ${tier.discountPercentage}%`);
				console.log(`   Max Uses Per Serial: ${tier.maxUsesPerSerial}`);
				console.log('');
			});
		}

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('✅ Configuration loaded successfully');

	}
	catch (error) {
		console.log('❌ Error loading configuration:', error.message, error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
