const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	TokenId,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const {
	contractDeployFunction,
	readOnlyEVMFromMirrorNode,
	contractExecuteFunction,
} = require('../utils/solidityHelpers');
const { sleep } = require('../utils/nodeHelpers');
const {
	accountCreator,
	associateTokenToAccount,
	mintFT,
	mintNFT,
	sendFT,
	setFTAllowance,
	sweepHbar,
	sendNFT,
	clearFTAllowances,
	associateTokensToAccount,
} = require('../utils/hederaHelpers');
const { checkMirrorBalance, getSerialsOwned, checkMirrorHbarBalance, getTokenDetails } = require('../utils/hederaMirrorHelpers');
const { fail } = require('assert');
const { ethers } = require('ethers');
const { estimateGas } = require('../utils/gasHelpers');

require('dotenv').config();

// ⚠️ IMPORTANT: Create USDC test tokens with 6 decimals to match production behavior

// Get operator from .env file
let operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
let operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'EditionWithPrize';
const lazyContractCreator = 'FungibleTokenCreator';
const prngContractName = 'PrngGenerator';
const env = process.env.ENVIRONMENT ?? null;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// Test Constants
const EDITION_MAX_SUPPLY = 10;
const PRIZE_MAX_SUPPLY = 3;
const MINT_PRICE_HBAR = Hbar.fromTinybars(100_000_000);
const MINT_PRICE_LAZY = 100;
const MINT_PRICE_USDC = ethers.parseUnits('5', 6);
const WL_DISCOUNT_PERCENT = 25;
const LAZY_BURN_PERCENT = 25;

let contractId, contractAddress;
let client;
let alicePK, aliceId, bobPK, bobId, carolPK, carolId;
let wlUser1PK, wlUser1Id, wlUser2PK, wlUser2Id;

// Token IDs
let lazyTokenId, lazySCT, lazyDelegateRegistry;
let usdcNativeId, usdcBridgedId;
let wlTokenId;
let editionTokenId, prizeTokenId;
let prngGenerator;

// Interface objects
let minterIface, lazyIface;

