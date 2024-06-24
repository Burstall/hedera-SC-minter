const {
	Client,
	AccountId,
	PrivateKey,
	AccountCreateTransaction,
	Hbar,
	ContractCreateFlow,
	AccountInfoQuery,
	TransferTransaction,
	ContractInfoQuery,
	ContractFunctionParameters,
	HbarUnit,
	ContractExecuteTransaction,
	TokenId,
	ContractId,
	ContractCallQuery,
	TokenAssociateTransaction,
	CustomRoyaltyFee,
	CustomFixedFee,
	TokenCreateTransaction,
	TokenType,
	TokenSupplyType,
	TokenMintTransaction,
	NftId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const {
	contractDeployFunction,
	linkBytecode,
	readOnlyEVMFromMirrorNode,
	contractExecuteFunction,
} = require('../utils/solidityHelpers');
const { sleep } = require('../utils/nodeHelpers');
const {
	accountCreator,
	associateTokenToAccount,
	mintNFT,
	sendHbar,
	setFTAllowance,
	setNFTAllowanceAll,
	sweepHbar,
	sendNFT,
} = require('../utils/hederaHelpers');
const { checkMirrorBalance, checkMirrorHbarBalance, checkMirrorAllowance, checkFTAllowances } = require('../utils/hederaMirrorHelpers');
const { fail } = require('assert');
const { ethers } = require('ethers');

require('dotenv').config();

// Get operator from .env file
let operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
let operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'MinterContract';
const lazyContractCreator = 'FungibleTokenCreator';
const env = process.env.ENVIRONMENT ?? null;
const lazyBurnPerc = process.env.LAZY_BURN_PERC || 25;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi;
let client, clientAlice;
let alicePK, aliceId;
let tokenId, wlTokenId;
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

		// check if Alice has $LAZY associated else associate the token
		const aliceLazyBal = await checkMirrorBalance(env, aliceId, lazyTokenId);
		if (aliceLazyBal == null) {
			const result = await associateTokenToAccount(client, aliceId, alicePK, lazyTokenId);
			expect(result).to.be.equal('SUCCESS');
		}

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		// import ABI
		abi = json.abi;

		minterIface = new ethers.Interface(abi);

		const contractBytecode = json.bytecode;
		const gasLimit = 1200000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazySCT.toSolidityAddress())
			.addAddress(lazyTokenId.toSolidityAddress())
			.addUint256(lazyBurnPerc);

		[contractId, contractAddress] = await contractDeployFunction(client, contractBytecode, gasLimit, constructorParams);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		console.log('\n-Testing:', contractName);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('should mint an NFT to use as the WL token', async function() {
		client.setOperator(operatorId, operatorKey);
		const result = await mintNFT(client, operatorId, 'MinterContractWL ' + new Date().toISOString(), 'MCWL', 10, 75);
		wlTokenId = result[1];
		console.log('\n- NFT minted @', wlTokenId.toString());
		expect(result[0]).to.be.equal('SUCCESS');
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
		const contractLazyBal = await checkMirrorBalance(env, AccountId.fromString(contractId), lazyTokenId);
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
		expect(Number(batchSize[0])).to.be.equal(10);

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

		expect(!mintEconomics[0]).to.be.true;
		expect(Number(mintEconomics[1])).to.be.equal(0);
		expect(Number(mintEconomics[2])).to.be.equal(0);
		expect(Number(mintEconomics[3])).to.be.equal(0);
		expect(Number(mintEconomics[4])).to.be.equal(20);
		expect(Number(mintEconomics[5])).to.be.equal(0);
		expect(Number(mintEconomics[6])).to.be.equal(0);
		expect(Number(mintEconomics[7])).to.be.equal(0);
		expect(mintEconomics[8].slice(2).toLowerCase()).to.be.equal(ZERO_ADDRESS);

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

		expect(Number(mintTiming[0])).to.be.equal(0);

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

	// initialize the minter!
	it('Initialise the minter for a token with no Fees to check it works', async function() {
		const metadataList = ['metadata.json'];

		// set metadata seperately
		const [success, totalLoaded] = await uploadMetadata(metadataList);
		expect(success).to.be.equal('SUCCESS');
		expect(totalLoaded == 1).to.be.true;

		const royaltyList = [];

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
				royaltyList,
				0,
			],
			MINT_PAYMENT,
		);

		if (result[0] != 'SUCCESS') {
			console.log('Error:', result);
			fail();
		}
		tokenId = TokenId.fromSolidityAddress(result[1][0]);
		console.log('Token Created:', tokenId.toString(), 'tx:', result[2]?.transactionId?.toString());
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Cannot add more metadata - given no capacity', async function() {
		client.setOperator(operatorId, operatorKey);
		let errorCount = 0;
		try {

			// const [result, resultObj] = await useSetterStringArray('addMetadata', ['meta1', 'meta2']);
			// expect(result).to.be.equal('SUCCESS');
			// expect(Number(resultObj['totalLoaded']) == 2).to.be.true;
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Initialise the for a token wth additional headroom', async function() {
		client.setOperator(operatorId, operatorKey);

		// reset metadata
		const outcome = await resetContract();
		expect(outcome).to.be.equal('SUCCESS');
		const metadataList = ['metadata.json'];

		// set metadata seperately
		const [success, totalLoaded] = await uploadMetadata(metadataList);
		expect(success).to.be.equal('SUCCESS');
		expect(totalLoaded == 1).to.be.true;

		const royaltyList = [];

		const [result, tokenAddressSolidity] = await initialiseNFTMint(
			'MC-test',
			'MCt',
			'MC testing memo',
			'ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/',
			royaltyList,
			3,
		);

		tokenId = TokenId.fromSolidityAddress(tokenAddressSolidity);
		console.log('Token Created:', tokenId.toString(), ' / ', tokenAddressSolidity);
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;
		expect(result).to.be.equal('SUCCESS');
	});

	it('Can add more metadata - given spare capacity', async function() {
		client.setOperator(operatorId, operatorKey);
		let errorCount = 0;
		try {
			await useSetterStringArray('addMetadata', ['meta1', 'meta2']);
		}
		catch (err) {
			errorCount++;
		}
		try {
			await useSetterStringArray('addMetadata', ['meta1']);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Re-initialise the minter for a token with **WITH FEES**', async function() {
		// testing with one fallback and one without fallback for generalised case
		client.setOperator(operatorId, operatorKey);

		// reset metadata
		const outcome = await resetContract();
		expect(outcome).to.be.equal('SUCCESS');

		const metadataList = [];

		const maxMetadata = 180;
		for (let m = 1; m <= maxMetadata; m++) {
			const num = '' + m;
			metadataList.push(num.padStart(3, '0') + '_metadata.json');
		}

		// upload metadata
		const [success, totalLoaded] = await uploadMetadata(metadataList);
		expect(success).to.be.equal('SUCCESS');
		expect(totalLoaded == maxMetadata).to.be.true;

		const royalty1 = new NFTFeeObject(200, 10000, operatorId.toSolidityAddress(), 5);
		const royalty2 = new NFTFeeObject(50, 10000, aliceId.toSolidityAddress());

		const royaltyList = [royalty1, royalty2];

		const [result, tokenAddressSolidity, maxSupply] = await initialiseNFTMint(
			'MC-test',
			'MCt',
			'MC testing memo',
			'ipfs://bafybeibiedkt2qoulkexsl2nyz5vykgyjapc5td2fni322q6bzeogbp5ge/',
			royaltyList,
			0,
			1600000,
		);
		tokenId = TokenId.fromSolidityAddress(tokenAddressSolidity);
		console.log('Token Created:', tokenId.toString(), ' / ', tokenAddressSolidity);
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;
		expect(Number(maxSupply) == metadataList.length).to.be.true;
		expect(result).to.be.equal('SUCCESS');
	});

	it('Owner cannot set batch size to bad values', async function() {
		client.setOperator(operatorId, operatorKey);
		let errorCount = 0;
		try {
			await useSetterInts('updateBatchSize', 0);
		}
		catch (err) {
			errorCount++;
		}
		try {
			await useSetterInts('updateBatchSize', 11);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(2);
	});

	it('Owner can update batch value if needed', async function() {
		client.setOperator(operatorId, operatorKey);
		const [status, resultObj] = await useSetterInts('updateBatchSize', 10);
		expect(status).to.be.equal('SUCCESS');
		expect(Boolean(resultObj['changed'])).to.be.false;

	});

	it('Owner can get metadata', async function() {
		client.setOperator(operatorId, operatorKey);
		const [status, results] = await useSetterInts('getMetadataArray', 0, 10);
		const metadataList = results['metadataList'];
		expect(metadataList[0] == '001_metadata.json').to.be.true;
		expect(status).to.be.equal('SUCCESS');
	});

	it('Fail to update metadata with bad offset', async function() {
		client.setOperator(operatorId, operatorKey);
		let errorCount = 0;
		try {
			await updateMetadataAtOffset('updateMetadataArray', ['meta1', 'meta2'], 500);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Successfully update metadata', async function() {
		client.setOperator(operatorId, operatorKey);
		const metadataList = [];

		for (let m = 66; m <= 78; m++) {
			const num = '' + m;
			metadataList.push(num.padStart(3, '0') + '_metadata.json');
		}

		await updateMetadataAtOffset('updateMetadataArray', metadataList, 66, 2000000);
	});

	it('Successfully update CID', async function() {
		client.setOperator(operatorId, operatorKey);
		const result = await useSetterString('updateCID', 'ipfs://bafybeibiedkt2qoulkexsl2nyz5vykgyjapc5td2fni322q6bzeogbp5ge/');
		expect(result).to.be.equal('SUCCESS');
	});
});

describe('Check access control permission...', function() {
	it('Check Alice cannot modify LAZY token ID', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await useSetterAddress('updateLazyToken', TokenId.fromString('0.0.48486075'));
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify LSCT', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await useSetterAddress('updateLSCT', ContractId.fromString('0.0.48627791'));
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the WL', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterAddresses('addToWhitelist', [aliceId]);
		}
		catch (err) {
			errorCount++;
		}

		try {
			await useSetterAddresses('removeFromWhitelist', [aliceId]);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(2);
	});

	it('Check Alice cannot modify the CID/metadata', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterString('updateCID', 'newCIDstring');
		}
		catch (err) {
			errorCount++;
		}

		try {
			await updateMetadataAtOffset('updateMetadataArray', ['meta1', 'meta2'], 0);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(2);
	});

	it('Check Alice cannot retrieve the unminted metadata', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await getSetting('getMetadataArray', 'metadataList');
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the cost', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateCost', 1, 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot update the wlToken', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterAddress('updateWlToken', wlTokenId.toSolidityAddress());
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the batch sizing', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateBatchSize', 5);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the Lazy Burn Precentage', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateLazyBurnPercentage', 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the max mint', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateMaxMint', 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the cooldown timer', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateCooldown', 4);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the start date', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateMintStartTime', (new Date().getTime() / 1000) + 30);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the pause status', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await useSetterBool('updatePauseStatus', false);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify flag to spend lazy from contract', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await useSetterBool('updateContractPaysLazy', false);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot turn on WL', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterBool('updateWlOnlyStatus', true);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot adjust max mint for WL addresses', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('setMaxWlAddressMint', 2);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot adjust max mints per wallet', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateMaxMintPerWallet', 2);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot enable buying WL with $LAZY', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('setBuyWlWithLazy', 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot get details of who minted', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await methodCallerNoArgs('getNumberMintedByAllAddresses');
		}
		catch (err) {
			errorCount++;
		}
		try {
			await methodCallerNoArgs('getNumberMintedByAllWlAddresses');
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(2);
	});
});

