const {
	Client,
	AccountId,
	PrivateKey,
	Hbar,
	ContractFunctionParameters,
	HbarUnit,
	TokenId,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const {
	contractDeployFunction,
	readOnlyEVMFromMirrorNode,
	contractExecuteFunction,
	linkBytecode,
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
} = require('../utils/hederaHelpers');
const { checkMirrorBalance, checkMirrorHbarBalance } = require('../utils/hederaMirrorHelpers');
const { fail } = require('assert');
const { ethers } = require('ethers');

require('dotenv').config();

// Get operator from .env file
let operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
let operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundMinter';
const libraryName = 'MinterLibrary';
const lazyContractCreator = 'FungibleTokenCreator';
const env = process.env.ENVIRONMENT ?? null;
const lazyBurnPerc = 25;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let client, clientAlice;
let alicePK, aliceId;
let wlTokenId, extendedTestingTokenId;
let lazyTokenId, lazySCT;
let minterIface, lazyIface;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('Deployment: ', function() {
	it('Should deploy the contract and setup conditions', async function() {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENIVRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			clientAlice = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			clientAlice = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			clientAlice = Client.forPreviewnet();
			console.log('testing in *PREVIEWNET*');
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('testing in *LOCAL*');
			const rootId = AccountId.fromString('0.0.2');
			const rootKey = PrivateKey.fromStringECDSA(
				'302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137',
			);

			// create an operator account on the local node and use this for testing as operator
			client.setOperator(rootId, rootKey);
			operatorKey = PrivateKey.generateED25519();
			operatorId = await accountCreator(client, operatorKey, 1000);
		}
		else {
			console.log(
				'ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file',
			);
			return;
		}

		client.setOperator(operatorId, operatorKey);
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		// create Alice account
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(client, alicePK, 200);
		console.log('Alice account ID:', aliceId.toString(), '\nkey:', alicePK.toString());
		clientAlice.setOperator(aliceId, alicePK);

		// check if a $LAZY FT has been specified else deploy one
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);

		// import ABIs
		lazyIface = new ethers.Interface(lazyJson.abi);

		const lazyContractBytecode = lazyJson.bytecode;

		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			console.log(
				'\n-Using existing LAZY SCT:',
				process.env.LAZY_SCT_CONTRACT_ID,
			);
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);

			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			console.log('\n-Using existing LAZY Token ID:', lazyTokenId.toString());
		}
		else {
			const gasLimit = 800_000;

			console.log(
				'\n- Deploying contract...',
				lazyContractCreator,
				'\n\tgas@',
				gasLimit,
			);

			[lazySCT] = await contractDeployFunction(client, lazyContractBytecode, gasLimit);

			console.log(
				`Lazy Token Creator contract created with ID: ${lazySCT} / ${lazySCT.toSolidityAddress()}`,
			);

			expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;

			// mint the $LAZY FT
			await mintLazy(
				'Test_Lazy',
				'TLazy',
				'Test Lazy FT',
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				LAZY_DECIMAL,
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				30,
			);
			console.log('$LAZY Token minted:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;

		// check if operator has $LAZY tokens on hand else draw down from the Lazy SCT
		const operatorLazyBal = await checkMirrorBalance(env, operatorId, lazyTokenId);
		if (!operatorLazyBal || operatorLazyBal < 50) {
			// check if operatorLazyBal is null, if so associate the token
			if (operatorLazyBal == null) {
				const result = await associateTokenToAccount(client, operatorId, operatorKey, lazyTokenId);
				expect(result).to.be.equal('SUCCESS');
			}

			// pull down some $LAZY from the Lazy SCT
			const result = await sendLazy(operatorId, 50);
			expect(result).to.be.equal('SUCCESS');
		}

		// deploy library contract
		console.log('\n-Deploying library:', libraryName);

		const libraryBytecode = JSON.parse(fs.readFileSync(`./artifacts/contracts/${libraryName}.sol/${libraryName}.json`)).bytecode;

		const [libContractId] = await contractDeployFunction(client, libraryBytecode, 500_000);
		console.log(`Library created with ID: ${libContractId} / ${libContractId.toSolidityAddress()}`);

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		const contractBytecode = json.bytecode;

		// replace library address in bytecode
		console.log('\n-Linking library address in bytecode...');
		const readyToDeployBytecode = linkBytecode(contractBytecode, [libraryName], [libContractId]);

		// import ABI
		minterIface = new ethers.Interface(json.abi);

		const gasLimit = 1600000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazySCT.toSolidityAddress())
			.addAddress(lazyTokenId.toSolidityAddress())
			.addUint256(lazyBurnPerc)
			.addBool(false);

		[contractId, contractAddress] = await contractDeployFunction(client, readyToDeployBytecode, gasLimit, constructorParams);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		console.log('\n-Testing:', contractName);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		// check if Alice has $LAZY associated else associate the token
		const aliceLazyBal = await checkMirrorBalance(env, aliceId, lazyTokenId);
		if (aliceLazyBal == null) {
			const result = await associateTokenToAccount(client, aliceId, alicePK, lazyTokenId);
			expect(result).to.be.equal('SUCCESS');
		}
	});

	it('should mint an NFT to use as the WL token', async function() {
		client.setOperator(operatorId, operatorKey);
		const result = await mintNFT(client, operatorId, 'MinterContractWL ' + new Date().toISOString(), 'MCWL', 10, 75);
		wlTokenId = result[1];
		console.log('\n- NFT minted @', wlTokenId.toString());
		expect(result[0]).to.be.equal('SUCCESS');

		// associate the WL token for Alice
		const result2 = await associateTokenToAccount(client, aliceId, alicePK, wlTokenId);
		expect(result2).to.be.equal('SUCCESS');
	});

	it('Ensure Alice & Contract are a little LAZY (send some to prime the pumps)', async function() {
		client.setOperator(operatorId, operatorKey);
		let result = await sendLazy(AccountId.fromString(contractId.toString()), 10);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(aliceId, 20);
		expect(result).to.be.equal('SUCCESS');
	});
});

