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
const Web3 = require('web3');
const web3 = new Web3();
const { expect } = require('chai');
const { describe, it } = require('mocha');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'MinterContract';
const env = process.env.ENVIRONMENT ?? null;
const lazyContractId = ContractId.fromString(process.env.LAZY_CONTRACT);
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN);
const lazyBurnPerc = process.env.LAZY_BURN_PERC || 25;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi;
let client, clientAlice;
let alicePK, aliceId;
let tokenId, wlTokenId;

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
		else {
			console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		// import ABI
		abi = json.abi;

		const contractBytecode = json.bytecode;
		const gasLimit = 1200000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		await contractDeployFcn(contractBytecode, gasLimit);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		console.log('\n-Testing:', contractName);

		// create Alice account
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(alicePK, 200);
		console.log('Alice account ID:', aliceId.toString(), '\nkey:', alicePK.toString());
		clientAlice.setOperator(aliceId, alicePK);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('should mint an NFT to use as the WL token', async function() {
		client.setOperator(operatorId, operatorKey);
		const [rewardMintResult, rewardMintedTokenId] = await mintNFTBySDK('MinterContractWL ');
		wlTokenId = rewardMintedTokenId;
		expect(rewardMintResult == 'SUCCESS').to.be.true;

	});

	it('Ensure Alice & Contract are a little LAZY (send some to prime the pumps)', async function() {
		// send 2 $LAZY
		let result = await ftTansferFcn(operatorId, aliceId, 20, lazyTokenId);
		expect(result).to.be.equal('SUCCESS');
		result = await ftTansferFcn(operatorId, contractId, 10, lazyTokenId);
		expect(result).to.be.equal('SUCCESS');
	});
});

describe('Check SC deployment...', function() {
	it('Check Lazy token was associated by constructor', async function() {
		client.setOperator(operatorId, operatorKey);
		const [contractLazyBal] = await getContractBalance(contractId);
		expect(contractLazyBal == 10).to.be.true;
	});

	it('Check linkage to Lazy token / LSCT is correct', async function() {
		client.setOperator(operatorId, operatorKey);
		const addressLSCT = await getSetting('getLSCT', 'lsct');
		expect(ContractId.fromSolidityAddress(addressLSCT).toString() == lazyContractId.toString()).to.be.true;

		const addressLazy = await getSetting('getLazyToken', 'lazy');
		expect(TokenId.fromSolidityAddress(addressLazy).toString() == lazyTokenId.toString()).to.be.true;
	});

	it('Check default values are set in Constructor', async function() {
		client.setOperator(operatorId, operatorKey);
		const batchSize = await getSetting('getBatchSize', 'batchSize');
		expect(Number(batchSize) == 10).to.be.true;
		const lazyBurn = await getSetting('getLazyBurnPercentage', 'lazyBurn');
		expect(Number(lazyBurn) == lazyBurnPerc).to.be.true;
		const [hbarCost, lazyCost] = await getSettings('getCost', 'hbarCost', 'lazyCost');
		expect(Number(hbarCost) == 0 && Number(lazyCost) == 0).to.be.true;
		const mintEconomics = await getSetting('getMintEconomics', 'mintEconomics');
		expect(!mintEconomics[0] &&
			mintEconomics[1] == 0 &&
			mintEconomics[2] == 0 &&
			mintEconomics[3] == 0 &&
			mintEconomics[4] == 20 &&
			mintEconomics[5] == 0 &&
			mintEconomics[6] == 0 &&
			mintEconomics[7] == 0 &&
			mintEconomics[8] == ZERO_ADDRESS).to.be.true;
		const mintTiming = await getSetting('getMintTiming', 'mintTiming');
		expect(mintTiming[0] == 0 &&
			mintTiming[1] == 0 &&
			mintTiming[2] &&
			mintTiming[3] == 0 &&
			mintTiming[4] == 0 &&
			mintTiming[5] == false).to.be.true;
		const remainingMint = await getSetting('getRemainingMint', 'remainingMint');
		expect(Number(remainingMint) == 0).to.be.true;
		const numMinted = await getSetting('getNumberMintedByAddress', 'numMinted');
		expect(Number(numMinted) == 0).to.be.true;
		const wlNumMinted = await getSetting('getNumberMintedByWlAddress', 'wlNumMinted');
		expect(Number(wlNumMinted) == 0).to.be.true;
	});

	// initialize the minter!
	it('Initialise the minter for a token with no Fees to check it works', async function() {
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
			0,
		);

		tokenId = TokenId.fromSolidityAddress(tokenAddressSolidity);
		console.log('Token Created:', tokenId.toString(), ' / ', tokenAddressSolidity);
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;
		expect(result).to.be.equal('SUCCESS');
	});

	it('Cannot add more metadata - given no capacity', async function() {
		client.setOperator(operatorId, operatorKey);
		let errorCount = 0;
		try {
			const [result, resultObj] = await useSetterStringArray('addMetadata', ['meta1', 'meta2']);
			expect(result).to.be.equal('SUCCESS');
			expect(Number(resultObj['totalLoaded']) == 2).to.be.true;
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
		let [contractLazyBal, contractHbarBal] = await getContractBalance(contractId);
		const result = await transferHbarFromContract(Number(contractHbarBal.toTinybars()), HbarUnit.Tinybar);
		console.log('Clean-up -> Retrieve hbar from Contract');
		if (contractLazyBal > 0) {
			const pullLazy = await retrieveLazyFromContract(operatorId, contractLazyBal);
			expect(pullLazy).to.be.equal('SUCCESS');
		}
		[contractLazyBal, contractHbarBal] = await getContractBalance(contractId);
		console.log('Contract ending hbar balance:', contractHbarBal.toString());
		console.log('Contract ending Lazy balance:', contractLazyBal.toString());
		expect(result).to.be.equal('SUCCESS');
	});

	it('Cleans up -> retrieve hbar/Lazy', async function() {
		// get Alice balance
		let [aliceLazyBal, aliceHbarBal, aliceNftBal] = await getAccountBalance(aliceId);
		// SDK transfer back to operator
		client.setOperator(aliceId, alicePK);
		if (aliceLazyBal > 0) {
			const lazyReceipt = await ftTansferFcn(aliceId, operatorId, aliceLazyBal, lazyTokenId);
			expect(lazyReceipt == 'SUCCESS').to.be.true;
		}
		const receipt = await hbarTransferFcn(aliceId, operatorId, aliceHbarBal.toBigNumber().minus(0.05));
		console.log('Clean-up -> Retrieve hbar/Lazy from Alice');
		// reverting operator as Alice should be drained
		client.setOperator(operatorId, operatorKey);
		[aliceLazyBal, aliceHbarBal, aliceNftBal] = await getAccountBalance(aliceId);
		console.log('Alice ending hbar balance:', aliceHbarBal.toString());
		console.log('Alice ending Lazy balance:', aliceLazyBal.toString());
		console.log('Alice ending NFT balance:', aliceNftBal.toString());
		expect(receipt == 'SUCCESS').to.be.true;
	});
});

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVar the variable to exeppect to get back
 * @param {number=100000} gasLim allows gas veride
 * @return {*}
 */
