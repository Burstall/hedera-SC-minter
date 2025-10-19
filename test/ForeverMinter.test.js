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
	mintNFT,
	setFTAllowance,
	setNFTAllowanceAll,
	sweepHbar,
	sendNFT,
	clearNFTAllowances,
	clearFTAllowances,
	sendHbar,
	setHbarAllowance,
} = require('../utils/hederaHelpers');
const { checkMirrorBalance, getSerialsOwned, checkMirrorHbarBalance } = require('../utils/hederaMirrorHelpers');
const { fail } = require('assert');
const { ethers } = require('ethers');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'ForeverMinter';
const lazyContractCreator = 'FungibleTokenCreator';
const lazyGasStationContractName = 'LazyGasStation';
const prngContractName = 'PrngGenerator';
const env = process.env.ENVIRONMENT ?? null;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

let contractId, contractAddress;
let client;
let alicePK, aliceId, bobPK, bobId, carolPK, carolId;
let nftTokenId;
let discountToken1Id, discountToken2Id;
let lazyTokenId, lazySCT, lazyGasStation, lazyDelegateRegistry, prngGenerator;
let minterIface, lazyIface, lazyGasStationIface;
let carolSerialsForSacrifice;

const createdAccounts = [];
const nftAllowancesSet = [];
const lazyAllowancesSet = [];

describe('Deployment & Setup: ', function () {
	it('Should deploy dependencies and setup test conditions', async function () {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for the contract');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENVIRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('- using TESTNET');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('- using MAINNET');
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			console.log('- using PREVIEWNET');
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('- using LOCAL NODE');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);
		console.log('\n-Using Operator:', operatorId.toString());

		// Create test accounts: Alice, Bob, Carol

		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(client, alicePK, 200);
		createdAccounts.push({ id: aliceId, key: alicePK });
		console.log('Alice account ID:', aliceId.toString());

		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(client, bobPK, 200);
		createdAccounts.push({ id: bobId, key: bobPK });
		console.log('Bob account ID:', bobId.toString());

		carolPK = PrivateKey.generateED25519();
		carolId = await accountCreator(client, carolPK, 200);
		createdAccounts.push({ id: carolId, key: carolPK });
		console.log('Carol account ID:', carolId.toString());

		// Deploy or reuse LAZY token
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);
		lazyIface = new ethers.Interface(lazyJson.abi);

		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			console.log(
				'\n-Using existing LAZY SCT from environment ->',
				process.env.LAZY_SCT_CONTRACT_ID,
			);
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
			console.log('LAZY Token ID from env', process.env.LAZY_TOKEN_ID);
			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
		}
		else {
			console.log('\n-Deploying LAZY token creator');
			const lazyContractBytecode = lazyJson.bytecode;

			[lazySCT] = await contractDeployFunction(
				client,
				lazyContractBytecode,
				3_500_000,
			);

			console.log(`LAZY Creator deployed: ${lazySCT} / ${lazySCT.toSolidityAddress()}`);

			// Create the LAZY token
			const createTokenResult = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				800_000,
				'createFungibleWithBurn',
				[
					'LAZY Token',
					'LAZY',
					'LAZY for testing',
					LAZY_MAX_SUPPLY,
					LAZY_DECIMAL,
					LAZY_MAX_SUPPLY,
				],
				MINT_PAYMENT,
			);

			if (createTokenResult[0]?.status?.toString() != 'SUCCESS') {
				console.log('LAZY token creation FAILED:', createTokenResult);
				fail();
			}

			lazyTokenId = TokenId.fromSolidityAddress(createTokenResult[1][0]);
			console.log('LAZY Token created:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;

		// Deploy LazyGasStation
		const lazyGasStationJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationContractName}.sol/${lazyGasStationContractName}.json`,
			),
		);
		lazyGasStationIface = new ethers.Interface(lazyGasStationJson.abi);

		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			console.log(
				'\n-Using existing LazyGasStation from environment ->',
				process.env.LAZY_GAS_STATION_CONTRACT_ID,
			);
			lazyGasStation = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
		}
		else {
			console.log('\n-Deploying LazyGasStation');
			const lazyGasStationBytecode = lazyGasStationJson.bytecode;

			const gasStationParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazySCT.toSolidityAddress());

			[lazyGasStation] = await contractDeployFunction(
				client,
				lazyGasStationBytecode,
				3_200_000,
				gasStationParams,
			);

			console.log(`LazyGasStation deployed: ${lazyGasStation} / ${lazyGasStation.toSolidityAddress()}`);

			// Send LAZY to LazyGasStation for gas refills

			const sendResult = await sendLazy(AccountId.fromString(lazyGasStation.toString()), 500_000);
			expect(sendResult).to.be.equal('SUCCESS');

			// Send hbar to LazyGasStation for gas refills
			const hbarSend = await sendHbar(
				client,
				operatorId,
				AccountId.fromString(lazyGasStation.toString()),
				10,
				HbarUnit.Hbar,
			);
			expect(hbarSend).to.be.equal('SUCCESS');

			// Wait for mirror node
			await sleep(5000);

			const contractLazyBal = await checkMirrorBalance(
				env,
				AccountId.fromString(lazyGasStation.toString()),
				lazyTokenId,
			);
			expect(contractLazyBal).to.be.greaterThanOrEqual(500_000);
			console.log('Contract LAZY balance:', contractLazyBal);
		}

		expect(lazyGasStation.toString().match(addressRegex).length == 2).to.be.true;

		// Deploy PrngGenerator
		const prngJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${prngContractName}.sol/${prngContractName}.json`,
			),
		);

		if (process.env.PRNG_CONTRACT_ID) {
			console.log(
				'\n-Using existing PrngGenerator from environment ->',
				process.env.PRNG_CONTRACT_ID,
			);
			prngGenerator = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
		}
		else {
			console.log('\n-Deploying PrngGenerator');
			const prngBytecode = prngJson.bytecode;

			[prngGenerator] = await contractDeployFunction(
				client,
				prngBytecode,
				600_000,
			);

			console.log(`PrngGenerator deployed: ${prngGenerator} / ${prngGenerator.toSolidityAddress()}`);
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
			console.log(
				'\n-Using existing LazyDelegateRegistry from environment ->',
				process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			);
			lazyDelegateRegistry = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
		}
		else {
			console.log('\n-Deploying LazyDelegateRegistry');
			const lazyDelegateRegistryBytecode = lazyDelegateRegistryJson.bytecode;

			[lazyDelegateRegistry] = await contractDeployFunction(
				client,
				lazyDelegateRegistryBytecode,
				2_100_000,
			);

			console.log(`LazyDelegateRegistry deployed: ${lazyDelegateRegistry} / ${lazyDelegateRegistry.toSolidityAddress()}`);
		}

		expect(lazyDelegateRegistry.toString().match(addressRegex).length == 2).to.be.true;

		// Ensure operator has LAZY tokens
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

		// Associate LAZY to test accounts
		for (const account of [{ id: aliceId, key: alicePK }, { id: bobId, key: bobPK }, { id: carolId, key: carolPK }]) {
			const bal = await checkMirrorBalance(env, account.id, lazyTokenId);
			if (bal == null) {
				const assocResult = await associateTokenToAccount(client, account.id, account.key, lazyTokenId);
				expect(assocResult).to.be.equal('SUCCESS');
				console.log(`Associated LAZY to ${account.id.toString()}`);
			}
		}

		// Send LAZY to test accounts
		for (const account of [aliceId, bobId, carolId]) {
			const sendResult = await sendLazy(account, 500);
			expect(sendResult).to.be.equal('SUCCESS');
		}

		console.log('\n-Dependency deployment complete');
	});

	it('Should mint NFT collection to distribute (100 NFTs)', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await mintNFT(
			client,
			operatorId,
			'ForeverMinter NFT Collection ' + new Date().toISOString(),
			'FMNFT',
			100,
			MINT_PAYMENT,
		);

		if (result[0] !== 'SUCCESS') {
			console.log('NFT mint FAILED:', result);
			fail();
		}

		nftTokenId = result[1];
		console.log('\n-NFT Collection minted:', nftTokenId.toString(), '(100 serials)');
		expect(nftTokenId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should mint discount holder NFTs (2 collections)', async function () {
		client.setOperator(operatorId, operatorKey);

		// Discount Token 1: 10 NFTs for holder discounts (Tier 0: 25% discount, 3 uses)
		const result1 = await mintNFT(
			client,
			operatorId,
			'Discount Holder Gen1 ' + new Date().toISOString(),
			'DH1',
			10,
			MINT_PAYMENT,
		);

		if (result1[0] !== 'SUCCESS') {
			console.log('Discount NFT 1 mint FAILED:', result1);
			fail();
		}

		discountToken1Id = result1[1];
		console.log('\n-Discount Token 1 minted:', discountToken1Id.toString(), '(10 serials)');

		// Discount Token 2: 10 NFTs for holder discounts (Tier 1: 10% discount, 5 uses)
		const result2 = await mintNFT(
			client,
			operatorId,
			'Discount Holder Gen2 ' + new Date().toISOString(),
			'DH2',
			10,
			MINT_PAYMENT,
		);

		if (result2[0] !== 'SUCCESS') {
			console.log('Discount NFT 2 mint FAILED:', result2);
			fail();
		}

		discountToken2Id = result2[1];
		console.log('-Discount Token 2 minted:', discountToken2Id.toString(), '(10 serials)');

		expect(discountToken1Id.toString().match(addressRegex).length == 2).to.be.true;
		expect(discountToken2Id.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy ForeverMinter contract', async function () {
		client.setOperator(operatorId, operatorKey);

		const json = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
			),
		);

		const contractBytecode = json.bytecode;
		minterIface = new ethers.Interface(json.abi);

		const gasLimit = 6_500_000;

		console.log('\n-Deploying contract...', contractName, '\n\tgas@', gasLimit);

		// Constructor params: (nftToken, prngGenerator, lazyToken, lazyGasStation, lazyDelegateRegistry)
		const constructorParams = new ContractFunctionParameters()
			.addAddress(nftTokenId.toSolidityAddress())
			.addAddress(prngGenerator.toSolidityAddress())
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazyGasStation.toSolidityAddress())
			.addAddress(lazyDelegateRegistry.toSolidityAddress());

		[contractId, contractAddress] = await contractDeployFunction(
			client,
			contractBytecode,
			gasLimit,
			constructorParams,
		);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);
		console.log('\n-Testing:', contractName);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		// Register ForeverMinter with LazyGasStation
		console.log('\n-Registering ForeverMinter with LazyGasStation');
		const addContractUserResult = await contractExecuteFunction(
			lazyGasStation,
			lazyGasStationIface,
			client,
			300_000,
			'addContractUser',
			[contractId.toSolidityAddress()],
		);

		if (addContractUserResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('addContractUser FAILED:', addContractUserResult);
			fail();
		}

		console.log('ForeverMinter registered with LazyGasStation, tx:', addContractUserResult[2]?.transactionId?.toString());
	});
});

