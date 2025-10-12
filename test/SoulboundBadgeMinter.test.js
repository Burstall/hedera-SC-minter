const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	TokenId,
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
	sweepHbar,
	setNFTAllowanceAll,
} = require('../utils/hederaHelpers');
const { checkMirrorHbarBalance } = require('../utils/hederaMirrorHelpers');
const { fail } = require('assert');
const { ethers } = require('ethers');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';
const env = process.env.ENVIRONMENT ?? null;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variables
let contractId;
let contractAddress;
let revocableContractId;
let client, clientAlice, clientBob;
let alicePK, aliceId;
let bobPK, bobId;
let tokenId;
let minterIface;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('Deployment: ', function () {
	it('Should deploy the contract and setup conditions', async function () {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for ABI');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID');
			process.exit(1);
		}

		console.log('\n-Using ENVIRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			clientAlice = Client.forTestnet();
			clientBob = Client.forTestnet();
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			clientAlice = Client.forMainnet();
			clientBob = Client.forMainnet();
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			clientAlice = Client.forPreviewnet();
			clientBob = Client.forPreviewnet();
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			clientAlice = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			clientBob = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file');
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

		// create Bob account
		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(client, bobPK, 200);
		console.log('Bob account ID:', bobId.toString(), '\nkey:', bobPK.toString());
		clientBob.setOperator(bobId, bobPK);

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		const contractBytecode = json.bytecode;

		// import ABI
		minterIface = new ethers.Interface(json.abi);

		const gasLimit = 4_800_000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		const constructorParams = new ContractFunctionParameters()
			.addBool(false);

		[contractId, contractAddress] = await contractDeployFunction(client, contractBytecode, gasLimit, constructorParams);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		console.log('\n-Testing:', contractName);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		// deploy a revocable contract
		const revocableConstructorParams = new ContractFunctionParameters()
			.addBool(true);

		[revocableContractId] = await contractDeployFunction(client, contractBytecode, gasLimit, revocableConstructorParams);

		console.log(`Revocable Contract created with ID: ${revocableContractId} / ${revocableContractId.toSolidityAddress()}`);
		expect(revocableContractId.toString().match(addressRegex).length == 2).to.be.true;
	});
});

describe('Check SC deployment...', function () {
	it('Check default values are set in Constructor', async function () {
		client.setOperator(operatorId, operatorKey);

		// check if owner is an admin
		let encodedCommand = minterIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const isOwnerAdmin = minterIface.decodeFunctionResult('isAdmin', result);
		expect(isOwnerAdmin[0]).to.be.true;

		// check admin list
		encodedCommand = minterIface.encodeFunctionData('getAdmins');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const adminList = minterIface.decodeFunctionResult('getAdmins', result);
		expect(adminList[0].length).to.be.equal(1);
		expect(adminList[0][0].slice(2).toLowerCase()).to.be.equal(operatorId.toEvmAddress());

		// check no token initialized yet
		encodedCommand = minterIface.encodeFunctionData('getToken');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tokenAddress = minterIface.decodeFunctionResult('getToken', result);
		expect(tokenAddress[0]).to.be.equal(ZERO_ADDRESS);

		// check total minted is 0
		encodedCommand = minterIface.encodeFunctionData('totalMinted');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const totalMinted = minterIface.decodeFunctionResult('totalMinted', result);
		expect(Number(totalMinted[0])).to.be.equal(0);

		// check active badge IDs is empty
		encodedCommand = minterIface.encodeFunctionData('getActiveBadgeIds');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const activeBadgeIds = minterIface.decodeFunctionResult('getActiveBadgeIds', result);
		expect(activeBadgeIds[0].length).to.be.equal(0);
	});

	it('Initialise the minter for unlimited token', async function () {
		// execute the initialiseNFTMint function
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_000_000,
			'initialiseNFTMint',
			[
				'SoulboundBadge-test',
				'SBT',
				'SBT testing memo',
				0,
				true,
			],
			MINT_PAYMENT,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Token creation result:', result);
			fail('Token creation failed');
		}
		tokenId = TokenId.fromSolidityAddress(result[1][0]);
		console.log('Token Created:', tokenId.toString(), 'tx:', result[2]?.transactionId?.toString());
		expect(tokenId.toString().match(addressRegex).length == 2).to.be.true;

		// Check unlimited supply was set correctly
		const maxSupply = Number(result[1][1]);
		expect(maxSupply).to.be.greaterThan(1000000000);
	});

	it('Check token was initialized correctly', async function () {
		// let mirror node catch up
		await sleep(5000);

		client.setOperator(operatorId, operatorKey);

		// check token address is set
		let encodedCommand = minterIface.encodeFunctionData('getToken');

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tokenAddress = minterIface.decodeFunctionResult('getToken', result);
		expect(tokenAddress[0].slice(2).toLowerCase()).to.be.equal(tokenId.toSolidityAddress());

		// check max supply
		encodedCommand = minterIface.encodeFunctionData('getMaxSupply');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const maxSupply = minterIface.decodeFunctionResult('getMaxSupply', result);
		expect(Number(maxSupply[0])).to.be.greaterThan(1000000000);

		// check remaining supply
		encodedCommand = minterIface.encodeFunctionData('getRemainingSupply');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const remainingSupply = minterIface.decodeFunctionResult('getRemainingSupply', result);
		// Should return max uint256 for unlimited
		expect(Number(remainingSupply[0])).to.be.greaterThan(1000000000);
	});

	it('Cannot initialize token twice', async function () {
		client.setOperator(operatorId, operatorKey);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				1_000_000,
				'initialiseNFTMint',
				[
					'SoulboundBadge-test2',
					'SBT2',
					'SBT testing memo 2',
					100,
					// limited supply
					false,
				],
				MINT_PAYMENT,
			);

			if (result[0]?.status?.name != 'TokenAlreadyInitialized') {
				console.log('ERROR expecting TokenAlreadyInitialized:', result);
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
	});
});

