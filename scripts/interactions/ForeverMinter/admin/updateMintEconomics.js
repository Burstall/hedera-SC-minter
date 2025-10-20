const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

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
		console.log('📋 Enter new mint economics values:');
		console.log('   (Press Enter to skip a field and keep current value)\n');

		// Collect inputs
		const hbarPriceInput = readlineSync.question('HBAR Price (in tinybars): ');
		const lazyPriceInput = readlineSync.question('LAZY Price (in tokens): ');
		const sacrificeDiscountInput = readlineSync.question('Sacrifice Discount (%): ');
		const maxPerMintInput = readlineSync.question('Max Per Mint: ');
		const maxPerWalletInput = readlineSync.question('Max Per Wallet (0 = unlimited): ');
		const wlSlotCostInput = readlineSync.question('WL Slot Cost (LAZY tokens): ');

		// Validate and convert
		const hbarPrice = hbarPriceInput ? parseInt(hbarPriceInput) : null;
		const lazyPrice = lazyPriceInput ? parseInt(lazyPriceInput) : null;
		const sacrificeDiscount = sacrificeDiscountInput ? parseInt(sacrificeDiscountInput) : null;
		const maxPerMint = maxPerMintInput ? parseInt(maxPerMintInput) : null;
		const maxPerWallet = maxPerWalletInput ? parseInt(maxPerWalletInput) : null;
		const wlSlotCost = wlSlotCostInput ? parseInt(wlSlotCostInput) : null;

		// Check if any values provided
		if (!hbarPrice && !lazyPrice && !sacrificeDiscount && !maxPerMint && !maxPerWallet && !wlSlotCost) {
			console.log('\n❌ Error: No values provided');
			return;
		}

		// Validate values
		if (hbarPrice !== null && (isNaN(hbarPrice) || hbarPrice < 0)) {
			console.log('❌ Error: Invalid HBAR price');
			return;
		}

		if (lazyPrice !== null && (isNaN(lazyPrice) || lazyPrice < 0)) {
			console.log('❌ Error: Invalid LAZY price');
			return;
		}

		if (sacrificeDiscount !== null && (isNaN(sacrificeDiscount) || sacrificeDiscount < 0 || sacrificeDiscount > 100)) {
			console.log('❌ Error: Invalid sacrifice discount (must be 0-100)');
			return;
		}

		if (maxPerMint !== null && (isNaN(maxPerMint) || maxPerMint < 1)) {
			console.log('❌ Error: Invalid max per mint');
			return;
		}

		if (maxPerWallet !== null && (isNaN(maxPerWallet) || maxPerWallet < 0)) {
			console.log('❌ Error: Invalid max per wallet');
			return;
		}

		if (wlSlotCost !== null && (isNaN(wlSlotCost) || wlSlotCost < 0)) {
			console.log('❌ Error: Invalid WL slot cost');
			return;
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 SUMMARY - New Values');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (hbarPrice !== null) console.log(`HBAR Price: ${hbarPrice} tℏ`);
		if (lazyPrice !== null) console.log(`LAZY Price: ${lazyPrice} tokens`);
		if (sacrificeDiscount !== null) console.log(`Sacrifice Discount: ${sacrificeDiscount}%`);
		if (maxPerMint !== null) console.log(`Max Per Mint: ${maxPerMint} NFTs`);
		if (maxPerWallet !== null) console.log(`Max Per Wallet: ${maxPerWallet === 0 ? 'Unlimited' : `${maxPerWallet} NFTs`}`);
		if (wlSlotCost !== null) console.log(`WL Slot Cost: ${wlSlotCost} LAZY`);

		console.log('\n⚠️  Warning: This will update the contract configuration');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with update? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		// Prepare arguments
		const args = [
			hbarPrice ?? 0,
			lazyPrice ?? 0,
			sacrificeDiscount ?? 0,
			maxPerMint ?? 0,
			maxPerWallet ?? 0,
			wlSlotCost ?? 0,
		];

		// Prepare flags (0 = skip, 1 = update)
		const flags = [
			hbarPrice !== null ? 1 : 0,
			lazyPrice !== null ? 1 : 0,
			sacrificeDiscount !== null ? 1 : 0,
			maxPerMint !== null ? 1 : 0,
			maxPerWallet !== null ? 1 : 0,
			wlSlotCost !== null ? 1 : 0,
		];

		console.log('\n🔄 Updating mint economics...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateMintEconomics',
			[...args, flags],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'updateMintEconomics',
			[...args, flags],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Mint economics updated');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n📊 Updated Values:');
			if (hbarPrice !== null) console.log(`   HBAR Price: ${hbarPrice} tℏ`);
			if (lazyPrice !== null) console.log(`   LAZY Price: ${lazyPrice} tokens`);
			if (sacrificeDiscount !== null) console.log(`   Sacrifice Discount: ${sacrificeDiscount}%`);
			if (maxPerMint !== null) console.log(`   Max Per Mint: ${maxPerMint} NFTs`);
			if (maxPerWallet !== null) console.log(`   Max Per Wallet: ${maxPerWallet === 0 ? 'Unlimited' : `${maxPerWallet} NFTs`}`);
			if (wlSlotCost !== null) console.log(`   WL Slot Cost: ${wlSlotCost} LAZY`);

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