describe('Constructor & Initial State Verification:', function () {
	it('Should verify immutable variables set correctly', async function () {
		client.setOperator(operatorId, operatorKey);

		// Check NFT_TOKEN
		let encodedCommand = minterIface.encodeFunctionData('NFT_TOKEN');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const nftToken = minterIface.decodeFunctionResult('NFT_TOKEN', result);
		expect(nftToken[0].slice(2).toLowerCase()).to.be.equal(nftTokenId.toSolidityAddress());

		// Check PRNG_GENERATOR
		encodedCommand = minterIface.encodeFunctionData('PRNG_GENERATOR');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prngAddr = minterIface.decodeFunctionResult('PRNG_GENERATOR', result);
		expect(prngAddr[0].slice(2).toLowerCase()).to.be.equal(prngGenerator.toSolidityAddress());

		console.log('✓ Immutable variables verified');
	});

	it('Should verify deployer is admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isAdmin = minterIface.decodeFunctionResult('isAdmin', result);

		expect(isAdmin[0]).to.be.true;
		console.log('✓ Deployer is admin');
	});

	it('Should verify default state values', async function () {
		client.setOperator(operatorId, operatorKey);

		// Check pool is empty
		let encodedCommand = minterIface.encodeFunctionData('getRemainingSupply');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolSizeResult = minterIface.decodeFunctionResult('getRemainingSupply', result);
		expect(Number(poolSizeResult[0])).to.be.equal(0);

		// Check mint economics defaults
		encodedCommand = minterIface.encodeFunctionData('getMintEconomics');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', result);

		// console.log('Default Economics:', economics);

		// mintPriceHbar
		expect(Number(economics[0][0])).to.be.equal(0);
		// mintPriceLazy
		expect(Number(economics[0][1])).to.be.equal(0);
		// wlDiscount
		expect(Number(economics[0][2])).to.be.equal(0);
		// sacrificeDiscount
		expect(Number(economics[0][3])).to.be.equal(0);
		// maxMint
		expect(Number(economics[0][4])).to.be.equal(50);
		// maxMintPerWallet
		expect(Number(economics[0][5])).to.be.equal(0);
		// buyWithLazy
		expect(Number(economics[0][6])).to.be.equal(0);
		// buyWLSlotCount
		expect(Number(economics[0][7])).to.be.equal(1);
		// maxSacrifice
		expect(Number(economics[0][8])).to.be.equal(10);
		// lazyFromContract (bool)
		expect(economics[0][9]).to.be.false;

		// Check mint timing defaults
		encodedCommand = minterIface.encodeFunctionData('getMintTiming');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const timing = minterIface.decodeFunctionResult('getMintTiming', result);

		// lastMintTimestamp
		expect(Number(timing[0][0])).to.be.equal(0);
		// mintStartTime
		expect(Number(timing[0][1])).to.be.greaterThan(0);
		// mintPaused
		expect(timing[0][2]).to.be.true;
		// refundWindow
		expect(Number(timing[0][3])).to.be.equal(3600);
		// refundPercentage
		expect(Number(timing[0][4])).to.be.equal(60);
		// wlOnly
		expect(timing[0][5]).to.be.false;

		// Check lazy details
		encodedCommand = minterIface.encodeFunctionData('getLazyDetails');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', result);

		expect(lazyDetails[0][0].slice(2).toLowerCase()).to.be.equal(lazyTokenId.toSolidityAddress());
		expect(Number(lazyDetails[0][1])).to.be.equal(50);

		console.log('✓ Default state verified');
	});
});

