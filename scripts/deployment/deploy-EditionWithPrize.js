const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { contractDeployFunction } = require('../../utils/solidityHelpers');
require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'EditionWithPrize';

const env = process.env.ENVIRONMENT ?? null;

// Required dependencies - can be passed as args or from .env
let lazyTokenId, lazySCT, prngGeneratorId, lazyDelegateRegistryId, usdcNativeId, usdcBridgedId;
let lazyBurnPercentage;

let client;

/**
 * Display deployment summary
 */
function displaySummary(contractId, contractAddress) {
	console.log('\n===========================================');
	console.log('DEPLOYMENT COMPLETE');
	console.log('===========================================');
	console.log('Contract Name:', contractName);
	console.log('Contract ID:', contractId.toString());
	console.log('Contract Address:', contractAddress);
	console.log('LAZY Token:', lazyTokenId.toString());
	console.log('LAZY SCT:', lazySCT.toString());
	console.log('LAZY Burn %:', lazyBurnPercentage);
	console.log('PRNG Generator:', prngGeneratorId.toString());
	console.log('LazyDelegateRegistry:', lazyDelegateRegistryId.toString());
	console.log('USDC Native:', usdcNativeId.toString());
	console.log('USDC Bridged:', usdcBridgedId.toString());
	console.log('Environment:', env);
	console.log('===========================================');
	console.log('\n📝 Next Steps:');
	console.log('1. Add CONTRACT_ID to your .env file:');
	console.log(`   EDITION_WITH_PRIZE_CONTRACT_ID=${contractId.toString()}`);
	console.log('\n2. Initialize Edition Token:');
	console.log('   node scripts/interactions/EditionWithPrize/admin/initializeEditionToken.js');
	console.log('\n3. Initialize Prize Token:');
	console.log('   node scripts/interactions/EditionWithPrize/admin/initializePrizeToken.js');
	console.log('\n4. Configure economics and timing:');
	console.log('   node scripts/interactions/EditionWithPrize/admin/updateMintEconomics.js');
	console.log('   node scripts/interactions/EditionWithPrize/admin/updateMintTiming.js');
	console.log('\n5. Configure whitelist (optional):');
	console.log('   node scripts/interactions/EditionWithPrize/admin/addToWhitelist.js');
	console.log('   or');
	console.log('   node scripts/interactions/EditionWithPrize/admin/setWlPurchaseOptions.js');
	console.log('\n6. Unpause minting:');
	console.log('   node scripts/interactions/EditionWithPrize/admin/setPause.js');
	console.log('\n7. Test minting:');
	console.log('   node scripts/interactions/EditionWithPrize/mint.js');
	console.log('\n8. After sold out - Select Winners:');
	console.log('   ⚠️  IMPORTANT: Use 2-3x gas estimate if prizeMaxSupply > 1');
	console.log('   node scripts/interactions/EditionWithPrize/selectWinner.js');
	console.log('\n9. Winners claim prizes:');
	console.log('   node scripts/interactions/EditionWithPrize/claimPrize.js');
	console.log('\n===========================================\n');
}

/**
 * Parse command line arguments or read from .env
 */