describe('Basic interaction with the Minter...', function() {
	it('Associate the token to Operator', async function() {
		client.setOperator(operatorId, operatorKey);
		const result = await associateTokenToAccount(operatorId, tokenId);
		expect(result).to.be.equal('SUCCESS');
		// Alice will use auto asociation
	});

	it('Check unable to mint if contract paused (then unpause)', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 1);
		await useSetterBool('updatePauseStatus', true);

		let errorCount = 0;
		try {
			await mintNFT(1, tinybarCost);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);

		// unpause the contract
		await useSetterBool('updatePauseStatus', false);
	});

	it('Mint a token from the SC for hbar', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 0);

		// let Alice mint to test it works for a 3rd party
		client.setOperator(aliceId, alicePK);
		const [success, serials] = await mintNFT(1, tinybarCost);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;
	});

	it('Mint 19 tokens from the SC for hbar', async function() {
		client.setOperator(operatorId, operatorKey);
		// unpause the contract
		await useSetterBool('updatePauseStatus', false);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 0);

		const toMint = 19;

		// let Alice mint to test it works for a 3rd party
		client.setOperator(aliceId, alicePK);
		const [success, serials] = await mintNFT(toMint, tinybarCost * toMint, client, 4000000);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == toMint).to.be.true;
	});

	it('Check concurrent mint...', async function() {
		client.setOperator(operatorId, operatorKey);
		// unpause the contract
		await useSetterBool('updatePauseStatus', false);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 0);
		let loop = 10;
		const promiseList = [];
		while (loop > 0) {
			promiseList.push(mintNFT(1, tinybarCost, client));
			await sleep(125);
			promiseList.push(mintNFT(1, tinybarCost, clientAlice));
			await sleep(125);
			loop--;
		}

		let sumSerials = 0;
		await Promise.all(promiseList). then((results) => {
			for (let i = 0; i < results.length; i++) {
				const [, serialList] = results[i];
				sumSerials += serialList.length;
			}
		});
		expect(sumSerials == 20).to.be.true;
	});

	it('Attempt to mint 2 with max mint @ 1, then mint 1', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 0);
		await useSetterInts('updateMaxMint', 1);

		// let Alice mint to test it works for a 3rd party
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await mintNFT(2, tinybarCost * 2);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);

		// now mint the singleton
		const [success, serials] = await mintNFT(1, tinybarCost);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;

		client.setOperator(operatorId, operatorKey);
		await useSetterInts('updateMaxMint', 20);
	});

	it('Mint a token from the SC for Lazy', async function() {
		client.setOperator(operatorId, operatorKey);
		// paying 0.5 $LAZY to check burn works.
		await useSetterInts('updateCost', 0, 5);

		// let Alice mint to test it works for a 3rd party
		client.setOperator(aliceId, alicePK);
		const [success, serials] = await mintNFT(1, 0);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;
	});

	it('Mint a token from the SC for hbar + Lazy', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 1);

		// let Alice mint to test it works for a 3rd party
		client.setOperator(aliceId, alicePK);
		const [success, serials] = await mintNFT(1, tinybarCost);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;
	});

	it('Allow contract to pay the $LAZY fee', async function() {
		client.setOperator(operatorId, operatorKey);
		await useSetterBool('updateContractPaysLazy', true);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 5);

		// let Alice mint to test it works for a 3rd party
		client.setOperator(aliceId, alicePK);
		const [success, serials] = await mintNFT(1, tinybarCost);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;

		// reset state
		client.setOperator(operatorId, operatorKey);
		await useSetterBool('updateContractPaysLazy', false);
	});


	it('Check unable to mint if not enough funds', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(10).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 1);
		// unpause the contract
		await useSetterBool('updatePauseStatus', false);

		// let Alice mint to test it works for a 3rd party
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await mintNFT(1, new Hbar(1).toTinybars);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check unable to mint if not yet at start time', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 1);
		// set start time 4 seconds in future
		await useSetterInts('updateMintStartTime', Math.floor(new Date().getTime() / 1000) + 4);
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await mintNFT(1, new Hbar(1).toTinybars);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check **ABLE** to mint once start time has passed', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 1);
		// sleep to ensure past the start time
		const mintTiming = await getSetting('getMintTiming', 'mintTiming');
		const mintStart = Number(mintTiming[1]);
		const now = Math.floor(new Date().getTime() / 1000);
		const sleepTime = Math.max((mintStart - now) * 1000, 0);
		// console.log(mintStart, '\nSleeping to wait for the mint to start...', sleepTime, '(milliseconds)');
		await sleep(sleepTime + 1125);
		client.setOperator(aliceId, alicePK);
		const [success, serials] = await mintNFT(1, tinybarCost);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;
	});
});

