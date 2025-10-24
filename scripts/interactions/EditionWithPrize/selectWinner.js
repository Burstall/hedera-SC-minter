const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { ethers } = require('ethers');
const {
	contractExecuteFunction,
	readOnlyEVMFromMirrorNode,
} = require('../../../utils/solidityHelpers');
const { estimateGas } = require('../../../utils/gasHelpers');
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
	console.log('║   EditionWithPrize - Select Winner(s)   ║');
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

	console.log('Using account:', operatorId.toString());
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
		// Step 1: Get contract state
		console.log('\n📊 Fetching contract state...');
		const state = await getContractState();

		// Validate phase
		if (state.phase !== 2) {
			const phaseNames = ['NOT_INITIALIZED', 'EDITION_MINTING', 'EDITION_SOLD_OUT', 'WINNER_SELECTED', 'PRIZE_CLAIMED'];
			console.log(`❌ ERROR: Winner selection not available. Current phase: ${phaseNames[state.phase]}`);

			if (state.phase === 1) {
				console.log(`   Editions still available: ${state.editionMaxSupply - state.editionMinted} / ${state.editionMaxSupply}`);
				console.log('   Wait until all editions are sold out');
			}
			else if (state.phase === 3) {
				console.log('   Winner(s) already selected!');
				console.log('   Winning serials:', state.winningSerials.join(', '));
			}
			else if (state.phase === 4) {
				console.log('   All prizes have been claimed');
			}
			return;
		}

		// Display info
		console.log('\n✅ All editions sold out!');
		console.log('  Edition Supply:', state.editionMaxSupply);
		console.log('  Prize Supply:', state.prizeMaxSupply);
		console.log(`  Winners to select: ${state.prizeMaxSupply}`);

		// Important gas warning for multiple winners
		if (state.prizeMaxSupply > 1) {
			console.log('\n⚠️  CRITICAL GAS REQUIREMENT WARNING:');
			console.log(`   Selecting ${state.prizeMaxSupply} winners may require 2-3x gas estimate`);
			console.log('   This is due to the robust duplicate-handling algorithm');
			console.log('   The algorithm guarantees exactly', state.prizeMaxSupply, 'unique winners');
			console.log('\n   Statistical Analysis:');
			console.log(`   - Single iteration: ~${Math.floor((1 - Math.pow(1 - 1 / state.editionMaxSupply, state.prizeMaxSupply - 1)) * 100)}% probability`);
			console.log('   - Two iterations: >99% completion probability');
			console.log('   - Gas multiplier: 2.5x will be applied automatically');
		}

		console.log('\n🎲 Winner Selection Details:');
		console.log('  - Uses Hedera PRNG for verifiable randomness');
		console.log('  - Anyone can call (permissionless)');
		console.log('  - Bearer asset model: winning serials are tradeable');
		console.log('  - Current serial owner at claim time wins the prize');

		// Step 2: Confirm selection
		const proceed = readlineSync.keyInYNStrict('\nProceed with winner selection?');
		if (!proceed) {
			console.log('❌ Selection cancelled');
			return;
		}

		// Step 3: Estimate gas with multiplier for multiple winners
		console.log('\n⛽ Estimating gas...');
		const baseGasEstimate = await estimateGas(
			env,
			contractId,
			abi,
			operatorId,
			'selectWinner',
			[],
			400_000,
			0,
		);

		let finalGasLimit = baseGasEstimate.gasLimit;

		// Apply 2.5x multiplier for multiple winners
		if (state.prizeMaxSupply > 1) {
			finalGasLimit = Math.floor(finalGasLimit * 2.5);
			console.log(`  Base estimate: ${baseGasEstimate.gasLimit.toLocaleString()}`);
			console.log('  Multiplier: 2.5x (multiple winners)');
			console.log(`  Final gas limit: ${finalGasLimit.toLocaleString()}`);
		}
		else {
			console.log(`  Gas limit: ${finalGasLimit.toLocaleString()}`);
		}

		// Step 4: Execute selection
		console.log('\n🎲 Selecting winner(s)...');
		console.log('⏳ This may take a moment...');

		const result = await contractExecuteFunction(
			contractId,
			abi,
			client,
			finalGasLimit,
			'selectWinner',
			[],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('❌ ERROR: Winner selection failed');
			console.log('Status:', result[0]?.status?.toString());

			if (state.prizeMaxSupply > 1) {
				console.log('\n💡 TIP: If gas limit exceeded, the algorithm may have needed more iterations.');
				console.log('   This is rare but possible. You can try again with the same result (idempotent).');
			}
			return;
		}

		console.log('\n✅ Winner selection successful!');
		console.log('Transaction ID:', result[2]?.transactionId?.toString());

		// Step 5: Get winning serials from return value
		try {
			const winningSerials = result[1];
			if (winningSerials && winningSerials.length > 0) {
				console.log('\n🎉 Winning Edition Serial(s):');
				winningSerials.forEach((serial, index) => {
					console.log(`  ${index + 1}. Serial #${Number(serial)}`);
				});

				console.log('\n📝 Important Notes:');
				console.log('  - These edition serials are BEARER ASSETS');
				console.log('  - Whoever owns the serial at claim time receives the prize');
				console.log('  - Serials can be traded on secondary markets');
				console.log('  - Each winner must associate with prize token before claiming');
			}
		}
		catch {
			console.log('\n📊 Check contract state to view winning serials:');
			console.log('   node scripts/interactions/EditionWithPrize/getContractState.js');
		}

		console.log('\n📊 Next Steps:');
		console.log('  1. Winners should check if they own winning serials');
		console.log('  2. Winners must associate with prize token');
		console.log('  3. Winners can claim prizes:');
		console.log('     node scripts/interactions/EditionWithPrize/claimPrize.js');
		console.log('\n  Query contract state anytime:');
		console.log('     node scripts/interactions/EditionWithPrize/getContractState.js');

	}
	catch (error) {
		console.error('\n❌ Error during winner selection:', error.message || error);

		if (error.message && error.message.includes('gas')) {
			console.log('\n💡 TIP: Try increasing the gas limit manually if using multiple winners.');
			console.log('   The algorithm may need additional iterations for duplicate handling.');
		}
	}
};

/**
 * Get contract state
 */
async function getContractState() {
	const encodedCommand = abi.encodeFunctionData('getContractState');
	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const decoded = abi.decodeFunctionResult('getContractState', result);

	const state = {
		phase: Number(decoded[0]),
		editionToken: decoded[1],
		prizeToken: decoded[2],
		editionMaxSupply: Number(decoded[6]),
		prizeMaxSupply: Number(decoded[7]),
		editionMinted: Number(decoded[8]),
		prizeMinted: Number(decoded[9]),
		winningSerials: decoded[10].map(s => Number(s)),
	};

	return state;
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