function loadDependencies() {
	const args = process.argv.slice(2);

	console.log('\n📋 Loading deployment dependencies...');

	// Check for command line args first, then .env
	if (args.length >= 7) {
		// Command line: node deploy-EditionWithPrize.js <lazyToken> <lazySCT> <lazyBurnPerc> <prngGenerator> <delegateRegistry> <usdcNative> <usdcBridged>
		lazyTokenId = TokenId.fromString(args[0]);
		lazySCT = ContractId.fromString(args[1]);
		lazyBurnPercentage = parseInt(args[2]);
		prngGeneratorId = ContractId.fromString(args[3]);
		lazyDelegateRegistryId = ContractId.fromString(args[4]);
		usdcNativeId = TokenId.fromString(args[5]);
		usdcBridgedId = TokenId.fromString(args[6]);
		console.log('✓ Using dependencies from command line arguments');
	}
	else {
		// Load from .env
		if (!process.env.LAZY_TOKEN_ID) {
			console.log('❌ ERROR: LAZY_TOKEN_ID not found in .env file');
			console.log('Please set LAZY_TOKEN_ID=0.0.xxxxx in your .env file');
			console.log('Or pass as argument: node deploy-EditionWithPrize.js <lazyToken> <lazySCT> <lazyBurnPerc> <prngGenerator> <delegateRegistry> <usdcNative> <usdcBridged>');
			process.exit(1);
		}
		if (!process.env.LAZY_SCT_CONTRACT_ID) {
			console.log('❌ ERROR: LAZY_SCT_CONTRACT_ID not found in .env file');
			console.log('Please set LAZY_SCT_CONTRACT_ID=0.0.xxxxx in your .env file');
			process.exit(1);
		}
		if (!process.env.LAZY_BURN_PERCENTAGE) {
			console.log('⚠️  WARNING: LAZY_BURN_PERCENTAGE not found in .env file');
			console.log('Using default: 25%');
			lazyBurnPercentage = 25;
		}
		else {
			lazyBurnPercentage = parseInt(process.env.LAZY_BURN_PERCENTAGE);
		}
		if (!process.env.PRNG_CONTRACT_ID) {
			console.log('❌ ERROR: PRNG_CONTRACT_ID not found in .env file');
			console.log('Please set PRNG_CONTRACT_ID=0.0.xxxxx in your .env file');
			process.exit(1);
		}
		if (!process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			console.log('❌ ERROR: LAZY_DELEGATE_REGISTRY_CONTRACT_ID not found in .env file');
			console.log('Please set LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.xxxxx in your .env file');
			process.exit(1);
		}
		if (!process.env.USDC_NATIVE_TOKEN_ID) {
			console.log('❌ ERROR: USDC_NATIVE_TOKEN_ID not found in .env file');
			console.log('Please set USDC_NATIVE_TOKEN_ID=0.0.xxxxx in your .env file');
			console.log('For testnet: Create a test token with 6 decimals');
			process.exit(1);
		}
		if (!process.env.USDC_BRIDGED_TOKEN_ID) {
			console.log('❌ ERROR: USDC_BRIDGED_TOKEN_ID not found in .env file');
			console.log('Please set USDC_BRIDGED_TOKEN_ID=0.0.xxxxx in your .env file');
			console.log('For testnet: Create a test token with 6 decimals');
			process.exit(1);
		}

		lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
		lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
		prngGeneratorId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
		lazyDelegateRegistryId = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
		usdcNativeId = TokenId.fromString(process.env.USDC_NATIVE_TOKEN_ID);
		usdcBridgedId = TokenId.fromString(process.env.USDC_BRIDGED_TOKEN_ID);
		console.log('✓ Using dependencies from .env file');
	}

	// Validate burn percentage
	if (lazyBurnPercentage < 0 || lazyBurnPercentage > 100) {
		console.log('❌ ERROR: LAZY_BURN_PERCENTAGE must be between 0 and 100');
		process.exit(1);
	}

	console.log('\n📦 Dependency Summary:');
	console.log('  LAZY Token:', lazyTokenId.toString());
	console.log('  LAZY SCT:', lazySCT.toString());
	console.log('  LAZY Burn %:', lazyBurnPercentage);
	console.log('  PRNG Generator:', prngGeneratorId.toString());
	console.log('  LazyDelegateRegistry:', lazyDelegateRegistryId.toString());
	console.log('  USDC Native:', usdcNativeId.toString());
	console.log('  USDC Bridged:', usdcBridgedId.toString());
}

/**
 * Deploy EditionWithPrize contract
 */