describe('Test out WL functions...', function() {
	it('Enable Adress Based WL, check WL empty', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 0);
		// unpause the contract
		await useSetterBool('updateWlOnlyStatus', true);

		const wl = await getSetting('getWhitelist', 'wl');
		expect(wl.length == 0).to.be.true;
	});

	it('Check Alice is unable to mint ', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await mintNFT(1, new Hbar(1).toTinybars);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Add Alice to WL & can mint', async function() {
		client.setOperator(operatorId, operatorKey);
		const result = await useSetterAddresses('addToWhitelist', [aliceId.toSolidityAddress()]);
		expect(result == 'SUCCESS').to.be.true;
		// now Alice should be able to mint
		client.setOperator(aliceId, alicePK);
		const tinybarCost = new Hbar(1).toTinybars();
		const [success, serials] = await mintNFT(1, tinybarCost);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;
	});

	it('Remove Alice from WL, let Alice buy in with Lazy', async function() {
		client.setOperator(operatorId, operatorKey);
		const result = await useSetterAddresses('removeFromWhitelist', [aliceId.toSolidityAddress()]);
		expect(result == 'SUCCESS').to.be.true;
		let wl = await getSetting('getWhitelist', 'wl');
		expect(wl.length == 0).to.be.true;

		// by default unable to buy in with LAZY - check assumption
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await methodCallerNoArgs('buyWlWithLazy', 500000);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);

		client.setOperator(operatorId, operatorKey);
		let [response] = await useSetterInts('setBuyWlWithLazy', 1);
		expect(response == 'SUCCESS').to.be.true;

		// now Alice can buy that WL spot
		client.setOperator(aliceId, alicePK);
		[response] = await methodCallerNoArgs('buyWlWithLazy', 500000);
		expect(response == 'SUCCESS').to.be.true;

		wl = await getSetting('getWhitelist', 'wl');
		expect(AccountId.fromSolidityAddress(wl[0]).toString() ==
			aliceId.toString()).to.be.true;
	});

	it('Set max cap for WL address, buy in, mint and then check it blocks Alice', async function() {
		client.setOperator(operatorId, operatorKey);
		const [result] = await useSetterInts('setMaxWlAddressMint', 1);
		expect(result == 'SUCCESS').to.be.true;
		// setup mint costs
		const tinybarCost = new Hbar(1).toTinybars();
		await useSetterInts('updateCost', tinybarCost, 0);

		client.setOperator(aliceId, alicePK);
		// Alice buys into WL again it should give her one slot
		const [response] = await methodCallerNoArgs('buyWlWithLazy', 500000);
		expect(response == 'SUCCESS').to.be.true;

		let errorCount = 0;
		try {
			// should fail as only space for a single mint
			await mintNFT(2, tinybarCost * 2);
		}
		catch (err) {
			errorCount++;
		}
		// should pass...
		const [success, serials] = await mintNFT(1, tinybarCost);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;
		try {
			// should fail as cap exhausted
			await mintNFT(1, tinybarCost);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(2);
	});

	it('Check Owner can get WL / mint history', async function() {
		client.setOperator(operatorId, operatorKey);
		let [status, result] = await methodCallerNoArgs('getNumberMintedByAllAddresses', 600000);
		expect(status == 'SUCCESS').to.be.true;
		let walletList = result['walletList'];
		let numMints = result['numMintedList'];
		let totalMinted = 0;

		for (let w = 0; w < walletList.length; w++) {
			console.log('Regular mint:', AccountId.fromSolidityAddress(walletList[w]).toString(), Number(numMints[w]));
			totalMinted += Number(numMints[w]);
		}

		[status, result] = await methodCallerNoArgs('getNumberMintedByAllWlAddresses', 600000);
		expect(status == 'SUCCESS').to.be.true;
		walletList = result['wlWalletList'];
		numMints = result['wlNumMintedList'];
		let totalWlMints = 0;

		for (let w = 0; w < walletList.length; w++) {
			console.log('WL mint:', AccountId.fromSolidityAddress(walletList[w]).toString(), Number(numMints[w]));
			totalWlMints += Number(numMints[w]);
		}
		expect(totalMinted > totalWlMints).to.be.true;
	});

	it('Enables buying WL based on serial', async function() {
		client.setOperator(operatorId, operatorKey);
		await useSetterAddress('updateWlToken', wlTokenId);
		let [status, result] = await methodCallerNoArgs('clearWhitelist', 300000);
		// console.log('WL entries removed:', Number(result['numAddressesRemoved']));
		expect(status == 'SUCCESS').to.be.true;
		[status] = await useSetterInts('setMaxWlAddressMint', 1);
		expect(status == 'SUCCESS').to.be.true;
		// setup mint costs
		const tinybarCost = new Hbar(1).toTinybars();
		[status, result] = await useSetterInts('updateCost', tinybarCost, 0);
		expect(status == 'SUCCESS').to.be.true;

		// buy WL for operator
		[status, result] = await useSetterInt256Array('buyWlWithTokens', [1]);
		expect(status == 'SUCCESS').to.be.true;
		expect(Number(result['wlSpotsPurchased']) == 1).to.be.true;
		// send two NFTs to Alice to check she can buy WL with the serials
		await transferNFTBySDK(operatorId, aliceId, wlTokenId, [2, 3]);
		client.setOperator(aliceId, alicePK);
		[status, result] = await useSetterInt256Array('buyWlWithTokens', [2, 3]);
		expect(status == 'SUCCESS').to.be.true;
		expect(Number(result['wlSpotsPurchased']) == 2).to.be.true;

		// expect operator to have 1 WL slot and alice to have 2
		result = await getSettings('getWhitelist', 'wl', 'wlQty');
		expect(result[0].length == 2).to.be.true;
		// order not g'teed but should be sum to 3.
		expect((Number(result[1][0]) + Number(result[1][1])) == 3).to.be.true;
	});

	it('ensure no double spend on the serial', async function() {
		// attempt to buy WL for operator again using serial 1 - expect failure
		client.setOperator(operatorId, operatorKey);
		let errorCount = 0;
		try {
			// should fail as already redeemed
			await useSetterInt256Array('buyWlWithTokens', [1]);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('ensure user must own the serial', async function() {
		// attempt to buy WL for operator again using serial 1 - expect failure
		client.setOperator(aliceId, alicePK);
		// have Alice try and buy WL using serial 4 that she does not own.
		let errorCount = 0;
		try {
			// should fail as already redeemed
			await useSetterInt256Array('buyWlWithTokens', [4]);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});
});

describe('Test out Discount mint functions...', function() {
	it('getCost method to check discount / non-discount cost', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		let [status, result] = await useSetterInts('updateCost', tinybarCost, 1);
		expect(status == 'SUCCESS').to.be.true;

		[status, result] = await useSetterInts('updateWlDiscount', 20);
		expect(status == 'SUCCESS').to.be.true;

		[status, result] = await methodCallerNoArgs('clearWhitelist', 300000);
		expect(Number(result['numAddressesRemoved']) == 2).to.be.true;
		expect(status == 'SUCCESS').to.be.true;

		client.setOperator(aliceId, alicePK);
		[status, result] = await methodCallerNoArgs('getCost', 300000);
		expect(status == 'SUCCESS').to.be.true;
		expect(Number(result['hbarCost']) == tinybarCost).to.be.true;
		expect(Number(result['lazyCost']) == 1).to.be.true;

		// could allow Alice to buy in for Lazy instead
		client.setOperator(operatorId, operatorKey);
		result = await useSetterAddresses('addToWhitelist', [aliceId.toSolidityAddress()]);
		expect(result == 'SUCCESS').to.be.true;

		client.setOperator(aliceId, alicePK);
		[status, result] = await methodCallerNoArgs('getCost', 300000);
		expect(status == 'SUCCESS').to.be.true;
		expect(Number(result['hbarCost']) == new Hbar(0.8).toTinybars()).to.be.true;
		expect(Number(result['lazyCost']) == 0).to.be.true;
	});

	it('WL mint, at discount', async function() {
		client.setOperator(aliceId, alicePK);
		const [success, serials] = await mintNFT(1, new Hbar(0.8).toTinybars());
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;
	});

	it('Ensure non-WL has correct price for mint', async function() {
		client.setOperator(operatorId, operatorKey);
		await useSetterBool('updateWlOnlyStatus', false);
		let errorCount = 0;
		try {
			const tinybarCost = new Hbar(0.8).toTinybars();
			await mintNFT(1, tinybarCost);
		}
		catch (err) {
			errorCount++;
		}

		const [success, serials] = await mintNFT(1, new Hbar(1).toTinybars());
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;
		expect(errorCount).to.be.equal(1);
	});

	it('Checks we can update the max mints per wallet and cap it', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		let [status, result] = await useSetterInts('updateCost', tinybarCost, 0);
		expect(status == 'SUCCESS').to.be.true;
		// check how many we have already minted
		[status, result] = await methodCallerNoArgs('getNumberMintedByAddress', 600000);
		expect(status == 'SUCCESS').to.be.true;
		// add 1 for headroom
		const numMints = Number(result['numMinted']) + 1;
		// get the max per Wallet
		await useSetterInts('updateMaxMintPerWallet', numMints);
		let mintEconomics = await getSetting('getMintEconomics', 'mintEconomics');
		expect(Number(mintEconomics[7]) == numMints).to.be.true;

		// mint one
		const [success, serials] = await mintNFT(1, tinybarCost);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 1).to.be.true;

		let errorCount = 0;
		// second should fail
		try {
			await mintNFT(1, tinybarCost);
		}
		catch (err) {
			errorCount++;
		}

		expect(errorCount).to.be.equal(1);

		// clean-up
		await useSetterInts('updateMaxMintPerWallet', 0);
		mintEconomics = await getSetting('getMintEconomics', 'mintEconomics');
		expect(Number(mintEconomics[7]) == 0).to.be.true;
	});
});

