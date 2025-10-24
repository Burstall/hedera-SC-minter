const {
	AccountId,
	ContractId,
	Hbar,
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
	console.log('║   EditionWithPrize - Contract State     ║');
	console.log('╚══════════════════════════════════════════╝\n');

	console.log('Contract ID:', contractId.toString());
	console.log('Environment:', env);

	// Load contract ABI
	const json = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	abi = new ethers.Interface(json.abi);

	try {
		console.log('\n📊 Fetching contract state...\n');

		// Get full contract state
		const encodedCommand = abi.encodeFunctionData('getContractState');
		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const decoded = abi.decodeFunctionResult('getContractState', result);

		// Parse all state
		const phase = Number(decoded[0]);
		const editionToken = decoded[1];
		const prizeToken = decoded[2];
		const lazyToken = decoded[3];
		const usdcNative = decoded[4];
		const usdcBridged = decoded[5];
		const editionMaxSupply = Number(decoded[6]);
		const prizeMaxSupply = Number(decoded[7]);
		const editionMinted = Number(decoded[8]);
		const prizeMinted = Number(decoded[9]);
		const winningSerials = decoded[10].map(s => Number(s));

		const economics = decoded[11];
		const timing = decoded[12];

		// Display phase
		const phaseNames = ['NOT_INITIALIZED', 'EDITION_MINTING', 'EDITION_SOLD_OUT', 'WINNER_SELECTED', 'PRIZE_CLAIMED'];
		console.log('═══════════════════════════════════════════');
		console.log('  CURRENT PHASE');
		console.log('═══════════════════════════════════════════');
		console.log(`  ${phaseNames[phase]}`);
		console.log();

		// Token addresses
		console.log('═══════════════════════════════════════════');
		console.log('  TOKEN ADDRESSES');
		console.log('═══════════════════════════════════════════');
		console.log('  Edition Token:', editionToken);
		console.log('  Prize Token:  ', prizeToken);
		console.log('  LAZY Token:   ', lazyToken);
		console.log('  USDC Native:  ', usdcNative);
		console.log('  USDC Bridged: ', usdcBridged);
		console.log();

		// Supply info
		console.log('═══════════════════════════════════════════');
		console.log('  SUPPLY INFORMATION');
		console.log('═══════════════════════════════════════════');
		console.log('  Edition Supply:');
		console.log(`    Max:    ${editionMaxSupply}`);
		console.log(`    Minted: ${editionMinted}`);
		console.log(`    Remaining: ${editionMaxSupply - editionMinted}`);
		console.log('  Prize Supply:');
		console.log(`    Max:    ${prizeMaxSupply}`);
		console.log(`    Claimed: ${prizeMinted}`);
		console.log(`    Available: ${prizeMaxSupply - prizeMinted}`);
		console.log();

		// Economics
		console.log('═══════════════════════════════════════════');
		console.log('  MINT ECONOMICS');
		console.log('═══════════════════════════════════════════');
		const hbarPrice = BigInt(economics[0]);
		const lazyPrice = Number(economics[1]);
		const usdcPrice = BigInt(economics[2]);
		const wlDiscount = Number(economics[3]);
		const maxMintPerTx = Number(economics[4]);
		const maxMintPerWallet = Number(economics[5]);

		console.log('  Pricing:');
		console.log(`    HBAR: ${hbarPrice > 0 ? Hbar.fromTinybars(hbarPrice).toString() : 'FREE'}`);
		console.log(`    LAZY: ${lazyPrice > 0 ? lazyPrice : 'FREE'}`);
		console.log(`    USDC: ${usdcPrice > 0 ? ethers.formatUnits(usdcPrice, 6) : 'FREE'}`);
		console.log('  Whitelist:');
		console.log(`    Discount: ${wlDiscount}%`);
		console.log('  Limits:');
		console.log(`    Max per transaction: ${maxMintPerTx > 0 ? maxMintPerTx : 'Unlimited'}`);
		console.log(`    Max per wallet: ${maxMintPerWallet > 0 ? maxMintPerWallet : 'Unlimited'}`);
		console.log();

		// Timing
		console.log('═══════════════════════════════════════════');
		console.log('  MINT TIMING & STATUS');
		console.log('═══════════════════════════════════════════');
		const mintStartTime = Number(timing[0]);
		const paused = timing[1];
		const wlOnly = timing[2];

		if (mintStartTime > 0) {
			const startDate = new Date(mintStartTime * 1000);
			const now = Date.now();
			const started = now >= startDate.getTime();
			console.log('  Start Time:', startDate.toLocaleString());
			console.log('  Status:', started ? '✓ Started' : '⏳ Not Started Yet');
		}
		else {
			console.log('  Start Time: Not set (starts immediately when unpaused)');
		}
		console.log('  Paused:', paused ? '⏸️  YES' : '▶️  NO');
		console.log('  Whitelist-Only:', wlOnly ? '🔒 YES' : '🔓 NO');
		console.log();

		// Winners
		if (phase >= 3 && winningSerials.length > 0) {
			console.log('═══════════════════════════════════════════');
			console.log('  WINNING SERIALS');
			console.log('═══════════════════════════════════════════');
			winningSerials.forEach((serial, index) => {
				console.log(`  ${index + 1}. Serial #${serial}`);
			});
			console.log();
			console.log('  ℹ️  Winning serials are BEARER ASSETS');
			console.log('     Current owner can claim the prize');
			console.log();
		}

		// Status summary
		console.log('═══════════════════════════════════════════');
		console.log('  STATUS SUMMARY');
		console.log('═══════════════════════════════════════════');

		if (phase === 0) {
			console.log('  ⏳ Awaiting token initialization');
			console.log('     Owner must initialize edition & prize tokens');
		}
		else if (phase === 1) {
			if (paused) {
				console.log('  ⏸️  Minting is paused');
				console.log('     Owner can unpause to allow minting');
			}
			else if (mintStartTime > 0 && Date.now() < mintStartTime * 1000) {
				const startDate = new Date(mintStartTime * 1000);
				console.log('  ⏳ Minting scheduled to start');
				console.log(`     Starts: ${startDate.toLocaleString()}`);
			}
			else if (wlOnly) {
				console.log('  🔒 Whitelist-only minting active');
				console.log('     Only whitelisted addresses can mint');
			}
			else {
				console.log('  ✅ Minting is OPEN');
				console.log(`     ${editionMaxSupply - editionMinted} / ${editionMaxSupply} editions available`);
			}
		}
		else if (phase === 2) {
			console.log('  🎉 All editions SOLD OUT!');
			console.log('     Ready for winner selection');
			console.log('     Anyone can call selectWinner()');
			if (prizeMaxSupply > 1) {
				console.log(`     ⚠️  ${prizeMaxSupply} winners will be selected`);
				console.log('     ⚠️  Use 2-3x gas estimate for selection');
			}
		}
		else if (phase === 3) {
			console.log('  🎲 Winner(s) selected!');
			console.log(`     ${prizeMaxSupply - prizeMinted} / ${prizeMaxSupply} prizes available to claim`);
			console.log('     Winners can call claimPrize()');
		}
		else if (phase === 4) {
			console.log('  ✅ All prizes claimed');
			console.log('     Edition complete!');
			if (prizeMinted === prizeMaxSupply) {
				console.log(`     All ${prizeMaxSupply} prize(s) successfully claimed`);
			}
		}
		console.log();

		// Next steps
		console.log('═══════════════════════════════════════════');
		console.log('  AVAILABLE ACTIONS');
		console.log('═══════════════════════════════════════════');

		if (phase === 1 && !paused && (mintStartTime === 0 || Date.now() >= mintStartTime * 1000)) {
			console.log('  🎫 Mint editions:');
			console.log('     node scripts/interactions/EditionWithPrize/mint.js');
		}
		else if (phase === 2) {
			console.log('  🎲 Select winners (anyone can call):');
			console.log('     node scripts/interactions/EditionWithPrize/selectWinner.js');
		}
		else if (phase === 3) {
			console.log('  🎁 Claim prize (if you own winning serial):');
			console.log('     node scripts/interactions/EditionWithPrize/claimPrize.js');
		}

		console.log('  📊 Check mint cost:');
		console.log('     node scripts/interactions/EditionWithPrize/checkMintCost.js');
		console.log('  🔍 Check WL status:');
		console.log('     node scripts/interactions/EditionWithPrize/checkWLStatus.js');
		console.log();

	}
	catch (error) {
		console.error('\n❌ Error fetching contract state:', error.message || error);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
