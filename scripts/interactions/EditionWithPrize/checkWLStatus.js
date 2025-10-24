const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const {
	readOnlyEVMFromMirrorNode,
} = require('../../../utils/solidityHelpers');
require('dotenv').config();

const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractId = ContractId.fromString(process.env.EDITION_WITH_PRIZE_CONTRACT_ID);
const contractName = 'EditionWithPrize';
const env = process.env.ENVIRONMENT ?? null;

let abi;

const main = async () => {
	console.log('\n╔══════════════════════════════════════════╗');
	console.log('║  EditionWithPrize - Check WL Status     ║');
	console.log('╚══════════════════════════════════════════╝\n');

	console.log('Checking for account:', operatorId.toString());
	console.log('Contract ID:', contractId.toString());

	// Load contract ABI
	const json = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	abi = new ethers.Interface(json.abi);

	try {
		console.log('\n🔍 Checking whitelist status...\n');

		// Check if address is whitelisted
		const encodedCommand = abi.encodeFunctionData('isAddressWL', [
			operatorId.toSolidityAddress(),
		]);
		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const decoded = abi.decodeFunctionResult('isAddressWL', result);
		const isWL = decoded[0];

		console.log('═══════════════════════════════════════════');
		console.log('  WHITELIST STATUS');
		console.log('═══════════════════════════════════════════');
		console.log(`  Address: ${operatorId.toString()}`);
		console.log(`  Whitelisted: ${isWL ? '✅ YES' : '❌ NO'}`);
		console.log();

		if (isWL) {
			// Get contract state to show discount
			const stateCmd = abi.encodeFunctionData('getContractState');
			const stateResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				stateCmd,
				operatorId,
				false,
			);
			const stateDecoded = abi.decodeFunctionResult('getContractState', stateResult);
			const wlDiscount = Number(stateDecoded[11][3]);

			console.log('✨ Benefits:');
			console.log(`  - ${wlDiscount}% discount on all payment types`);
			console.log('  - Discount applies to HBAR, LAZY, and USDC');

			// Check if WL-only mode
			const wlOnly = stateDecoded[12][2];
			if (wlOnly) {
				console.log('  - 🔒 Exclusive access (WL-only mode active)');
			}

			console.log('\n📊 Check exact costs:');
			console.log('   node scripts/interactions/EditionWithPrize/checkMintCost.js');
		}
		else {
			console.log('ℹ️  You are not currently whitelisted');
			console.log();
			console.log('📋 Ways to get whitelisted:');
			console.log('  1. Manual whitelist by owner');
			console.log('  2. Purchase with LAZY:');
			console.log('     node scripts/interactions/EditionWithPrize/purchaseWLWithLazy.js');
			console.log('  3. Purchase with NFT token:');
			console.log('     node scripts/interactions/EditionWithPrize/purchaseWLWithToken.js');

			// Check if WL-only mode
			const stateCmd = abi.encodeFunctionData('getContractState');
			const stateResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				stateCmd,
				operatorId,
				false,
			);
			const stateDecoded = abi.decodeFunctionResult('getContractState', stateResult);
			const wlOnly = stateDecoded[12][2];

			if (wlOnly) {
				console.log('\n⚠️  WARNING: Minting is currently WHITELIST-ONLY');
				console.log('   You must be whitelisted to mint');
			}
			else {
				console.log('\n✓ You can still mint at regular price');
				console.log('  (WL-only mode is not active)');
			}
		}

		console.log();

	}
	catch (error) {
		console.error('\n❌ Error checking whitelist status:', error.message || error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
