const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	HbarUnit,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const {
	contractExecuteFunction,
	readOnlyEVMFromMirrorNode,
} = require('../../../utils/solidityHelpers');
const {
	associateTokenToAccount,
	setHbarAllowance,
	setFTAllowance,
} = require('../../../utils/hederaHelpers');
const {
	homebrewPopulateAccountEvmAddress,
	checkMirrorBalance,
	getSerialsOwned,
} = require('../../../utils/hederaMirrorHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

// Get operator from .env
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'ForeverMinter';
const contractId = ContractId.fromString(process.env.CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// Validate environment
	if (!operatorId || !operatorKey) {
		console.log('❌ Error: Missing ACCOUNT_ID or PRIVATE_KEY in .env file');
		return;
	}

	if (!contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing or invalid CONTRACT_ID in .env file');
		return;
	}

	console.log('\n🎯 ForeverMinter - Interactive Minting');
	console.log('========================================\n');

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
		console.log('❌ Error: Invalid ENVIRONMENT in .env file (must be TEST, MAIN, PREVIEW, or LOCAL)');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Load ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));
	const minterIface = new ethers.Interface(json.abi);

	try {
		// Step 1: Get NFT token address from contract
		console.log('📋 Checking token association...');
		const nftTokenCommand = minterIface.encodeFunctionData('NFT_TOKEN');
		const nftTokenResult = await readOnlyEVMFromMirrorNode(env, contractId, nftTokenCommand, operatorId, false);
		const nftTokenAddress = minterIface.decodeFunctionResult('NFT_TOKEN', nftTokenResult)[0];
		const nftTokenId = TokenId.fromSolidityAddress(nftTokenAddress);

		// Check association
		const balance = await checkMirrorBalance(env, operatorId, nftTokenId);
		if (balance === null) {
			console.log('⚠️  NFT Token not associated to your account');
			const associate = readlineSync.question(`Would you like to associate ${nftTokenId.toString()}? (y/N): `);
			if (associate.toLowerCase() === 'y') {
				await associateTokenToAccount(client, operatorId, operatorKey, nftTokenId);
				console.log('✅ Token associated successfully');
			}
			else {
				console.log('❌ Token association required to mint. Exiting.');
				return;
			}
		}
		else {
			console.log(`✅ NFT Token (${nftTokenId.toString()}) is associated`);
		}

		// Step 2: Load contract configuration
		console.log('\n📊 Loading contract configuration...');

		// Get economics
		const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
		const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult)[0];

		// Get timing
		const timingCommand = minterIface.encodeFunctionData('getMintTiming');
		const timingResult = await readOnlyEVMFromMirrorNode(env, contractId, timingCommand, operatorId, false);
		const timing = minterIface.decodeFunctionResult('getMintTiming', timingResult)[0];

		// Get remaining supply
		const supplyCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const supplyResult = await readOnlyEVMFromMirrorNode(env, contractId, supplyCommand, operatorId, false);
		const remainingSupply = minterIface.decodeFunctionResult('getRemainingSupply', supplyResult)[0];

		// Get LAZY details
		const lazyCommand = minterIface.encodeFunctionData('getLazyDetails');
		const lazyResult = await readOnlyEVMFromMirrorNode(env, contractId, lazyCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', lazyResult)[0];
		const lazyTokenId = TokenId.fromSolidityAddress(lazyDetails.lazyToken);

		// Get LazyGasStation address
		const lgsCommand = minterIface.encodeFunctionData('lazyGasStation');
		const lgsResult = await readOnlyEVMFromMirrorNode(env, contractId, lgsCommand, operatorId, false);
		const lazyGasStationAddress = minterIface.decodeFunctionResult('lazyGasStation', lgsResult)[0];
		const lazyGasStationId = ContractId.fromSolidityAddress(lazyGasStationAddress);

		// Check if paused or not started
		if (timing.mintPaused) {
			console.log('❌ Error: Minting is currently paused');
			return;
		}

		const now = Math.floor(Date.now() / 1000);
		if (now < Number(timing.mintStartTime)) {
			const startDate = new Date(Number(timing.mintStartTime) * 1000);
			console.log(`❌ Error: Minting has not started yet. Starts at ${startDate.toLocaleString()}`);
			return;
		}

		// Display config
		console.log('✅ Contract Info:');
		console.log(`   - NFT Token: ${nftTokenId.toString()}`);
		console.log(`   - Available Supply: ${Number(remainingSupply)} NFTs`);
		console.log(`   - Mint Price: ${Number(economics.mintPriceHbar)} tℏ + ${Number(economics.mintPriceLazy)} LAZY`);
		console.log(`   - WL Discount: ${Number(economics.wlDiscount)}%`);
		console.log(`   - Sacrifice Discount: ${Number(economics.sacrificeDiscount)}%`);
		console.log(`   - Max Mint Per Transaction: ${Number(economics.maxMint) || 'Unlimited'}`);
		console.log(`   - Max Mint Per Wallet: ${Number(economics.maxMintPerWallet) || 'Unlimited'}`);
		console.log(`   - Refund Window: ${Number(timing.refundWindow) / 3600} hours (${Number(timing.refundPercentage)}% refund)`);

		if (Number(remainingSupply) === 0) {
			console.log('\n❌ Error: No NFTs available in pool. Sold out!');
			return;
		}

		// Step 3: Check discount eligibility
		console.log('\n🔍 Checking available discounts...');

		const tierCountCommand = minterIface.encodeFunctionData('getDiscountTierCount');
		const tierCountResult = await readOnlyEVMFromMirrorNode(env, contractId, tierCountCommand, operatorId, false);
		const tierCount = minterIface.decodeFunctionResult('getDiscountTierCount', tierCountResult)[0];

		for (let i = 0; i < Number(tierCount); i++) {
			const tierCommand = minterIface.encodeFunctionData('getDiscountTier', [i]);
			const tierResult = await readOnlyEVMFromMirrorNode(env, contractId, tierCommand, operatorId, false);
			const tier = minterIface.decodeFunctionResult('getDiscountTier', tierResult)[0];

			// Skip removed tiers
			if (Number(tier.discountPercentage) === 0) continue;

			// Get token address for this tier (we need to reverse lookup - check all tokens)
			// For simplicity, we'll query known discount tokens from environment or skip this
			// In production, you'd maintain a registry or query events
			console.log(`   Tier ${i}: ${Number(tier.discountPercentage)}% discount, ${Number(tier.maxUsesPerSerial)} uses per serial`);
		}

		// Check WL slots
		const wlSlotsCommand = minterIface.encodeFunctionData('whitelistSlots', [
			(await homebrewPopulateAccountEvmAddress(env, operatorId)).startsWith('0x')
				? await homebrewPopulateAccountEvmAddress(env, operatorId)
				: operatorId.toSolidityAddress(),
		]);
		const wlSlotsResult = await readOnlyEVMFromMirrorNode(env, contractId, wlSlotsCommand, operatorId, false);
		const wlSlots = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], wlSlotsResult)[0];

		if (Number(wlSlots) > 0) {
			console.log(`\n💰 You have ${Number(wlSlots)} WL slots (${Number(economics.wlDiscount)}% discount, can stack with holder discounts)`);
		}

		// Check user's mint count
		const mintCountCommand = minterIface.encodeFunctionData('getWalletMintCount', [
			(await homebrewPopulateAccountEvmAddress(env, operatorId)).startsWith('0x')
				? await homebrewPopulateAccountEvmAddress(env, operatorId)
				: operatorId.toSolidityAddress(),
		]);
		const mintCountResult = await readOnlyEVMFromMirrorNode(env, contractId, mintCountCommand, operatorId, false);
		const currentMintCount = minterIface.decodeFunctionResult('getWalletMintCount', mintCountResult)[0];

		// Check user's NFTs for potential sacrifice
		console.log('\n📦 Checking NFTs you own for sacrifice option...');
		const ownedSerials = await getSerialsOwned(env, operatorId, nftTokenId);

		if (ownedSerials.length > 0) {
			console.log(`✅ Found ${ownedSerials.length} NFTs eligible for sacrifice (${Number(economics.sacrificeDiscount)}% discount, exclusive)`);
		}

		// Step 4: Get mint quantity
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		let quantity;
		if (process.argv[2] && !isNaN(parseInt(process.argv[2]))) {
			quantity = parseInt(process.argv[2]);
		}
		else {
			const maxAllowed = Math.min(
				Number(remainingSupply),
				Number(economics.maxMint) || Number(remainingSupply),
				Number(economics.maxMintPerWallet) > 0
					? Number(economics.maxMintPerWallet) - Number(currentMintCount)
					: Number(remainingSupply),
			);

			if (maxAllowed <= 0) {
				console.log('❌ Error: You have reached your maximum mint limit');
				return;
			}

			quantity = parseInt(readlineSync.question(`How many NFTs do you want to mint? (1-${maxAllowed}): `));

			if (isNaN(quantity) || quantity <= 0 || quantity > maxAllowed) {
				console.log('❌ Error: Invalid quantity');
				return;
			}
		}

		// Step 5: Discount selection
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💎 DISCOUNT SELECTION');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const discountTokens = [];
		const serialsByToken = [];

		const useDiscounts = readlineSync.question('Would you like to use holder discount serials? (y/N): ');

		if (useDiscounts.toLowerCase() === 'y') {
			console.log('\n⚠️  Note: Please manually specify discount token addresses and serials');
			console.log('Example format for discount tokens: 0x... (comma separated)');
			console.log('Example format for serials: [[1,2,3],[4,5,6]] (grouped by token)\n');

			const tokensInput = readlineSync.question('Enter discount token addresses (comma separated, or press enter to skip): ');
			if (tokensInput.trim()) {
				const tokens = tokensInput.split(',').map(t => t.trim());
				for (const token of tokens) {
					discountTokens.push(token);

					const serialsInput = readlineSync.question(`Enter serials for token ${token} (comma separated): `);
					const serials = serialsInput.split(',').map(s => parseInt(s.trim()));
					serialsByToken.push(serials);
				}
			}
		}

		// Step 6: Sacrifice selection
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🔥 SACRIFICE OPTION');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const sacrificeSerials = [];

		if (ownedSerials.length > 0) {
			const useSacrifice = readlineSync.question(`Would you like to sacrifice NFTs for ${Number(economics.sacrificeDiscount)}% discount? (y/N): `);

			if (useSacrifice.toLowerCase() === 'y') {
				console.log(`\nAvailable serials: ${ownedSerials.join(', ')}`);
				console.log(`Max sacrifice: ${Math.min(quantity, Number(economics.maxSacrifice))}\n`);

				const sacrificeInput = readlineSync.question('Enter serial numbers to sacrifice (comma separated): ');
				if (sacrificeInput.trim()) {
					const serials = sacrificeInput.split(',').map(s => parseInt(s.trim()));
					sacrificeSerials.push(...serials);

					if (sacrificeSerials.length > quantity) {
						console.log(`⚠️  Warning: Sacrifice count (${sacrificeSerials.length}) exceeds mint quantity (${quantity})`);
						console.log('Will be capped at mint quantity');
					}

					if (sacrificeSerials.length > Number(economics.maxSacrifice)) {
						console.log(`⚠️  Warning: Sacrifice count exceeds max sacrifice (${Number(economics.maxSacrifice)})`);
						return;
					}
				}
			}
		}

		// Step 7: Calculate cost
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 COST CALCULATION');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('Calculating final cost...\n');

		const costCommand = minterIface.encodeFunctionData('calculateMintCost', [
			quantity,
			discountTokens,
			serialsByToken,
			sacrificeSerials.length,
		]);

		const costResult = await readOnlyEVMFromMirrorNode(env, contractId, costCommand, operatorId, false);
		const [totalHbarCost, totalLazyCost, totalDiscount, holderSlotsUsed, wlSlotsUsed] =
			minterIface.decodeFunctionResult('calculateMintCost', costResult);

		console.log('Final Cost:');
		console.log(`   HBAR: ${Number(totalHbarCost)} tℏ`);
		console.log(`   LAZY: ${Number(totalLazyCost)} tokens`);
		console.log(`   Average Discount: ${Number(totalDiscount)}%`);
		console.log(`   Holder Slots Used: ${Number(holderSlotsUsed)}`);
		console.log(`   WL Slots Used: ${Number(wlSlotsUsed)}`);

		// Step 8: Check and set allowances
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🔐 ALLOWANCE SETUP');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('Setting up HBAR allowance...');
		// Safety margin for royalties
		const hbarAllowanceAmount = quantity * 10;
		await setHbarAllowance(client, operatorId, contractId, hbarAllowanceAmount);
		console.log(`✅ HBAR allowance set (${hbarAllowanceAmount} tℏ to contract)`);

		if (Number(totalLazyCost) > 0) {
			console.log('\nSetting up LAZY allowance...');
			await setFTAllowance(client, operatorId, operatorKey, lazyTokenId, lazyGasStationId, Number(totalLazyCost));
			console.log(`✅ LAZY allowance set (${Number(totalLazyCost)} LAZY to LazyGasStation)`);
		}

		// Step 9: Final confirmation
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 FINAL SUMMARY');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Minting ${quantity} NFTs`);
		console.log(`Total Cost: ${Number(totalHbarCost)} tℏ + ${Number(totalLazyCost)} LAZY`);
		console.log(`Average Discount: ${Number(totalDiscount)}%`);

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const proceed = readlineSync.question('Proceed with minting? (y/N): ');
		if (proceed.toLowerCase() !== 'y') {
			console.log('❌ Cancelled.');
			return;
		}

		// Step 10: Execute mint
		console.log('\n🎯 Minting NFTs...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'mintNFT',
			[quantity, discountTokens, serialsByToken, sacrificeSerials],
			800_000,
			Number(totalHbarCost),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'mintNFT',
			[quantity, discountTokens, serialsByToken, sacrificeSerials],
			new hbarAllowanceAmount(Number(totalHbarCost), HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Minted NFTs');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n💰 Payment:');
			console.log(`   HBAR Paid: ${Number(totalHbarCost)} tℏ`);
			console.log(`   LAZY Paid: ${Number(totalLazyCost)} tokens`);

			console.log('\n⏰ Refund Info:');
			const refundMinutes = Number(timing.refundWindow) / 60;
			console.log(`   Refund eligible for: ${refundMinutes} minutes`);
			console.log(`   Refund amount: ${Number(timing.refundPercentage)}%`);

			console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('🎉 Minting complete! Enjoy your NFTs!');
		}
		else {
			console.log('❌ Failed to mint:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'NFT Minting', gasInfo);

	}
	catch (error) {
		console.log('❌ Error during minting:', error.message);
		if (error.message.includes('INSUFFICIENT_TX_FEE')) {
			console.log('💡 Tip: Transaction fee was insufficient. Try increasing gas limit.');
		}
		else if (error.message.includes('CONTRACT_REVERT_EXECUTED')) {
			console.log('💡 Tip: Contract reverted. Check requirements (paused, supply, limits, etc.)');
		}
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