describe('Test out refund functions...', function() {
	it('Check anyone can burn NFTs', async function() {
		client.setOperator(operatorId, operatorKey);
		const tinybarCost = new Hbar(1).toTinybars();
		let [status, result] = await useSetterInts('updateCost', tinybarCost, 0);
		expect(status == 'SUCCESS').to.be.true;

		client.setOperator(aliceId, alicePK);
		const [success, serials] = await mintNFT(2, tinybarCost * 2);
		expect(success == 'SUCCESS').to.be.true;
		expect(serials.length == 2).to.be.true;

		client.setOperator(operatorId, operatorKey);
		[status, result] = await methodCallerNoArgs('getNumberMintedByAllAddresses', 600000);
		expect(status == 'SUCCESS').to.be.true;
		const walletList = result['walletList'];
		const numMints = result['numMintedList'];
		let totalMinted = 0;

		// gather total minted
		for (let w = 0; w < walletList.length; w++) {
			totalMinted += Number(numMints[w]);
		}

		// Alice now burns her NFTs
		const serialsAsNum = [];
		for (let s = 0; s < serials.length; s++) {
			serialsAsNum.push(Number(serials[s]));
		}
		client.setOperator(aliceId, alicePK);
		const [txStatus, txResObj] = await useSetterInt64Array('burnNFTs', serialsAsNum);
		expect(txStatus == 'SUCCESS').to.be.true;
		// check supply is now 2 less
		expect(totalMinted == (Number(txResObj['newTotalSupply']) + 2)).to.be.true;
	});

	it('Enable refund (& burn), mint then refund - hbar', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Enable refund (& burn), mint then refund - lazy', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Shift to refund (hbar & lazy) but store NFT on refund', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Check Owner can withdraw NFTs exchanged for refund', async function() {
		expect.fail(0, 1, 'Not implemented');
	});
});