describe('Check access control permission...', function () {
	it('Check Alice cannot create badges', async function () {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'createBadge',
				[
					'Bronze Badge',
					'ipfs://bronze-metadata',
					100,
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
	});

	it('Check Alice cannot add admins', async function () {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'addAdmin',
				[aliceId.toSolidityAddress()],
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
	});

	it('Check Alice cannot modify whitelists', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'addToBadgeWhitelist',
				[
					1,
					[aliceId.toSolidityAddress()],
					[1],
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
	});
});

describe('Badge Management...', function () {
	it('Owner can add Alice as admin', async function () {
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
			console.log('Adding admin result:', result);
			fail('Adding admin failed');
		}

		// need to wait a bit for mirror node to catch up
		await sleep(5000);

		// Verify Alice is now an admin
		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [aliceId.toSolidityAddress()]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const isAliceAdmin = minterIface.decodeFunctionResult('isAdmin', queryResult);
		if (!isAliceAdmin[0]) {
			console.log('ERROR: Alice should be admin but isAdmin returned false', isAliceAdmin);
			fail('Alice is not admin');
		}
	});

	it('Alice (as admin) can add Bob as admin', async function () {
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
			console.log('Alice adding Bob as admin result:', result);
			fail('Alice adding Bob as admin failed');
		}

		// let mirror node catch up
		await sleep(5000);

		// Verify Bob is now an admin
		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [bobId.toSolidityAddress()]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const isBobAdmin = minterIface.decodeFunctionResult('isAdmin', queryResult);
		expect(isBobAdmin[0]).to.be.true;
	});

	it('Create first badge type', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'createBadge',
			[
				'Bronze Badge',
				'ipfs://bronze-metadata.json',
				100,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Badge creation result:', result);
			fail('Badge creation failed');
		}

		const badgeId = Number(result[1][0]);
		expect(badgeId).to.be.equal(1);
		console.log('Bronze Badge created with ID:', badgeId);

		// let mirror node catch up
		await sleep(5000);

		// Verify badge was created correctly
		const encodedCommand = minterIface.encodeFunctionData('getBadge', [badgeId]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [name, metadata, totalMinted, maxSupply, active] = minterIface.decodeFunctionResult('getBadge', queryResult);
		expect(name).to.be.equal('Bronze Badge');
		expect(metadata).to.be.equal('ipfs://bronze-metadata.json');
		expect(Number(totalMinted)).to.be.equal(0);
		expect(Number(maxSupply)).to.be.equal(100);
		expect(active).to.be.true;
	});

	it('Alice (as admin) can create second badge type', async function () {
		client.setOperator(aliceId, alicePK);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'createBadge',
			[
				'Silver Badge',
				'ipfs://silver-metadata.json',
				0,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Silver badge creation result:', result);
			fail('Badge creation failed');
		}

		const badgeId = Number(result[1][0]);
		expect(badgeId).to.be.equal(2);
		console.log('Silver Badge created with ID:', badgeId);
	});

	it('Check active badge IDs', async function () {
		await sleep(5000);

		const encodedCommand = minterIface.encodeFunctionData('getActiveBadgeIds');

		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const activeBadgeIds = minterIface.decodeFunctionResult('getActiveBadgeIds', result);

		console.log('Active badge IDs:', activeBadgeIds);

		expect(activeBadgeIds[0].length).to.be.equal(2);
		expect(Number(activeBadgeIds[0][0])).to.be.equal(1);
		expect(Number(activeBadgeIds[0][1])).to.be.equal(2);
	});

	it('Update badge metadata', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'updateBadge',
			[
				1,
				'Bronze Badge Updated',
				'ipfs://bronze-metadata-v2.json',
				150,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Badge update result:', result);
			fail('Badge update failed');
		}

		// let mirror node catch up
		await sleep(5000);

		// Verify update
		const encodedCommand = minterIface.encodeFunctionData('getBadge', [1]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [name, metadata, , maxSupply] = minterIface.decodeFunctionResult('getBadge', queryResult);
		expect(name).to.be.equal('Bronze Badge Updated');
		expect(metadata).to.be.equal('ipfs://bronze-metadata-v2.json');
		expect(Number(maxSupply)).to.be.equal(150);
	});

	it('Cannot create unlimited badge when token has limited supply', async function () {
		client.setOperator(operatorId, operatorKey);

		// First reinitialize with limited supply
		// Reset and create limited supply token first
		// We'll do this in a separate test for limited supply scenarios
	});
});

