const {
	AccountId,
	ContractId,
	Hbar,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
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
	console.log('║  EditionWithPrize - Check Mint Cost     ║');
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
		// Get contract state
		console.log('\n📊 Fetching pricing information...');
		const state = await getContractState();

		// Check whitelist status
		const isWL = await checkWhitelistStatus(operatorId);

		console.log('\n💰 Pricing Information:');
		console.log('═══════════════════════════════════════════\n');

		const hbarPrice = BigInt(state.economics.mintPriceHbar);
		const lazyPrice = Number(state.economics.mintPriceLazy);
		const usdcPrice = BigInt(state.economics.mintPriceUsdc);
		const wlDiscount = Number(state.economics.wlDiscount);

		console.log('Base Price Per Edition:');
		console.log(`  HBAR: ${hbarPrice > 0 ? Hbar.fromTinybars(hbarPrice).toString() : 'FREE'}`);
		console.log(`  LAZY: ${lazyPrice > 0 ? lazyPrice : 'FREE'}`);
		console.log(`  USDC: ${usdcPrice > 0 ? ethers.formatUnits(usdcPrice, 6) : 'FREE'}`);

		console.log('\nYour Status:');
		console.log(`  Whitelisted: ${isWL ? '✅ YES' : '❌ NO'}`);

		if (isWL && wlDiscount > 0) {
			console.log(`  Discount: ${wlDiscount}%`);

			const hbarDiscounted = hbarPrice * BigInt(100 - wlDiscount) / 100n;
			const lazyDiscounted = Math.floor(lazyPrice * (100 - wlDiscount) / 100);
			const usdcDiscounted = usdcPrice * BigInt(100 - wlDiscount) / 100n;

			console.log('\nYour Price Per Edition:');
			if (hbarPrice > 0) {
				console.log(`  HBAR: ${Hbar.fromTinybars(hbarDiscounted).toString()} (save ${Hbar.fromTinybars(hbarPrice - hbarDiscounted).toString()})`);
			}
			if (lazyPrice > 0) {
				console.log(`  LAZY: ${lazyDiscounted} (save ${lazyPrice - lazyDiscounted})`);
			}
			if (usdcPrice > 0) {
				console.log(`  USDC: ${ethers.formatUnits(usdcDiscounted, 6)} (save ${ethers.formatUnits(usdcPrice - usdcDiscounted, 6)})`);
			}
		}

		// Calculate for quantity
		console.log('\n───────────────────────────────────────────');
		const quantity = parseInt(readlineSync.question('\nHow many editions? (enter quantity): '));

		if (quantity < 1 || isNaN(quantity)) {
			console.log('❌ Invalid quantity');
			return;
		}

		const discount = isWL ? wlDiscount : 0;
		const totalHbar = hbarPrice * BigInt(quantity) * BigInt(100 - discount) / 100n;
		const totalLazy = Math.floor(lazyPrice * quantity * (100 - discount) / 100);
		const totalUsdc = usdcPrice * BigInt(quantity) * BigInt(100 - discount) / 100n;

		console.log(`\n💵 Total Cost for ${quantity} Edition(s):`);
		console.log('═══════════════════════════════════════════');
		if (hbarPrice > 0) {
			console.log(`  HBAR: ${Hbar.fromTinybars(totalHbar).toString()}`);
		}
		if (lazyPrice > 0) {
			console.log(`  LAZY: ${totalLazy}`);
		}
		if (usdcPrice > 0) {
			console.log(`  USDC: ${ethers.formatUnits(totalUsdc, 6)}`);
		}

		if (isWL && wlDiscount > 0) {
			const fullHbar = hbarPrice * BigInt(quantity);
			const fullLazy = lazyPrice * quantity;
			const fullUsdc = usdcPrice * BigInt(quantity);

			console.log(`\n💰 Total Savings (${wlDiscount}% discount):`);
			if (hbarPrice > 0) {
				console.log(`  HBAR: ${Hbar.fromTinybars(fullHbar - totalHbar).toString()}`);
			}
			if (lazyPrice > 0) {
				console.log(`  LAZY: ${fullLazy - totalLazy}`);
			}
			if (usdcPrice > 0) {
				console.log(`  USDC: ${ethers.formatUnits(fullUsdc - totalUsdc, 6)}`);
			}
		}

		console.log('\n📋 Additional Info:');
		console.log(`  Editions Available: ${state.editionMaxSupply - state.editionMinted} / ${state.editionMaxSupply}`);
		if (state.economics.maxMintPerTx > 0) {
			console.log(`  Max Per Transaction: ${state.economics.maxMintPerTx}`);
		}
		if (state.economics.maxMintPerWallet > 0) {
			console.log(`  Max Per Wallet: ${state.economics.maxMintPerWallet}`);
		}

		console.log('\n🎫 Ready to mint?');
		console.log('   Run: node scripts/interactions/EditionWithPrize/mint.js');

	}
	catch (error) {
		console.error('\n❌ Error checking mint cost:', error.message || error);
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

	return {
		editionMaxSupply: Number(decoded[6]),
		editionMinted: Number(decoded[8]),
		economics: {
			mintPriceHbar: BigInt(decoded[11][0]),
			mintPriceLazy: Number(decoded[11][1]),
			mintPriceUsdc: BigInt(decoded[11][2]),
			wlDiscount: Number(decoded[11][3]),
			maxMintPerTx: Number(decoded[11][4]),
			maxMintPerWallet: Number(decoded[11][5]),
		},
	};
}

/**
 * Check whitelist status
 */
async function checkWhitelistStatus(accountId) {
	try {
		const encodedCommand = abi.encodeFunctionData('isAddressWL', [
			accountId.toSolidityAddress(),
		]);
		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const decoded = abi.decodeFunctionResult('isAddressWL', result);
		return decoded[0];
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
