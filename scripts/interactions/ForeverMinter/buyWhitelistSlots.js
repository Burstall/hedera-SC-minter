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
const readlineSync = require('readline-sync');
const {
	contractExecuteFunction,
	readOnlyEVMFromMirrorNode,
	setFTAllowance,
} = require('../../../utils/solidityHelpers');
const { checkTokenAssociation } = require('../../../utils/hederaHelpers');
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

	// Parse quantity from arguments
	if (process.argv.length < 3) {
		console.log('Usage: node buyWhitelistSlots.js <quantity>');
		console.log('\nExample: node buyWhitelistSlots.js 5');
		return;
	}

	const quantity = parseInt(process.argv[2]);

	if (isNaN(quantity) || quantity < 1) {
		console.log('❌ Error: Quantity must be a positive number');
		return;
	}

	console.log('\n🎟️  ForeverMinter - Buy Whitelist Slots');
	console.log('===========================================\n');

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
		// Get LAZY token details
		const lazyCommand = minterIface.encodeFunctionData('getLazyDetails');
		const lazyResult = await readOnlyEVMFromMirrorNode(env, contractId, lazyCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', lazyResult)[0];
		const lazyTokenId = TokenId.fromSolidityAddress(lazyDetails.lazyToken);

		// Check LAZY token association
		const isAssociated = await checkTokenAssociation(env, operatorId, lazyTokenId);

		if (!isAssociated) {
			console.log(`❌ Error: Your account is not associated with LAZY token ${lazyTokenId.toString()}`);
			console.log('   Please associate the token first');
			return;
		}

		// Get economics for WL slot cost
		const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
		const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult)[0];
		const wlSlotCost = Number(economics.wlSlotCost);

		const totalCost = wlSlotCost * quantity;

		// Get current WL slots
		const wlSlotsCommand = minterIface.encodeFunctionData('whitelistSlots', [operatorId.toSolidityAddress()]);
		const wlSlotsResult = await readOnlyEVMFromMirrorNode(env, contractId, wlSlotsCommand, operatorId, false);
		const currentSlots = Number(minterIface.decodeFunctionResult('whitelistSlots', wlSlotsResult)[0]);

		// Get LazyGasStation for allowance
		const gasStationCommand = minterIface.encodeFunctionData('lazyGasStation');
		const gasStationResult = await readOnlyEVMFromMirrorNode(env, contractId, gasStationCommand, operatorId, false);
		const gasStationAddress = minterIface.decodeFunctionResult('lazyGasStation', gasStationResult)[0];
		const gasStationId = ContractId.fromSolidityAddress(gasStationAddress);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 Whitelist Slot Purchase');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Current WL Slots: ${currentSlots}`);
		console.log(`Quantity to Buy: ${quantity}`);
		console.log(`New Total: ${currentSlots + quantity} slots`);

		console.log('\n💰 Cost:');
		console.log(`   Per Slot: ${wlSlotCost} LAZY`);
		console.log(`   Total: ${totalCost} LAZY`);

		console.log('\n💡 What are Whitelist Slots?');
		console.log('   WL slots allow you to mint at full price BEFORE');
		console.log('   the waterfall discount system applies holder discounts.');

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with purchase? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		// Set LAZY allowance to LazyGasStation
		console.log('\n⚙️  Setting LAZY allowance...\n');

		await setFTAllowance(
			client,
			operatorId,
			operatorKey,
			lazyTokenId,
			gasStationId,
			totalCost,
		);

		console.log('✅ Allowance set');

		// Execute purchase
		console.log('\n🔄 Processing purchase...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'buyWhitelistSlots',
			[quantity],
			200_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'buyWhitelistSlots',
			[quantity],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Whitelist slots purchased');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n📊 Your Updated WL Slots:');
			console.log(`   Previous: ${currentSlots}`);
			console.log(`   Purchased: ${quantity}`);
			console.log(`   New Total: ${currentSlots + quantity}`);

			console.log('\n💰 LAZY Spent:');
			console.log(`   ${totalCost} LAZY tokens`);

			console.log('\n💡 Next Steps:');
			console.log('   • Your WL slots will be consumed during minting');
			console.log('   • They allow full-price mints before holder discounts');
			console.log('   • Check your slots anytime with: node checkWLSlots.js');
		}
		else {
			console.log('❌ Failed to purchase:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Buy Whitelist Slots', gasInfo);

	}
	catch (error) {
		console.log('❌ Error during purchase:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