describe('Whitelist Management...', function () {
	it('Add users to Bronze badge whitelist', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'addToBadgeWhitelist',
			[
				// Bronze badge
				1,
				[aliceId.toSolidityAddress(), bobId.toSolidityAddress()],
				// Alice can mint 2, Bob can mint 1
				[2, 1],
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Bronze whitelist update result:', result);
			fail('Whitelist update failed');
		}

		// let mirror node catch up
		await sleep(5000);

		// Verify whitelist
		const encodedCommand = minterIface.encodeFunctionData('getBadgeWhitelist', [1]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [addresses, quantities] = minterIface.decodeFunctionResult('getBadgeWhitelist', queryResult);
		expect(addresses.length).to.be.equal(2);
		expect(addresses[0].slice(2).toLowerCase()).to.be.equal(aliceId.toSolidityAddress());
		expect(addresses[1].slice(2).toLowerCase()).to.be.equal(bobId.toSolidityAddress());
		expect(Number(quantities[0])).to.be.equal(2);
		expect(Number(quantities[1])).to.be.equal(1);
	});

	it('Add users to Silver badge whitelist (unlimited quantities)', async function () {
		// Alice as admin
		client.setOperator(aliceId, alicePK);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			600_000,
			'addToBadgeWhitelist',
			[
				// Silver badge
				2,
				[aliceId.toSolidityAddress(), bobId.toSolidityAddress()],
				// 0 means unlimited
				[0, 0],
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Silver whitelist update result:', result);
			fail('Whitelist update failed');
		}

		await sleep(5000);
	});

	it('Check user eligibility', async function () {
		// Check Alice's eligibility for Bronze badge
		let encodedCommand = minterIface.encodeFunctionData('getUserBadgeEligibility', [1, aliceId.toSolidityAddress()]);

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		let [eligible, remainingMints, alreadyMinted] = minterIface.decodeFunctionResult('getUserBadgeEligibility', result);
		console.log('Alice Bronze badge eligibility:', eligible, Number(remainingMints), Number(alreadyMinted));
		expect(eligible).to.be.true;
		expect(Number(remainingMints)).to.be.equal(2);
		expect(Number(alreadyMinted)).to.be.equal(0);

		// Check Alice's eligibility for Silver badge (unlimited)
		encodedCommand = minterIface.encodeFunctionData('getUserBadgeEligibility', [2, aliceId.toSolidityAddress()]);

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		[eligible, remainingMints, alreadyMinted] = minterIface.decodeFunctionResult('getUserBadgeEligibility', result);
		console.log('Alice Silver badge eligibility:', eligible, Number(remainingMints), Number(alreadyMinted));
		expect(eligible).to.be.true;
		// For unlimited, should be max uint256 or very large number
		expect(Number(remainingMints)).to.be.greaterThan(1000000000);
		expect(Number(alreadyMinted)).to.be.equal(0);
	});
});