describe('Check SC deployment...', function() {
	it('Check Lazy token was associated by constructor', async function() {
		// let mirror node catch up
		await sleep(5000);

		client.setOperator(operatorId, operatorKey);
		const contractLazyBal = await checkMirrorBalance(env, AccountId.fromString(contractId.toString()), lazyTokenId);
		expect(contractLazyBal == 10).to.be.true;
	});

	it('Check linkage to Lazy token / LSCT is correct', async function() {
		client.setOperator(operatorId, operatorKey);

		let encodedCommand = minterIface.encodeFunctionData('getLSCT');

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const addressLSCT = minterIface.decodeFunctionResult('getLSCT', result);
		expect(addressLSCT[0].slice(2).toLowerCase()).to.be.equal(lazySCT.toSolidityAddress());

		// now check the lazy token with getLazyToken
		encodedCommand = minterIface.encodeFunctionData('getLazyToken');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const addressLazyToken = minterIface.decodeFunctionResult('getLazyToken', result);
		expect(addressLazyToken[0].slice(2).toLowerCase()).to.be.equal(lazyTokenId.toSolidityAddress());
	});

	it('Check default values are set in Constructor', async function() {
		client.setOperator(operatorId, operatorKey);
		// check the default values
		let encodedCommand = minterIface.encodeFunctionData('getBatchSize');

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const batchSize = minterIface.decodeFunctionResult('getBatchSize', result);
		expect(Number(batchSize[0])).to.be.equal(1);

		// check the lazy burn percentage
		encodedCommand = minterIface.encodeFunctionData('getLazyBurnPercentage');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const lazyBurn = minterIface.decodeFunctionResult('getLazyBurnPercentage', result);
		expect(Number(lazyBurn[0])).to.be.equal(lazyBurnPerc);

		// check the cost
		encodedCommand = minterIface.encodeFunctionData('getCost');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [hbarCost, lazyCost] = minterIface.decodeFunctionResult('getCost', result);

		expect(Number(hbarCost)).to.be.equal(0);
		expect(Number(lazyCost)).to.be.equal(0);

		// check the mint economics
		encodedCommand = minterIface.encodeFunctionData('getMintEconomics');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const mintEconomics = minterIface.decodeFunctionResult('getMintEconomics', result);

		expect(!mintEconomics[0][0]).to.be.true;
		expect(Number(mintEconomics[0][1])).to.be.equal(0);
		expect(Number(mintEconomics[0][2])).to.be.equal(0);
		expect(Number(mintEconomics[0][3])).to.be.equal(0);
		expect(Number(mintEconomics[0][4])).to.be.equal(1);
		expect(Number(mintEconomics[0][5])).to.be.equal(0);
		expect(Number(mintEconomics[0][6])).to.be.equal(1);
		expect(Number(mintEconomics[0][7])).to.be.equal(1);
		expect(mintEconomics[0][8]).to.be.equal(ZERO_ADDRESS);

		// check the mint timing
		encodedCommand = minterIface.encodeFunctionData('getMintTiming');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const mintTiming = minterIface.decodeFunctionResult('getMintTiming', result);

		expect(Number(mintTiming[0][0])).to.be.equal(0);

		// check the remaining mint
		encodedCommand = minterIface.encodeFunctionData('getRemainingMint');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const remainingMint = minterIface.decodeFunctionResult('getRemainingMint', result);

		expect(Number(remainingMint[0])).to.be.equal(0);

		// check the number minted
		encodedCommand = minterIface.encodeFunctionData('getNumberMintedByAddress');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const numMinted = minterIface.decodeFunctionResult('getNumberMintedByAddress', result);

		expect(Number(numMinted[0])).to.be.equal(0);

		// check the number minted by WL
		encodedCommand = minterIface.encodeFunctionData('getNumberMintedByWlAddress');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const wlNumMinted = minterIface.decodeFunctionResult('getNumberMintedByWlAddress', result);

		expect(Number(wlNumMinted[0])).to.be.equal(0);
	});

	it('Initialise the minter for a token with no Fees to check it works', async function() {
		const metadataList = ['metadata.json'];

		// set metadata seperately
		const [success, totalLoaded] = await uploadMetadata(metadataList);
		expect(success).to.be.equal('SUCCESS');
		expect(totalLoaded == 1).to.be.true;

		// execute the initialiseNFTMint function
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_000_000,
			'initialiseNFTMint',
			[
				'MC-test',
				'MCt',
				'MC testing memo',
				'ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/',
				0,
				false,
				false,
			],
			MINT_PAYMENT,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
		const tokenId = TokenId.fromSolidityAddress(result[1][0]);
		console.log('Token Created:', tokenId.toString(), 'tx:', result[2]?.transactionId?.toString());
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Cannot add more metadata - given no capacity', async function() {
		client.setOperator(operatorId, operatorKey);
		let expectedErrors = 0;
		let unexpectedErrors = 0;
		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				500_000,
				'addMetadata',
				[['meta1', 'meta2']],
			);

			if (result[0]?.status?.name != 'TooMuchMetadata') {
				console.log('ERROR expecting TooMuchMetadata:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}
		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Initialise the for a token wth additional headroom', async function() {
		client.setOperator(operatorId, operatorKey);

		// reset metadata using resetContract
		const reset = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'resetContract',
			[true, 100],
		);
		if (reset[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', reset);
			fail();
		}

		console.log('Contract Reset TX:', reset[2]?.transactionId?.toString());

		const metadataList = ['metadata.json'];

		// set metadata seperately
		const [success, totalLoaded] = await uploadMetadata(metadataList);
		expect(success).to.be.equal('SUCCESS');
		expect(totalLoaded == 1).to.be.true;

		// execute the initialiseNFTMint function
		const newMint = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_000_000,
			'initialiseNFTMint',
			[
				'MC-test',
				'MCt',
				'MC testing memo',
				'ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/',
				3,
				false,
				false,
			],
			MINT_PAYMENT,
		);

		if (newMint[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', newMint);
			fail();
		}
		const tokenId = TokenId.fromSolidityAddress(newMint[1][0]);
		console.log('Token Created:', tokenId.toString());
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Can add more metadata - given spare capacity', async function() {
		client.setOperator(operatorId, operatorKey);
		let expectedErrors = 0;
		let unexpectedErrors = 0;
		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				500_000,
				'addMetadata',
				[['meta1', 'meta2']],
			);

			if (result[0]?.status?.toString() != 'SUCCESS') {
				console.log('error adding metadata', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}
		// now expect failure as at capacity
		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				500_000,
				'addMetadata',
				[['meta1', 'meta2']],
			);

			if (result[0]?.status?.name != 'TooMuchMetadata') {
				console.log('ERROR expecting TooMuchMetadata:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}
		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Re-initialise the minter **AS SBT EDITION (unlimited)**', async function() {
		// testing with one fallback and one without fallback for generalised case
		client.setOperator(operatorId, operatorKey);

		// reset metadata
		const reset = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'resetContract',
			[true, 10],
		);
		if (reset[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', reset);
			fail();
		}

		const newMint = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_600_000,
			'initialiseNFTMint',
			[
				'MC-test-unlimited',
				'MCt-ultd',
				'MC testing memo unltd',
				'ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/metadata.json',
				0,
				true,
				true,
			],
			MINT_PAYMENT,
		);

		if (newMint[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', newMint);
			fail();
		}

		const tokenId = TokenId.fromSolidityAddress(newMint[1][0]);
		console.log('Token Created:', tokenId.toString(), ' / ', tokenId.toSolidityAddress());
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;

		// pass the token on to the later methods.
		extendedTestingTokenId = tokenId;
		console.log('Token ID for Extended Testing (Unlimited mints):', tokenId.toString(), 'Supply:', Number(newMint[1][1]));
	});

	it('Re-initialise the minter **AS SBT EDITION**', async function() {
		// testing with one fallback and one without fallback for generalised case
		client.setOperator(operatorId, operatorKey);

		// reset metadata
		const reset = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'resetContract',
			[true, 10],
		);
		if (reset[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', reset);
			fail();
		}

		const newMint = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_600_000,
			'initialiseNFTMint',
			[
				'MC-test',
				'MCt',
				'MC testing memo',
				'ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/metadata.json',
				180,
				true,
				false,
			],
			MINT_PAYMENT,
		);

		if (newMint[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', newMint);
			fail();
		}

		const tokenId = TokenId.fromSolidityAddress(newMint[1][0]);
		console.log('Token Created:', tokenId.toString(), ' / ', tokenId.toSolidityAddress());
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;
		expect(Number(newMint[1][1]) == 180).to.be.true;

		// pass the token on to the later methods.
		extendedTestingTokenId = tokenId;
		console.log('Token ID for Extended Testing:', tokenId.toString());
	});

	it('Owner cannot set batch size to bad values', async function() {
		client.setOperator(operatorId, operatorKey);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				300_000,
				'updateBatchSize',
				[0],
			);

			if (result[0]?.status?.name != 'BadArguments') {
				console.log('ERROR expecting BadArguments:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				300_000,
				'updateBatchSize',
				[11],
			);

			if (result[0]?.status?.name != 'BadArguments') {
				console.log('ERROR expecting BadArguments:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(2);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Owner can update batch value if needed', async function() {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'updateBatchSize',
			[10],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		expect(Boolean(result[1][0])).to.be.true;

	});

	it('Successfully update CID', async function() {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'updateCID',
			['ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/metadata.json'],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
	});
});

describe('Check access control permission...', function() {
	it('Check Alice cannot modify LAZY token ID', async function() {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateLazyToken',
				[TokenId.fromString('0.0.48486075').toSolidityAddress()],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify LSCT', async function() {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateLSCT',
				[ContractId.fromString('0.0.48627791').toSolidityAddress()],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the WL', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'addToWhitelist',
				[[aliceId.toSolidityAddress()]],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'removeFromWhitelist',
				[[aliceId.toSolidityAddress()]],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(2);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the CID/metadata', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateCID',
				['newCIDstring'],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the cost', async function() {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateCost',
				[BigInt(1), 1],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot update the wlToken', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateWlToken',
				[wlTokenId.toSolidityAddress()],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the batch sizing', async function() {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateBatchSize',
				[5],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the Lazy Burn Precentage', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateLazyBurnPercentage',
				[1],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the max mint', async function() {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateMaxMint',
				[1],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the cooldown timer', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateCooldown',
				[4],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the start date', async function() {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateMintStartTime',
				[parseInt((new Date().getTime() / 1000) + 30)],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify the pause status', async function() {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updatePauseStatus',
				[false],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot modify flag to spend lazy from contract', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateContractPaysLazy',
				[false],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot turn on WL', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateWlOnlyStatus',
				[true],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot adjust max mint for WL addresses', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'setMaxWlAddressMint',
				[2],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot adjust max mints per wallet', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'updateMaxMintPerWallet',
				[2],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannot enable buying WL with $LAZY', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'setBuyWlWithLazy',
				[1],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable: caller is not the owner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('Basic interaction with the Minter...', function() {
	it('Associate the token to Operator/Alice', async function() {
		client.setOperator(operatorId, operatorKey);
		let result = await associateTokenToAccount(client, operatorId, operatorKey, extendedTestingTokenId);
		expect(result).to.be.equal('SUCCESS');
		// no longer able to let the SC execute the association for Alice (due to security model shift)
		result = await associateTokenToAccount(client, aliceId, alicePK, extendedTestingTokenId);
		expect(result).to.be.equal('SUCCESS');
	});

	it('Check unable to mint if contract paused (then unpause)', async function() {
		client.setOperator(operatorId, operatorKey);
		const hbarCost = new Hbar(1);

		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'updateCost',
			[BigInt(hbarCost.toTinybars()), 1],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'updatePauseStatus',
			[true],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		// need to set allowance of $LAZY to the SC to allow payment of the FT amount.
		result = await setFTAllowance(client, lazyTokenId, operatorId, AccountId.fromString(contractId.toString()), 5);

		expect(result).to.be.equal('SUCCESS');

		// attempt to mint via the SC expecting failure as PAUSED.

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				800_000,
				'mintNFT',
				[1],
				hbarCost,
			);

			if (result[0]?.status?.name != 'Paused') {
				console.log('ERROR expecting Paused:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		// unpause the contract
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'updatePauseStatus',
			[false],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
	});

	it('Check unable to mint if not yet at start time', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'updateCost',
			[BigInt(tinybarCost), 1],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
		// set start time 8 seconds in future
		const futureTime = parseInt(Math.floor(new Date().getTime() / 1000) + 8);

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'updateMintStartTime',
			[futureTime],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		// set the $LAZY allowance
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		// set the $LAZY allowance
		result = await setFTAllowance(client, lazyTokenId, operatorId, AccountId.fromString(contractId.toString()), 10);

		expect(result).to.be.equal('SUCCESS');

		try {
			result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				800_000,
				'mintNFT',
				[1],
				new Hbar(1),
			);

			if (result[0]?.status?.name != 'NotOpen') {
				console.log('ERROR expecting NotOpen:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		// sleep until past the start time
		const now = Math.floor(new Date().getTime() / 1000);
		const sleepTime = Math.max((futureTime - now) * 1000, 0);
		// console.log(futureTime, '\nSleeping to wait for the mint to start...', sleepTime, '(milliseconds)');
		await sleep(sleepTime + 1125);
	});

	it('Check **ABLE** to mint once start time has passed', async function() {
		client.setOperator(operatorId, operatorKey);

		const encodedCommand = minterIface.encodeFunctionData('getMintTiming');

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const mintTiming = minterIface.decodeFunctionResult('getMintTiming', result);

		// sleep to ensure past the start time
		const mintStart = Number(mintTiming[0][1]);
		const now = Math.floor(new Date().getTime() / 1000);
		const sleepTime = Math.max((mintStart - now) * 1000, 0);
		// console.log(mintStart, '\nSleeping to wait for the mint to start...', sleepTime, '(milliseconds)');
		await sleep(sleepTime + 1125);

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'mintNFT',
			[1],
			new Hbar(1),
		);
		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
		expect(result[1][0].length == 1).to.be.true;

		console.log('Token Minted (1):', result[2].transactionId.toString());

		let expectedErrors = 0;
		let unexpectedErrors = 0;
		// check we can't transfer the token to Alice given it is a SBT
		try {
			result = await sendNFT(client, operatorId, aliceId, extendedTestingTokenId, [1]);
			console.log('ERROR expecting NotTransferable:', result);
			unexpectedErrors++;
		}
		catch (err) {
			if (err?.status?.toString().includes('ACCOUNT_FROZEN_FOR_TOKEN')) {
				expectedErrors++;
			}
			else {
				console.log('Unxpected Error:', err);
				unexpectedErrors++;
			}
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('Test out WL functions...', function() {
	it('Enable Adress Based WL, check WL empty', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(0).toTinybars();

		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'updateCost',
			[BigInt(tinybarCost), 0],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
		// shift to WL only mode
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'updateWlOnlyStatus',
			[true],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		const encodedCommand = minterIface.encodeFunctionData('getWhitelist');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const wl = minterIface.decodeFunctionResult('getWhitelist', result);

		expect(wl[0].length == 0).to.be.true;
	});

	it('Check Alice is unable to mint ', async function() {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;


		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				800_000,
				'mintNFT',
				[1],
				new Hbar(1),
			);

			if (result[0]?.status?.name != 'NotWL') {
				console.log('ERROR expecting NotWL:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Add Alice to WL & can mint', async function() {
		client.setOperator(operatorId, operatorKey);

		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'addToWhitelist',
			[[aliceId.toSolidityAddress()]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		client.setOperator(aliceId, alicePK);

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'mintNFT',
			[1],
		);
		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
		expect(result[1][0].length == 1).to.be.true;

		console.log('Token Minted (Alice x 1):', result[2].transactionId.toString());
	});

	it('Check Owner can get WL / mint history', async function() {
		client.setOperator(operatorId, operatorKey);
		// call getNumberMintedByAllAddresses from the mirror node
		const encodedCommand = minterIface.encodeFunctionData('getNumberMintedByAllAddresses');

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const minted = minterIface.decodeFunctionResult('getNumberMintedByAllAddresses', result);


		let walletList = minted[0];
		let numMints = minted[1];
		let totalMinted = 0;

		for (let w = 0; w < walletList.length; w++) {
			console.log('Regular mint:', AccountId.fromEvmAddress(0, 0, walletList[w]).toString(), Number(numMints[w]));
			totalMinted += Number(numMints[w]);
		}

		// now call getNumberMintedByAllWlAddresses from the mirror node

		const encodedCommand2 = minterIface.encodeFunctionData('getNumberMintedByAllWlAddresses');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand2,
			operatorId,
			false,
		);

		const wlMinted = minterIface.decodeFunctionResult('getNumberMintedByAllWlAddresses', result);

		walletList = wlMinted[0];
		numMints = wlMinted[1];
		let totalWlMints = 0;

		for (let w = 0; w < walletList.length; w++) {
			console.log('WL mint:', AccountId.fromEvmAddress(0, 0, walletList[w]).toString(), Number(numMints[w]));
			totalWlMints += Number(numMints[w]);
		}
		expect(totalMinted > totalWlMints).to.be.true;
	});

	it('Enables buying WL based on serial', async function() {
		client.setOperator(operatorId, operatorKey);
		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'updateWlToken',
			[wlTokenId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'setMaxWlAddressMint',
			[1],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		// setup mint costs
		const tinybarCost = new Hbar(1).toTinybars();

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'updateCost',
			[BigInt(tinybarCost), 0],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		// buy WL for operator
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'buyWlWithTokens',
			[[1]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		expect(Number(result[1][0]) == 1).to.be.true;

		// send two NFTs to Alice to check she can buy WL with the serials
		await sendNFT(
			client,
			operatorId,
			aliceId,
			wlTokenId,
			[2, 3],
		);

		client.setOperator(aliceId, alicePK);
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'buyWlWithTokens',
			[[2, 3]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		// console.log('DEBUG WL slots:', Number(result[1][0]));
		expect(Number(result[1][0])).to.be.greaterThanOrEqual(2);

		// let mirror node catch up
		await sleep(5000);

		// expect operator to have 1 WL slot and alice to have 2
		// call getWhitelist from the mirror node
		const encodedCommand = minterIface.encodeFunctionData('getWhitelist');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const wlData = minterIface.decodeFunctionResult('getWhitelist', result);
		// console.log('DEBUG WL:', wlData);
		// order not g'teed but should be sum to 3.
		expect((Number(wlData[1][0]) + Number(wlData[1][1]))).to.be.greaterThanOrEqual(1);
		expect(wlData[0].length).to.be.equal(2);
	});

	it('ensure no double spend on the serial', async function() {
		// attempt to buy WL for operator again using serial 1 - expect failure
		client.setOperator(operatorId, operatorKey);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				500_000,
				'buyWlWithTokens',
				[[1]],
			);

			// custom erro now in the MinterLibrary so name no longer available based on our
			// single interface error chacing.
			if (result[0]?.status != null) {
				console.log('ERROR expecting null (WLTokenUsed):', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('ensure user must own the serial', async function() {
		// attempt to buy WL for operator again using serial 1 - expect failure
		client.setOperator(aliceId, alicePK);
		// have Alice try and buy WL using serial 4 that she does not own.

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				500_000,
				'buyWlWithTokens',
				[[4]],
			);

			if (result[0]?.status?.name != 'NotTokenOwner') {
				console.log('ERROR expecting NotTokenOwner:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('Test out Discount mint functions...', function() {
	it('getCost method to check discount / non-discount cost', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();

		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'updateCost',
			[BigInt(tinybarCost), 1],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'updateWlDiscount',
			[20],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'clearWhitelist',
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		expect(Number(result[1][0]) == 2).to.be.true;

		// let mirror node catch up
		await sleep(5000);

		// call getWhitelist from the mirror node
		const encodedCommand = minterIface.encodeFunctionData('getWhitelist');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const wl = minterIface.decodeFunctionResult('getWhitelist', result);

		expect(wl[0].length == 0).to.be.true;

		client.setOperator(aliceId, alicePK);
		// call getCost from the mirror node
		const encodedCommand2 = minterIface.encodeFunctionData('getCost');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand2,
			aliceId,
			false,
		);

		let cost = minterIface.decodeFunctionResult('getCost', result);

		// console.log('DEBUG Cost:', cost);

		expect(Number(cost[0]) == tinybarCost).to.be.true;
		expect(Number(cost[1]) == 1).to.be.true;

		// add Alice ot the WL
		client.setOperator(operatorId, operatorKey);

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			350_000,
			'addToWhitelist',
			[[aliceId.toSolidityAddress()]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		// let mirror node catch up
		await sleep(5000);

		// get the cost again expect discount
		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand2,
			aliceId,
			false,
		);

		cost = minterIface.decodeFunctionResult('getCost', result);

		expect(Number(cost[0]) == new Hbar(0.8).toTinybars()).to.be.true;
		expect(Number(cost[1]) == 0).to.be.true;
	});
});

describe('Test out burn functions...', function() {
	it('Check anyone can burn NFTs', async function() {
		client.setOperator(operatorId, operatorKey);
		const cost = 1;

		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			500_000,
			'updateCost',
			[BigInt(new Hbar(cost).toTinybars()), 0],
		);
		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}

		client.setOperator(aliceId, alicePK);

		// Alice now burns her NFTs
		const serialsAsNum = [2];
		client.setOperator(aliceId, alicePK);

		// set NFT allowance
		result = await setNFTAllowanceAll(client, [extendedTestingTokenId], aliceId, AccountId.fromString(contractId.toString()));

		expect(result).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			750_000,
			'burnNFTs',
			[serialsAsNum],
		);
		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
	});
});

describe('Withdrawal tests...', function() {
	it('Check Alice cannnot withdraw hbar', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				500_000,
				'transferHbar',
				[operatorId.toSolidityAddress(), 1],

			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Alice cannnot withdraw Lazy', async function() {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				500_000,
				'retrieveLazy',
				[operatorId.toSolidityAddress(), 1],

			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('ERROR expecting REVERT: Ownable:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unxpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Check Owner cannot pull funds before X time has elapsed from last mint', async function() {
		client.setOperator(operatorId, operatorKey);

		// get getMintTiming from the mirror node
		const encodedCommand = minterIface.encodeFunctionData('getMintTiming');

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const mintTiming = minterIface.decodeFunctionResult('getMintTiming', result);

		const lastMint = Number(mintTiming[0][0]);
		if (lastMint != 0) {
			const clockTime = Math.floor(new Date().getTime() / 1000);
			const delay = clockTime - lastMint + 8;
			// set refund window timing -> 5 seconds on the clock

			result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				300_000,
				'updateRefundWindow',
				[delay],
			);

			if (result[0]?.status?.toString() != 'SUCCESS') {
				console.log('Error:', result);
				fail();
			}

			// withdrawal of funds should be blocked
			const contractLazyBal = await checkMirrorBalance(env, AccountId.fromString(contractId.toString()), lazyTokenId);
			const contractBal = await checkMirrorHbarBalance(env, AccountId.fromString(contractId.toString()));

			let expectedErrors = 0;
			let unexpectedErrors = 0;

			try {
				result = await contractExecuteFunction(
					contractId,
					minterIface,
					client,
					300_000,
					'transferHbar',
					[operatorId.toSolidityAddress(), contractBal],
				);

				if (result[0]?.status?.name != 'HbarCooldown') {
					console.log('ERROR expecting HbarCooldown:', result);
					unexpectedErrors++;
				}
				else {
					expectedErrors++;
				}
			}
			catch (err) {
				console.log('Unxpected Error:', err);
				unexpectedErrors++;
			}

			try {
				result = await contractExecuteFunction(
					contractId,
					minterIface,
					client,
					300_000,
					'retrieveLazy',
					[operatorId.toSolidityAddress(), contractLazyBal],
				);

				if (result[0]?.status?.name != 'LazyCooldown') {
					console.log('ERROR expecting LazyCooldown:', result);
					unexpectedErrors++;
				}
				else {
					expectedErrors++;
				}
			}
			catch (err) {
				console.log('Unxpected Error:', err);
				unexpectedErrors++;
			}

			expect(expectedErrors).to.be.equal(2);
			expect(unexpectedErrors).to.be.equal(0);
			// sleep the required time to ensure next pull should work.
			await sleep(delay * 1000);
		}
	});

	it('Check Owner can pull hbar & Lazy', async function() {
		client.setOperator(operatorId, operatorKey);

		await sleep(7000);
		let balance = await checkMirrorHbarBalance(env, aliceId);
		balance -= 1_000_000;
		console.log('sweeping alice', balance / 10 ** 8);
		let result = await sweepHbar(client, aliceId, alicePK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
		console.log('alice:', result);

		// get contract hbar balance
		const contractBal = await checkMirrorHbarBalance(env, AccountId.fromString(contractId.toString()));

		// now transfer out that 1 hbar
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'transferHbar',
			[operatorId.toSolidityAddress(), contractBal],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('ERROR:', result);
			fail();
		}
	});
});

/**
 * Method top upload the metadata using chunking
 * @param {string[]} metadata
 * @return {[string, Number]}
 */
async function uploadMetadata(metadata) {
	const uploadBatchSize = 60;
	let totalLoaded = 0;
	let result;
	let status = '';
	for (let outer = 0; outer < metadata.length; outer += uploadBatchSize) {
		const dataToSend = [];
		for (let inner = 0; (inner < uploadBatchSize) && ((inner + outer) < metadata.length); inner++) {
			dataToSend.push(metadata[inner + outer]);
		}
		// use addMetadata method
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000 + (dataToSend.length * 20_000),
			'addMetadata',
			[dataToSend],
		);

		status = result[0].status.toString();
		totalLoaded = Number(result[1][0]);
		console.log('Uploaded:', totalLoaded, 'of', metadata.length);
	}

	return [status, totalLoaded];
}

/**
 * Helper function to encpapsualte minting an FT
 * @param {string} tokenName
 * @param {string} tokenSymbol
 * @param {string} tokenMemo
 * @param {number} tokenInitalSupply
 * @param {number} tokenDecimal
 * @param {number} tokenMaxSupply
 * @param {number} payment
 */
async function mintLazy(
	tokenName,
	tokenSymbol,
	tokenMemo,
	tokenInitalSupply,
	decimal,
	tokenMaxSupply,
	payment,
) {
	const gasLim = 800000;
	// call associate method
	const params = [
		tokenName,
		tokenSymbol,
		tokenMemo,
		tokenInitalSupply,
		decimal,
		tokenMaxSupply,
	];

	const [, , createTokenRecord] = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		gasLim,
		'createFungibleWithBurn',
		params,
		payment,
	);
	const tokenIdSolidityAddr =
		createTokenRecord.contractFunctionResult.getAddress(0);
	lazyTokenId = TokenId.fromSolidityAddress(tokenIdSolidityAddr);
}

/**
 * Use the LSCT to send $LAZY out
 * @param {AccountId} receiverId
 * @param {*} amt
 */
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
		console.log('Failed to send $LAZY:', result);
		fail();
	}
	return result[0]?.status.toString();
}