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
			console.log('   Usage: node checkWLSlots.js [accountId]');
			return;
		}
	}

	console.log('\n🎟️  ForeverMinter - Whitelist Slots');
	console.log('======================================\n');

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
		// Get whitelist slots
		const wlSlotsCommand = minterIface.encodeFunctionData('getBatchWhitelistSlots', [[targetAddress]]);
		const wlSlotsResult = await readOnlyEVMFromMirrorNode(env, contractId, wlSlotsCommand, operatorId, false);
		const slotsArray = minterIface.decodeFunctionResult('getBatchWhitelistSlots', wlSlotsResult)[0];
		const wlSlots = Number(slotsArray[0]);

		// Get WL slot cost and discount info
		const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
		const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult)[0];
		const wlSlotCost = Number(economics[6]); // buyWlWithLazy
		const slotsPerPurchase = Number(economics[7]); // buyWlSlotCount
		const wlDiscount = Number(economics[2]); // wlDiscount
		const sacrificeDiscount = Number(economics[3]); // sacrificeDiscount

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎟️  Whitelist Slot Status');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Account: ${AccountId.fromSolidityAddress(targetAddress).toString()}`);
		console.log(`Whitelist Slots: ${wlSlots}`);

		if (wlSlots > 0) {
			console.log(`\n✅ You have ${wlSlots} whitelist slot(s) available!`);
		}
		else {
			console.log('\n❌ You have 0 whitelist slots');
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💡 What are Whitelist Slots?');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log('Whitelist slots allow you to mint at a discount BEFORE');
		console.log('the waterfall discount system applies holder discounts.');
		console.log('');
		console.log('Discount Logic:');
		console.log(`   • Sacrifice: ${sacrificeDiscount}% discount (STOPS HERE - mutually exclusive)`);
		console.log('');
		console.log('OR if no sacrifice, waterfall applies:');
		console.log('   1. Holder Discounts (consume holder slots first)');
		console.log(`   2. Whitelist: ${wlDiscount}% discount (consume WL slots)`);
		console.log('   3. Full Price (no slots consumed)');
		console.log('');
		console.log(`Cost to purchase: ${wlSlotCost} LAZY per purchase`);
		console.log(`Slots per purchase: ${slotsPerPurchase}`);

		if (wlSlots === 0) {
			console.log('\n📝 To purchase whitelist slots:');
			console.log('   node buyWhitelistSlots.js <quantity>');
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.log('❌ Error checking whitelist slots:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