// eslint-disable-next-line no-unused-vars
async function getSetting(fcnName, expectedVar, gasLim = 100000) {
	// check the Lazy Token and LSCT addresses
	// generate function call with function name and parameters
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, []);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setMaxQueryPayment(new Hbar(2))
		.setGas(gasLim)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	return queryResult[expectedVar];
}

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVars the variable to exeppect to get back
 * @return {*} array of results
 */
// eslint-disable-next-line no-unused-vars
async function getSettings(fcnName, ...expectedVars) {
	// check the Lazy Token and LSCT addresses
	// generate function call with function name and parameters
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, []);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setMaxQueryPayment(new Hbar(2))
		.setGas(100000)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	const results = [];
	for (let v = 0 ; v < expectedVars.length; v++) {
		results.push(queryResult[expectedVars[v]]);
	}
	return results;
}

/**
 * Helper method to encode a contract query function
 * @param {string} functionName name of the function to call
 * @param {string[]} parameters string[] of parameters - typically blank
 * @returns {Buffer} encoded function call
 */
function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

/**
 * Helper function for FT transfer
 * @param {AccountId} sender
 * @param {AccountId} receiver
 * @param {Number} amount
 * @param {TokenId} token
 * @returns {TransactionReceipt | any}
 */
async function ftTansferFcn(sender, receiver, amount, token) {
	const transferTx = new TransferTransaction()
		.addTokenTransfer(token, sender, -amount)
		.addTokenTransfer(token, receiver, amount)
		.freezeWith(client);
	const transferSign = await transferTx.sign(operatorKey);
	const transferSubmit = await transferSign.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx.status.toString();
}

/**
 * Request hbar from the contract
 * @param {number} amount
 * @param {HbarUnit=} units defaults to Hbar as the unit type
 */
