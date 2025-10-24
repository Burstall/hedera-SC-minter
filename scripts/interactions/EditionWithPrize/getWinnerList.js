const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const {
	readOnlyEVMFromMirrorNode,
} = require('../../../utils/solidityHelpers');
require('dotenv').config();

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractId = ContractId.fromString(process.env.EDITION_WITH_PRIZE_CONTRACT_ID);
const contractName = 'EditionWithPrize';
const env = process.env.ENVIRONMENT ?? null;

let client;
let abi;

const main = async () => {
	console.log('\n╔══════════════════════════════════════════╗');
	console.log('║         Get Winner List                  ║');
	console.log('╚══════════════════════════════════════════╝\n');

	if (
		operatorKey === undefined ||
		operatorKey == null ||
		operatorId === undefined ||
		operatorId == null
	) {
		console.log('❌ ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in .env file');
		return;
	}

	console.log('Contract ID:', contractId.toString());
	console.log('Environment:', env);

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
		console.log('❌ ERROR: Must specify either MAIN, TEST, PREVIEW, or LOCAL as environment');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Load contract ABI
	const json = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	abi = new ethers.Interface(json.abi);

	try {
		console.log('\n📊 Retrieving winner information...\n');

		// Get current phase
		const phaseCmd = abi.encodeFunctionData('currentPhase');
		const phaseResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			phaseCmd,
			operatorId,
			false,
		);
		const currentPhase = abi.decodeFunctionResult('currentPhase', phaseResult)[0];

		if (currentPhase < 2) {
			console.log('❌ Winners have not been selected yet');
			console.log('   Current phase:', currentPhase.toString());
			console.log('   Phase 2 = WINNER_SELECTION required');
			return;
		}

		// Get prize max supply
		const maxSupplyCmd = abi.encodeFunctionData('prizeMaxSupply');
		const maxSupplyResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			maxSupplyCmd,
			operatorId,
			false,
		);
		const prizeMaxSupply = abi.decodeFunctionResult('prizeMaxSupply', maxSupplyResult)[0];

		console.log('🎁 Prize Information:');
		console.log('═══════════════════════════════════════════');
		console.log('  Number of Winners:', prizeMaxSupply.toString());
		console.log();

		// Get winner serials
		const winnersCmd = abi.encodeFunctionData('getWinners');
		const winnersResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			winnersCmd,
			operatorId,
			false,
		);
		const winners = abi.decodeFunctionResult('getWinners', winnersResult)[0];

		if (!winners || winners.length === 0) {
			console.log('⚠️  No winners recorded yet');
			return;
		}

		console.log('🏆 Winning Edition Serials:');
		console.log('═══════════════════════════════════════════');
		winners.forEach((serial, index) => {
			console.log(`  ${index + 1}. Edition #${serial.toString()}`);
		});

		console.log();
		console.log('📝 Note: These edition serials are bearer assets');
		console.log('   The current holder of each serial can claim the prize');
		console.log('   Prize is claimed by calling claimPrize() with the winning serial');

		// Check if any prizes have been claimed
		console.log('\n🎁 Prize Claim Status:');
		console.log('═══════════════════════════════════════════');

		for (let i = 0; i < winners.length; i++) {
			const serial = winners[i];
			const claimedCmd = abi.encodeFunctionData('prizesClaimed', [serial]);
			const claimedResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				claimedCmd,
				operatorId,
				false,
			);
			const claimed = abi.decodeFunctionResult('prizesClaimed', claimedResult)[0];

			const status = claimed ? '✅ CLAIMED' : '⏳ UNCLAIMED';
			console.log(`  Edition #${serial.toString()}: ${status}`);
		}

		console.log();
		console.log(`Total Winners: ${winners.length}`);
		console.log('Note: Check individual serials for exact claim status');

		console.log('\n📊 Next Steps:');
		console.log('  • Claim a prize (if you hold a winning serial):');
		console.log('    node scripts/interactions/EditionWithPrize/claimPrize.js');
		console.log('  • Check full contract state:');
		console.log('    node scripts/interactions/EditionWithPrize/getContractState.js');

	}
	catch (error) {
		console.error('\n❌ Error retrieving winner list:', error.message || error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