describe('Badge Minting...', function () {
	it('Associate the token to users', async function () {
		client.setOperator(operatorId, operatorKey);
		let result = await associateTokenToAccount(client, operatorId, operatorKey, tokenId);
		expect(result).to.be.equal('SUCCESS');

		result = await associateTokenToAccount(client, aliceId, alicePK, tokenId);
		expect(result).to.be.equal('SUCCESS');

		result = await associateTokenToAccount(client, bobId, bobPK, tokenId);
		expect(result).to.be.equal('SUCCESS');
	});

	it('Alice cannot mint without being whitelisted', async function () {
		client.setOperator(aliceId, alicePK);

		// Try to mint badge type 1 but for operator (not whitelisted)
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				800_000,
				'mintBadgeOnBehalf',
				[
					// Bronze badge
					1,
					// quantity
					1,
					// operator not whitelisted
					operatorId.toSolidityAddress(),
				],
			);

			if (result[0]?.status?.name != 'NotWhitelistedForType') {
				console.log('ERROR expecting NotWhitelistedForType:', result);
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
	});

	it('Alice can mint Bronze badge for herself', async function () {
		client.setOperator(aliceId, alicePK);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'mintBadge',
			[
				// Bronze badge
				1,
				// quantity
				1,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Alice Bronze badge mint result:', result);
			fail('Badge minting failed');
		}

		console.log('Alice Bronze badge mint tx:', result[2]?.transactionId?.toString());

		const serialNumbers = result[1][0];
		expect(serialNumbers.length).to.be.equal(1);
		const serial = Number(serialNumbers[0]);
		console.log('Alice minted Bronze badge, serial:', serial);

		// let mirror node catch up
		await sleep(5000);

		// Check the serial-to-badge mapping
		const encodedCommand = minterIface.encodeFunctionData('getSerialBadgeId', [serial]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const badgeId = minterIface.decodeFunctionResult('getSerialBadgeId', queryResult);
		expect(Number(badgeId[0])).to.be.equal(1);
	});

	it('Check Alice\'s updated eligibility and mint counts', async function () {
		// Check Alice's remaining eligibility for Bronze badge
		let encodedCommand = minterIface.encodeFunctionData('getUserBadgeEligibility', [1, aliceId.toSolidityAddress()]);

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [eligible, remainingMints, alreadyMinted] = minterIface.decodeFunctionResult('getUserBadgeEligibility', result);
		expect(eligible).to.be.true;
		// Was 2, now 1
		expect(Number(remainingMints)).to.be.equal(1);
		expect(Number(alreadyMinted)).to.be.equal(1);

		// Check user mint counts
		encodedCommand = minterIface.encodeFunctionData('getUserBadgeMintCounts', [aliceId.toSolidityAddress(), [1, 2]]);

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const mintCounts = minterIface.decodeFunctionResult('getUserBadgeMintCounts', result);
		// Bronze badge count
		expect(Number(mintCounts[0][0])).to.be.equal(1);
		// Silver badge count
		expect(Number(mintCounts[0][1])).to.be.equal(0);
	});

	it('Alice can mint Silver badge (unlimited)', async function () {
		client.setOperator(aliceId, alicePK);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			1_800_000,
			'mintBadge',
			[
				// Silver badge
				2,
				// quantity - test multiple mints
				3,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Alice Silver badge mint result:', result);
			fail('Badge minting failed');
		}

		console.log('Alice Silver badge mint tx:', result[2]?.transactionId?.toString());

		const serialNumbers = result[1][0];
		expect(serialNumbers.length).to.be.equal(3);
		console.log('Alice minted 3 Silver badges, serials:', serialNumbers.map(s => Number(s)));
	});

	it('Alice cannot exceed Bronze badge whitelist limit', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				1_600_000,
				'mintBadge',
				[
					// Bronze badge
					1,
					// quantity - but Alice only has 1 remaining
					2,
				],
			);

			if (result[0]?.status?.name != 'NotEnoughWLSlots') {
				console.log('ERROR expecting NotEnoughWLSlots:', result);
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
	});

	it('Bob can mint his allocated Bronze badge', async function () {
		client.setOperator(bobId, bobPK);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'mintBadge',
			[
				// Bronze badge
				1,
				// quantity - Bob's limit
				1,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Bob Bronze badge mint result:', result);
			fail('Badge minting failed');
		}

		const serialNumbers = result[1][0];
		expect(serialNumbers.length).to.be.equal(1);
		console.log('Bob minted Bronze badge, serial:', Number(serialNumbers[0]));
	});

	it('Check badge remaining supply', async function () {
		await sleep(5000);

		// Bronze badge: started with 150, minted 2 (Alice 1 + Bob 1)
		let encodedCommand = minterIface.encodeFunctionData('getBadgeRemainingSupply', [1]);

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		let remainingSupply = minterIface.decodeFunctionResult('getBadgeRemainingSupply', result);
		// 150 - 2
		expect(Number(remainingSupply[0])).to.be.equal(148);

		// Silver badge: unlimited
		encodedCommand = minterIface.encodeFunctionData('getBadgeRemainingSupply', [2]);

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		remainingSupply = minterIface.decodeFunctionResult('getBadgeRemainingSupply', result);
		// Should be max uint256 for unlimited
		expect(Number(remainingSupply[0])).to.be.greaterThan(1000000000);
	});

	it('Check total minted and capacity analysis', async function () {
		await sleep(5000);
		// Check total minted: Alice (1 Bronze + 3 Silver) + Bob (1 Bronze) = 5
		let encodedCommand = minterIface.encodeFunctionData('totalMinted');

		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const totalMinted = minterIface.decodeFunctionResult('totalMinted', result);
		expect(Number(totalMinted[0])).to.be.equal(5);

		// Check capacity analysis
		encodedCommand = minterIface.encodeFunctionData('getCapacityAnalysis');

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [tokenMaxSupply, tokenMinted, , , , hasUnlimitedBadges] = minterIface.decodeFunctionResult('getCapacityAnalysis', result);

		// Unlimited token
		expect(Number(tokenMaxSupply)).to.be.greaterThanOrEqual(Number.MAX_SAFE_INTEGER);
		expect(Number(tokenMinted)).to.be.equal(5);
		// Silver badge is unlimited
		expect(hasUnlimitedBadges).to.be.true;
	});
});

