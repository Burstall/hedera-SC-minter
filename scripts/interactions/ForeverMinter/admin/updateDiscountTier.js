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
const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
const { estimateGas, logTransactionResult } = require('../../../../utils/gasHelpers');

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
	if (process.argv.length < 6) {
		console.log('Usage: node updateDiscountTier.js <index> <name> <tokenId> <discountPerSerial> <maxSerialsPerMint> <maxDiscount>');
		console.log('\nExample: node updateDiscountTier.js 0 "Updated Tier" 0.0.123456 10 5 50');
		return;
	}

	const tierIndex = parseInt(process.argv[2]);
	const tierName = process.argv[3];
	const tokenIdStr = process.argv[4];
	const discountPerSerial = parseInt(process.argv[5]);
	const maxSerialsPerMint = parseInt(process.argv[6]);
	const maxDiscount = parseInt(process.argv[7]);

	// Validate
	if (isNaN(tierIndex) || tierIndex < 0) {
		console.log('❌ Error: Invalid tier index');
		return;
	}

	let tierTokenId;
	try {
		tierTokenId = TokenId.fromString(tokenIdStr);
	}
	catch {
		console.log('❌ Error: Invalid token ID');
		return;
	}

	if (isNaN(discountPerSerial) || discountPerSerial < 0 || discountPerSerial > 100) {
		console.log('❌ Error: Discount per serial must be 0-100');
		return;
	}

	if (isNaN(maxSerialsPerMint) || maxSerialsPerMint < 1) {
		console.log('❌ Error: Max serials per mint must be at least 1');
		return;
	}

	if (isNaN(maxDiscount) || maxDiscount < 0 || maxDiscount > 100) {
		console.log('❌ Error: Max discount must be 0-100');
		return;
	}

	console.log('\n🎁 ForeverMinter - Update Discount Tier');
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
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 Updated Discount Tier');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Tier Index: ${tierIndex}`);
		console.log(`Name: ${tierName}`);
		console.log(`Token: ${tierTokenId.toString()}`);
		console.log(`Discount per Serial: ${discountPerSerial}%`);
		console.log(`Max Serials per Mint: ${maxSerialsPerMint}`);
		console.log(`Max Discount: ${maxDiscount}%`);

		console.log('\n⚠️  Warning: This will update the existing discount tier');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with update? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		console.log('\n🔄 Updating discount tier...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateDiscountTier',
			[tierIndex, tierName, tierTokenId.toSolidityAddress(), discountPerSerial, maxSerialsPerMint, maxDiscount],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'updateDiscountTier',
			[tierIndex, tierName, tierTokenId.toSolidityAddress(), discountPerSerial, maxSerialsPerMint, maxDiscount],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Discount tier updated');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n💡 Verify with: node getContractInfo.js');
		}
		else {
			console.log('❌ Failed to update tier:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'Update Discount Tier', gasInfo);

	}
	catch (error) {
		console.log('❌ Error updating discount tier:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
