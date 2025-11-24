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
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');
const { estimateGas, logTransactionResult } = require('../../../../utils/gasHelpers');

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

	console.log('\n⚙️  ForeverMinter - Update Mint Economics');
	console.log('============================================\n');

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
		// Fetch current economics configuration
		console.log('🔍 Fetching current economics configuration...\n');
		console.log(`   Contract ID: ${contractId.toString()}`);
		console.log(`   Environment: ${env}\n`);

		const encodedCommand = minterIface.encodeFunctionData('getMintEconomics');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);

		if (!queryResult || queryResult === '0x' || queryResult.length <= 2) {
			console.log('❌ Error: Contract returned empty data');
			console.log('   This usually means:');
			console.log('   1. The FOREVER_MINTER_CONTRACT_ID in .env is incorrect');
			console.log('   2. The contract is not deployed on this network');
			console.log('   3. The contract has not been initialized\n');
			console.log(`   Current FOREVER_MINTER_CONTRACT_ID: ${contractId.toString()}`);
			console.log(`   Current ENVIRONMENT: ${env}`);
			return;
		}

		const currentEconomics = minterIface.decodeFunctionResult('getMintEconomics', queryResult);

		// Get LAZY token details for decimal precision
		const lazyCommand = minterIface.encodeFunctionData('getLazyDetails');
		const lazyResult = await readOnlyEVMFromMirrorNode(env, contractId, lazyCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', lazyResult)[0];
		const lazyTokenId = TokenId.fromSolidityAddress(lazyDetails.lazyToken);
		const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
		if (!lazyTokenInfo) {
			console.log('❌ Error: Could not fetch LAZY token details');
			return;
		}
		const lazyDecimals = parseInt(lazyTokenInfo.decimals);

		// Extract current values
		const currentHbarPrice = Number(currentEconomics[0][0]);
		const currentLazyPrice = Number(currentEconomics[0][1]);
		const currentWlDiscount = Number(currentEconomics[0][2]);
		const currentSacrificeDiscount = Number(currentEconomics[0][3]);
		const currentMaxMint = Number(currentEconomics[0][4]);
		const currentMaxMintPerWallet = Number(currentEconomics[0][5]);
		const currentBuyWlWithLazy = Number(currentEconomics[0][6]);
		const currentBuyWlSlotCount = Number(currentEconomics[0][7]);
		const currentMaxSacrifice = Number(currentEconomics[0][8]);
		const currentLazyFromContract = currentEconomics[0][9];

		console.log('📊 Current Economics Configuration:');
		console.log(`   HBAR Price: ${Hbar.fromTinybars(currentHbarPrice).toString()}`);
		console.log(`   LAZY Price: ${(currentLazyPrice / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);
		console.log(`   Whitelist Discount: ${currentWlDiscount}%`);
		console.log(`   Sacrifice Discount: ${currentSacrificeDiscount}%`);
		console.log(`   Max Per Mint: ${currentMaxMint} NFTs`);
		console.log(`   Max Per Wallet: ${currentMaxMintPerWallet === 0 ? 'Unlimited' : `${currentMaxMintPerWallet} NFTs`}`);
		console.log(`   WL Slot Cost: ${(currentBuyWlWithLazy / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals)} ${lazyTokenInfo.symbol}`);
		console.log(`   WL Slot Count: ${currentBuyWlSlotCount} slots`);
		console.log(`   Max Sacrifice: ${currentMaxSacrifice} NFTs`);
		console.log(`   Contract Sponsors ${lazyTokenInfo.symbol}: ${currentLazyFromContract}`);

		console.log('\n📋 Enter new mint economics values:');
		console.log('   (Press Enter to keep current value)\n');

		// Collect inputs
		const hbarPriceInput = readlineSync.question('HBAR Price (in HBAR, e.g., 1.5): ');
		const lazyPriceInput = readlineSync.question(`${lazyTokenInfo.symbol} Price (in ${lazyTokenInfo.symbol}, e.g., 11.1): `);
		const wlDiscountInput = readlineSync.question('Whitelist Discount (%): ');
		const sacrificeDiscountInput = readlineSync.question('Sacrifice Discount (%): ');
		const maxPerMintInput = readlineSync.question('Max Per Mint: ');
		const maxPerWalletInput = readlineSync.question('Max Mint Per Wallet (0 = unlimited): ');
		const wlSlotCostInput = readlineSync.question(`WL Slot Cost (${lazyTokenInfo.symbol} tokens, e.g., 50.0): `);
		const wlSlotCountInput = readlineSync.question('WL Slot Count Per Purchase: ');
		const maxSacrificeInput = readlineSync.question('Max Sacrifice per Mint: ');
		const lazyFromContractInput = readlineSync.question('Contract Sponsors LAZY? (true/false): ');

		// Validate and convert
		// Default to current values
		let hbarPrice = currentHbarPrice;
		let hbarPriceFormatted = Hbar.fromTinybars(currentHbarPrice).toString();
		if (hbarPriceInput.trim()) {
			const hbarAmount = new Hbar(parseFloat(hbarPriceInput));
			hbarPrice = Number(hbarAmount.toTinybars());
			hbarPriceFormatted = hbarAmount.toString();
		}

		let lazyPrice = currentLazyPrice;
		let lazyPriceFormatted = (currentLazyPrice / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals);
		if (lazyPriceInput.trim()) {
			const lazyValue = parseFloat(lazyPriceInput);
			if (isNaN(lazyValue) || lazyValue < 0) {
				console.log(`❌ Error: Invalid ${lazyTokenInfo.symbol} price`);
				return;
			}
			lazyPrice = Math.floor(lazyValue * Math.pow(10, lazyDecimals));
			lazyPriceFormatted = lazyValue.toFixed(lazyDecimals);
		}

		const wlDiscount = wlDiscountInput.trim() ? parseInt(wlDiscountInput) : currentWlDiscount;
		const sacrificeDiscount = sacrificeDiscountInput.trim() ? parseInt(sacrificeDiscountInput) : currentSacrificeDiscount;
		const maxPerMint = maxPerMintInput.trim() ? parseInt(maxPerMintInput) : currentMaxMint;
		const maxPerWallet = maxPerWalletInput.trim() ? parseInt(maxPerWalletInput) : currentMaxMintPerWallet;

		let wlSlotCost = currentBuyWlWithLazy;
		let wlSlotCostFormatted = (currentBuyWlWithLazy / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals);
		if (wlSlotCostInput.trim()) {
			const wlValue = parseFloat(wlSlotCostInput);
			if (isNaN(wlValue) || wlValue < 0) {
				console.log('❌ Error: Invalid WL slot cost');
				return;
			}
			wlSlotCost = Math.floor(wlValue * Math.pow(10, lazyDecimals));
			wlSlotCostFormatted = wlValue.toFixed(lazyDecimals);
		}

		const wlSlotCount = wlSlotCountInput.trim() ? parseInt(wlSlotCountInput) : currentBuyWlSlotCount;
		const maxSacrifice = maxSacrificeInput.trim() ? parseInt(maxSacrificeInput) : currentMaxSacrifice;
		const lazyFromContract = lazyFromContractInput.trim() ? lazyFromContractInput.toLowerCase() === 'true' : currentLazyFromContract;

		// Validate values
		if (wlDiscount < 0 || wlDiscount > 100) {
			console.log('❌ Error: Invalid whitelist discount (must be 0-100)');
			return;
		}

		if (sacrificeDiscount < 0 || sacrificeDiscount > 100) {
			console.log('❌ Error: Invalid sacrifice discount (must be 0-100)');
			return;
		}

		if (maxPerMint < 0) {
			console.log('❌ Error: Invalid max per mint');
			return;
		}

		if (maxPerWallet < 0) {
			console.log('❌ Error: Invalid max per wallet');
			return;
		}

		if (wlSlotCount < 1) {
			console.log('❌ Error: Invalid WL slot count (must be >= 1)');
			return;
		}

		if (maxSacrifice < 0) {
			console.log('❌ Error: Invalid max sacrifice');
			return;
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 SUMMARY - Parameters to be sent');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Calculate what's changing
		const hbarChanged = hbarPrice !== currentHbarPrice;
		const lazyChanged = lazyPrice !== currentLazyPrice;
		const wlDiscountChanged = wlDiscount !== currentWlDiscount;
		const sacrificeDiscountChanged = sacrificeDiscount !== currentSacrificeDiscount;
		const maxMintChanged = maxPerMint !== currentMaxMint;
		const maxWalletChanged = maxPerWallet !== currentMaxMintPerWallet;
		const wlCostChanged = wlSlotCost !== currentBuyWlWithLazy;
		const wlCountChanged = wlSlotCount !== currentBuyWlSlotCount;
		const maxSacrificeChanged = maxSacrifice !== currentMaxSacrifice;
		const lazyFromContractChanged = lazyFromContract !== currentLazyFromContract;

		const changeMarker = (changed) => changed ? ' ⭐ CHANGED' : '';

		// Show all parameters with change indicators
		console.log(`HBAR Price: ${hbarPriceFormatted}${changeMarker(hbarChanged)}`);
		console.log(`LAZY Price: ${lazyPriceFormatted} $LAZY${changeMarker(lazyChanged)}`);
		console.log(`Whitelist Discount: ${wlDiscount}%${changeMarker(wlDiscountChanged)}`);
		console.log(`Sacrifice Discount: ${sacrificeDiscount}%${changeMarker(sacrificeDiscountChanged)}`);
		console.log(`Max Per Mint: ${maxPerMint} NFTs${changeMarker(maxMintChanged)}`);
		console.log(`Max Per Wallet: ${maxPerWallet === 0 ? 'Unlimited' : `${maxPerWallet} NFTs`}${changeMarker(maxWalletChanged)}`);
		console.log(`WL Slot Cost: ${wlSlotCostFormatted} $LAZY${changeMarker(wlCostChanged)}`);
		console.log(`WL Slot Count: ${wlSlotCount} slots${changeMarker(wlCountChanged)}`);
		console.log(`Max Sacrifice: ${maxSacrifice} NFTs${changeMarker(maxSacrificeChanged)}`);
		console.log(`Contract Sponsors LAZY: ${lazyFromContract}${changeMarker(lazyFromContractChanged)}`);

		console.log('\n⚠️  Warning: This will update the contract configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with update? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		// Prepare arguments for updateEconomics()
		// All 10 parameters are required by the contract
		const params = [
			hbarPrice ?? 0,
			lazyPrice ?? 0,
			wlDiscount,
			sacrificeDiscount,
			maxPerMint,
			maxPerWallet,
			wlSlotCost ?? 0,
			wlSlotCount,
			maxSacrifice,
			lazyFromContract,
		];

		console.log('\n🔄 Updating mint economics...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateEconomics',
			params,
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'updateEconomics',
			params,
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Mint economics updated');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n📊 Updated Values:');
			console.log(`   HBAR Price: ${hbarPriceFormatted}${changeMarker(hbarChanged)}`);
			console.log(`   LAZY Price: ${lazyPriceFormatted} $LAZY${changeMarker(lazyChanged)}`);
			console.log(`   Whitelist Discount: ${wlDiscount}%${changeMarker(wlDiscountChanged)}`);
			console.log(`   Sacrifice Discount: ${sacrificeDiscount}%${changeMarker(sacrificeDiscountChanged)}`);
			console.log(`   Max Per Mint: ${maxPerMint} NFTs${changeMarker(maxMintChanged)}`);
			console.log(`   Max Per Wallet: ${maxPerWallet === 0 ? 'Unlimited' : `${maxPerWallet} NFTs`}${changeMarker(maxWalletChanged)}`);
			console.log(`   WL Slot Cost: ${wlSlotCostFormatted} $LAZY${changeMarker(wlCostChanged)}`);
			console.log(`   WL Slot Count: ${wlSlotCount} slots${changeMarker(wlCountChanged)}`);
			console.log(`   Max Sacrifice: ${maxSacrifice} NFTs${changeMarker(maxSacrificeChanged)}`);
			console.log(`   Contract Sponsors LAZY: ${lazyFromContract}${changeMarker(lazyFromContractChanged)}`);

			if (hbarChanged || lazyChanged || wlDiscountChanged || sacrificeDiscountChanged ||
				maxMintChanged || maxWalletChanged || wlCostChanged || wlCountChanged ||
				maxSacrificeChanged || lazyFromContractChanged) {
				console.log('\n   ⭐ = Value changed from current');
			}

			console.log('\n💡 Verify with: node getContractInfo.js');
		}
		else {
			console.log('❌ Failed to update:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Update Mint Economics', gasInfo);

	}
	catch (error) {
		console.log('❌ Error updating mint economics:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