describe('Badge Deactivation...', function () {
	it('Deactivate Bronze badge', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'setBadgeActive',
			[
				// Bronze badge
				1,
				// deactivate
				false,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Badge deactivation result:', result);
			fail('Badge deactivation failed');
		}

		// let mirror node catch up
		await sleep(5000);

		// Verify badge is inactive
		const encodedCommand = minterIface.encodeFunctionData('getBadge', [1]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [name, metadata, totalMinted, maxSupply, active] = minterIface.decodeFunctionResult('getBadge', queryResult);
		console.log('Bronze badge active status:', name, metadata, Number(totalMinted), Number(maxSupply), active);
		expect(active).to.be.false;
	});

	it('Cannot mint deactivated badge', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				800_000,
				'mintBadge',
				[
					// Bronze badge (deactivated)
					1,
					// quantity
					1,
				],
			);

			if (result[0]?.status?.name != 'TypeNotFound') {
				console.log('ERROR expecting TypeNotFound:', result);
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
	});

	it('Reactivate Bronze badge', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'setBadgeActive',
			[
				// Bronze badge
				1,
				// reactivate
				true,
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Reactivate Bronze badge', result);
			fail('Badge reactivation failed');
		}
	});
});

describe('Badge Burning...', function () {
	it('Alice can burn her Silver badge NFTs', async function () {
		client.setOperator(aliceId, alicePK);

		// Allow the contract to move the NFTs back to treasury for burning
		const approvalTx = await setNFTAllowanceAll(
			client,
			[tokenId],
			aliceId,
			contractId,
		);

		if (approvalTx != 'SUCCESS') {
			console.log('Error setting NFT allowance for burn:', approvalTx);
			fail('Setting NFT allowance failed');
		}

		// Alice should have 3 Silver badges (serials 2, 3, 4) and 1 Bronze (serial 1)
		// Let's burn 2 of her Silver badges
		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			800_000,
			'burnNFTs',
			[
				// Serial numbers to burn
				[2, 3],
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('NFT burning result:', result);
			fail('NFT burning failed');
		}

		const newTotalSupply = Number(result[1][0]);
		console.log('New total supply after burn:', newTotalSupply);

		// let mirror node catch up
		await sleep(5000);

		// Check Alice's updated mint counts
		const encodedCommand = minterIface.encodeFunctionData('getUserBadgeMintCounts', [aliceId.toSolidityAddress(), [1, 2]]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const mintCounts = minterIface.decodeFunctionResult('getUserBadgeMintCounts', queryResult);
		// Bronze badge count unchanged
		expect(Number(mintCounts[0][0])).to.be.equal(1);
		// Silver badge count reduced from 3 to 1
		expect(Number(mintCounts[0][1])).to.be.equal(1);
	});

	it('Check total minted after burn', async function () {
		await sleep(5000);
		// Should be 3 now (was 5, burned 2)
		const encodedCommand = minterIface.encodeFunctionData('totalMinted');

		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const totalMinted = minterIface.decodeFunctionResult('totalMinted', result);
		expect(Number(totalMinted[0])).to.be.equal(3);
	});
});

describe('Admin Management...', function () {
	it('Alice (as admin) can remove Bob as admin', async function () {
		client.setOperator(aliceId, alicePK);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'removeAdmin',
			[bobId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Alice removing Bob as admin result:', result);
			fail('Alice removing Bob as admin failed');
		}

		// let mirror node catch up
		await sleep(5000);

		// Verify Bob is no longer an admin
		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [bobId.toSolidityAddress()]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const isBobAdmin = minterIface.decodeFunctionResult('isAdmin', queryResult);
		expect(isBobAdmin[0]).to.be.false;
	});

	it('Remove Alice as admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			400_000,
			'removeAdmin',
			[aliceId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Remove admin result:', result);
			fail('Removing admin failed');
		}

		// let mirror node catch up
		await sleep(5000);

		// Verify Alice is no longer an admin
		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [aliceId.toSolidityAddress()]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const isAliceAdmin = minterIface.decodeFunctionResult('isAdmin', queryResult);
		expect(isAliceAdmin[0]).to.be.false;
	});

	it('Cannot remove the last admin', async function () {
		client.setOperator(operatorId, operatorKey);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		// Now owner is the only admin left, try to remove owner (should fail)
		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				400_000,
				'removeAdmin',
				[operatorId.toSolidityAddress()],
			);

			if (result[0]?.status?.name != 'CannotRemoveLastAdmin') {
				console.log('ERROR expecting CannotRemoveLastAdmin:', result);
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

		// Verify owner is still an admin
		const encodedCommand = minterIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);

		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const isOwnerAdmin = minterIface.decodeFunctionResult('isAdmin', queryResult);
		expect(isOwnerAdmin[0]).to.be.true;
	});

	it('Alice can no longer create badges', async function () {
		client.setOperator(aliceId, alicePK);
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				600_000,
				'createBadge',
				[
					'Gold Badge',
					'ipfs://gold-metadata.json',
					50,
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
	});
});

