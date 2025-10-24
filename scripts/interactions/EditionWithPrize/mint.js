const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	Hbar,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { ethers } = require('ethers');
const {
	contractExecuteFunction,
	readOnlyEVMFromMirrorNode,
} = require('../../../utils/solidityHelpers');
const {
	associateTokenToAccount,
	setFTAllowance,
} = require('../../../utils/hederaHelpers');
const {
	checkMirrorBalance,
	checkMirrorHbarBalance,
} = require('../../../utils/hederaMirrorHelpers');
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
	console.log('║    EditionWithPrize - Mint Editions     ║');
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
		if (state.phase !== 1) {
			const phaseNames = ['NOT_INITIALIZED', 'EDITION_MINTING', 'EDITION_SOLD_OUT', 'WINNER_SELECTED', 'PRIZE_CLAIMED'];
			console.log(`❌ ERROR: Minting not available. Current phase: ${phaseNames[state.phase]}`);
			if (state.phase === 0) {
				console.log('   Tokens need to be initialized by owner.');
			}
			else if (state.phase === 2) {
				console.log('   All editions are sold out!');
			}
			return;
		}

		// Check if paused
		if (state.timing.paused) {
			console.log('❌ ERROR: Minting is currently paused');
			return;
		}

		// Check start time
		if (state.timing.mintStartTime > 0) {
			const now = Math.floor(Date.now() / 1000);
			if (now < state.timing.mintStartTime) {
				const startDate = new Date(state.timing.mintStartTime * 1000);
				console.log(`❌ ERROR: Minting hasn't started yet. Starts at: ${startDate.toLocaleString()}`);
				return;
			}
		}

		// Display info
		console.log('\n📦 Edition Collection Info:');
		console.log('  Token:', state.editionToken);
		console.log('  Supply:', `${state.editionMinted} / ${state.editionMaxSupply} minted`);
		console.log('  Available:', state.editionMaxSupply - state.editionMinted);

		// Check if sold out
		if (state.editionMinted >= state.editionMaxSupply) {
			console.log('❌ ERROR: All editions are sold out!');
			return;
		}

		// Step 2: Check whitelist status
		console.log('\n🔍 Checking whitelist status...');
		const isWL = await checkWhitelistStatus(operatorId);

		// Step 3: Calculate costs
		console.log('\n💰 Pricing Information:');
		console.log('  HBAR:', state.economics.mintPriceHbar > 0 ? `${Hbar.fromTinybars(state.economics.mintPriceHbar).toString()} per edition` : 'FREE');
		console.log('  LAZY:', state.economics.mintPriceLazy > 0 ? `${state.economics.mintPriceLazy} per edition` : 'FREE');
		console.log('  USDC:', state.economics.mintPriceUsdc > 0 ? `${ethers.formatUnits(state.economics.mintPriceUsdc, 6)} per edition` : 'FREE');

		if (isWL && state.economics.wlDiscount > 0) {
			console.log(`\n✨ You are whitelisted! Discount: ${state.economics.wlDiscount}%`);
		}
		else if (state.timing.wlOnly) {
			console.log('\n❌ ERROR: Minting is currently whitelist-only and you are not whitelisted');
			return;
		}

		// Step 4: Get quantity
		const maxAvailable = Math.min(
			state.editionMaxSupply - state.editionMinted,
			state.economics.maxMintPerTx > 0 ? state.economics.maxMintPerTx : 999,
		);

		const quantity = parseInt(readlineSync.question(`\nHow many editions to mint? (1-${maxAvailable}): `));

		if (quantity < 1 || quantity > maxAvailable) {
			console.log('❌ ERROR: Invalid quantity');
			return;
		}

		// Calculate actual costs with discount
		const discount = isWL ? state.economics.wlDiscount : 0;
		const hbarCost = state.economics.mintPriceHbar * BigInt(quantity) * BigInt(100 - discount) / 100n;
		const lazyCost = state.economics.mintPriceLazy * quantity * (100 - discount) / 100;
		const usdcCost = state.economics.mintPriceUsdc * BigInt(quantity) * BigInt(100 - discount) / 100n;

		console.log('\n💵 Total Cost:');
		if (hbarCost > 0) console.log('  HBAR:', Hbar.fromTinybars(hbarCost).toString());
		if (lazyCost > 0) console.log('  LAZY:', lazyCost);
		if (usdcCost > 0) console.log('  USDC:', ethers.formatUnits(usdcCost, 6));

		// Step 5: Check associations and balances
		console.log('\n🔗 Verifying token associations and balances...');

		// Check edition token association
		const editionTokenId = TokenId.fromSolidityAddress(state.editionToken);
		const editionAssociated = await checkTokenAssociation(operatorId, editionTokenId);

		if (!editionAssociated) {
			const associate = readlineSync.keyInYNStrict('Edition token not associated. Associate now?');
			if (associate) {
				console.log('Associating edition token...');
				await associateTokenToAccount(client, operatorId, operatorKey, editionTokenId);
				console.log('✓ Edition token associated');
			}
			else {
				console.log('❌ Cannot mint without token association');
				return;
			}
		}

		// Check LAZY balance and allowance if needed
		if (lazyCost > 0) {
			const lazyTokenId = TokenId.fromSolidityAddress(state.lazyToken);
			const lazyBalance = await checkMirrorBalance(env, operatorId, lazyTokenId);

			if (lazyBalance < lazyCost) {
				console.log(`❌ ERROR: Insufficient LAZY balance. Have: ${lazyBalance}, Need: ${lazyCost}`);
				return;
			}

			console.log('✓ Sufficient LAZY balance');

			// Set allowance
			console.log('Setting LAZY allowance...');
			await setFTAllowance(
				client,
				lazyTokenId,
				operatorId,
				operatorKey,
				contractId,
				lazyCost,
			);
			console.log('✓ LAZY allowance set');
		}

		// Check USDC balance and allowance if needed
		if (usdcCost > 0) {
			const usdcNativeId = TokenId.fromSolidityAddress(state.usdcNative);
			const usdcBridgedId = TokenId.fromSolidityAddress(state.usdcBridged);

			const usdcNativeBalance = await checkMirrorBalance(env, operatorId, usdcNativeId);
			const usdcBridgedBalance = await checkMirrorBalance(env, operatorId, usdcBridgedId);
			const totalUsdcBalance = BigInt(usdcNativeBalance) + BigInt(usdcBridgedBalance);

			if (totalUsdcBalance < usdcCost) {
				console.log(`❌ ERROR: Insufficient USDC balance. Have: ${ethers.formatUnits(totalUsdcBalance, 6)}, Need: ${ethers.formatUnits(usdcCost, 6)}`);
				return;
			}

			console.log('✓ Sufficient USDC balance');

			// Set allowances for both USDC tokens
			if (usdcNativeBalance > 0) {
				console.log('Setting USDC Native allowance...');
				await setFTAllowance(
					client,
					usdcNativeId,
					operatorId,
					operatorKey,
					contractId,
					Math.min(Number(usdcCost), usdcNativeBalance),
				);
				console.log('✓ USDC Native allowance set');
			}

			if (usdcBridgedBalance > 0 && usdcCost > BigInt(usdcNativeBalance)) {
				console.log('Setting USDC Bridged allowance...');
				await setFTAllowance(
					client,
					usdcBridgedId,
					operatorId,
					operatorKey,
					contractId,
					Number(usdcCost - BigInt(usdcNativeBalance)),
				);
				console.log('✓ USDC Bridged allowance set');
			}
		}

		// Check HBAR balance
		if (hbarCost > 0) {
			const hbarBalance = await checkMirrorHbarBalance(env, operatorId);
			const hbarBalanceTinybar = Hbar.from(hbarBalance, 'hbar').toTinybars();

			// Need extra for gas
			// Conservative estimate
			const estimatedGas = 500_000;
			// ~0.05 HBAR
			const gasHbar = BigInt(estimatedGas * 10000000);
			const totalNeeded = hbarCost + gasHbar;

			if (BigInt(hbarBalanceTinybar) < totalNeeded) {
				console.log(`❌ ERROR: Insufficient HBAR balance. Have: ${Hbar.fromTinybars(hbarBalanceTinybar).toString()}, Need: ${Hbar.fromTinybars(totalNeeded).toString()} (including gas)`);
				return;
			}

			console.log('✓ Sufficient HBAR balance');
		}

		// Step 6: Confirm mint
		console.log('\n📝 Minting Summary:');
		console.log('  Quantity:', quantity);
		console.log('  Whitelist:', isWL ? 'Yes' : 'No');
		if (hbarCost > 0) console.log('  HBAR:', Hbar.fromTinybars(hbarCost).toString());
		if (lazyCost > 0) console.log('  LAZY:', lazyCost);
		if (usdcCost > 0) console.log('  USDC:', ethers.formatUnits(usdcCost, 6));

		const proceed = readlineSync.keyInYNStrict('\nProceed with minting?');
		if (!proceed) {
			console.log('❌ Minting cancelled');
			return;
		}

		// Step 7: Estimate gas
		console.log('\n⛽ Estimating gas...');
		const gasEstimate = await estimateGas(
			env,
			contractId,
			abi,
			operatorId,
			'mint',
			[quantity],
			500_000,
			Number(hbarCost),
		);

		console.log(`  Estimated gas: ${gasEstimate.gasLimit.toLocaleString()}`);

		// Step 8: Execute mint
		console.log('\n🚀 Minting editions...');
		const result = await contractExecuteFunction(
			contractId,
			abi,
			client,
			gasEstimate.gasLimit,
			'mint',
			[quantity],
			// Convert to HBAR
			Number(Hbar.fromTinybars(hbarCost).toTinybars()) / 100_000_000,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('❌ ERROR: Mint transaction failed');
			console.log('Status:', result[0]?.status?.toString());
			return;
		}

		console.log('\n✅ Mint successful!');
		console.log('Transaction ID:', result[2]?.transactionId?.toString());

		// Parse events to get minted serials
		try {
			const txReceipt = result[2];
			if (txReceipt && txReceipt.logs) {
				// Look for EditionMintEvent
				console.log('\n📦 Minted Serials:');
				// Note: In production, parse logs to extract serial numbers
				console.log('  Check transaction on HashScan for serial details');
			}
		}
		catch {
			// Silent fail - not critical
		}

		console.log('\n🎉 Editions minted successfully!');
		console.log(`   You now own ${quantity} edition NFT${quantity > 1 ? 's' : ''}`);
		console.log('\n📊 Next Steps:');
		console.log('  - Wait for all editions to sell out');
		console.log('  - Anyone can call selectWinner() after sold out');
		console.log('  - Winners can claim prizes with claimPrize()');

	}
	catch (error) {
		console.error('\n❌ Error during mint:', error.message || error);
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

	// Parse results
	const state = {
		phase: Number(decoded[0]),
		editionToken: decoded[1],
		prizeToken: decoded[2],
		lazyToken: decoded[3],
		usdcNative: decoded[4],
		usdcBridged: decoded[5],
		editionMaxSupply: Number(decoded[6]),
		prizeMaxSupply: Number(decoded[7]),
		editionMinted: Number(decoded[8]),
		prizeMinted: Number(decoded[9]),
		winningSerials: decoded[10].map(s => Number(s)),
		economics: {
			mintPriceHbar: BigInt(decoded[11][0]),
			mintPriceLazy: Number(decoded[11][1]),
			mintPriceUsdc: BigInt(decoded[11][2]),
			wlDiscount: Number(decoded[11][3]),
			maxMintPerTx: Number(decoded[11][4]),
			maxMintPerWallet: Number(decoded[11][5]),
		},
		timing: {
			mintStartTime: Number(decoded[12][0]),
			paused: decoded[12][1],
			wlOnly: decoded[12][2],
		},
	};

	return state;
}

/**
 * Check whitelist status
 */
async function checkWhitelistStatus(accountId) {
	try {
		const encodedCommand = abi.encodeFunctionData('isAddressWL', [
			accountId.toSolidityAddress(),
		]);
		const resultBytes = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const decodedResult = abi.decodeFunctionResult('isAssociated', resultBytes);
		// Returns boolean
		return decodedResult[0];
	}
	catch {
		return false;
	}
}

/**
 * Check if token is associated
 */
async function checkTokenAssociation(accountId, tokenId) {
	try {
		const balance = await checkMirrorBalance(env, accountId, tokenId);
		return balance !== null;
	}
	catch {
		return false;
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
