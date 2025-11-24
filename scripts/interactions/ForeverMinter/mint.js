const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	HbarUnit,
	Hbar,
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
	parseContractEvents,
	homebrewPopulateAccountEvmAddress,
	checkMirrorBalance,
	checkMirrorAllowance,
	checkHbarAllowances,
	getSerialsOwned,
	getTokenDetails,
} = require('../../../utils/hederaMirrorHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

// Get operator from .env
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'ForeverMinter';
const contractId = ContractId.fromString(process.env.FOREVER_MINTER_CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;

let client;

const main = async () => {
	// Validate environment
	if (!operatorId || !operatorKey) {
		console.log('❌ Error: Missing ACCOUNT_ID or PRIVATE_KEY in .env file');
		return;
	}

	if (!contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing or invalid FOREVER_MINTER_CONTRACT_ID in .env file');
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

		// Get LAZY token details for decimal precision
		const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
		if (!lazyTokenInfo) {
			console.log('❌ Error: Could not fetch LAZY token details');
			return;
		}
		const lazyDecimals = parseInt(lazyTokenInfo.decimals);

		// Get LazyGasStation address
		const lgsCommand = minterIface.encodeFunctionData('lazyGasStation');
		const lgsResult = await readOnlyEVMFromMirrorNode(env, contractId, lgsCommand, operatorId, false);
		const lazyGasStationAddress = minterIface.decodeFunctionResult('lazyGasStation', lgsResult)[0];
		const lazyGasStationId = ContractId.fromSolidityAddress(lazyGasStationAddress);

		// Format prices for display
		const hbarPrice = Hbar.fromTinybars(Number(economics.mintPriceHbar));
		const lazyPrice = Number(economics.mintPriceLazy) / Math.pow(10, lazyDecimals);

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
		console.log(`   - Mint Price: ${hbarPrice.toString()} + ${lazyPrice.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);
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

		// Build a map of discount tokens by scanning contract events
		const discountTokenMap = new Map();

		console.log('   Scanning contract history for discount tokens...');
		// Fetch all events to find DiscountTierUpdated
		const allEvents = await parseContractEvents(env, contractId, minterIface, 100, true, 'desc');
		const discountEvents = allEvents.filter(e => e.name === 'DiscountTierUpdated');

		const processedTokens = new Set();

		for (const event of discountEvents) {
			const tokenAddress = event.args.token;

			// We iterate in descending order (newest first), so we only care about the first time we see a token
			if (processedTokens.has(tokenAddress)) continue;
			processedTokens.add(tokenAddress);

			const discountPercentage = Number(event.args.discountPercentage);

			// Only add if it's an active discount (percentage > 0)
			if (discountPercentage > 0) {
				try {
					const tokenId = TokenId.fromSolidityAddress(tokenAddress);
					const tokenIdStr = tokenId.toString();

					discountTokenMap.set(tokenIdStr, {
						tokenId,
						tokenAddress,
						tierIndex: Number(event.args.tierIndex),
						discountPercentage,
						maxUsesPerSerial: Number(event.args.maxUsesPerSerial),
					});
				}
				catch {
					console.log(`   ⚠️  Could not parse token address from event: ${tokenAddress}`);
				}
			}
		}

		if (discountTokenMap.size > 0) {
			console.log('\n📋 Discount Tokens (found via contract events):');

			// Track which tokens the user owns with ACTUAL remaining uses
			const ownedDiscountTokens = new Map();

			for (const [tokenIdStr, info] of discountTokenMap) {
				// Check if user owns any
				const ownedSerials = await getSerialsOwned(env, operatorId, info.tokenId);

				if (ownedSerials.length > 0) {
					// Check ACTUAL remaining uses for each serial
					const serialsWithUses = [];

					// Batch check serial discount info
					const tokenAddresses = ownedSerials.map(() => info.tokenAddress);
					const batchCommand = minterIface.encodeFunctionData('getBatchSerialDiscountInfo', [
						tokenAddresses,
						ownedSerials,
					]);
					const batchResult = await readOnlyEVMFromMirrorNode(env, contractId, batchCommand, operatorId, false);
					const [, usesRemaining, isEligible] =
						minterIface.decodeFunctionResult('getBatchSerialDiscountInfo', batchResult);

					for (let i = 0; i < ownedSerials.length; i++) {
						if (isEligible[i] && Number(usesRemaining[i]) > 0) {
							serialsWithUses.push({
								serial: ownedSerials[i],
								remainingUses: Number(usesRemaining[i]),
							});
						}
					}

					if (serialsWithUses.length > 0) {
						const totalAvailableUses = serialsWithUses.reduce((sum, s) => sum + s.remainingUses, 0);
						console.log(`   ✅ ${tokenIdStr}: ${info.discountPercentage}% discount`);
						console.log(`      👉 You own ${serialsWithUses.length} usable NFT${serialsWithUses.length > 1 ? 's' : ''} with ${totalAvailableUses} total use${totalAvailableUses > 1 ? 's' : ''} remaining`);
						console.log(`      Serials: [${serialsWithUses.map(s => `#${s.serial}(${s.remainingUses})`).slice(0, 10).join(', ')}${serialsWithUses.length > 10 ? '...' : ''}]`);

						// Store owned tokens with their usable serials
						ownedDiscountTokens.set(tokenIdStr, {
							...info,
							ownedSerials: serialsWithUses.map(s => s.serial),
							serialsWithUses,
							totalAvailableUses,
						});
					}
					else {
						console.log(`   ⚠️  ${tokenIdStr}: ${info.discountPercentage}% discount`);
						console.log(`      You own ${ownedSerials.length} NFT${ownedSerials.length > 1 ? 's' : ''} but all uses are exhausted`);
					}
				}
				else {
					console.log(`   ⚠️  ${tokenIdStr}: ${info.discountPercentage}% discount - You don't own any`);
				}
			}

			// Store for later use in discount selection (sorted by discount percentage)
			const sortedOwnedTokens = new Map(
				[...ownedDiscountTokens.entries()].sort((a, b) => b[1].discountPercentage - a[1].discountPercentage),
			);
			discountTokenMap.ownedDiscountTokens = sortedOwnedTokens;
		}
		else {
			console.log('\n⚠️  No active discount tokens found in contract history');

			// Show generic tier info if no tokens found
			if (Number(tierCount) > 0) {
				console.log('\n📋 Available Discount Tiers (Generic):');
				for (let i = 0; i < Number(tierCount); i++) {
					const tierCommand = minterIface.encodeFunctionData('getDiscountTier', [i]);
					const tierResult = await readOnlyEVMFromMirrorNode(env, contractId, tierCommand, operatorId, false);
					const tier = minterIface.decodeFunctionResult('getDiscountTier', tierResult)[0];

					if (Number(tier.discountPercentage) === 0) continue;

					console.log(`   Tier ${i}: ${Number(tier.discountPercentage)}% discount, ${Number(tier.maxUsesPerSerial)} uses per serial`);
				}
			}
		}

		// Check WL slots
		const userAddress = await homebrewPopulateAccountEvmAddress(env, operatorId);
		const wlSlotsCommand = minterIface.encodeFunctionData('getBatchWhitelistSlots', [[userAddress]]);
		const wlSlotsResult = await readOnlyEVMFromMirrorNode(env, contractId, wlSlotsCommand, operatorId, false);
		const wlSlotsArray = minterIface.decodeFunctionResult('getBatchWhitelistSlots', wlSlotsResult)[0];
		const wlSlots = wlSlotsArray[0];

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

		// Check if user owns any discount tokens
		const ownedDiscountTokens = discountTokenMap.ownedDiscountTokens || new Map();

		if (ownedDiscountTokens.size > 0) {
			console.log(`💡 You own usable discount NFTs from ${ownedDiscountTokens.size} token${ownedDiscountTokens.size > 1 ? 's' : ''}:\n`);

			// Display sorted by discount percentage (already sorted in map)
			let optionNumber = 1;
			const tokenOptions = [];
			for (const [tokenId, info] of ownedDiscountTokens) {
				console.log(`   [${optionNumber}] ${tokenId}: ${info.discountPercentage}% discount`);
				console.log(`       ${info.totalAvailableUses} use${info.totalAvailableUses > 1 ? 's' : ''} available across ${info.ownedSerials.length} NFT${info.ownedSerials.length > 1 ? 's' : ''}`);
				tokenOptions.push({ tokenId, info });
				optionNumber++;
			}
			console.log(`   [${optionNumber}] Skip holder discounts\n`);

			// Suggest optimal selection based on mint quantity
			if (quantity <= 3 && ownedDiscountTokens.size > 0) {
				const bestToken = [...ownedDiscountTokens.entries()][0];
				console.log(`💡 Suggestion: For ${quantity} NFT${quantity > 1 ? 's' : ''}, use option [1] (${bestToken[1].discountPercentage}% discount)\n`);
			}

			const useDiscounts = readlineSync.question('Select discount token options (comma separated, e.g. "1,2" or just press Enter to skip): ');

			if (useDiscounts.trim()) {
				const selectedOptions = useDiscounts.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

				for (const option of selectedOptions) {
					if (option < 1 || option > tokenOptions.length) {
						console.log(`\n   ⚠️  Invalid option: ${option}`);
						continue;
					}

					const { tokenId: tokenIdStr, info } = tokenOptions[option - 1];
					console.log(`\n   Using ${tokenIdStr} (${info.discountPercentage}% discount)`);


					const tokenAddress = info.tokenAddress;
					const ownedTokenSerials = info.ownedSerials;
					const serialsWithUsesInfo = info.serialsWithUses;

					let serials = [];

					// Auto-select optimal serials based on quantity
					if (quantity <= info.totalAvailableUses) {
						// Automatically select best serials to cover the mint quantity
						let usesAccumulated = 0;
						const autoSelectedSerials = [];

						for (const serialInfo of serialsWithUsesInfo) {
							if (usesAccumulated >= quantity) break;
							autoSelectedSerials.push(serialInfo.serial);
							usesAccumulated += serialInfo.remainingUses;
						}

						console.log(`   💡 Auto-selecting ${autoSelectedSerials.length} serial${autoSelectedSerials.length > 1 ? 's' : ''} to cover ${quantity} mint${quantity > 1 ? 's' : ''}`);
						console.log(`   Serials: [${autoSelectedSerials.join(', ')}]`);

						const useAuto = readlineSync.question('   Use these serials? (Y/n): ');

						if (useAuto.toLowerCase() !== 'n') {
							serials = autoSelectedSerials;
							console.log(`   ✅ Using ${serials.length} serial${serials.length > 1 ? 's' : ''}`);
						}
					}

					// If not auto-selected or user declined, provide manual options
					if (serials.length === 0) {
						if (ownedTokenSerials.length <= 10) {
							console.log('\n   Select serials to use:');
							const choices = serialsWithUsesInfo.map(s => `Serial #${s.serial} (${s.remainingUses} use${s.remainingUses > 1 ? 's' : ''})`);
							choices.push('Use all available', 'Skip this token');

							const selected = readlineSync.keyInSelect(
								choices,
								'Select an option',
								{ cancel: false },
							);

							if (selected === ownedTokenSerials.length) {
								// Use all
								serials = ownedTokenSerials;
								console.log(`   ✅ Using all ${serials.length} serials`);
							}
							else if (selected === ownedTokenSerials.length + 1) {
								// Skip
								console.log('   ⏭️  Skipped');
								continue;
							}
							else if (selected >= 0 && selected < ownedTokenSerials.length) {
								// Single selection
								serials = [ownedTokenSerials[selected]];
								const selectedUses = serialsWithUsesInfo[selected].remainingUses;
								console.log(`   ✅ Using serial #${serials[0]} (${selectedUses} use${selectedUses > 1 ? 's' : ''})`);

								// Ask if they want to add more
								if (ownedTokenSerials.length > 1) {
									const addMore = readlineSync.question('   Add more serials? (y/N): ');
									if (addMore.toLowerCase() === 'y') {
										const moreInput = readlineSync.question('   Enter additional serials (comma separated): ');
										if (moreInput.trim()) {
											const additionalSerials = moreInput.split(',').map(s => parseInt(s.trim())).filter(s => !isNaN(s) && ownedTokenSerials.includes(s));
											serials.push(...additionalSerials);
											console.log(`   ✅ Using ${serials.length} serials total`);
										}
									}
								}
							}
						}
						else {
							// Manual entry for >10 serials
							console.log(`   Available serials with uses: [${serialsWithUsesInfo.map(s => `#${s.serial}(${s.remainingUses})`).slice(0, 20).join(', ')}${serialsWithUsesInfo.length > 20 ? '...' : ''}]`);
							const serialsInput = readlineSync.question('   Enter serials to use (comma separated, or \'all\'): ');

							if (serialsInput.trim().toLowerCase() === 'all') {
								serials = ownedTokenSerials;
								console.log(`   ✅ Using all ${serials.length} serials`);
							}
							else if (serialsInput.trim()) {
								serials = serialsInput.split(',').map(s => parseInt(s.trim())).filter(s => !isNaN(s) && ownedTokenSerials.includes(s));
								console.log(`   ✅ Using ${serials.length} serial${serials.length > 1 ? 's' : ''}`);
							}
						}
					}

					if (serials.length > 0) {
						discountTokens.push(tokenAddress);
						serialsByToken.push(serials);
					}
				}
			}
		}
		else if (discountTokenMap.size > 0) {
			console.log('💡 Discount tokens exist but you don\'t own any eligible NFTs');
			console.log('   Skipping holder discount selection\n');
		}
		else {
			console.log('💡 No discount tokens configured in contract\n');
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

		// Format costs for display
		const formattedHbarCost = Hbar.fromTinybars(Number(totalHbarCost));
		const formattedLazyCost = Number(totalLazyCost) / Math.pow(10, lazyDecimals);

		console.log('Final Cost:');
		console.log(`   HBAR: ${formattedHbarCost.toString()}`);
		console.log(`   ${lazyTokenInfo.symbol}: ${formattedLazyCost.toFixed(lazyDecimals)} tokens`);
		console.log(`   Average Discount: ${Number(totalDiscount)}%`);
		console.log(`   Holder Slots Used: ${Number(holderSlotsUsed)}`);
		console.log(`   WL Slots Used: ${Number(wlSlotsUsed)}`);

		// Step 8: Check and set allowances
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🔐 ALLOWANCE SETUP');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('Checking HBAR allowances...');
		// Check existing HBAR allowances
		const existingHbarAllowances = await checkHbarAllowances(env, operatorId);
		const contractAllowance = existingHbarAllowances.find(a => a.spender === contractId.toString());
		const currentHbarAllowance = contractAllowance ? Number(contractAllowance.amount) : 0;

		// Calculate required HBAR allowance for auto-association fee
		// Each mint transaction requires 1 tinybar per 8 associations (rounded up)
		// For safety, set 1 HBAR which covers up to 800 mints
		const requiredHbarAllowance = Hbar.from(Math.ceil(quantity / 8), HbarUnit.Tinybar).toTinybars();

		console.log(`   Current allowance: ${Hbar.fromTinybars(currentHbarAllowance).toString()}`);
		console.log(`   Required allowance: ${Hbar.fromTinybars(requiredHbarAllowance).toString()}`);

		if (currentHbarAllowance < requiredHbarAllowance) {
			console.log('   Setting up HBAR allowance...');
			await setHbarAllowance(client, operatorId, contractId, requiredHbarAllowance);
			console.log(`   ✅ HBAR allowance set (${Hbar.fromTinybars(requiredHbarAllowance).toString()} to contract)`);
		}
		else {
			console.log('   ✅ Sufficient HBAR allowance already exists');
		}

		if (Number(totalLazyCost) > 0) {
			console.log('\nChecking LAZY allowances...');
			// Check existing LAZY allowance
			const currentLazyAllowance = await checkMirrorAllowance(env, operatorId, lazyTokenId, lazyGasStationId);
			const requiredLazyAllowance = Number(totalLazyCost);

			console.log(`   Current allowance: ${(currentLazyAllowance / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);
			console.log(`   Required allowance: ${(requiredLazyAllowance / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);

			if (currentLazyAllowance < requiredLazyAllowance) {
				console.log('   Setting up LAZY allowance...');
				await setFTAllowance(client, lazyTokenId, operatorId, lazyGasStationId, requiredLazyAllowance);
				console.log(`   ✅ ${lazyTokenInfo.symbol} allowance set (${formattedLazyCost.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol} to LazyGasStation)`);
			}
			else {
				console.log(`   ✅ Sufficient ${lazyTokenInfo.symbol} allowance already exists`);
			}
		}

		// Step 9: Final confirmation
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 FINAL SUMMARY');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Minting ${quantity} NFTs`);
		console.log(`Total Cost: ${formattedHbarCost.toString()} + ${formattedLazyCost.toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);
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
			new Hbar(Number(totalHbarCost), HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Minted NFTs');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n💰 Payment:');
			console.log(`   HBAR Paid: ${Hbar.fromTinybars(Number(totalHbarCost)).toString()}`);
			console.log(`   LAZY Paid: ${(Number(totalLazyCost) / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);

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