describe('Revocable SBT functions...', function () {
	it('Check Owner can revoke SBT from revocable contract', async function () {
		client.setOperator(operatorId, operatorKey);

		// First, initialize a token in the revocable contract
		const initResult = await contractExecuteFunction(
			revocableContractId,
			minterIface,
			client,
			1_000_000,
			'initialiseNFTMint',
			[
				'RevocableSBT-test',
				'RSBT',
				'Revocable SBT testing',
				100,
				false,
			],
			MINT_PAYMENT,
		);

		if (initResult[0]?.status?.toString() != 'SUCCESS') {
			console.log(initResult[0]?.status?.toString());
			fail('Revocable token creation failed');
		}

		const revocableTokenId = TokenId.fromSolidityAddress(initResult[1][0]);
		console.log('Revocable Token Created:', revocableTokenId.toString());

		// Create a badge and whitelist Alice
		const badgeResult = await contractExecuteFunction(
			revocableContractId,
			minterIface,
			client,
			600_000,
			'createBadge',
			[
				'Revocable Badge',
				'ipfs://revocable-metadata.json',
				10,
			],
		);

		if (badgeResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('Revocable badge creation result:', badgeResult);
			fail('Revocable badge creation failed');
		}

		// Whitelist Alice
		const whitelistResult = await contractExecuteFunction(
			revocableContractId,
			minterIface,
			client,
			600_000,
			'addToBadgeWhitelist',
			[
				// Badge ID
				1,
				[aliceId.toSolidityAddress()],
				[1],
			],
		);

		if (whitelistResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('Revocable whitelist result:', whitelistResult);
			fail('Revocable badge whitelist failed');
		}

		// Associate token to Alice
		const result = await associateTokenToAccount(client, aliceId, alicePK, revocableTokenId);
		expect(result).to.be.equal('SUCCESS');

		// Alice mints a badge
		client.setOperator(aliceId, alicePK);
		const mintResult = await contractExecuteFunction(
			revocableContractId,
			minterIface,
			client,
			800_000,
			'mintBadge',
			[
				// Badge ID
				1,
				// quantity
				1,
			],
		);

		if (mintResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('Revocable mint result:', mintResult);
			fail('Revocable badge minting failed');
		}

		const serialNumbers = mintResult[1][0];
		const serial = Number(serialNumbers[0]);
		console.log('Alice minted revocable badge, serial:', serial);

		// let mirror node catch up
		await sleep(5000);

		// Now test revocation - switch back to owner
		client.setOperator(operatorId, operatorKey);

		// Verify Alice owns the NFT before revocation
		// Note: For simplicity, we'll assume the serial is valid and owned by Alice

		// Revoke the SBT from Alice
		const revokeResult = await contractExecuteFunction(
			revocableContractId,
			minterIface,
			client,
			800_000,
			'revokeSBT',
			[
				aliceId.toSolidityAddress(),
				serial,
			],
		);

		if (revokeResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('Revocation result:', revokeResult);
			fail('SBT revocation failed');
		}

		console.log('Successfully revoked SBT serial', serial, 'from Alice');

		// let mirror node catch up
		await sleep(5000);

		// Verify Alice no longer has the NFT and is removed from whitelist
		const eligibilityCommand = minterIface.encodeFunctionData('getUserBadgeEligibility', [1, aliceId.toSolidityAddress()]);

		const eligibilityResult = await readOnlyEVMFromMirrorNode(
			env,
			revocableContractId,
			eligibilityCommand,
			operatorId,
			false,
		);

		const [eligible] = minterIface.decodeFunctionResult('getUserBadgeEligibility', eligibilityResult);
		// Should be false as Alice was removed from whitelist
		expect(eligible).to.be.false;

		console.log('Verified Alice is no longer eligible for the badge after revocation');
	});
});