async function transferHbarFromContract(amount, units = HbarUnit.Hbar) {
	const gasLim = 400000;
	const params = new ContractFunctionParameters()
		.addAddress(operatorId.toSolidityAddress())
		.addUint256(new Hbar(amount, units).toTinybars());
	const [callHbarRx, , ] = await contractExecuteFcn(contractId, gasLim, 'transferHbar', params);
	return callHbarRx.status.toString();
}

/**
 *
 * @param {Number} quantity
 * @param {Number | Long} tinybarPmt
 * @param {Client=} clientToUse
 * @param {Number=} gasLim
 */
// eslint-disable-next-line no-unused-vars
async function mintNFT(quantity, tinybarPmt, clientToUse = client, gasLim = 2000000) {
	const params = [quantity];

	const [mintRx, mintResults] =
		await contractExecuteWithStructArgs(contractId, gasLim, 'mintNFT', params, new Hbar(tinybarPmt, HbarUnit.Tinybar), clientToUse);
	return [mintRx.status.toString(), mintResults['serials']] ;
}

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
		[status, result] = await useSetterStringArray('addMetadata', dataToSend, 1500000);
		totalLoaded = Number(result['totalLoaded']);
		// console.log('Uploaded metadata:', totalLoaded);
	}

	return [status, totalLoaded];
}

/**
 *
 * @param {string} name
 * @param {string} symbol
 * @param {string} memo
 * @param {string} cid
 * @param {*} royaltyList
 * @param {Number=0} maxSupply
 * @param {Number=1000000} gasLim
 */
async function initialiseNFTMint(name, symbol, memo, cid, royaltyList, maxSupply = 0, gasLim = 1000000) {
	const params = [name, symbol, memo, cid, royaltyList, maxSupply];

	const [initialiseRx, initialiseResults] = await contractExecuteWithStructArgs(contractId, gasLim, 'initialiseNFTMint', params, MINT_PAYMENT);
	return [initialiseRx.status.toString(), initialiseResults['createdTokenAddress'], initialiseResults['maxSupply']] ;
}

async function contractExecuteWithStructArgs(cId, gasLim, fcnName, params, amountHbar, clientToUse = client) {
	// use web3.eth.abi to encode the struct for sending.
	// console.log('pre-encode:', JSON.stringify(params, null, 4));
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, params);

	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunctionParameters(functionCallAsUint8Array)
		.setPayableAmount(amountHbar)
		.freezeWith(clientToUse)
		.execute(clientToUse);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(clientToUse);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(clientToUse);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} cId the contract to call
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {ContractFunctionParameters} params the function arguments
 * @param {string | number | Hbar | Long.Long | BigNumber} amountHbar the amount of hbar to send in the methos call
 * @returns {[TransactionReceipt, any, TransactionRecord]} the transaction receipt and any decoded results
 */