async function deployEditionWithPrize() {
	const json = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const contractBytecode = json.bytecode;

	console.log('\n📄 Contract bytecode loaded');
	console.log('  Size:', contractBytecode.length / 2, 'bytes');

	const gasLimit = 7_750_000;

	console.log('\n🚀 Deploying contract...', contractName);
	console.log('  Gas limit:', gasLimit.toLocaleString());

	// Constructor params: (lazyToken, lsct, lazyBurnPerc, prngGenerator, delegateRegistry, usdcNative, usdcBridged)
	const constructorParams = new ContractFunctionParameters()
		.addAddress(lazyTokenId.toSolidityAddress())
		.addAddress(lazySCT.toSolidityAddress())
		.addUint256(lazyBurnPercentage)
		.addAddress(prngGeneratorId.toSolidityAddress())
		.addAddress(lazyDelegateRegistryId.toSolidityAddress())
		.addAddress(usdcNativeId.toSolidityAddress())
		.addAddress(usdcBridgedId.toSolidityAddress());

	const [contractId, contractAddress] = await contractDeployFunction(
		client,
		contractBytecode,
		gasLimit,
		constructorParams,
	);

	console.log('✅ Contract deployed successfully!');
	console.log('  Contract ID:', contractId.toString());
	console.log('  Contract Address:', contractAddress);

	return [contractId, contractAddress];
}

/**
 * Main deployment function
 */
const main = async () => {
	console.log('\n╔═══════════════════════════════════════════╗');
	console.log('║  EditionWithPrize v1.0 Deployment Tool   ║');
	console.log('╚═══════════════════════════════════════════╝');

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());

	if (contractName === undefined || contractName == null) {
		console.log('ERROR: Contract name not defined');
		process.exit(1);
	}
	if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
		console.log('ERROR: Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
		process.exit(1);
	}

	// Load dependencies
	loadDependencies();

	// Confirm deployment
	console.log('\n⚠️  You are about to deploy EditionWithPrize v1.0');
	console.log('\n📋 Key Features:');
	console.log('  • Dual-token system (Edition + Prize NFTs)');
	console.log('  • Multi-payment support (HBAR + LAZY + USDC)');
	console.log('  • Multi-winner support with robust PRNG selection');
	console.log('  • Whitelist management (manual + purchase options)');
	console.log('  • Bearer asset model (winning serials are tradeable)');
	console.log('\n⚠️  IMPORTANT GAS CONSIDERATION:');
	console.log('  If prizeMaxSupply > 1, selectWinner() may require 2-3x gas estimate');
	console.log('  due to potential duplicate handling in PRNG generation.');

	const proceed = readlineSync.keyInYNStrict('\nDo you want to proceed with deployment?');

	if (!proceed) {
		console.log('❌ Deployment cancelled by user');
		process.exit(0);
	}

	// Setup client
	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('\n🌐 Deploying to TESTNET');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('\n🌐 Deploying to MAINNET');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('\n🌐 Deploying to PREVIEWNET');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('\n🌐 Deploying to LOCAL NODE');
	}
	else {
		console.log('❌ ERROR: Must specify either MAIN, TEST, PREVIEW, or LOCAL as environment in .env file');
		process.exit(1);
	}

	client.setOperator(operatorId, operatorKey);

	try {
		// Deploy contract
		const [contractId, contractAddress] = await deployEditionWithPrize();

		// Display summary
		displaySummary(contractId, contractAddress);

		// Save to file for easy reference
		const deploymentInfo = {
			contractName,
			contractId: contractId.toString(),
			contractAddress,
			lazyTokenId: lazyTokenId.toString(),
			lazySCT: lazySCT.toString(),
			lazyBurnPercentage,
			prngGeneratorId: prngGeneratorId.toString(),
			lazyDelegateRegistryId: lazyDelegateRegistryId.toString(),
			usdcNativeId: usdcNativeId.toString(),
			usdcBridgedId: usdcBridgedId.toString(),
			environment: env,
			deployedAt: new Date().toISOString(),
			deployedBy: operatorId.toString(),
		};

		const filename = `deployment-${contractName}-${env}-${Date.now()}.json`;
		fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
		console.log(`\n💾 Deployment info saved to: ${filename}`);

		console.log('\n✅ Deployment process complete!');
		console.log('\n⚠️  NEXT: Initialize both edition and prize tokens before minting can begin.');

	}
	catch (error) {
		console.error('\n❌ Deployment failed:', error);
		process.exit(1);
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