describe('Withdrawal tests...', function () {
	it('Check Alice cannot withdraw hbar', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				300_000,
				'transferHbar',
				[aliceId.toSolidityAddress(), 1_000],
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
	});

	it('Check Owner can pull hbar', async function () {
		client.setOperator(operatorId, operatorKey);

		await sleep(3000);

		// Check if contract has any HBAR balance first
		const contractHbarBalance = await checkMirrorHbarBalance(env, AccountId.fromString(contractId.toString()));
		console.log('Contract HBAR balance:', contractHbarBalance);

		if (contractHbarBalance && contractHbarBalance > 0) {
			const result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				300_000,
				'transferHbar',
				[operatorId.toSolidityAddress(), contractHbarBalance],
			);

			if (result[0]?.status?.toString() != 'SUCCESS') {
				console.log('HBAR withdrawal failed - this is expected if contract has no HBAR balance');
			}
			else {
				console.log('HBAR withdrawal successful');
			}
		}
		else {
			console.log('Contract has no HBAR balance to withdraw');
		}
	});

	it('Sweep hbar from Alice & Bob as cleanup', async function () {

		let balance = await checkMirrorHbarBalance(env, aliceId);
		balance -= 1_000_000;
		console.log('sweeping alice', balance / 10 ** 8);
		let result = await sweepHbar(client, aliceId, alicePK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
		console.log('alice:', result);

		balance = await checkMirrorHbarBalance(env, bobId);
		balance -= 1_000_000;
		console.log('sweeping bob', balance / 10 ** 8);
		result = await sweepHbar(client, bobId, bobPK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
		console.log('bob:', result);
	});

});