async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	const functionParameters = functionAbi.outputs;
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
	return result;
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {boolean} value
 * @param {number=} gasLim
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterBool(fcnName, value, gasLim = 200000) {
	const params = new ContractFunctionParameters()
		.addBool(value);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

async function resetContract() {
	const params = new ContractFunctionParameters()
		.addBool(true)
		.addUint256(1000);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, 1000000, 'resetContract', params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {TokenId | AccountId | ContractId} value
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterAddress(fcnName, value) {
	const gasLim = 200000;
	const params = new ContractFunctionParameters()
		.addAddress(value.toSolidityAddress());
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {TokenId[] | AccountId[] | ContractId[]} value
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterAddresses(fcnName, value) {
	const gasLim = 500000;
	const params = new ContractFunctionParameters()
		.addAddressArray(value);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {string} value
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterString(fcnName, value) {
	const gasLim = 200000;
	const params = new ContractFunctionParameters()
		.addString(value);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {string[]} value
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterStringArray(fcnName, value, gasLim = 500000) {
	const params = new ContractFunctionParameters()
		.addStringArray(value);
	const [setterAddressRx, setterResults] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterAddressRx.status.toString(), setterResults];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {string[]} value
 * @param {Number} offset starting point to update the array
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function updateMetadataAtOffset(fcnName, value, offset = 0, gasLim = 800000) {
	const params = new ContractFunctionParameters()
		.addStringArray(value)
		.addUint256(offset);
	const [setterAddressRx, setterResults] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterAddressRx.status.toString(), setterResults];
}

/**
 * Call a methos with no arguments
 * @param {string} fcnName
 * @param {number=} gas
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function methodCallerNoArgs(fcnName, gasLim = 500000) {
	const params = new ContractFunctionParameters();
	const [setterAddressRx, setterResults ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterAddressRx.status.toString(), setterResults];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {...number} values
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterInts(fcnName, ...values) {
	const gasLim = 800000;
	const params = new ContractFunctionParameters();

	for (let i = 0 ; i < values.length; i++) {
		params.addUint256(values[i]);
	}
	const [setterIntsRx, setterResult] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterIntsRx.status.toString(), setterResult];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {number[]} ints
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterInt256Array(fcnName, ints) {
	const gasLim = 8000000;
	const params = new ContractFunctionParameters().addUint256Array(ints);

	const [setterIntArrayRx, setterResult] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterIntArrayRx.status.toString(), setterResult];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {number[]} ints
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterInt64Array(fcnName, ints) {
	const gasLim = 8000000;
	const params = new ContractFunctionParameters().addInt64Array(ints);

	const [setterIntArrayRx, setterResult] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterIntArrayRx.status.toString(), setterResult];
}
/**
 * Helper function to get the Lazy, hbar & minted NFT balance of the contract
 * @returns {[number | Long.Long, Hbar, number | Long.Long]} The balance of the FT (without decimals), Hbar & NFT at the SC
 */
async function getContractBalance() {

	const query = new ContractInfoQuery()
		.setContractId(contractId);

	const info = await query.execute(client);

	let balance;

	const tokenMap = info.tokenRelationships;
	const tokenBal = tokenMap.get(lazyTokenId.toString());
	if (tokenBal) {
		balance = tokenBal.balance;
	}
	else {
		balance = -1;
	}

	let nftBal = 0;
	if (tokenId) {
		const nftTokenBal = tokenMap.get(tokenId.toString());
		if (nftTokenBal) {
			nftBal = nftTokenBal.balance;
		}
		else {
			nftBal = -1;
		}
	}

	return [balance, info.balance, nftBal];
}


/**
 * Helper function to send hbar
 * @param {AccountId} sender sender address
 * @param {AccountId} receiver receiver address
 * @param {string | number | BigNumber} amount the amounbt to send
 * @returns {any} expect a string of SUCCESS
 */
async function hbarTransferFcn(sender, receiver, amount) {
	const transferTx = new TransferTransaction()
		.addHbarTransfer(sender, -amount)
		.addHbarTransfer(receiver, amount)
		.freezeWith(client);
	const transferSubmit = await transferTx.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx.status.toString();
}

/**
 * Helper function to retrieve account balances
 * @param {AccountId} acctId the account to check
 * @returns {[number, Hbar, number]} balance of the FT token (without decimals), balance of Hbar & NFTs in account as array
 */
async function getAccountBalance(acctId) {

	const query = new AccountInfoQuery()
		.setAccountId(acctId);

	const info = await query.execute(client);

	let balance;
	const tokenMap = info.tokenRelationships;
	// This is in process of deprecation sadly so may need to be adjusted.
	const tokenBal = tokenMap.get(lazyTokenId.toString());
	if (tokenBal) {
		balance = tokenBal.balance;
	}
	else {
		balance = -1;
	}

	let nftBal = 0;
	if (tokenId) {
		const nftTokenBal = tokenMap.get(tokenId.toString());
		if (nftTokenBal) {
			nftBal = nftTokenBal.balance;
		}
		else {
			nftBal = -1;
		}
	}

	return [balance, info.balance, nftBal];
}

/**
 * Method to transfer an NFT by SDK
 * @param {AccountId} sender
 * @param {AccounId} receiver
 * @param {TokenId} token
 * @param {int[]} serials
 * @param {Client=} cliebntToUse allows for overide
 * @returns {string} sumbission status
 */
async function transferNFTBySDK(sender, receiver, token, serials, clientToUse = client) {
	const tokenTransferTx = new TransferTransaction();
	for (let s = 0; s < serials.length; s++) {
		const nftId = new NftId(token, serials[s]);
		tokenTransferTx.addNftTransfer(nftId, sender, receiver);
	}
	const tokenTransferSubmit = await tokenTransferTx.setTransactionMemo('WL Token Transfer')
		.freezeWith(clientToUse)
		.execute(clientToUse);
	const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);
	return tokenTransferRx.status.toString();

}

/**
 * Helper function to create new accounts
 * @param {PrivateKey} privateKey new accounts private key
 * @param {string | number} initialBalance initial balance in hbar
 * @returns {AccountId} the newly created Account ID object
 */
async function accountCreator(privateKey, initialBalance) {
	const response = await new AccountCreateTransaction()
		.setInitialBalance(new Hbar(initialBalance))
		.setMaxAutomaticTokenAssociations(10)
		.setKey(privateKey.publicKey)
		.execute(client);
	const receipt = await response.getReceipt(client);
	return receipt.accountId;
}

/**
 * Helper method for token association
 * @param {AccountId} account
 * @param {TokenId} tokenToAssociate
 * @returns {any} expected to be a string 'SUCCESS' implies it worked
 */
// eslint-disable-next-line no-unused-vars
async function associateTokenToAccount(account, tokenToAssociate) {
	// now associate the token to the operator account
	const associateToken = await new TokenAssociateTransaction()
		.setAccountId(account)
		.setTokenIds([tokenToAssociate])
		.freezeWith(client);

	const associateTokenTx = await associateToken.execute(client);
	const associateTokenRx = await associateTokenTx.getReceipt(client);

	const associateTokenStatus = associateTokenRx.status;

	return associateTokenStatus.toString();
}


/**
 * Helper function to deploy the contract
 * @param {string} bytecode bytecode from compiled SOL file
 * @param {number} gasLim gas limit as a number
 */
async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addAddress(lazyContractId.toSolidityAddress())
				.addAddress(lazyTokenId.toSolidityAddress())
				.addUint256(lazyBurnPerc),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	contractId = contractCreateRx.contractId;
	contractAddress = contractId.toSolidityAddress();
}

/*
 * basci sleep function
 * @param {number} ms milliseconds to sleep
 * @returns {Promise}
 */
// eslint-disable-next-line no-unused-vars
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper method to transfer FT using HTS
 * @param {AccountId} receiver
 * @param {number} amount amount of the FT to transfer (adjusted for decimal)
 * @returns {any} expected to be a string 'SUCCESS' implies it worked
 */
async function retrieveLazyFromContract(receiver, amount) {

	const gasLim = 600000;
	const params = new ContractFunctionParameters()
		.addAddress(receiver.toSolidityAddress())
		.addInt64(amount);
	const [tokenTransferRx, , ] = await contractExecuteFcn(contractId, gasLim, 'retrieveLazy', params);
	const tokenTransferStatus = tokenTransferRx.status;

	return tokenTransferStatus.toString();
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
 * Helper function to mint an NFT and a serial on to that token
 * Using royaltyies to test the (potentially) more complicate case
 */
async function mintNFTBySDK(name) {
	const supplyKey = PrivateKey.generateED25519();

	// create a basic royalty
	const fee = new CustomRoyaltyFee()
		.setNumerator(2 * 100)
		.setDenominator(10000)
		.setFeeCollectorAccountId(operatorId)
		.setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(5)));

	const tokenCreateTx = new TokenCreateTransaction()
		.setTokenType(TokenType.NonFungibleUnique)
		.setTokenName(name + new Date().toISOString())
		.setTokenSymbol('MCWL')
		.setInitialSupply(0)
		.setMaxSupply(10)
		.setSupplyType(TokenSupplyType.Finite)
		.setTreasuryAccountId(operatorId)
		.setAutoRenewAccountId(operatorId)
		.setSupplyKey(supplyKey)
		.setCustomFees([fee])
		.setMaxTransactionFee(new Hbar(75, HbarUnit.Hbar));

	tokenCreateTx.freezeWith(client);
	const signedCreateTx = await tokenCreateTx.sign(operatorKey);
	const executionResponse = await signedCreateTx.execute(client);

	/* Get the receipt of the transaction */
	const createTokenRx = await executionResponse.getReceipt(client).catch((e) => {
		console.log(e);
		console.log('Token Create **FAILED*');
	});

	/* Get the token ID from the receipt */
	const mintedTokenId = createTokenRx.tokenId;

	// YOU CAN MINT *UP TO* 10 in a single tx by supplying and array of metadata
	const tokenMintTx = new TokenMintTransaction().setMaxTransactionFee(10);
	for (let c = 0 ; c < 10; c++) {
		tokenMintTx.addMetadata(Buffer.from('ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/metadata.json'));
	}
	tokenMintTx.setTokenId(mintedTokenId).freezeWith(client);

	const signedTx = await tokenMintTx.sign(supplyKey);
	const tokenMintSubmit = await signedTx.execute(client);
	// check it worked
	const mintRx = await tokenMintSubmit.getReceipt(client);
	return [mintRx.status.toString(), mintedTokenId];
}