const createdAccounts = [];
const lazyAllowancesSet = [];
const usdcAllowancesSet = [];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('Deployment & Setup:', function () {
	it('Should deploy dependencies and setup test conditions', async function () {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for the test');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID for the test');
			process.exit(1);
		}

		console.log('\n-Using ENVIRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			console.log('testing in *PREVIEWNET*');
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('testing in *LOCAL*');
			const rootId = AccountId.fromString('0.0.2');
			const rootKey = PrivateKey.fromString('302e020100300506032b6570042204203b054fade7a2b0869c6bd4a63b7017cbae7855d12acc357bea718e2c3e805962c');
			client.setOperator(rootId, rootKey);
			operatorId = rootId;
			operatorKey = rootKey;
		}

		client.setOperator(operatorId, operatorKey);
		console.log('\n-Using Operator:', operatorId.toString());

		// Create test accounts: Alice, Bob, Carol, WL users
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(client, alicePK, 15);
		createdAccounts.push({ id: aliceId, key: alicePK });
		console.log('Alice account ID:', aliceId.toString());

		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(client, bobPK, 15);
		createdAccounts.push({ id: bobId, key: bobPK });
		console.log('Bob account ID:', bobId.toString());

		carolPK = PrivateKey.generateED25519();
		carolId = await accountCreator(client, carolPK, 15);
		createdAccounts.push({ id: carolId, key: carolPK });
		console.log('Carol account ID:', carolId.toString());

		wlUser1PK = PrivateKey.generateED25519();
		wlUser1Id = await accountCreator(client, wlUser1PK, 15);
		createdAccounts.push({ id: wlUser1Id, key: wlUser1PK });
		console.log('WL User 1 account ID:', wlUser1Id.toString());

		wlUser2PK = PrivateKey.generateED25519();
		wlUser2Id = await accountCreator(client, wlUser2PK, 15);
		createdAccounts.push({ id: wlUser2Id, key: wlUser2PK });
		console.log('WL User 2 account ID:', wlUser2Id.toString());

		// Deploy or reuse LAZY token
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);
		lazyIface = new ethers.Interface(lazyJson.abi);

		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			console.log('\n-Using existing LAZY:', lazyTokenId.toString());
			console.log('-Using existing LSCT:', lazySCT.toString());
		}
		else {
			console.log('\n-Deploying LAZY token and SCT...');
			const lazyConstructorParams = new ContractFunctionParameters()
				.addUint256(LAZY_BURN_PERCENT);

			[lazySCT] = await contractDeployFunction(
				client,
				lazyJson.bytecode,
				3_500_000,
				lazyConstructorParams,
			);

			console.log('\nLazy SCT deployed:', lazySCT.toString());

			const mintLazyResult = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				800_000,
				'createFungibleWithBurn',
				[
					'LAZY',
					'$LAZY',
					'Lazy Superheroes Token',
					LAZY_MAX_SUPPLY,
					LAZY_DECIMAL,
					LAZY_MAX_SUPPLY,
				],
				MINT_PAYMENT,
			);

			if (mintLazyResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('LAZY token creation failed:', mintLazyResult[0]?.status?.toString());
				fail('LAZY token creation failed');
			}

			lazyTokenId = TokenId.fromSolidityAddress(mintLazyResult[1][0]);
			console.log('LAZY Token created:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;

		// Create USDC test tokens with 6 decimals

		if (process.env.USDC_NATIVE_TOKEN_ID) {
			usdcNativeId = TokenId.fromString(process.env.USDC_NATIVE_TOKEN_ID);
			console.log('\n-Using existing USDC Native:', usdcNativeId.toString());
		}
		else {
			console.log('\n-Creating USDC test tokens (6 decimals)...');

			const usdcNativeResult = await mintFT(
				client,
				operatorId,
				null,
				1_000_000_000_000,
				'USDC Native Test',
				'USDC',
				6,
			);

			if (usdcNativeResult[0] !== 'SUCCESS') {
				console.log('USDC Native creation failed:', usdcNativeResult[0]);
				fail('USDC Native creation failed');
			}

			usdcNativeId = usdcNativeResult[1];
			console.log('USDC Native Token created:', usdcNativeId.toString());
		}

		if (process.env.USDC_BRIDGED_TOKEN_ID) {
			usdcBridgedId = TokenId.fromString(process.env.USDC_BRIDGED_TOKEN_ID);
			console.log('\n-Using existing USDC Bridged:', usdcBridgedId.toString());
		}
		else {
			const usdcBridgedResult = await mintFT(
				client,
				operatorId,
				null,
				1_000_000_000_000,
				'USDC Bridged Test',
				'USDCB',
				6,
			);

			if (usdcBridgedResult[0] !== 'SUCCESS') {
				console.log('USDC Bridged creation failed:', usdcBridgedResult[0]);
				fail('USDC Bridged creation failed');
			}

			usdcBridgedId = usdcBridgedResult[1];
			console.log('USDC Bridged Token created:', usdcBridgedId.toString());
		}

		// Deploy PRNG Generator
		const prngJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${prngContractName}.sol/${prngContractName}.json`,
			),
		);

		if (process.env.PRNG_CONTRACT_ID) {
			prngGenerator = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
			console.log('\n-Using existing PRNG:', prngGenerator.toString());
		}
		else {
			console.log('\n-Deploying PRNG Generator...');
			[prngGenerator] = await contractDeployFunction(
				client,
				prngJson.bytecode,
				1_800_000,
			);
			console.log('PRNG Generator deployed:', prngGenerator.toString());
		}

		expect(prngGenerator.toString().match(addressRegex).length == 2).to.be.true;

		// Deploy LazyDelegateRegistry
		const lazyDelegateRegistryName = 'LazyDelegateRegistry';
		const lazyDelegateRegistryJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
			),
		);

		if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			lazyDelegateRegistry = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
			console.log('\n-Using existing Lazy Delegate Registry:', lazyDelegateRegistry.toString());
		}
		else {
			console.log('\n-Deploying Lazy Delegate Registry...');
			[lazyDelegateRegistry] = await contractDeployFunction(
				client,
				lazyDelegateRegistryJson.bytecode,
				2_100_000,
			);
			console.log('Lazy Delegate Registry deployed:', lazyDelegateRegistry.toString());
		}

		expect(lazyDelegateRegistry.toString().match(addressRegex).length == 2).to.be.true;

		// Ensure operator has tokens
		const operatorLazyBal = await checkMirrorBalance(env, operatorId, lazyTokenId);
		if (!operatorLazyBal || operatorLazyBal < 1000) {
			console.log('\n-Operator needs LAZY, drawing from creator');
			const drawResult = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				300_000,
				'transferHTS',
				[lazyTokenId.toSolidityAddress(), operatorId.toSolidityAddress(), 5000],
			);
			if (drawResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('LAZY draw FAILED:', drawResult);
				fail();
			}
			console.log('Drew 5000 LAZY to operator');
		}


		// to avoid race conditions with the mirror node post token create
		await sleep(4000);

		// Associate tokens to test accounts
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: wlUser1Id, key: wlUser1PK },
			{ id: wlUser2Id, key: wlUser2PK },
		];

		for (const account of testAccounts) {
			// Associate tokens
			const assocResult = await associateTokensToAccount(client, account.id, account.key, [lazyTokenId, usdcNativeId, usdcBridgedId]);
			expect(assocResult).to.be.equal('SUCCESS');
			console.log(`Associated tokens to ${account.id.toString()}`);
		}

		// Send tokens to test accounts
		for (const account of testAccounts) {
			// Send LAZY tokens
			let result = await sendLazy(account.id, 1000);
			if (result !== 'SUCCESS') {
				console.log(`LAZY send failed for ${account.id.toString()}:`, result);
				fail('LAZY send failed');
			}

			// Send USDC tokens
			result = await sendUsdc(account.id, usdcNativeId, 100 * 10 ** 6);
			if (result !== 'SUCCESS') {
				console.log(`USDC Native send failed for ${account.id.toString()}:`, result);
				fail('USDC Native send failed');
			}

			result = await sendUsdc(account.id, usdcBridgedId, 100 * 10 ** 6);
			if (result !== 'SUCCESS') {
				console.log(`USDC Bridged send failed for ${account.id.toString()}:`, result);
				fail('USDC Bridged send failed');
			}
		}

		console.log('\n-Dependency deployment complete');
	});

	it('Should create WL purchase token (10 NFTs)', async function () {
		client.setOperator(operatorId, operatorKey);

		if (process.env.WL_TOKEN_ID) {
			wlTokenId = TokenId.fromString(process.env.WL_TOKEN_ID);
			console.log('\n-Using existing WL Token:', wlTokenId.toString());
		}
		else {
			const result = await mintNFT(
				client,
				operatorId,
				'EditionWithPrize WL Token ' + new Date().toISOString(),
				'EPWL',
				10,
				MINT_PAYMENT,
			);

			if (result[0] !== 'SUCCESS') {
				console.log('WL token creation failed:', result[0]);
				fail('WL token creation failed');
			}

			wlTokenId = result[1];
			console.log('\n-WL Token minted:', wlTokenId.toString(), '(10 serials)');
			expect(wlTokenId.toString().match(addressRegex).length == 2).to.be.true;
		}

		// Associate WL token to test accounts
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: wlUser1Id, key: wlUser1PK },
			{ id: wlUser2Id, key: wlUser2PK },
		];

		for (const account of testAccounts) {
			const assocResult = await associateTokenToAccount(client, account.id, account.key, wlTokenId);
			if (assocResult !== 'SUCCESS') {
				console.log(`WL token association failed for ${account.id.toString()}:`, assocResult);
				fail('WL token association failed');
			}
		}

		// Send some WL tokens to test users
		const sendResult1 = await sendNFT(client, operatorId, operatorKey, wlUser1Id, wlTokenId, 1);
		if (sendResult1 !== 'SUCCESS') {
			console.log('WL token send to wlUser1 failed:', sendResult1);
			fail('WL token send failed');
		}

		const sendResult2 = await sendNFT(client, operatorId, operatorKey, wlUser2Id, wlTokenId, 2);
		if (sendResult2 !== 'SUCCESS') {
			console.log('WL token send to wlUser2 failed:', sendResult2);
			fail('WL token send failed');
		}
	});

	it('Should deploy EditionWithPrize contract', async function () {
		client.setOperator(operatorId, operatorKey);

		const json = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
			),
		);

		const contractBytecode = json.bytecode;
		minterIface = new ethers.Interface(json.abi);

		const gasLimit = 7_750_000;

		console.log('\n-Deploying contract...', contractName, '\n\tgas@', gasLimit);

		// Constructor params: (lazyToken, lsct, lazyBurnPerc, prngGenerator, delegateRegistry, usdcNative, usdcBridged)
		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazySCT.toSolidityAddress())
			.addUint256(LAZY_BURN_PERCENT)
			.addAddress(prngGenerator.toSolidityAddress())
			.addAddress(lazyDelegateRegistry.toSolidityAddress())
			.addAddress(usdcNativeId.toSolidityAddress())
			.addAddress(usdcBridgedId.toSolidityAddress());

		[contractId, contractAddress] = await contractDeployFunction(
			client,
			contractBytecode,
			gasLimit,
			constructorParams,
		);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);
		console.log('\n-Testing:', contractName);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;
	});
});

describe('Constructor & Initial State Verification:', function () {
	it('Should verify immutable variables set correctly', async function () {
		client.setOperator(operatorId, operatorKey);

		// let the mirror node catch up
		await sleep(6000);

		// Check PRNG Generator
		let encodedCommand = minterIface.encodeFunctionData('PRNG_GENERATOR');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prngAddr = minterIface.decodeFunctionResult('PRNG_GENERATOR', result);
		expect(prngAddr[0].slice(2).toLowerCase()).to.be.equal(prngGenerator.toSolidityAddress());

		// Check Lazy Delegate Registry
		encodedCommand = minterIface.encodeFunctionData('LAZY_DELEGATE_REGISTRY');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const delegateAddr = minterIface.decodeFunctionResult('LAZY_DELEGATE_REGISTRY', result);
		expect(delegateAddr[0].slice(2).toLowerCase()).to.be.equal(lazyDelegateRegistry.toSolidityAddress());

		// Check USDC Native
		encodedCommand = minterIface.encodeFunctionData('USDC_NATIVE');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const usdcNativeAddr = minterIface.decodeFunctionResult('USDC_NATIVE', result);
		expect(usdcNativeAddr[0].slice(2).toLowerCase()).to.be.equal(usdcNativeId.toSolidityAddress());

		// Check USDC Bridged
		encodedCommand = minterIface.encodeFunctionData('USDC_BRIDGED');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const usdcBridgedAddr = minterIface.decodeFunctionResult('USDC_BRIDGED', result);
		expect(usdcBridgedAddr[0].slice(2).toLowerCase()).to.be.equal(usdcBridgedId.toSolidityAddress());
	});

	it('Should verify deployer is owner', async function () {
		client.setOperator(operatorId, operatorKey);

		const encodedCommand = minterIface.encodeFunctionData('owner');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const owner = minterIface.decodeFunctionResult('owner', result);
		expect(owner[0].slice(2).toLowerCase()).to.be.equal(operatorId.toEvmAddress());
	});

	it('Should verify default state values', async function () {
		client.setOperator(operatorId, operatorKey);

		// Check current phase (should be NOT_INITIALIZED)
		let encodedCommand = minterIface.encodeFunctionData('currentPhase');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const phase = minterIface.decodeFunctionResult('currentPhase', result);
		expect(Number(phase[0])).to.be.equal(0);

		// Check edition token is zero address
		encodedCommand = minterIface.encodeFunctionData('editionToken');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const editionToken = minterIface.decodeFunctionResult('editionToken', result);
		expect(editionToken[0]).to.be.equal(ZERO_ADDRESS);

		// Check prize token is zero address
		encodedCommand = minterIface.encodeFunctionData('prizeToken');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prizeToken = minterIface.decodeFunctionResult('prizeToken', result);
		expect(prizeToken[0]).to.be.equal(ZERO_ADDRESS);

		// Check edition minted is 0
		encodedCommand = minterIface.encodeFunctionData('editionMinted');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const editionMinted = minterIface.decodeFunctionResult('editionMinted', result);
		expect(Number(editionMinted[0])).to.be.equal(0);

		// Check prize minted is 0
		encodedCommand = minterIface.encodeFunctionData('prizeMinted');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prizeMinted = minterIface.decodeFunctionResult('prizeMinted', result);
		expect(Number(prizeMinted[0])).to.be.equal(0);
	});
});

describe('Token Initialization:', function () {
	it('Should initialize edition token correctly', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'initializeEditionToken',
			[
				'Test Edition Collection',
				'TEC',
				'Edition NFTs for testing',
				'ipfs://QmTGxe7GAzV9yWqU2FF6L2jGAyVJW51tCN7396oDSCSofX/LSH-silver-S1.json',
				EDITION_MAX_SUPPLY,
				[],
			],
			400_000,
			Number(new Hbar(MINT_PAYMENT).toTinybars()),
		);


		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'initializeEditionToken',
			[
				'Test Edition Collection',
				'TEC',
				'Edition NFTs for testing',
				'ipfs://QmTGxe7GAzV9yWqU2FF6L2jGAyVJW51tCN7396oDSCSofX/LSH-silver-S1.json',
				EDITION_MAX_SUPPLY,
				[],
			],
			MINT_PAYMENT,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('\n=== EDITION TOKEN INITIALIZATION FAILED ===');
			console.log('Result array:', result);

			fail('Edition token initialization failed');
		}

		console.log('-Edition Token Initialization tx:', result[2]?.transactionId?.toString());

		editionTokenId = TokenId.fromSolidityAddress(result[1][0]);
		console.log('\n-Edition Token Created:', editionTokenId.toString());
		expect(editionTokenId.toString().match(addressRegex).length == 2).to.be.true;

		// Wait for mirror node
		await sleep(5000);

		// Verify edition token address is set
		const encodedCommand = minterIface.encodeFunctionData('editionToken');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const tokenAddr = minterIface.decodeFunctionResult('editionToken', queryResult);
		expect(tokenAddr[0].slice(2).toLowerCase()).to.be.equal(editionTokenId.toSolidityAddress());

		// Verify max supply
		const maxSupplyCommand = minterIface.encodeFunctionData('editionMaxSupply');
		const maxSupplyResult = await readOnlyEVMFromMirrorNode(env, contractId, maxSupplyCommand, operatorId, false);
		const maxSupply = minterIface.decodeFunctionResult('editionMaxSupply', maxSupplyResult);
		expect(Number(maxSupply[0])).to.be.equal(EDITION_MAX_SUPPLY);

		// Phase should still be NOT_INITIALIZED (prize token not created yet)
		const phaseCommand = minterIface.encodeFunctionData('currentPhase');
		const phaseResult = await readOnlyEVMFromMirrorNode(env, contractId, phaseCommand, operatorId, false);
		const phase = minterIface.decodeFunctionResult('currentPhase', phaseResult);
		expect(Number(phase[0])).to.be.equal(0);
	});

	it('Should initialize prize token correctly', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'initializePrizeToken',
			[
				'Test Prize Collection',
				'TPC',
				'Prize NFTs for testing',
				'ipfs://QmTGxe7GAzV9yWqU2FF6L2jGAyVJW51tCN7396oDSCSofX/LSH-gold-S1.json',
				PRIZE_MAX_SUPPLY,
				[],
			],
			400_000,
			Number(new Hbar(MINT_PAYMENT).toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'initializePrizeToken',
			[
				'Test Prize Collection',
				'TPC',
				'Prize NFTs for testing',
				'ipfs://QmTGxe7GAzV9yWqU2FF6L2jGAyVJW51tCN7396oDSCSofX/LSH-gold-S1.json',
				PRIZE_MAX_SUPPLY,
				[],
			],
			MINT_PAYMENT,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Prize token initialization failed:', result[0]?.status?.toString());
			fail('Prize token initialization failed');
		}

		console.log('-Prize Token Initialization tx:', result[2]?.transactionId?.toString());

		console.log('Result array:', result[1]);

		prizeTokenId = TokenId.fromSolidityAddress(result[1][0]);
		console.log('\n-Prize Token Created:', prizeTokenId.toString());
		expect(prizeTokenId.toString().match(addressRegex).length == 2).to.be.true;

		// Wait for mirror node
		await sleep(5000);

		// Verify prize token address is set
		const encodedCommand = minterIface.encodeFunctionData('prizeToken');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const tokenAddr = minterIface.decodeFunctionResult('prizeToken', queryResult);
		expect(tokenAddr[0].slice(2).toLowerCase()).to.be.equal(prizeTokenId.toSolidityAddress());

		// Verify max supply
		const maxSupplyCommand = minterIface.encodeFunctionData('prizeMaxSupply');
		const maxSupplyResult = await readOnlyEVMFromMirrorNode(env, contractId, maxSupplyCommand, operatorId, false);
		const maxSupply = minterIface.decodeFunctionResult('prizeMaxSupply', maxSupplyResult);
		expect(Number(maxSupply[0])).to.be.equal(PRIZE_MAX_SUPPLY);

		// Phase should now be INITIALIZED
		const phaseCommand = minterIface.encodeFunctionData('currentPhase');
		const phaseResult = await readOnlyEVMFromMirrorNode(env, contractId, phaseCommand, operatorId, false);
		const phase = minterIface.decodeFunctionResult('currentPhase', phaseResult);
		expect(Number(phase[0])).to.be.equal(1);
	});

	it('Should prevent double initialization', async function () {
		client.setOperator(operatorId, operatorKey);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'initializeEditionToken',
			[
				'Another Edition',
				'AE',
				'This should fail',
				'ipfs://fail/',
				10,
				[],
			],
			1_200_000,
			Number(new Hbar(MINT_PAYMENT).toTinybars()),
		);

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasEstimate.gasLimit,
				'initializeEditionToken',
				[
					'Another Edition',
					'AE',
					'This should fail',
					'ipfs://fail/',
					10,
					[],
				],
				MINT_PAYMENT,
			);

			if (result[0]?.status?.name != 'InvalidPhase') {
				console.log('Expected failure but got:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('Configuration & Economics Setup:', function () {
	it('Should configure mint economics', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateMintCost',
			[
				MINT_PRICE_HBAR.toTinybars().toString(),
				MINT_PRICE_LAZY,
				MINT_PRICE_USDC.toString(),
			],
			600_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'updateMintCost',
			[
				MINT_PRICE_HBAR.toTinybars().toString(),
				MINT_PRICE_LAZY,
				MINT_PRICE_USDC.toString(),
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Mint cost update failed:', result[0]?.status?.toString());
			fail('Mint cost update failed');
		}

		console.log('-Mint costs updated tx:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Verify costs were set using view function
		const encodedCommand = minterIface.encodeFunctionData('getMintCost');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const costs = minterIface.decodeFunctionResult('getMintCost', queryResult);

		console.log('-Mint costs retrieved:', costs);

		expect(costs[0].toString()).to.be.equal(MINT_PRICE_HBAR.toTinybars().toString());
		expect(costs[1].toString()).to.be.equal(MINT_PRICE_LAZY.toString());
		expect(costs[2].toString()).to.be.equal(MINT_PRICE_USDC.toString());
	});

	it('Should verify getEconomics and getTiming methods', async function () {
		client.setOperator(operatorId, operatorKey);

		// Test getEconomics
		let encodedCommand = minterIface.encodeFunctionData('getEconomics');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getEconomics', result);

		console.log('-Economics retrieved:', economics);
		expect(economics[0].mintPriceHbar.toString()).to.be.equal(MINT_PRICE_HBAR.toTinybars().toString());
		expect(economics[0].mintPriceLazy.toString()).to.be.equal(MINT_PRICE_LAZY.toString());
		expect(economics[0].mintPriceUsdc.toString()).to.be.equal(MINT_PRICE_USDC.toString());

		// Test getTiming
		encodedCommand = minterIface.encodeFunctionData('getTiming');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const timing = minterIface.decodeFunctionResult('getTiming', result);

		console.log('-Timing retrieved:', timing);
		expect(timing[0][2]).to.be.true;
	});

	it('Should configure whitelist discount', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'setWhitelistDiscount',
			[WL_DISCOUNT_PERCENT],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'setWhitelistDiscount',
			[WL_DISCOUNT_PERCENT],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('WL discount update failed:', result[0]?.status?.toString());
			fail('WL discount update failed');
		}

		console.log('-WL discount updated tx:', result[2]?.transactionId?.toString());
	});

	it('Should set mint timing', async function () {
		client.setOperator(operatorId, operatorKey);

		const currentTime = Math.floor(Date.now() / 1000);
		const startTime = currentTime + 10;

		// estimate gas here
		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'setMintStartTime',
			[startTime],
			400_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'setMintStartTime',
			[startTime],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Mint start time update failed:', result[0]?.status?.toString());
			fail('Mint start time update failed');
		}

		console.log('-Mint start time set tx:', result[2]?.transactionId?.toString());
	});

	it('Should unpause minting', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'setPaused',
			[false],
			400_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'setPaused',
			[false],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Unpause failed:', result[0]?.status?.toString());
			fail('Unpause failed');
		}

		console.log('-Contract unpaused tx:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Verify phase transitioned to EDITION_MINTING
		const phaseCommand = minterIface.encodeFunctionData('currentPhase');
		const phaseResult = await readOnlyEVMFromMirrorNode(env, contractId, phaseCommand, operatorId, false);
		const phase = minterIface.decodeFunctionResult('currentPhase', phaseResult);
		expect(Number(phase[0])).to.be.equal(1);

		// verify pause status is false
		const pauseCommand = minterIface.encodeFunctionData('isPaused');
		const pauseResult = await readOnlyEVMFromMirrorNode(env, contractId, pauseCommand, operatorId, false);
		const isPaused = minterIface.decodeFunctionResult('isPaused', pauseResult);
		expect(isPaused[0]).to.be.false;
	});
});

describe('Token Association & Allowances:', function () {
	it('Should associate edition and prize tokens to test accounts', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: wlUser1Id, key: wlUser1PK },
			{ id: wlUser2Id, key: wlUser2PK },
		];

		for (const account of testAccounts) {
			client.setOperator(account.id, account.key);

			// Associate edition token
			const assoc = await associateTokensToAccount(client, account.id, account.key, [editionTokenId, prizeTokenId]);
			if (assoc !== 'SUCCESS') {
				console.log(`Token association failed for ${account.id.toString()}:`, assoc);
				fail('Token association failed');
			}
		}
	});

	it('Should set LAZY allowances for test accounts', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: wlUser1Id, key: wlUser1PK },
			{ id: wlUser2Id, key: wlUser2PK },
		];

		for (const account of testAccounts) {
			client.setOperator(account.id, account.key);

			const allowanceResult = await setFTAllowance(
				client,
				lazyTokenId,
				account.id,
				AccountId.fromString(contractId.toString()),
				1000,
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`LAZY allowance failed for ${account.id.toString()}:`, allowanceResult);
				fail('LAZY allowance failed');
			}
			lazyAllowancesSet.push(account);
		}
	});

	it('Should set USDC allowances for test accounts', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: wlUser1Id, key: wlUser1PK },
			{ id: wlUser2Id, key: wlUser2PK },
		];

		for (const account of testAccounts) {
			client.setOperator(account.id, account.key);

			// Set allowance for USDC Native
			let allowanceResult = await setFTAllowance(
				client,
				usdcNativeId,
				account.id,
				AccountId.fromString(contractId.toString()),
				Number(ethers.parseUnits('50', 6).toString()),
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`USDC Native allowance failed for ${account.id.toString()}:`, allowanceResult);
				fail('USDC Native allowance failed');
			}

			// Set allowance for USDC Bridged
			allowanceResult = await setFTAllowance(
				client,
				usdcBridgedId,
				account.id,
				AccountId.fromString(contractId.toString()),
				Number(ethers.parseUnits('50', 6).toString()),
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`USDC Bridged allowance failed for ${account.id.toString()}:`, allowanceResult);
				fail('USDC Bridged allowance failed');
			}

			usdcAllowancesSet.push(account);
		}
	});
});

describe('Whitelist Management:', function () {
	it('Should add addresses to whitelist', async function () {
		client.setOperator(operatorId, operatorKey);

		// lets do the gas estimate here
		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'addToWhitelist',
			[
				[wlUser1Id.toSolidityAddress(), wlUser2Id.toSolidityAddress()],
				[2, 1],
			],
			400_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'addToWhitelist',
			[
				[wlUser1Id.toSolidityAddress(), wlUser2Id.toSolidityAddress()],
				[2, 1],
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Whitelist addition failed:', result[0]?.status?.toString());
			fail('Whitelist addition failed');
		}

		console.log('-Whitelist addition tx:', result[2]?.transactionId?.toString());

		console.log('\n-Added wlUser1 and wlUser2 to whitelist');
	});

	it('Should verify whitelist eligibility', async function () {
		await sleep(5000);

		// Check wlUser1 eligibility
		let encodedCommand = minterIface.encodeFunctionData('getWhitelistStatus', [wlUser1Id.toSolidityAddress()]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		let slots = minterIface.decodeFunctionResult('getWhitelistStatus', result);
		console.log('-wlUser1 whitelist status slots:', slots);
		expect(Number(slots[3])).to.be.equal(2);

		// Check wlUser2 eligibility
		encodedCommand = minterIface.encodeFunctionData('getWhitelistStatus', [wlUser2Id.toSolidityAddress()]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		slots = minterIface.decodeFunctionResult('getWhitelistStatus', result);
		expect(Number(slots[3])).to.be.equal(1);

		// Check non-WL user (Alice)
		encodedCommand = minterIface.encodeFunctionData('getWhitelistStatus', [aliceId.toSolidityAddress()]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		slots = minterIface.decodeFunctionResult('getWhitelistStatus', result);
		expect(Number(slots[3])).to.be.equal(0);
	});
});

describe('Basic Minting Tests:', function () {
	it('Should wait for mint start time', async function () {
		console.log('\n-Waiting for mint start time...');
		await sleep(5000);
	});

	it('Should mint with combined payment (HBAR + LAZY + USDC) - non-WL', async function () {
		client.setOperator(aliceId, alicePK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			aliceId,
			'mint',
			[1],
			800_000,
			Number(MINT_PRICE_HBAR.toTinybars().toString()),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'mint',
			[1],
			MINT_PRICE_HBAR,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Combined payment mint failed:', result);
			fail('Combined payment mint failed');
		}

		console.log('-Combined payment mint tx:', result[2]?.transactionId?.toString());

		const mintedSerial = Number(result[1][0]);
		console.log('\n-Alice minted edition serial:', mintedSerial, '(paid 1 HBAR + 10 LAZY + 5 USDC)');
		expect(mintedSerial).to.be.equal(1);

		// Wait for mirror node
		await sleep(6000);

		// Verify Alice owns the NFT
		const aliceSerials = await getSerialsOwned(env, aliceId, editionTokenId);
		expect(aliceSerials.includes(mintedSerial)).to.be.true;

		// Check phase is still EDITION_MINTING
		const phaseCommand = minterIface.encodeFunctionData('currentPhase');
		const phaseResult = await readOnlyEVMFromMirrorNode(env, contractId, phaseCommand, operatorId, false);
		const phase = minterIface.decodeFunctionResult('currentPhase', phaseResult);
		expect(Number(phase[0])).to.be.equal(1);
	});

	it('Should mint with combined payment (HBAR + LAZY + USDC) - Bob', async function () {
		client.setOperator(bobId, bobPK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			bobId,
			'mint',
			[1],
			800_000,
			Number(MINT_PRICE_HBAR.toTinybars().toString()),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'mint',
			[1],
			MINT_PRICE_HBAR,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Combined payment mint failed:', result);
			fail('Combined payment mint failed');
		}

		console.log('-Combined payment mint tx:', result[2]?.transactionId?.toString());

		const mintedSerial = Number(result[1][0]);
		console.log('\n-Bob minted edition serial:', mintedSerial, '(paid 1 HBAR + 10 LAZY + 5 USDC)');
		expect(mintedSerial).to.be.equal(2);
	});

	it('Should mint with combined payment (HBAR + LAZY + USDC) - Carol', async function () {
		client.setOperator(carolId, carolPK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			carolId,
			'mint',
			[1],
			800_000,
			Number(MINT_PRICE_HBAR.toTinybars().toString()),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'mint',
			[1],
			MINT_PRICE_HBAR,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Combined payment mint failed:', result);
			fail('Combined payment mint failed');
		}

		const mintedSerial = Number(result[1][0]);
		console.log('\n-Carol minted edition serial:', mintedSerial, '(paid 1 HBAR + 10 LAZY + 5 USDC)');
		expect(mintedSerial).to.be.equal(3);
	});

	it('Should mint with WL discount (25% off all payment types)', async function () {
		client.setOperator(wlUser1Id, wlUser1PK);

		// WL discount applies to ALL payment types: HBAR, LAZY, and USDC
		const expectedDiscountedHbarTotal = Math.floor(MINT_PRICE_HBAR.toTinybars() * 0.75 * 2);

		// get the cost from the contract to verify using calculateMintCost
		const encodedCommand = minterIface.encodeFunctionData('calculateMintCost', [2, wlUser1Id.toSolidityAddress()]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const costs = minterIface.decodeFunctionResult('calculateMintCost', queryResult);

		console.log('-Calculated mint costs for wlUser1 minting 2 editions with WL discount:', costs);

		const discountedHbarTotal = Number(costs[0]);
		expect(discountedHbarTotal).to.be.equal(expectedDiscountedHbarTotal);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			wlUser1Id,
			'mint',
			[2],
			1_250_000,
			discountedHbarTotal.toString(),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'mint',
			[2],
			new Hbar(discountedHbarTotal.toString(), HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('WL mint failed:', result[0]?.status?.toString());
			fail('WL mint failed');
		}

		console.log('-WL mint tx:', result[2]?.transactionId?.toString());

		const mintedSerials = result[1][0];
		console.log('\n-WL User1 minted edition serials:', mintedSerials.map(s => Number(s)), '(paid 75% of: 2 HBAR + 20 LAZY + 10 USDC)');
		expect(mintedSerials.length).to.be.equal(2);
		expect(Number(mintedSerials[0])).to.be.equal(4);
		expect(Number(mintedSerials[1])).to.be.equal(5);
	});
});

describe('Individual Payment Type Tests:', function () {
	it('Should configure costs to test HBAR-only minting', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateMintCost',
			[
				Number(MINT_PRICE_HBAR.toTinybars().toString()),
				0,
				0,
			],
		);

		// Set LAZY and USDC costs to 0 to test HBAR-only
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'updateMintCost',
			[
				Number(MINT_PRICE_HBAR.toTinybars().toString()),
				0,
				0,
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Cost update failed:', result[0]?.status?.toString());
			fail('Cost update failed');
		}

		console.log('-Mint cost update tx:', result[2]?.transactionId?.toString());

		console.log('-Configured for HBAR-only testing');
	});

	it('Should mint with HBAR-only payment', async function () {
		client.setOperator(aliceId, alicePK);

		await sleep(5000);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			aliceId,
			'mint',
			[1],
			800_000,
			Number(MINT_PRICE_HBAR.toTinybars().toString()),
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'mint',
			[1],
			MINT_PRICE_HBAR,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('HBAR-only mint failed:', result[0]?.status?.toString());
			fail('HBAR-only mint failed');
		}

		console.log('-HBAR-only mint tx:', result[2]?.transactionId?.toString());

		const mintedSerial = Number(result[1][0]);
		console.log('\n-Alice minted with HBAR-only, serial:', mintedSerial);
		expect(mintedSerial).to.be.equal(6);
	});

	it('Should configure costs to test LAZY-only minting', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateMintCost',
			[
				Number(MINT_PRICE_HBAR.toTinybars().toString()),
				0,
				0,
			],
		);

		// Set HBAR and USDC costs to 0 to test LAZY-only
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'updateMintCost',
			[
				0,
				Number(MINT_PRICE_LAZY.toString()),
				0,
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Cost update failed:', result[0]?.status?.toString());
			fail('Cost update failed');
		}

		console.log('-Mint cost update tx:', result[2]?.transactionId?.toString());

		console.log('-Configured for LAZY-only testing');
	});

	it('Should mint with LAZY-only payment', async function () {
		client.setOperator(bobId, bobPK);

		await sleep(5000);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			bobId,
			'mint',
			[1],
			1_200_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'mint',
			[1],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY-only mint failed:', result);
			fail('LAZY-only mint failed');
		}

		console.log('-LAZY-only mint tx:', result[2]?.transactionId?.toString());

		const mintedSerial = Number(result[1][0]);
		console.log('\n-Bob minted with LAZY-only, serial:', mintedSerial);
		expect(mintedSerial).to.be.equal(7);
	});

	it('Should configure costs to test USDC-only minting', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateMintCost',
			[
				Number(MINT_PRICE_HBAR.toTinybars().toString()),
				0,
				0,
			],
			1_200_000,
		);

		// Set HBAR and LAZY costs to 0 to test USDC-only
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'updateMintCost',
			[
				0,
				0,
				Number(MINT_PRICE_USDC.toString()),
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Cost update failed:', result[0]?.status?.toString());
			fail('Cost update failed');
		}

		console.log('-Mint cost update tx:', result[2]?.transactionId?.toString());

		console.log('-Configured for USDC-only testing');
	});

	it('Should mint with USDC-only payment', async function () {
		client.setOperator(carolId, carolPK);

		await sleep(5000);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			carolId,
			'mint',
			[1],
			1_200_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'mint',
			[1],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('USDC-only mint failed:', result);
			fail('USDC-only mint failed');
		}

		console.log('-USDC-only mint tx:', result[2]?.transactionId?.toString());

		const mintedSerial = Number(result[1][0]);
		console.log('\n-Carol minted with USDC-only, serial:', mintedSerial);
		expect(mintedSerial).to.be.equal(8);
	});

	it('Should restore original combined payment costs', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'updateMintCost',
			[
				Number(MINT_PRICE_HBAR.toTinybars().toString()),
				Number(MINT_PRICE_LAZY.toString()),
				Number(MINT_PRICE_USDC.toString()),
			],
			400_000,
		);

		// Restore original costs for remaining tests
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'updateMintCost',
			[
				Number(MINT_PRICE_HBAR.toTinybars().toString()),
				Number(MINT_PRICE_LAZY.toString()),
				Number(MINT_PRICE_USDC.toString()),
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Cost restore failed:', result[0]?.status?.toString());
			fail('Cost restore failed');
		}

		console.log('-Mint cost restore tx:', result[2]?.transactionId?.toString());

		console.log('-Restored original combined payment costs');
	});
});

describe('Mint Multiple Editions to Reach Sold Out:', function () {
	it('Should mint remaining editions to trigger sold out', async function () {
		// await sleep to ensure previous txs are indexed
		await sleep(5000);

		// get the current supply for the edition from the mirror node
		const editionSupply = await getTokenDetails(env, editionTokenId);
		console.log('\n-Current edition supply:', editionSupply.total_supply);
		console.log('-Edition max supply:', editionSupply.max_supply);

		// We have minted 8 so far (5 combined + 3 individual), need 2 more to reach max supply of 10
		const remainingToMint = Number(editionSupply.max_supply) - Number(editionSupply.total_supply);
		console.log('-Remaining editions to mint:', remainingToMint);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'mint',
			[1],
			800_000,
			Number(MINT_PRICE_HBAR.toTinybars().toString()),
		);

		for (let i = 0; i < remainingToMint; i++) {
			// Rotate between users
			const users = [
				{ id: aliceId, key: alicePK },
				{ id: bobId, key: bobPK },
				{ id: carolId, key: carolPK },
				{ id: wlUser2Id, key: wlUser2PK },
			];
			const user = users[i % users.length];

			client.setOperator(user.id, user.key);

			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasEstimate.gasLimit,
				'mint',
				[1],
				MINT_PRICE_HBAR,
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log(`Mint ${i + 9} failed:`, result[0]?.status?.toString());
				fail(`Mint ${i + 9} failed`);
			}

			console.log(`-Minted edition serial ${i + 9} to ${user.id.toString()}`);
		}

		// Wait for mirror node
		await sleep(6000);

		// Check phase transitioned to EDITION_SOLD_OUT
		const phaseCommand = minterIface.encodeFunctionData('currentPhase');
		const phaseResult = await readOnlyEVMFromMirrorNode(env, contractId, phaseCommand, operatorId, false);
		const phase = minterIface.decodeFunctionResult('currentPhase', phaseResult);
		expect(Number(phase[0])).to.be.equal(2);

		console.log('\n-All editions sold out! Phase: EDITION_SOLD_OUT');
	});

	it('Should prevent minting when sold out', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			aliceId,
			'mint',
			[1],
			800_000,
			Number(MINT_PRICE_HBAR.toTinybars().toString()),
		);

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasEstimate.gasLimit,
				'mint',
				[1],
				MINT_PRICE_HBAR,
			);

			if (result[0]?.status?.name != 'InvalidPhase') {
				console.log('Mint succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		// let's also check isMintOpen() expecting "Sold Out"
		const isMintOpenCommand = minterIface.encodeFunctionData('isMintOpen');
		const isMintOpenResult = await readOnlyEVMFromMirrorNode(env, contractId, isMintOpenCommand, operatorId, false);
		const isMintOpen = minterIface.decodeFunctionResult('isMintOpen', isMintOpenResult);
		expect(isMintOpen[0]).to.be.false;
		expect(isMintOpen[1].toLowerCase()).to.be.equal('sold out');
	});
});

describe('Winner Selection & Prize Claiming:', function () {
	it('Should select winners using PRNG', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'selectWinner',
			[],
			1_500_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit * 3,
			'selectWinner',
			[],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Winner selection failed:', result);
			fail('Winner selection failed');
		}

		console.log('-Winner selection tx:', result[2]?.transactionId?.toString());

		const winningSerials = result[1][0];
		console.log('\n-Winning serials selected:', winningSerials.map(s => Number(s)));
		expect(winningSerials.length).to.be.greaterThan(0);
		expect(winningSerials.length).to.be.lessThanOrEqual(PRIZE_MAX_SUPPLY);

		// Wait for mirror node
		await sleep(5000);

		// Check phase transitioned to WINNER_SELECTED
		const phaseCommand = minterIface.encodeFunctionData('currentPhase');
		const phaseResult = await readOnlyEVMFromMirrorNode(env, contractId, phaseCommand, operatorId, false);
		const phase = minterIface.decodeFunctionResult('currentPhase', phaseResult);
		expect(Number(phase[0])).to.be.equal(3);

		// Verify winners can be queried
		const firstWinningSerial = Number(winningSerials[0]);
		const winnerCheckCommand = minterIface.encodeFunctionData('isWinningSerial', [firstWinningSerial]);
		const winnerCheckResult = await readOnlyEVMFromMirrorNode(env, contractId, winnerCheckCommand, operatorId, false);
		const isWinner = minterIface.decodeFunctionResult('isWinningSerial', winnerCheckResult);
		expect(isWinner[0]).to.be.true;
	});

	it('Should allow winner to claim prize', async function () {
		// Get the first winning serial and find its owner
		const winningSerialCommand = minterIface.encodeFunctionData('getWinningSerials');
		const winningSerialResult = await readOnlyEVMFromMirrorNode(env, contractId, winningSerialCommand, operatorId, false);
		const winningSerials = minterIface.decodeFunctionResult('getWinningSerials', winningSerialResult);

		console.log('\n-Winning serials to claim prizes for:', winningSerials);

		const firstWinningSerial = Number(winningSerials[0][0]);
		console.log('\n-Attempting to claim prize for winning serial:', firstWinningSerial);

		// Find who owns this serial
		let winner = null;
		const testAccounts = [aliceId, bobId, carolId, wlUser1Id, wlUser2Id];

		for (const accountId of testAccounts) {
			const serials = await getSerialsOwned(env, accountId, editionTokenId);
			if (serials.includes(firstWinningSerial)) {
				winner = accountId;
				break;
			}
		}

		if (!winner) {
			fail('Could not find owner of winning serial');
		}

		console.log(`-Winner found: ${winner.toString()}`);

		// Set appropriate client based on winner
		if (winner.equals(aliceId)) client.setOperator(aliceId, alicePK);
		else if (winner.equals(bobId)) client.setOperator(bobId, bobPK);
		else if (winner.equals(carolId)) client.setOperator(carolId, carolPK);
		else if (winner.equals(wlUser1Id)) client.setOperator(wlUser1Id, wlUser1PK);
		else if (winner.equals(wlUser2Id)) client.setOperator(wlUser2Id, wlUser2PK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			winner,
			'claimPrize',
			[firstWinningSerial],
			1_200_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasEstimate.gasLimit,
			'claimPrize',
			[firstWinningSerial],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Prize claim failed:', result[0]?.status?.toString());
			fail('Prize claim failed');
		}

		const prizeSerial = Number(result[1][0]);
		console.log(`-Prize claimed! Prize serial: ${prizeSerial}`);
		expect(prizeSerial).to.be.equal(1);

		// Wait for mirror node
		await sleep(5000);

		// Verify winner owns the prize NFT
		const winnerPrizeSerials = await getSerialsOwned(env, winner, prizeTokenId);
		expect(winnerPrizeSerials.includes(prizeSerial)).to.be.true;

		// Verify edition NFT was wiped (should not exist)
		const winnerEditionSerials = await getSerialsOwned(env, winner, editionTokenId);
		expect(winnerEditionSerials.includes(firstWinningSerial)).to.be.false;
	});

	it('Should prevent non-winners from claiming', async function () {
		client.setOperator(aliceId, alicePK);

		// Try to claim with a non-winning serial
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		// get the winning serials to avoid using one of them
		const winningSerialCommand = minterIface.encodeFunctionData('getWinningSerials');
		const winningSerialResult = await readOnlyEVMFromMirrorNode(env, contractId, winningSerialCommand, operatorId, false);
		const winningSerials = minterIface.decodeFunctionResult('getWinningSerials', winningSerialResult);
		const winningSerialSet = new Set(winningSerials[0].map(s => Number(s)));

		// pick a serial that is not a winner but still exists
		let nonWinningSerial = null;
		for (let i = 1; i <= 1000; i++) {
			if (!winningSerialSet.has(i)) {
				nonWinningSerial = i;
				break;
			}
		}

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				1_200_000,
				'claimPrize',
				[nonWinningSerial],
			);

			if (result[0]?.status?.name != 'NotWinningSerial') {
				console.log('Prize claim succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('Access Control Tests:', function () {
	it('Should prevent non-owner from configuration', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		const gasEstimate = await estimateGas(
			env,
			contractId,
			minterIface,
			aliceId,
			'updateMintCost',
			[1000, 100, 1000],
			400_000,
		);

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasEstimate.gasLimit,
				'updateMintCost',
				[1000, 100, 1000],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('Configuration update succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Should prevent non-owner from whitelist management', async function () {
		client.setOperator(bobId, bobPK);

		let expectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'addToWhitelist',
				[[aliceId.toSolidityAddress()], [1]],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		console.log('-Non-owner prevented from whitelist management');
	});

	it('Should prevent non-owner from pause control', async function () {
		client.setOperator(carolId, carolPK);

		let expectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				300_000,
				'setPaused',
				[true],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		console.log('-Non-owner prevented from pause control');
	});

	it('Should prevent non-owner from USDC withdrawal', async function () {
		client.setOperator(wlUser1Id, wlUser1PK);

		let expectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'withdrawUSDC',
				[],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		console.log('-Non-owner prevented from USDC withdrawal');
	});

	it('Should prevent non-owner from whitelist-only toggle', async function () {
		client.setOperator(wlUser2Id, wlUser2PK);

		let expectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				300_000,
				'setWhitelistOnly',
				[true],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		console.log('-Non-owner prevented from whitelist-only control');
	});
});

describe('Cleanup & Final State:', function () {
	it('Should verify final contract state', async function () {
		client.setOperator(operatorId, operatorKey);

		// Check edition minted count
		let encodedCommand = minterIface.encodeFunctionData('editionMinted');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const editionMinted = minterIface.decodeFunctionResult('editionMinted', result);
		expect(Number(editionMinted[0])).to.be.equal(EDITION_MAX_SUPPLY);

		// Check prize minted count (at least 1)
		encodedCommand = minterIface.encodeFunctionData('prizeMinted');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prizeMinted = minterIface.decodeFunctionResult('prizeMinted', result);
		expect(Number(prizeMinted[0])).to.be.greaterThan(0);

		// Check final phase
		encodedCommand = minterIface.encodeFunctionData('currentPhase');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const phase = minterIface.decodeFunctionResult('currentPhase', result);
		expect(Number(phase[0])).to.be.equal(3);

		console.log('\n-Final State:');
		console.log(`  Edition Minted: ${Number(editionMinted[0])}/${EDITION_MAX_SUPPLY}`);
		console.log(`  Prizes Claimed: ${Number(prizeMinted[0])}/${PRIZE_MAX_SUPPLY}`);
		console.log(`  Final Phase: ${Number(phase[0])} (WINNER_SELECTED)`);
	});

	it('Should clear allowances for cleanup', async function () {
		// Clear LAZY allowances but only for the operator
		client.setOperator(operatorId, operatorKey);

		const allowanceList = [];

		allowanceList.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(contractId.toString()) });
		allowanceList.push({ tokenId: usdcNativeId, owner: operatorId, spender: AccountId.fromString(contractId.toString()) });
		allowanceList.push({ tokenId: usdcBridgedId, owner: operatorId, spender: AccountId.fromString(contractId.toString()) });

		await clearFTAllowances(
			client,
			allowanceList,
		);

	});

	it('Should withdraw contract balances (HBAR, LAZY, USDC)', async function () {
		client.setOperator(operatorId, operatorKey);

		await sleep(5000);

		console.log('\n-Starting contract balance cleanup:');

		// Check and withdraw HBAR balance using new withdrawHbar method
		const hbarBalance = await checkMirrorHbarBalance(env, contractId);
		if (hbarBalance && hbarBalance > 0) {
			console.log(`\n-Contract HBAR balance: ${hbarBalance} tinybars`);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				minterIface,
				operatorId,
				'withdrawHbar',
				[],
				400_000,
			);

			const hbarWithdrawResult = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasEstimate.gasLimit,
				'withdrawHbar',
				[],
			);

			if (hbarWithdrawResult[0]?.status?.toString() === 'SUCCESS') {
				console.log(`-Withdrew ${hbarBalance} tinybars HBAR to operator`);
			}
			else {
				console.log('HBAR withdrawal failed:', hbarWithdrawResult[0]?.status?.toString());
			}
		}

		// Check and withdraw LAZY balance using new withdrawLazy method
		const lazyBalance = await checkMirrorBalance(env, contractId, lazyTokenId);
		if (lazyBalance && lazyBalance > 0) {
			console.log(`-Contract LAZY balance: ${lazyBalance}`);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				minterIface,
				operatorId,
				'withdrawLazy',
				[],
				400_000,
			);

			const lazyWithdrawResult = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasEstimate.gasLimit,
				'withdrawLazy',
				[],
			);

			if (lazyWithdrawResult[0]?.status?.toString() === 'SUCCESS') {
				console.log(`-Withdrew ${lazyBalance} LAZY to operator`);
			}
			else {
				console.log('LAZY withdrawal failed:', lazyWithdrawResult[0]?.status?.toString());
			}
		}

		// Withdraw USDC balances using existing withdrawUSDC method
		const usdcNativeBalance = await checkMirrorBalance(env, contractId, usdcNativeId);
		const usdcBridgedBalance = await checkMirrorBalance(env, contractId, usdcBridgedId);

		if ((usdcNativeBalance && usdcNativeBalance > 0) || (usdcBridgedBalance && usdcBridgedBalance > 0)) {
			console.log(`-Contract USDC Native balance: ${usdcNativeBalance || 0}`);
			console.log(`-Contract USDC Bridged balance: ${usdcBridgedBalance || 0}`);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				minterIface,
				operatorId,
				'withdrawUSDC',
				[],
				400_000,
			);

			const usdcWithdrawResult = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasEstimate.gasLimit,
				'withdrawUSDC',
				[],
			);

			if (usdcWithdrawResult[0]?.status?.toString() === 'SUCCESS') {
				console.log('-USDC balances withdrawn to operator');
			}
			else {
				console.log('USDC withdrawal failed:', usdcWithdrawResult[0]?.status?.toString());
			}
		}

		console.log('-Contract balance cleanup completed');
	});

	it('Should sweep HBAR from test accounts', async function () {
		for (const account of createdAccounts) {
			const hbarAmount = await checkMirrorHbarBalance(env, account.id);
			console.log(`\n-Account ${account.id.toString()} HBAR balance: ${hbarAmount} tinybars`);

			const sweepResult = await sweepHbar(client, account.id, account.key, operatorId, new Hbar(hbarAmount, HbarUnit.Tinybar));
			if (sweepResult !== 'SUCCESS') {
				console.log(`HBAR sweep failed for ${account.id.toString()}:`, sweepResult);
			}
		}
	});
});

// Helper function to send LAZY tokens
async function sendLazy(receiverId, amt) {
	const result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'transferHTS',
		[lazyTokenId.toSolidityAddress(), receiverId.toSolidityAddress(), amt],
	);
	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('LAZY transfer failed:', result[0]?.status?.toString());
		return result[0]?.status?.toString();
	}
	return result[0]?.status.toString();
}

/** Helper function to send USDC tokens
* @param {AccountId} receiverId - The receiver's account ID
* @param {TokenId} usdcTokenId - The USDC token ID to send
* @param {number} amt - The amount of USDC to send (in smallest unit, e.g., 6 decimals)
*/
async function sendUsdc(receiverId, usdcTokenId, amt) {
	const result = await sendFT(
		client,
		usdcTokenId,
		amt,
		operatorId,
		receiverId,
		'USDC transfer for testing',
	);
	if (result !== 'SUCCESS') {
		console.log('USDC transfer failed:', result);
		return result;
	}
	return result;
}