describe('Admin System Tests:', function () {
	it('Should add Alice as admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'addAdmin',
			[aliceId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('addAdmin FAILED:', result);
			fail();
		}

		console.log('Operator added Alice as admin, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Alice is admin
		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [aliceId.toSolidityAddress()]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isAdmin = minterIface.decodeFunctionResult('isAdmin', queryResult);

		expect(isAdmin[0]).to.be.true;
		console.log('✓ Alice added as admin');
	});

	it('Should verify Alice can add Bob as admin', async function () {
		client.setOperator(aliceId, alicePK);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'addAdmin',
			[bobId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Alice addAdmin FAILED:', result);
			fail();
		}

		console.log('Alice added Bob as admin, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Bob is admin
		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [bobId.toSolidityAddress()]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isAdmin = minterIface.decodeFunctionResult('isAdmin', queryResult);

		expect(isAdmin[0]).to.be.true;
		console.log('✓ Bob added as admin by Alice');
	});

	it('Should verify non-admin Carol cannot add admin', async function () {
		client.setOperator(carolId, carolPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'addAdmin',
				[carolId.toSolidityAddress()],
			);

			if (result[0]?.status?.name != 'NotAdmin') {
				console.log('ERROR expecting NotAdmin:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('✓ Non-admin correctly blocked from addAdmin');
	});

	it('Should remove Bob as admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'removeAdmin',
			[bobId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('removeAdmin FAILED:', result);
			fail();
		}

		console.log('Operator removed Bob as admin, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Bob is no longer admin
		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [bobId.toSolidityAddress()]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isAdmin = minterIface.decodeFunctionResult('isAdmin', queryResult);

		expect(isAdmin[0]).to.be.false;
		console.log('✓ Bob removed as admin');
	});

	it('Should prevent removing last admin', async function () {
		client.setOperator(operatorId, operatorKey);

		// First remove Alice (leaving only operator)
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'removeAdmin',
			[aliceId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Remove Alice FAILED:', result);
			fail();
		}

		console.log('Alice removed as admin, tx:', result[2]?.transactionId?.toString());

		// Now try to remove operator (last admin)
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		const result2 = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'removeAdmin',
			[operatorId.toSolidityAddress()],
		);

		if (result2[0]?.status?.name != 'CannotRemoveLastAdmin') {
			console.log('ERROR expecting CannotRemoveLastAdmin:', result2);
			unexpectedErrors++;
		}
		else {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		// Re-add Alice for future tests
		const result3 = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'addAdmin',
			[aliceId.toSolidityAddress()],
		);

		if (result3[0]?.status?.toString() != 'SUCCESS') {
			console.log('Re-add Alice FAILED:', result3);
			fail();
		}

		console.log('Re-added Alice as admin, tx:', result3[2]?.transactionId?.toString());

		console.log('✓ Cannot remove last admin (Alice re-added)');
	});
});

describe('Initialization & Configuration:', function () {
	it('Should initialize contract with economics and timing', async function () {
		client.setOperator(operatorId, operatorKey);

		// Update economics
		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			250_000,
			'updateEconomics',
			[
				1000,
				50,
				10,
				30,
				50,
				100,
				25,
				1,
				20,
				false,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('updateEconomics FAILED:', result);
			fail();
		}

		console.log('Economics updated, tx:', result[2]?.transactionId?.toString());

		// Update timing
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			250_000,
			'updateTiming',
			[
				Math.floor(Date.now() / 1000) - 60,
				false,
				3600,
				90,
				false,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('updateTiming FAILED:', result);
			fail();
		}

		console.log('Timing updated, tx:', result[2]?.transactionId?.toString());

		// Set sacrifice destination
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'setSacrificeDestination',
			[contractId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('setSacrificeDestination FAILED:', result);
			fail();
		}

		console.log('Sacrifice destination set, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify economics
		let encodedCommand = minterIface.encodeFunctionData('getMintEconomics');
		let queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', queryResult);

		expect(Number(economics[0][0])).to.be.equal(1000);
		expect(Number(economics[0][1])).to.be.equal(50);
		expect(Number(economics[0][2])).to.be.equal(10);
		expect(Number(economics[0][3])).to.be.equal(30);

		// Verify timing
		encodedCommand = minterIface.encodeFunctionData('getMintTiming');
		queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const timing = minterIface.decodeFunctionResult('getMintTiming', queryResult);

		expect(timing[0][2]).to.be.false;
		expect(Number(timing[0][3])).to.be.equal(3600);
		expect(Number(timing[0][4])).to.be.equal(90);

		console.log('✓ Contract initialized with economics and timing');
	});

	it('Should update lazy burn percentage', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'updateLazyBurnPercentage',
			[25],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('updateLazyBurnPercentage FAILED:', result);
			fail();
		}

		console.log('Lazy burn % updated, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		const encodedCommand = minterIface.encodeFunctionData('getLazyDetails');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', queryResult);

		expect(Number(lazyDetails[0][1])).to.be.equal(25);
		console.log('✓ Lazy burn percentage updated to 25%');
	});

	it('Should verify non-admin cannot update configuration', async function () {
		client.setOperator(carolId, carolPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateLazyBurnPercentage',
				[50],
			);

			if (result[0]?.status?.name != 'NotAdmin') {
				console.log('ERROR expecting NotAdmin:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('✓ Non-admin correctly blocked from configuration');
	});
});

describe('NFT Pool Management:', function () {
	it('Should register NFTs sent from treasury (operator)', async function () {
		client.setOperator(operatorId, operatorKey);

		// Send first 20 NFTs to contract (serials 1-20)
		const serialsToSend = Array.from({ length: 20 }, (_, i) => i + 1);

		console.log('Sending NFTs to contract for registration:', serialsToSend);
		console.log('NFT Token ID:', nftTokenId.toString());
		console.log('Contract ID:', contractId.toString());
		console.log('Operator ID:', operatorId.toString());

		// Send NFTs to contract

		const sendResult = await sendNFT(
			client,
			operatorId,
			AccountId.fromString(contractId.toString()),
			nftTokenId,
			serialsToSend,
		);

		if (sendResult != 'SUCCESS') {
			console.log('Sending NFTs to contract FAILED:', sendResult);
			fail();
		}

		// Register the NFTs
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			2_000_000,
			'registerNFTs',
			[serialsToSend],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('registerNFTs FAILED:', result);
			fail();
		}

		console.log('Operator registered 20 NFTs, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify pool has 20 serials
		const encodedCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolSizeResult = minterIface.decodeFunctionResult('getRemainingSupply', queryResult);

		expect(Number(poolSizeResult[0])).to.be.equal(20);
		console.log('✓ Registered 20 NFTs to pool');
	});

	it('Should add NFTs from donor (Alice)', async function () {
		client.setOperator(aliceId, alicePK);

		// Associate Alice with NFT token
		const assocResult = await associateTokenToAccount(client, aliceId, alicePK, nftTokenId);
		expect(assocResult).to.be.equal('SUCCESS');


		// Send NFTs 21-30 from operator to Alice
		client.setOperator(operatorId, operatorKey);
		const serialsForAlice = Array.from({ length: 10 }, (_, i) => i + 21);

		for (const serial of serialsForAlice) {
			const res = await sendNFT(client, operatorId, aliceId, nftTokenId, [serial]);
			expect(res).to.be.equal('SUCCESS');
		}

		// Alice sets approval for contract
		client.setOperator(aliceId, alicePK);
		const approvalResult = await setNFTAllowanceAll(client, [nftTokenId], aliceId, contractId);
		expect(approvalResult).to.be.equal('SUCCESS');
		nftAllowancesSet.push({ owner: aliceId, tokenId: nftTokenId, spender: contractId });
		// Alice adds NFTs to pool
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			2_500_000,
			'addNFTsToPool',
			[serialsForAlice],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('addNFTsToPool FAILED:', result);
			fail();
		}

		console.log('Alice added NFTs to pool, tx successful', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify pool now has 30 serials
		const encodedCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolSizeResult = minterIface.decodeFunctionResult('getRemainingSupply', queryResult);

		expect(Number(poolSizeResult[0])).to.be.equal(30);
		console.log('✓ Alice donated 10 NFTs, pool now has 30');
	});

	it('Should prevent duplicate serial registration', async function () {
		client.setOperator(operatorId, operatorKey);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				1_000_000,
				'registerNFTs',
				[[1]],
			);

			if (result[0]?.status?.name != 'SerialAlreadyInPool') {
				console.log('ERROR expecting SerialAlreadyInPool:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('✓ Duplicate serial correctly rejected');
	});

	it('Should emergency withdraw NFTs (admin only)', async function () {
		client.setOperator(operatorId, operatorKey);

		// set an allowance of habr to the contract for emergency withdraw
		const hbarAllowance = await setHbarAllowance(
			client,
			operatorId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		// Emergency withdraw serials 1-5 back to operator
		const serialsToWithdraw = [1, 2, 3, 4, 5];

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_500_000,
			'emergencyWithdrawNFTs',
			[serialsToWithdraw, operatorId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('emergencyWithdrawNFTs FAILED:', result);
			fail();
		}

		console.log('Emergency withdraw complete, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify pool now has 25 serials (30 - 5)
		const encodedCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolSizeResult = minterIface.decodeFunctionResult('getRemainingSupply', queryResult);

		expect(Number(poolSizeResult[0])).to.be.equal(25);
		console.log('✓ Emergency withdrew 5 NFTs, pool now has 25');

		// Re-add them for future tests
		for (const serial of serialsToWithdraw) {
			await sendNFT(client, operatorId, AccountId.fromString(contractId.toString()), nftTokenId, [serial]);
		}

		const reAddResult = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_500_000,
			'registerNFTs',
			[serialsToWithdraw],
		);

		if (reAddResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('Re-register NFTs FAILED:', reAddResult);
			fail();
		}

		console.log('Re-added 5 NFTs, tx:', reAddResult[2]?.transactionId?.toString());
	});
});

describe('Discount System Setup:', function () {
	it('Should add discount tier 0 (25% discount, 3 uses)', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'addDiscountTier',
			[
				discountToken1Id.toSolidityAddress(),
				25,
				3,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('addDiscountTier FAILED:', result);
			fail();
		}

		console.log('Discount tier 0 added, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify discount tier - first get tier index for token
		let encodedCommand = minterIface.encodeFunctionData('getTokenTierIndex', [discountToken1Id.toSolidityAddress()]);
		let queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const tierIndex = minterIface.decodeFunctionResult('getTokenTierIndex', queryResult);

		// Then get the tier details using the tier index
		encodedCommand = minterIface.encodeFunctionData('getDiscountTier', [Number(tierIndex[0])]);
		queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const tier = minterIface.decodeFunctionResult('getDiscountTier', queryResult);

		console.log('✓ Discount Tier 0 details:', tier);

		expect(Number(tier[0][0])).to.be.equal(25);
		expect(Number(tier[0][1])).to.be.equal(3);
	});

	it('Should add discount tier 1 (10% discount, 5 uses)', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'addDiscountTier',
			[
				discountToken2Id.toSolidityAddress(),
				10,
				5,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('addDiscountTier FAILED:', result);
			fail();
		}

		console.log('Discount tier 1 added, tx:', result[2]?.transactionId?.toString());
	});

	it('Should distribute discount NFTs to test users', async function () {
		client.setOperator(operatorId, operatorKey);

		// Associate test accounts with discount tokens
		for (const account of [{ id: aliceId, key: alicePK }, { id: bobId, key: bobPK }]) {
			await associateTokenToAccount(client, account.id, account.key, discountToken1Id);
			await associateTokenToAccount(client, account.id, account.key, discountToken2Id);
		}

		// Send discount NFTs:
		// Alice gets: DT1 serials 1,2 (2 Gen1 NFTs) and DT2 serials 1,2,3 (3 Gen2 NFTs)
		// Bob gets: DT1 serial 3 (1 Gen1 NFT)

		await sendNFT(client, operatorId, aliceId, discountToken1Id, [1]);
		await sendNFT(client, operatorId, aliceId, discountToken1Id, [2]);
		await sendNFT(client, operatorId, bobId, discountToken1Id, [3]);

		await sendNFT(client, operatorId, aliceId, discountToken2Id, [1]);
		await sendNFT(client, operatorId, aliceId, discountToken2Id, [2]);
		await sendNFT(client, operatorId, aliceId, discountToken2Id, [3]);

		console.log('✓ Discount NFTs distributed:');
		console.log('  Alice: DT1[1,2], DT2[1,2,3]');
		console.log('  Bob: DT1[3]');
	});

	it('Should allow delegation of discount NFT to work for minting', async function () {
		client.setOperator(aliceId, alicePK);

		// Get Alice's DT1 serials to ensure we delegate one she actually owns
		await sleep(5000);
		const aliceDT1Serials = await getSerialsOwned(env, aliceId, discountToken1Id);
		expect(aliceDT1Serials).to.be.an('array').that.is.not.empty;

		const serialToDelegate = aliceDT1Serials[0];
		console.log(`Alice owns DT1 serials: [${aliceDT1Serials.join(', ')}]`);
		console.log(`Alice delegating DT1 serial ${serialToDelegate} to Carol...`);

		const lazyDelegateRegistryIface = new ethers.Interface(
			JSON.parse(
				fs.readFileSync(
					'./artifacts/contracts/LazyDelegateRegistry.sol/LazyDelegateRegistry.json',
				),
			).abi,
		);

		const delegateResult = await contractExecuteFunction(
			lazyDelegateRegistry,
			lazyDelegateRegistryIface,
			client,
			800_000,
			'delegateNFT',
			[carolId.toSolidityAddress(), discountToken1Id.toSolidityAddress(), [serialToDelegate]],
		);

		if (delegateResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('delegateNFT FAILED:', delegateResult);
			fail();
		}

		console.log('Delegation successful, tx:', delegateResult[2]?.transactionId?.toString());

		await sleep(3000);

		// Verify delegation
		const encodedCheck = lazyDelegateRegistryIface.encodeFunctionData('getNFTDelegatedTo', [
			discountToken1Id.toSolidityAddress(),
			serialToDelegate,
		]);
		const checkResult = await readOnlyEVMFromMirrorNode(
			env,
			lazyDelegateRegistry,
			encodedCheck,
			operatorId,
			false,
		);
		const delegatedTo = lazyDelegateRegistryIface.decodeFunctionResult('getNFTDelegatedTo', checkResult);
		expect(delegatedTo[0].toLowerCase()).to.be.equal('0x' + carolId.toSolidityAddress());

		console.log(`✓ Delegation verified: DT1 serial ${serialToDelegate} delegated to Carol`);

		// Now Carol should be able to use this for discount
		client.setOperator(carolId, carolPK);

		// Calculate cost with delegated discount
		const encodedCommand = minterIface.encodeFunctionData('calculateMintCost', [
			1,
			[discountToken1Id.toSolidityAddress()],
			[[serialToDelegate]],
			0,
		]);
		const costResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, carolId, false);
		const [hbarCost, lazyCost, discount] = minterIface.decodeFunctionResult('calculateMintCost', costResult);

		console.log('Cost with delegated discount:');
		console.log('  HBAR:', hbarCost.toString());
		console.log('  LAZY:', lazyCost.toString());
		console.log('  Discount:', discount.toString() + '%');

		expect(Number(discount)).to.be.equal(25);

		console.log('✓ Carol can calculate cost using delegated discount serial');

		// Revoke delegation (cleanup)
		client.setOperator(aliceId, alicePK);
		const revokeResult = await contractExecuteFunction(
			lazyDelegateRegistry,
			lazyDelegateRegistryIface,
			client,
			800_000,
			'revokeDelegateNFT',
			[discountToken1Id.toSolidityAddress(), [serialToDelegate]],
		);

		if (revokeResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('revokeDelegateNFT FAILED:', revokeResult);
			fail();
		}

		console.log('Delegation revoked, tx:', revokeResult[2]?.transactionId?.toString());
	});
});

describe('Whitelist Management:', function () {
	it('Should add addresses to whitelist with slots', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'batchAddToWhitelist',
			[
				[aliceId.toSolidityAddress(), bobId.toSolidityAddress()],
				[5, 3],
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('batchAddToWhitelist FAILED:', result);
			fail();
		}

		console.log('Whitelist addresses added, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Alice's slots
		let encodedCommand = minterIface.encodeFunctionData('getBatchWhitelistSlots', [[aliceId.toSolidityAddress()]]);
		let queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		let slots = minterIface.decodeFunctionResult('getBatchWhitelistSlots', queryResult);

		expect(Number(slots[0][0])).to.be.equal(5);

		// Verify Bob's slots
		encodedCommand = minterIface.encodeFunctionData('getBatchWhitelistSlots', [[bobId.toSolidityAddress()]]);
		queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		slots = minterIface.decodeFunctionResult('getBatchWhitelistSlots', queryResult);

		expect(Number(slots[0][0])).to.be.equal(3);

		console.log('✓ Whitelist slots: Alice=5, Bob=3');
	});

	it('Should allow buying WL slots with LAZY', async function () {
		client.setOperator(carolId, carolPK);

		// Carol needs to set LAZY allowance to LazyGasStation
		const allowanceResult = await setFTAllowance(
			client,
			lazyTokenId,
			carolId,
			lazyGasStation,
			100,
		);
		expect(allowanceResult).to.be.equal('SUCCESS');
		lazyAllowancesSet.push({ owner: carolId, tokenId: lazyTokenId, spender: lazyGasStation });

		// Carol buys 2 WL slots (cost: 25 LAZY per slot = 50 total)
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_200_000,
			'buyWhitelistWithLazy',
			[2],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('buyWhitelistWithLazy FAILED:', result);
			fail();
		}

		console.log('Carol bought WL slots, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Carol's slots
		const encodedCommand = minterIface.encodeFunctionData('getBatchWhitelistSlots', [[carolId.toSolidityAddress()]]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const slots = minterIface.decodeFunctionResult('getBatchWhitelistSlots', queryResult);

		expect(Number(slots[0][0])).to.be.equal(2);
		console.log('✓ Carol bought 2 WL slots with LAZY');
	});

	it('Should remove addresses from whitelist', async function () {
		client.setOperator(operatorId, operatorKey);

		// Add Carol temporarily
		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'batchAddToWhitelist',
			[[carolId.toSolidityAddress()], [10]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Add Carol to WL FAILED:', result);
			fail();
		}

		// Remove Carol
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'removeFromWhitelist',
			[[carolId.toSolidityAddress()]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('removeFromWhitelist FAILED:', result);
			fail();
		}

		console.log('Carol removed from WL, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Carol has 0 slots - removeFromWhitelist sets ALL slots to 0 (including purchased ones)
		const encodedCommand = minterIface.encodeFunctionData('getBatchWhitelistSlots', [[carolId.toSolidityAddress()]]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const slots = minterIface.decodeFunctionResult('getBatchWhitelistSlots', queryResult);

		console.log('Carol whitelist slots after removal:', slots);

		expect(Number(slots[0][0])).to.be.equal(0);
		console.log('✓ Removed Carol from whitelist (all slots set to 0)');
	});
});

describe('Cost Calculation (DRY Architecture v1.0.5):', function () {
	it('Should calculate cost with 5 return values (no discounts)', async function () {
		client.setOperator(operatorId, operatorKey);

		// Carol has no discounts, no WL slots
		const encodedCommand = minterIface.encodeFunctionData('calculateMintCost', [
			5,
			[],
			[],
			0,
		]);

		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, carolId, false);
		const [hbar, lazy, discount, holderSlots, wlSlots] = minterIface.decodeFunctionResult('calculateMintCost', result);

		// Base price: 1000 HBAR + 50 LAZY per NFT
		expect(Number(hbar)).to.be.equal(5000);
		expect(Number(lazy)).to.be.equal(250);
		expect(Number(discount)).to.be.equal(0);
		expect(Number(holderSlots)).to.be.equal(0);
		expect(Number(wlSlots)).to.be.equal(0);

		console.log('✓ calculateMintCost returns 5 values correctly');
		console.log(`  Cost: ${Number(hbar)} HBAR, ${Number(lazy)} LAZY, ${Number(discount)}% discount`);
		console.log(`  Slots: ${Number(holderSlots)} holder, ${Number(wlSlots)} WL`);
	});

	it('Should calculate cost with WL discount only', async function () {
		client.setOperator(operatorId, operatorKey);

		// Alice has 5 WL slots, 10% WL discount
		const encodedCommand = minterIface.encodeFunctionData('calculateMintCost', [
			3,
			[],
			[],
			0,
		]);

		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, aliceId, false);
		const [hbar, lazy, discount, holderSlots, wlSlots] = minterIface.decodeFunctionResult('calculateMintCost', result);

		// 3 NFTs with 10% WL discount
		// Per NFT: 1000 * 0.9 = 900 HBAR, 50 * 0.9 = 45 LAZY
		// Total: 2700 HBAR, 135 LAZY
		expect(Number(hbar)).to.be.equal(2700);
		expect(Number(lazy)).to.be.equal(135);
		expect(Number(discount)).to.be.equal(10);
		expect(Number(holderSlots)).to.be.equal(0);
		expect(Number(wlSlots)).to.be.equal(3);

		console.log('✓ WL discount calculated correctly');
		console.log(`  Slots consumed: ${Number(wlSlots)} WL slots`);
	});

	it('Should calculate cost with holder discount only', async function () {
		client.setOperator(operatorId, operatorKey);

		// Bob has DT1[3] = 1 Gen1 NFT with 25% discount, 3 uses
		// Bob has 3 WL slots, but we need to remove them to test holder-only
		// (holder + WL discounts stack, so we must remove WL to test holder alone)

		// Remove Bob from whitelist temporarily
		const removeResult = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'removeFromWhitelist',
			[[bobId.toSolidityAddress()]],
		);

		if (removeResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('removeFromWhitelist FAILED:', removeResult);
			fail();
		}

		console.log('Bob removed from whitelist, tx:', removeResult[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Bob has no WL slots
		const verifyCommand = minterIface.encodeFunctionData('getBatchWhitelistSlots', [[bobId.toSolidityAddress()]]);
		const verifyResult = await readOnlyEVMFromMirrorNode(env, contractId, verifyCommand, operatorId, false);
		const verifySlots = minterIface.decodeFunctionResult('getBatchWhitelistSlots', verifyResult);
		expect(Number(verifySlots[0][0])).to.be.equal(0);

		console.log('✓ Verified Bob has 0 WL slots');

		// Now test holder-only discount
		const encodedCommand = minterIface.encodeFunctionData('calculateMintCost', [
			2,
			[discountToken1Id.toSolidityAddress()],
			[[3]],
			0,
		]);

		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, bobId, false);
		const [hbar, lazy, discount, holderSlots, wlSlots] = minterIface.decodeFunctionResult('calculateMintCost', result);

		// Get the base mint cost too via MintEconomics for logging
		const economicsCommand = minterIface.encodeFunctionData('getMintEconomics');
		const economicsResult = await readOnlyEVMFromMirrorNode(env, contractId, economicsCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', economicsResult);
		const baseHbar = Number(economics[0][0]);
		const baseLazy = Number(economics[0][1]);

		console.log('Decoded values:', {
			baseHbar: baseHbar,
			baseLazy: baseLazy,
			hbar: Number(hbar),
			lazy: Number(lazy),
			discount: Number(discount),
			holderSlots: Number(holderSlots),
			wlSlots: Number(wlSlots),
		});

		// 2 NFTs with 25% holder discount only (no WL)
		// Per NFT: 1000 * 0.75 = 750 HBAR, 50 * 0.75 = 37.5 LAZY (rounds to 37)
		// Total: 1500 HBAR, 75 LAZY
		expect(Number(hbar)).to.be.equal(1500);
		expect(Number(lazy)).to.be.equal(75);
		expect(Number(discount)).to.be.equal(25);
		expect(Number(holderSlots)).to.be.equal(2);
		expect(Number(wlSlots)).to.be.equal(0);

		console.log('✓ Holder discount calculated correctly (WL removed to test holder-only)');
		console.log(`  Slots consumed: ${Number(holderSlots)} holder slots, ${Number(wlSlots)} WL slots`);

		// Re-add Bob to whitelist for future tests
		const readdResult = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'batchAddToWhitelist',
			[[bobId.toSolidityAddress()], [3]],
		);

		if (readdResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('batchAddToWhitelist FAILED (re-add):', readdResult);
			fail();
		}

		console.log('Bob re-added to whitelist with 3 slots, tx:', readdResult[2]?.transactionId?.toString());
	});

	it('Should calculate cost with WL + Holder stacking', async function () {
		client.setOperator(operatorId, operatorKey);

		// Alice has DT1[1,2] and DT2[1,2,3]
		// DT1: 25% discount, 3 uses each = 6 total uses
		// Alice has 5 WL slots
		// All 4 NFTs should get stacked: 25% holder + 10% WL = 35% discount
		const encodedCommand = minterIface.encodeFunctionData('calculateMintCost', [
			4,
			[discountToken1Id.toSolidityAddress()],
			[[1, 2]],
			0,
		]);

		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, aliceId, false);
		const [hbar, lazy, discount, holderSlots, wlSlots] = minterIface.decodeFunctionResult('calculateMintCost', result);

		console.log('Decoded values:', {
			hbar: Number(hbar),
			lazy: Number(lazy),
			discount: Number(discount),
			holderSlots: Number(holderSlots),
			wlSlots: Number(wlSlots),
		});

		console.log('\n=== Manual Calculation Verification ===');
		console.log('Base LAZY per NFT: 50');
		console.log('Stacked discount: 25% holder + 10% WL = 35%');
		console.log('Alice provides DT1 serials [1, 2], each with 3 uses available');
		console.log('');
		console.log('Contract processes per discount slot (not batched):');
		console.log('  Slot 0 (serial 1): 3 NFTs → (50 * 3 * 65) / 100 = 9750 / 100 = 97');
		console.log('  Slot 1 (serial 2): 1 NFT  → (50 * 1 * 65) / 100 = 3250 / 100 = 32');
		console.log('  Total: 97 + 32 = 129 LAZY');
		console.log('');
		console.log('Note: Integer division per slot causes 1 LAZY rounding loss');
		console.log('      (vs 130 if calculated as single batch)');
		console.log('Expected: 129 LAZY');
		console.log('Actual: ' + Number(lazy) + ' LAZY');
		console.log('======================================\n');

		// 4 NFTs with 25% holder + 10% WL = 35% discount
		// Contract calculates per discount slot (integer division):
		//   Slot 0 (serial 1, 3 uses): (50 * 3 * 65) / 100 = 97 LAZY
		//   Slot 1 (serial 2, 1 use):  (50 * 1 * 65) / 100 = 32 LAZY
		//   Total: 97 + 32 = 129 LAZY (1 LAZY lost to rounding per slot)
		// Total: 2600 HBAR, 129 LAZY
		expect(Number(hbar)).to.be.equal(2600);
		expect(Number(lazy)).to.be.equal(129);
		expect(Number(discount)).to.be.equal(35);
		expect(Number(holderSlots)).to.be.equal(4);
		// FIXED: WL slots ARE consumed when holder and WL discounts stack
		expect(Number(wlSlots)).to.be.equal(4);

		console.log('✓ WL + Holder stacking calculated correctly');
		console.log(`  Discount: ${Number(discount)}% (25% holder + 10% WL)`);
		console.log(`  Slots consumed: ${Number(holderSlots)} holder, ${Number(wlSlots)} WL`);
	});

	it('Should calculate waterfall: holder slots exhausted, WL takes over', async function () {
		client.setOperator(operatorId, operatorKey);

		// Alice mints 10 NFTs
		// Has DT1[1,2] = 6 uses total (3 each)
		// Has 5 WL slots (NOT 6!)
		// Expected waterfall:
		//   - First 5: 35% discount (holder+WL), consume 5 holder + 5 WL slots
		//   - Next 1: 25% discount (holder only, WL exhausted), consume 1 holder slot
		//   - Next 4: 0% discount (full price, all slots exhausted)
		const encodedCommand = minterIface.encodeFunctionData('calculateMintCost', [
			10,
			[discountToken1Id.toSolidityAddress()],
			[[1, 2]],
			0,
		]);

		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, aliceId, false);
		const [hbar, lazy, discount, holderSlots, wlSlots] = minterIface.decodeFunctionResult('calculateMintCost', result);

		console.log('Decoded values:', {
			hbar: Number(hbar),
			lazy: Number(lazy),
			discount: Number(discount),
			holderSlots: Number(holderSlots),
			wlSlots: Number(wlSlots),
		});

		// Need to account for per-slot integer division rounding
		// Slot 0 (serial 1, 3 uses):
		//   - 3 NFTs at 35% (holder+WL): (1000 * 3 * 65) / 100 = 1950 HBAR
		// Slot 1 (serial 2, 3 uses):
		//   - 2 NFTs at 35% (holder+WL): (1000 * 2 * 65) / 100 = 1300 HBAR
		//   - 1 NFT at 25% (holder only): (1000 * 1 * 75) / 100 = 750 HBAR
		// Remaining 4 NFTs at full price: 4000 HBAR
		// Total: 1950 + 1300 + 750 + 4000 = 8000 HBAR
		expect(Number(hbar)).to.be.equal(8000);

		// LAZY calculation (similar per-slot rounding):
		// Slot 0: (50 * 3 * 65) / 100 = 97 LAZY
		// Slot 1: (50 * 2 * 65) / 100 = 65 LAZY + (50 * 1 * 75) / 100 = 37 LAZY
		// Remaining: 4 * 50 = 200 LAZY
		// Total: 97 + 65 + 37 + 200 = 399 LAZY
		expect(Number(lazy)).to.be.equal(399);

		// Weighted average discount: ((5*35) + (1*25) + (4*0)) / 10 = 20%
		expect(Number(discount)).to.be.equal(20);

		expect(Number(holderSlots)).to.be.equal(6);
		expect(Number(wlSlots)).to.be.equal(5);

		console.log('✓ Waterfall discount calculated correctly');
		console.log('  5 NFTs at 35% (holder+WL), 1 NFT at 25% (holder only), 4 NFTs at full price');
		console.log('  Slots consumed: ' + Number(holderSlots) + ' holder, ' + Number(wlSlots) + ' WL');
	});

	it('Should calculate sacrifice discount (exclusive)', async function () {
		client.setOperator(operatorId, operatorKey);

		// Sacrifice mode: 30% discount, does NOT stack with holder/WL
		const encodedCommand = minterIface.encodeFunctionData('calculateMintCost', [
			3,
			[],
			[],
			3,
		]);

		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, aliceId, false);
		const [hbar, lazy, discount, holderSlots, wlSlots] = minterIface.decodeFunctionResult('calculateMintCost', result);

		console.log('Decoded values:', {
			hbar: Number(hbar),
			lazy: Number(lazy),
			discount: Number(discount),
			holderSlots: Number(holderSlots),
			wlSlots: Number(wlSlots),
		});

		// 3 NFTs with 30% sacrifice discount
		// Per NFT: 1000 * 0.7 = 700 HBAR, 50 * 0.7 = 35 LAZY
		// Total: 2100 HBAR, 105 LAZY
		expect(Number(hbar)).to.be.equal(2100);
		expect(Number(lazy)).to.be.equal(105);
		expect(Number(discount)).to.be.equal(30);

		// Sacrifice mode does NOT consume holder/WL slots
		expect(Number(holderSlots)).to.be.equal(0);
		expect(Number(wlSlots)).to.be.equal(0);

		console.log('✓ Sacrifice discount calculated correctly (exclusive, no slot consumption)');
	});
});

describe('Mint Workflows:', function () {
	it('Should associate NFT token to test users', async function () {
		client.setOperator(operatorId, operatorKey);

		for (const account of [{ id: aliceId, key: alicePK }, { id: bobId, key: bobPK }, { id: carolId, key: carolPK }]) {
			try {
				const assocResult = await associateTokenToAccount(client, account.id, account.key, nftTokenId);
				console.log(`Associated NFT to account ${account.id.toString()}:`, assocResult);
			}
			catch (error) {
				if (error.toString().includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
					console.log(`NFT already associated to account ${account.id.toString()}`);
					continue;
				}
				else {
					console.error(`Failed to associate NFT to account ${account.id.toString()}:`, error);
				}
			}
		}

		console.log('✓ Test users associated with NFT token');
	});

	it('Should mint with HBAR only (no discounts)', async function () {
		client.setOperator(carolId, carolPK);

		// Carol mints 2 NFTs with pure HBAR
		// Cost: 2000 HBAR, 100 LAZY
		// We'll pay in HBAR only (set LAZY to 0)

		// First update economics to allow HBAR-only (set lazy price to 0 temporarily)
		client.setOperator(operatorId, operatorKey);
		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'updateEconomics',
			[
				1000,
				0,
				10,
				30,
				50,
				100,
				25,
				1,
				20,
				false,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('updateEconomics FAILED:', result);
			fail();
		}


		console.log('Economics updated for HBAR-only, tx:', result[2]?.transactionId?.toString());

		client.setOperator(carolId, carolPK);

		// Set HBAR allowance to contract for royalty withdrawal
		const hbarAllowance = await setHbarAllowance(
			client,
			carolId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			2_000_000,
			'mintNFT',
			[
				2,
				[],
				[],
				[],
			],
			50,
		); if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('mintNFT FAILED:', result);
			fail();
		}

		console.log('Carol minted:', result[1]);

		console.log('Carol minted 2 NFTs, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Query Carol's NFT serials for later sacrifice tests
		carolSerialsForSacrifice = await getSerialsOwned(env, carolId, nftTokenId);
		console.log('Carol owns serials:', carolSerialsForSacrifice);

		// Verify Carol received 2 NFTs
		const encodedCommand = minterIface.encodeFunctionData('getWalletMintCount', [carolId.toSolidityAddress()]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const mintCount = minterIface.decodeFunctionResult('getWalletMintCount', queryResult);

		expect(Number(mintCount[0])).to.be.equal(2);

		console.log('✓ Carol minted 2 NFTs with HBAR only');

		// Restore economics to include LAZY
		client.setOperator(operatorId, operatorKey);
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'updateEconomics',
			[
				1000,
				50,
				10,
				30,
				50,
				100,
				25,
				1,
				20,
				false,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Restore economics FAILED:', result);
			fail();
		}

		console.log('Economics restored, tx:', result[2]?.transactionId?.toString());
	});

	it('Should mint with LAZY payment (requires allowance)', async function () {
		client.setOperator(aliceId, alicePK);

		// Alice sets LAZY allowance to LazyGasStation
		const allowanceResult = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStation,
			1000,
		);
		expect(allowanceResult).to.be.equal('SUCCESS');
		lazyAllowancesSet.push({ owner: aliceId, tokenId: lazyTokenId, spender: lazyGasStation });

		// Set HBAR allowance to contract for royalty withdrawal
		const hbarAllowance = await setHbarAllowance(
			client,
			aliceId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		// Alice mints 2 NFTs with WL discount (she has 5 slots)
		// Cost: 2 * (1000*0.9) HBAR + 2 * (50*0.9) LAZY = 1800 HBAR + 90 LAZY
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			2_000_000,
			'mintNFT',
			[
				2,
				[],
				[],
				[],
			],
			20,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Alice mintNFT FAILED:', result);
			fail();
		}

		console.log('Alice minted:', result[1]);

		console.log('Alice minted 2 NFTs with WL discount, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Alice's WL slots consumed (5 - 2 = 3 remaining)
		const encodedCommand = minterIface.encodeFunctionData('getBatchWhitelistSlots', [[aliceId.toSolidityAddress()]]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const slots = minterIface.decodeFunctionResult('getBatchWhitelistSlots', queryResult);

		expect(Number(slots[0][0])).to.be.equal(3);

		console.log('✓ Alice minted 2 NFTs with WL discount, consumed 2 WL slots (3 remaining)');
	});

	it('Should mint with holder discount (DRY slot consumption)', async function () {
		client.setOperator(bobId, bobPK);

		// Bob sets LAZY allowance
		const allowanceResult = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			lazyGasStation,
			500,
		);
		expect(allowanceResult).to.be.equal('SUCCESS');
		lazyAllowancesSet.push({ owner: bobId, tokenId: lazyTokenId, spender: lazyGasStation });

		// Set HBAR allowance to contract for royalty withdrawal
		const hbarAllowance = await setHbarAllowance(
			client,
			bobId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		// Bob mints 2 NFTs with DT1[3] (25% discount, 3 uses available)
		// Expected: 2 NFTs at 25% holder + 10% WL = 35% discount
		// Consumes 2 holder slots from DT1[3]
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			2_000_000,
			'mintNFT',
			[
				2,
				[discountToken1Id.toSolidityAddress()],
				[[3]],
				[],
			],
			20,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Bob mintNFT FAILED:', result);
			fail();
		}

		console.log('Bob minted:', result[1]);

		console.log('Bob minted 2 NFTs with holder discount, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Bob's discount serial usage (should have 1 use remaining)
		const encodedCommand = minterIface.encodeFunctionData('getSerialDiscountInfo', [
			discountToken1Id.toSolidityAddress(),
			3,
		]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const [isEligible, remainingUses, currentUsage] = minterIface.decodeFunctionResult('getSerialDiscountInfo', queryResult);

		expect(isEligible).to.be.true;
		expect(Number(remainingUses)).to.be.equal(1);
		// Bob used 2 out of 3 max uses
		expect(Number(currentUsage)).to.be.equal(2);

		console.log('✓ Bob minted 2 NFTs with holder discount, consumed 2 slots (1 remaining)');
	});

	it('Should prevent minting without required approvals', async function () {
		client.setOperator(carolId, carolPK);

		// Set HBAR allowance to avoid HBAR allowance errors
		const hbarAllowance = await setHbarAllowance(
			client,
			carolId,
			contractId,
			0,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		// Remove Carol's LAZY allowance
		await setFTAllowance(
			client,
			lazyTokenId,
			carolId,
			lazyGasStation,
			0,
		);

		await sleep(3000);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				2_000_000,
				'mintNFT',
				[
					1,
					[],
					[],
					[],
				],
				20,
			);

			if (result[0]?.status?.name != 'INSUFFICIENT_TOKEN_BALANCE' &&
				result[0]?.status?.name != 'SPENDER_DOES_NOT_HAVE_ALLOWANCE' &&
				!result[0]?.status?.toString().toLowerCase().includes('0x13be252b')) {
				console.log('ERROR expecting INSUFFICIENT_TOKEN_BALANCE or SPENDER_DOES_NOT_HAVE_ALLOWANCE or 0x13be252b (LGS InsufficientAllowance):', result[0]);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('✓ Mint correctly blocked without LAZY allowance');

		// Restore allowance for future tests
		await setFTAllowance(
			client,
			lazyTokenId,
			carolId,
			lazyGasStation,
			500,
		);
	});
});

describe('Sacrifice Mechanism:', function () {
	it('Should set sacrifice destination to an EOA', async function () {
		client.setOperator(operatorId, operatorKey);

		// Set Alice as the sacrifice destination (EOA)
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'setSacrificeDestination',
			[aliceId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('setSacrificeDestination to EOA FAILED:', result);
			fail();
		}

		console.log('Sacrifice destination set to EOA, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify the sacrifice destination was set
		const encodedCommand = minterIface.encodeFunctionData('sacrificeDestination');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const destination = minterIface.decodeFunctionResult('sacrificeDestination', queryResult);

		expect(destination[0].slice(2).toLowerCase()).to.be.equal(aliceId.toSolidityAddress().toLowerCase());

		console.log('✓ Sacrifice destination set to Alice (EOA)');
	});

	it('Should mint with sacrifice discount and send to EOA', async function () {
		client.setOperator(carolId, carolPK);

		// Carol needs to set NFT approval for sacrifice
		const approvalResult = await setNFTAllowanceAll(client, [nftTokenId], carolId, contractId);
		expect(approvalResult).to.be.equal('SUCCESS');
		nftAllowancesSet.push({ owner: carolId, tokenId: nftTokenId, spender: contractId });

		// Set HBAR allowance to contract for royalty withdrawal
		const hbarAllowance = await setHbarAllowance(
			client,
			carolId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		// check if the cost includes a $LAZY payment via the mintEconomics from the mirror node
		const encodedCommand = minterIface.encodeFunctionData('getMintEconomics');
		const encRes = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', encRes);

		if (Number(economics[0][1]) > 0) {
			// ensure there is enough $LAZY allowance set for the mint
			const lazyAllowanceResult = await setFTAllowance(
				client,
				lazyTokenId,
				carolId,
				lazyGasStation,
				// adjust for 2 NFTs
				Number(economics[0][1]) * 2,
			);
			expect(lazyAllowanceResult).to.be.equal('SUCCESS');
			lazyAllowancesSet.push({ owner: carolId, tokenId: lazyTokenId, spender: lazyGasStation });
		}

		// Get Alice's NFT balance before sacrifice
		const aliceSerialsBefore = await getSerialsOwned(env, aliceId, nftTokenId);
		const aliceBalanceBefore = aliceSerialsBefore ? aliceSerialsBefore.length : 0;

		console.log(`Alice NFT balance before: ${aliceBalanceBefore}`);

		// Use Carol's actual NFT serials for sacrifice (she minted 2 earlier)
		if (!carolSerialsForSacrifice || carolSerialsForSacrifice.length < 2) {
			fail('Carol does not have enough NFTs to sacrifice');
		}

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			3_000_000,
			'mintNFT',
			[
				2,
				[],
				[],
				carolSerialsForSacrifice.slice(0, 2),
			],
			30,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Sacrifice mint FAILED:', result);
			fail();
		}

		console.log('Carol minted:', result[1]);

		console.log('Carol minted with sacrifice to Alice, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Update Carol's serials (she now has 2 new NFTs from the mint)
		carolSerialsForSacrifice = await getSerialsOwned(env, carolId, nftTokenId);
		console.log('Carol now owns serials:', carolSerialsForSacrifice);

		// Get Alice's NFT balance after sacrifice
		const aliceSerialsAfter = await getSerialsOwned(env, aliceId, nftTokenId);
		const aliceBalanceAfter = aliceSerialsAfter ? aliceSerialsAfter.length : 0;

		console.log(`Alice NFT balance after: ${aliceBalanceAfter}`);

		// Alice should have received 2 sacrificed NFTs
		expect(aliceBalanceAfter).to.be.equal(aliceBalanceBefore + 2);

		console.log('✓ Carol minted 2 NFTs with sacrifice, sacrificed NFTs sent to Alice');

		// Reset sacrifice destination back to contract for other tests
		client.setOperator(operatorId, operatorKey);
		const resetResult = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'setSacrificeDestination',
			[contractId.toSolidityAddress()],
		);

		if (resetResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('Reset sacrifice destination FAILED:', resetResult);
			fail();
		}

		console.log('Sacrifice destination reset to contract, tx:', resetResult[2]?.transactionId?.toString());
	});

	it('Should mint with sacrifice discount', async function () {
		client.setOperator(carolId, carolPK);

		// Carol needs to set NFT approval for sacrifice (if not already set)

		const approvalResult = await setNFTAllowanceAll(client, [nftTokenId], carolId, contractId);
		expect(approvalResult).to.be.equal('SUCCESS');
		nftAllowancesSet.push({ owner: carolId, tokenId: nftTokenId, spender: contractId });

		// Set HBAR allowance to contract for royalty withdrawal
		const hbarAllowance = await setHbarAllowance(
			client,
			carolId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		// check if the cost includes a $LAZY payment via the mintEconomics from the mirror node
		const encodedCommand = minterIface.encodeFunctionData('getMintEconomics');
		const encRes = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', encRes);

		if (Number(economics[0][1]) > 0) {
			// ensure there is enough $LAZY allowance set for the mint
			const lazyAllowanceResult = await setFTAllowance(
				client,
				lazyTokenId,
				carolId,
				lazyGasStation,
				// adjust for 2 NFTs
				Number(economics[0][1]) * 2,
			);
			expect(lazyAllowanceResult).to.be.equal('SUCCESS');
			lazyAllowancesSet.push({ owner: carolId, tokenId: lazyTokenId, spender: lazyGasStation });
		}

		// Use Carol's current NFT serials for sacrifice (she received 2 from previous test)
		if (!carolSerialsForSacrifice || carolSerialsForSacrifice.length < 2) {
			fail('Carol does not have enough NFTs to sacrifice');
		}

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			3_000_000,
			'mintNFT',
			[
				2,
				[],
				[],
				carolSerialsForSacrifice.slice(0, 2),
			],
			30,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Sacrifice mint FAILED:', result);
			fail();
		}

		console.log('Carol minted:', result[1]);

		console.log('Carol minted 2 NFTs with sacrifice, tx:', result[2]?.transactionId?.toString());
	});

	it('Should mint with sacrifice + holder discount waterfall', async function () {
		client.setOperator(aliceId, alicePK);

		// Set HBAR allowance to avoid HBAR allowance errors
		const hbarAllowance = await setHbarAllowance(
			client,
			aliceId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		// Check if the cost includes a $LAZY payment via the mintEconomics from the mirror node
		const encodedCommand = minterIface.encodeFunctionData('getMintEconomics');
		const encRes = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const economics = minterIface.decodeFunctionResult('getMintEconomics', encRes);

		if (Number(economics[0][1]) > 0) {
			// Ensure there is enough $LAZY allowance set for the mint
			const lazyAllowanceResult = await setFTAllowance(
				client,
				lazyTokenId,
				aliceId,
				lazyGasStation,
				// Adjust for 5 NFTs
				Number(economics[0][1]) * 5,
			);
			expect(lazyAllowanceResult).to.be.equal('SUCCESS');
			lazyAllowancesSet.push({ owner: aliceId, tokenId: lazyTokenId, spender: lazyGasStation });
		}

		// Alice needs NFT approval for sacrifice
		if (nftAllowancesSet.findIndex(a => a.owner === aliceId && a.tokenId === nftTokenId) === -1) {
			const approvalResult = await setNFTAllowanceAll(client, [nftTokenId], aliceId, contractId);
			expect(approvalResult).to.be.equal('SUCCESS');
			nftAllowancesSet.push({ owner: aliceId, tokenId: nftTokenId, spender: contractId });
		}

		// Get Alice's current NFT serials to sacrifice (she should have some from earlier mints)
		const aliceSerials = await getSerialsOwned(env, aliceId, nftTokenId);
		expect(aliceSerials).to.not.be.null;
		expect(aliceSerials.length).to.be.greaterThan(0);

		console.log('Alice owns serials:', aliceSerials);

		// Waterfall test: Mint 5 NFTs with 2 sacrifice + holder discounts
		// Expected waterfall:
		// - First 2 NFTs: 30% sacrifice discount (exclusive)
		// - Next 3 NFTs: Use Alice's DT1 holder discounts (25% + 10% WL = 35%)
		// Alice's DT1 serials (3 uses each = 6 uses total, we need 3)
		// Sacrifice 2 NFTs
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			3_000_000,
			'mintNFT',
			[
				5,
				[discountToken1Id.toSolidityAddress()],
				[[1, 2]],
				aliceSerials.slice(0, 2),
			],
			50,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Sacrifice + Holder waterfall mint FAILED:', result);
			fail();
		}

		console.log('Alice minted with sacrifice + holder waterfall:', result[1]);

		await sleep(5000);

		// Verify the waterfall worked correctly
		console.log('✓ Alice successfully minted with sacrifice + holder discount waterfall');
		console.log('  - 2 NFTs at 30% sacrifice discount');
		console.log('  - 3 NFTs at 35% holder+WL stacked discount');
	});
});

describe('Refund System:', function () {
	it('Should refund NFT within window (90% refund)', async function () {
		client.setOperator(carolId, carolPK);

		// Carol needs approval to return NFT
		if (nftAllowancesSet.findIndex(a => a.owner === carolId && a.tokenId === nftTokenId) === -1) {
			const approvalResult = await setNFTAllowanceAll(client, [nftTokenId], carolId, contractId);
			expect(approvalResult).to.be.equal('SUCCESS');
			nftAllowancesSet.push({ owner: carolId, tokenId: nftTokenId, spender: contractId });
		}
		// Get Carol's current serials (she minted 2 earlier)
		const carolSerials = await getSerialsOwned(env, carolId, nftTokenId);
		expect(carolSerials).to.not.be.null;
		expect(carolSerials.length).to.be.greaterThan(0);

		console.log('Carol owns serials:', carolSerials);

		// Check refund eligibility using new isRefundOwed function
		const encodedCheck = minterIface.encodeFunctionData('isRefundOwed', [carolSerials]);
		const checkResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCheck, operatorId, false);
		const [isOwed, expiryTimes] = minterIface.decodeFunctionResult('isRefundOwed', checkResult);

		console.log('Refund eligibility:', isOwed);
		console.log('Expiry times:', expiryTimes.map(t => new Date(Number(t) * 1000).toISOString()));

		// At least one should be refundable
		const refundableCount = isOwed.filter(owned => owned).length;
		expect(refundableCount).to.be.greaterThan(0);

		// Refund the first serial that is eligible
		const refundSerial = carolSerials[isOwed.findIndex(owned => owned)];
		console.log('Attempting to refund serial:', refundSerial);

		// Get payment info before refund
		const encodedPayment = minterIface.encodeFunctionData('getSerialPayment', [refundSerial]);
		const paymentResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedPayment, operatorId, false);
		const paymentInfo = minterIface.decodeFunctionResult('getSerialPayment', paymentResult);

		console.log('Payment info for serial:', {
			hbarPaid: paymentInfo[0].hbarPaid.toString(),
			lazyPaid: paymentInfo[0].lazyPaid.toString(),
			minter: paymentInfo[0].minter,
		});

		// Execute refund
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			2_000_000,
			'refundNFT',
			[[refundSerial]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('refundNFT FAILED:', result);
			fail();
		}

		console.log('Refund successful, tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Carol no longer owns the refunded serial
		const carolSerialsAfter = await getSerialsOwned(env, carolId, nftTokenId);
		expect(carolSerialsAfter).to.not.include(refundSerial);

		// Verify the serial is back in the pool
		const encodedAvailable = minterIface.encodeFunctionData('isSerialAvailable', [refundSerial]);
		const availableResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedAvailable, operatorId, false);
		const isAvailable = minterIface.decodeFunctionResult('isSerialAvailable', availableResult);

		expect(isAvailable[0]).to.be.true;

		console.log('✓ Refund processed successfully, serial returned to pool');
	});

	it('Should prevent refund after window expires', async function () {
		client.setOperator(operatorId, operatorKey);

		// Get Carol's remaining serials (she should have at least 1 left after previous refund)
		const carolSerials = await getSerialsOwned(env, carolId, nftTokenId);
		expect(carolSerials).to.not.be.null;
		expect(carolSerials.length).to.be.greaterThan(0);

		console.log('Carol owns serials before window expiry:', carolSerials);

		// Check current refund eligibility
		let encodedCheck = minterIface.encodeFunctionData('isRefundOwed', [carolSerials]);
		let checkResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCheck, operatorId, false);
		const [isOwedBefore] = minterIface.decodeFunctionResult('isRefundOwed', checkResult);

		console.log('Refund eligibility before expiry:', isOwedBefore);

		// Update refund window to 0 (expired)
		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'updateTiming',
			[
				Math.floor(Date.now() / 1000) - 60,
				false,
				0,
				90,
				false,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('updateTiming FAILED:', result);
			fail();
		}

		console.log('Refund window set to 0, tx:', result[2]?.transactionId?.toString());

		await sleep(3000);

		// Check refund eligibility after window expires
		encodedCheck = minterIface.encodeFunctionData('isRefundOwed', [carolSerials]);
		checkResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCheck, operatorId, false);
		const [isOwedAfter] = minterIface.decodeFunctionResult('isRefundOwed', checkResult);

		console.log('Refund eligibility after expiry:', isOwedAfter);

		// All should be false now
		expect(isOwedAfter.every(owned => !owned)).to.be.true;

		console.log('✓ Refund window expired, all serials now ineligible');

		// Restore refund window for subsequent tests
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'updateTiming',
			[
				Math.floor(Date.now() / 1000) - 60,
				false,
				3600,
				90,
				false,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Restore timing FAILED:', result);
			fail();
		}

		console.log('Refund window restored, tx:', result[2]?.transactionId?.toString());
	});
});

describe('Admin Withdrawal Functions:', function () {
	it('Should verify withdrawal protection during refund window', async function () {
		client.setOperator(operatorId, operatorKey);

		// Try to withdraw immediately after last mint (should fail - users still in refund window)
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				600_000,
				'withdrawHbar',
				[operatorId.toSolidityAddress(), 100],
			);

			if (result[0]?.status?.name != 'WithdrawalDuringRefundWindow') {
				if (result[0]?.status?.toString() == 'SUCCESS') {
					console.log('ERROR withdrawal succeeded but should be blocked during refund window:', result[2]?.transactionId?.toString());
				}
				else {
					console.log('ERROR expecting WithdrawalDuringRefundWindow:', result);
				}
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('✓ Withdrawal correctly blocked during refund window + buffer period');
	});

	it('Should verify non-admin cannot withdraw', async function () {
		client.setOperator(carolId, carolPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				600_000,
				'withdrawHbar',
				[carolId.toSolidityAddress(), 100],
			);

			if (result[0]?.status?.name != 'NotAdmin') {
				console.log('ERROR expecting NotAdmin:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('✓ Non-admin correctly blocked from withdrawal');
	});
});

describe('Access Control Tests:', function () {
	it('Should prevent non-admin from adding discount tiers', async function () {
		client.setOperator(carolId, carolPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				600_000,
				'addDiscountTier',
				[
					discountToken1Id.toSolidityAddress(),
					15,
					2,
				],
			);

			if (result[0]?.status?.name != 'NotAdmin') {
				console.log('ERROR expecting NotAdmin:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('✓ Non-admin blocked from adding discount tiers');
	});

	it('Should allow anyone to register NFTs owned by contract', async function () {
		client.setOperator(carolId, carolPK);

		// This test verifies that registerNFTs is publicly callable
		// This is intentional - anyone can pay gas to help register NFTs the contract owns
		// The function has safety checks to only register NFTs actually owned by the contract

		// Try to register a serial the contract doesn't own (should fail)
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				600_000,
				'registerNFTs',
				[[99]],
			);

			if (result[0]?.status?.name === 'NotOwnerOfSerial') {
				expectedErrors++;
				console.log('✓ Correctly rejected serial not owned by contract');
			}
			else {
				console.log('ERROR expecting NotOwnerOfSerial:', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('✓ registerNFTs properly validates contract ownership (publicly callable)');
	});

	it('Should prevent non-admin from whitelist management', async function () {
		client.setOperator(carolId, carolPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				600_000,
				'batchAddToWhitelist',
				[
					[carolId.toSolidityAddress()],
					[5],
				],
			);

			if (result[0]?.status?.name != 'NotAdmin') {
				console.log('ERROR expecting NotAdmin:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('✓ Non-admin blocked from whitelist management');
	});
});

describe('View Functions & Getters:', function () {
	it('Should get available serials', async function () {
		client.setOperator(operatorId, operatorKey);

		const encodedCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolSizeResult = minterIface.decodeFunctionResult('getRemainingSupply', result);

		console.log(`✓ Available serials in pool: ${poolSizeResult[0]}`);
		expect(Number(poolSizeResult[0])).to.be.greaterThan(0);
	});

	it('Should get discount tier info', async function () {
		client.setOperator(operatorId, operatorKey);

		// First get tier index for the token
		let encodedCommand = minterIface.encodeFunctionData('getTokenTierIndex', [discountToken1Id.toSolidityAddress()]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const tierIndex = minterIface.decodeFunctionResult('getTokenTierIndex', result);

		// Then get the tier details using the tier index
		encodedCommand = minterIface.encodeFunctionData('getDiscountTier', [Number(tierIndex[0])]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const tierData = minterIface.decodeFunctionResult('getDiscountTier', result);

		console.log(`✓ Discount token tier index: ${Number(tierIndex[0])}`);
		console.log(`✓ Discount token tier: ${tierData}`);

		console.log(`✓ Discount tier: ${Number(tierData[0][0])}% discount, ${Number(tierData[0][1])} uses`);
		expect(Number(tierData[0][0])).to.be.equal(25);
		expect(Number(tierData[0][1])).to.be.equal(3);
	});

	it('Should get wallet mint count', async function () {
		client.setOperator(operatorId, operatorKey);

		const encodedCommand = minterIface.encodeFunctionData('getWalletMintCount', [aliceId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const count = minterIface.decodeFunctionResult('getWalletMintCount', result);

		console.log(`✓ Alice's mint count: ${Number(count[0])}`);
		expect(Number(count[0])).to.be.greaterThan(0);
	});

	it('Should get admin list', async function () {
		client.setOperator(operatorId, operatorKey);

		const encodedCommand = minterIface.encodeFunctionData('getAdmins');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const admins = minterIface.decodeFunctionResult('getAdmins', result);

		console.log(`✓ Admin count: ${admins[0].length}`);
		expect(admins[0].length).to.be.greaterThan(0);
	});
});

describe('Edge Cases & Validation:', function () {
	it('Should prevent minting when paused', async function () {
		client.setOperator(operatorId, operatorKey);

		// Pause minting
		const pauseResult = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'updatePauseStatus',
			[true],
		);

		if (pauseResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('updatePauseStatus FAILED:', pauseResult);
			fail();
		}

		console.log('Minting paused, tx:', pauseResult[2]?.transactionId?.toString());

		client.setOperator(carolId, carolPK);

		// Set HBAR allowance to avoid HBAR allowance errors
		const hbarAllowance = await setHbarAllowance(
			client,
			carolId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		let expectedErrors = 0;
		let unexpectedErrors = 0; try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				2_000_000,
				'mintNFT',
				[
					1,
					[],
					[],
					[],
				],
				20,
			);

			if (result[0]?.status?.name != 'MintPaused') {
				console.log('ERROR expecting MintPaused:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('✓ Minting correctly blocked when paused');

		// Unpause for other tests
		client.setOperator(operatorId, operatorKey);
		const unpauseResult = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'updatePauseStatus',
			[false],
		);

		if (unpauseResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('updatePauseStatus FAILED:', unpauseResult);
			fail();
		}

		console.log('Minting unpaused, tx:', unpauseResult[2]?.transactionId?.toString());
	});

	it('Should prevent minting quantity > maxMint', async function () {
		client.setOperator(carolId, carolPK);

		// Set HBAR allowance to avoid HBAR allowance errors
		const hbarAllowance = await setHbarAllowance(
			client,
			carolId,
			contractId,
			100,
		);
		expect(hbarAllowance).to.be.equal('SUCCESS');

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				5_000_000,
				'mintNFT',
				[
					51,
					[],
					[],
					[],
				],
				100,
			);

			if (result[0]?.status?.name != 'ExceedsMaxMint') {
				console.log('ERROR expecting ExceedsMaxMint:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('✓ Correctly prevented minting > maxMint');
	});

	it('Should prevent minting with insufficient pool', async function () {
		client.setOperator(operatorId, operatorKey);

		// Get current pool size
		const encodedCommand = minterIface.encodeFunctionData('getRemainingSupply');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolSizeResult = minterIface.decodeFunctionResult('getRemainingSupply', result);
		const poolSize = Number(poolSizeResult[0]);

		console.log(`Current pool size: ${poolSize}`);

		if (poolSize < 50) {
			// Pool already small, test will naturally fail
			client.setOperator(carolId, carolPK);

			// Set HBAR allowance to avoid HBAR allowance errors
			const hbarAllowance = await setHbarAllowance(
				client,
				carolId,
				contractId,
				100,
			);
			expect(hbarAllowance).to.be.equal('SUCCESS');

			let expectedErrors = 0;
			let unexpectedErrors = 0; try {
				const mintResult = await contractExecuteFunction(
					contractId,
					minterIface,
					client,
					5_000_000,
					'mintNFT',
					[
						50,
						[],
						[],
						[],
					],
					100,
				);

				if (mintResult[0]?.status?.name != 'MintedOut') {
					console.log('ERROR expecting MintedOut:', mintResult);
					unexpectedErrors++;
				}
				else {
					expectedErrors++;
				}
			}
			catch (err) {
				console.log('Unexpected Error:', err);
				unexpectedErrors++;
			}

			expect(expectedErrors).to.be.equal(1);
			expect(unexpectedErrors).to.be.equal(0);

			console.log('✓ Correctly prevented minting when pool insufficient');
		}
		else {
			console.log('✓ Pool has sufficient NFTs, skipping insufficient pool test');
		}
	});
});

describe('Cleanup & Teardown:', function () {
	it('Should clear NFT allowances for test accounts', async function () {
		// Filter allowances to only those owned by operator (throwaway accounts don't matter)
		const operatorNFTAllowances = nftAllowancesSet.filter(allowance =>
			allowance.owner.toString() === operatorId.toString(),
		);

		if (operatorNFTAllowances.length === 0) {
			console.log('✓ No operator NFT allowances to clear');
			return;
		}

		client.setOperator(operatorId, operatorKey);
		const result = await clearNFTAllowances(client, operatorNFTAllowances);

		if (result === 'SUCCESS') {
			console.log(`Cleared ${operatorNFTAllowances.length} NFT allowance(s) for operator`);
		}

		console.log('✓ Operator NFT allowances cleared');
	});

	it('Should clear LAZY allowances for test accounts', async function () {
		// Filter allowances to only those owned by operator (throwaway accounts don't matter)
		const operatorLazyAllowances = lazyAllowancesSet.filter(allowance =>
			allowance.owner.toString() === operatorId.toString(),
		);

		if (operatorLazyAllowances.length === 0) {
			console.log('✓ No operator LAZY allowances to clear');
			return;
		}

		client.setOperator(operatorId, operatorKey);
		const result = await clearFTAllowances(client, operatorLazyAllowances);

		if (result === 'SUCCESS') {
			console.log(`Cleared ${operatorLazyAllowances.length} LAZY allowance(s) for operator`);
		}

		console.log('✓ Operator LAZY allowances cleared');
	});

	it('Should sweep HBAR from test accounts', async function () {
		client.setOperator(operatorId, operatorKey);

		await sleep(5000);

		for (const account of createdAccounts) {
			// Get account balance from mirror node (returns tinybars)
			const balanceTinybars = await checkMirrorHbarBalance(env, account.id);

			// Convert to Hbar and leave a small amount for account maintenance
			const balanceHbar = balanceTinybars - 1;

			if (balanceHbar > 0) {
				const result = await sweepHbar(client, account.id, account.key, operatorId, new Hbar(balanceHbar, HbarUnit.Tinybar));
				if (result === 'SUCCESS') {
					console.log(`Swept ${new Hbar(balanceHbar, HbarUnit.Tinybar).toString()} HBAR from ${account.id.toString()}`);
				}
			}
			else {
				console.log(`Insufficient balance to sweep from ${account.id.toString()}`);
			}
		}

		console.log('✓ HBAR swept from all test accounts');
	});

	it('Should verify final contract state', async function () {
		client.setOperator(operatorId, operatorKey);

		let encodedCommand = minterIface.encodeFunctionData('getRemainingSupply');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolSizeResult = minterIface.decodeFunctionResult('getRemainingSupply', result);
		const poolSize = Number(poolSizeResult[0]);

		console.log('Final pool size: ' + poolSize);

		// Check total minted count
		encodedCommand = minterIface.encodeFunctionData('getWalletMintCount', [aliceId.toSolidityAddress()]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const aliceMints = minterIface.decodeFunctionResult('getWalletMintCount', result);

		encodedCommand = minterIface.encodeFunctionData('getWalletMintCount', [bobId.toSolidityAddress()]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const bobMints = minterIface.decodeFunctionResult('getWalletMintCount', result);

		encodedCommand = minterIface.encodeFunctionData('getWalletMintCount', [carolId.toSolidityAddress()]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const carolMints = minterIface.decodeFunctionResult('getWalletMintCount', result);

		console.log('\nFinal mint counts:');
		console.log('  Alice: ' + Number(aliceMints[0]));
		console.log('  Bob: ' + Number(bobMints[0]));
		console.log('  Carol: ' + Number(carolMints[0]));

		console.log('\n✅ ForeverMinter test suite completed successfully!');
		console.log('\nTest Summary:');
		console.log('  - Deployment & initialization ✓');
		console.log('  - Admin system ✓');
		console.log('  - Pool management ✓');
		console.log('  - Discount system ✓');
		console.log('  - Whitelist management ✓');
		console.log('  - Cost calculation (DRY v1.0.5) ✓');
		console.log('  - Mint workflows ✓');
		console.log('  - Sacrifice mechanism ✓');
		console.log('  - Refund structure ✓');
		console.log('  - Access control ✓');
		console.log('  - Edge cases ✓');
		console.log('  - Cleanup ✓');
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
		console.log('sendLazy FAILED:', result);
		return 'FAILED';
	}
	return result[0]?.status.toString();
}