describe('Withdrawal tests...', function() {
	it('Check Alice cannnot withdraw hbar', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await transferHbarFromContract(0.1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannnot withdraw Lazy', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// try requesting a min lot
			await retrieveLazyFromContract(aliceId, 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Owner cannot pull funds before X time has elapsed from last mint', async function() {
		client.setOperator(operatorId, operatorKey);
		const mintTiming = await getSetting('getMintTiming', 'mintTiming');
		const lastMint = Number(mintTiming[0]);
		if (lastMint != 0) {
			const clockTime = Math.floor(new Date().getTime() / 1000);
			const delay = clockTime - lastMint + 8;
			// set refund window timing -> 5 seconds on the clock
			await useSetterInts('updateRefundWindow', delay);
			// console.log('Delay', delay, 'last mint', lastMint, 'clock', clockTime);
			// withdrawal of funds should be blocked
			const [contractLazyBal, contractHbarBal] = await getContractBalance(contractId);
			let errorCount = 0;
			try {
				await transferHbarFromContract(Number(contractHbarBal.toTinybars()), HbarUnit.Tinybar);
			}
			catch {
				errorCount++;
			}

			try {
				if (contractLazyBal > 0) {
					const pullLazy = await retrieveLazyFromContract(operatorId, contractLazyBal);
					expect(pullLazy).to.be.equal('SUCCESS');
				}
			}
			catch {
				errorCount++;
			}
			expect(errorCount).to.be.equal(2);
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

		// check the initial vesting has expired if not sleep for the remaining time
		const now = parseInt(new Date().getTime() / 1000);
		const timeToComplete = masterEndTimestamp - now;

		if (timeToComplete > 0) {
			console.log('Time to complete:', timeToComplete, 'seconds');
			await sleep((timeToComplete + 2) * 1000);
		}

		// get contract hbar balance
		const contractBal = await checkMirrorHbarBalance(env, AccountId.fromString(contractId.toString()));

		// now transfer out that 1 hbar
		result = await contractExecuteFunction(
			contractId,
			vestingIface,
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
		result = contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000 + (dataToSend.length * 20_000),
			'addMetadata',
			[dataToSend],
		);

		status = result[0].status.toString();
		totalLoaded += Number(result[1][0]);
		console.log('Uploaded:', totalLoaded, 'of', metadata.length);
	}

	return [status, totalLoaded];
}

class NFTFeeObject {
	/**
	 *
	 * @param {number} numerator
	 * @param {number} denominator
	 * @param {string} account address in solidity format
	 * @param {number} fallbackfee left as 0 if no fallback
	 */
	constructor(numerator, denominator, account, fallbackfee = 0) {
		this.numerator = numerator;
		this.denominator = denominator;
		this.fallbackfee = fallbackfee;
		this.account = account;
	}
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