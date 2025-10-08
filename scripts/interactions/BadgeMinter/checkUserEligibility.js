const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { homebrewPopulateAccountEvmAddress } = require('../../../utils/hederaMirrorHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// Check for optional arguments
	let badgeId = null;
	let userAccount = null;

	if (process.argv.length === 3) {
		// Either badge ID or user account
		const arg = process.argv[2];
		if (arg.startsWith('0.0.') || arg.startsWith('0x')) {
			userAccount = arg;
		}
		else {
			badgeId = parseInt(arg);
		}
	}
	else if (process.argv.length === 4) {
		// Both badge ID and user account
		badgeId = parseInt(process.argv[2]);
		userAccount = process.argv[3];
	}

	if (process.argv.length > 4) {
		console.log('Usage: node checkUserEligibility.js [badgeId] [userAccount]');
		console.log('Example: node checkUserEligibility.js                        # Check your eligibility for all badges');
		console.log('Example: node checkUserEligibility.js 1                     # Check your eligibility for badge 1');
		console.log('Example: node checkUserEligibility.js 0.0.12345             # Check another user\'s eligibility for all badges');
		console.log('Example: node checkUserEligibility.js 1 0.0.12345           # Check another user\'s eligibility for badge 1');
		return;
	}

	if (operatorId === undefined || operatorId == null) {
		console.log('Environment required, please specify ACCOUNT_ID in the .env file');
		return;
	}
	else if (contractId === undefined || contractId == null) {
		console.log('Contract ID required, please specify CONTRACT_ID in the .env file');
		return;
	}

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using contract:', contractId.toString());
	console.log('\n-Using contract name:', contractName);

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('interacting in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('interacting in *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('interacting in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('interacting in *LOCAL*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));
	const minterIface = new ethers.Interface(json.abi);

	// Default to operator if no user specified
	const targetUser = userAccount || operatorId.toString();

	// Convert to EVM address
	let userEvmAddress;
	if (targetUser.startsWith('0.0.')) {
		const accountId = AccountId.fromString(targetUser);
		try {
			userEvmAddress = await homebrewPopulateAccountEvmAddress(env, accountId);
		}
		catch {
			userEvmAddress = accountId.toSolidityAddress();
		}
	}
	else if (targetUser.startsWith('0x')) {
		userEvmAddress = targetUser;
	}
	else {
		console.log('Invalid account format. Use either 0.0.xxxxx or 0x...');
		return;
	}

	try {
		if (badgeId !== null) {
			// Check specific badge eligibility
			await checkSpecificBadgeEligibility(minterIface, badgeId, targetUser, userEvmAddress);
		}
		else {
			// Check all badges eligibility
			await checkAllBadgesEligibility(minterIface, targetUser, userEvmAddress);
		}
	}
	catch (error) {
		console.log('❌ Error checking eligibility:', error.message);
	}
};

async function checkSpecificBadgeEligibility(minterIface, badgeId, userAccount, userEvmAddress) {
	console.log('\n===========================================');
	console.log(`BADGE ${badgeId} ELIGIBILITY CHECK`);
	console.log('===========================================');
	console.log('User:', userAccount);

	try {
		const encodedCommand = minterIface.encodeFunctionData('getUserBadgeEligibility', [badgeId, userEvmAddress]);

		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [eligible, remainingMints, alreadyMinted] = minterIface.decodeFunctionResult('getUserBadgeEligibility', result);

		console.log('\nResults:');
		console.log('Eligible:', eligible ? '✅ Yes' : '❌ No');
		console.log('Already Minted:', Number(alreadyMinted));

		if (eligible) {
			const remaining = Number(remainingMints);
			console.log('Remaining Mints:', remaining > 1000000000 ? 'Unlimited' : remaining);
		}
		else {
			console.log('Remaining Mints: N/A (not eligible)');
		}

		// Get badge info for context
		const badgeCommand = minterIface.encodeFunctionData('getBadge', [badgeId]);
		const badgeResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			badgeCommand,
			operatorId,
			false,
		);
		const [badgeName, , , , active] = minterIface.decodeFunctionResult('getBadge', badgeResult);

		console.log('\nBadge Info:');
		console.log('Name:', badgeName);
		console.log('Active:', active ? '✅ Yes' : '❌ No');

	}
	catch (error) {
		if (error.message.includes('TypeNotFound')) {
			console.log(`❌ Badge ID ${badgeId} does not exist.`);
		}
		else {
			console.log('❌ Error checking eligibility:', error.message);
		}
	}
}

async function checkAllBadgesEligibility(minterIface, userAccount, userEvmAddress) {
	console.log('\n===========================================');
	console.log('ALL BADGES ELIGIBILITY CHECK');
	console.log('===========================================');
	console.log('User:', userAccount);

	try {
		// Get active badge IDs
		const activeCommand = minterIface.encodeFunctionData('getActiveBadgeIds');
		const activeResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			activeCommand,
			operatorId,
			false,
		);
		const activeBadgeIds = minterIface.decodeFunctionResult('getActiveBadgeIds', activeResult);

		if (activeBadgeIds[0].length === 0) {
			console.log('\nNo active badges found.');
			return;
		}

		console.log(`\nChecking eligibility for ${activeBadgeIds[0].length} active badge(s):\n`);

		let eligibleCount = 0;
		let totalMinted = 0;

		for (let i = 0; i < activeBadgeIds[0].length; i++) {
			const badgeId = Number(activeBadgeIds[0][i]);

			// Get badge info
			const badgeCommand = minterIface.encodeFunctionData('getBadge', [badgeId]);
			const badgeResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				badgeCommand,
				operatorId,
				false,
			);
			const [badgeName] = minterIface.decodeFunctionResult('getBadge', badgeResult);

			// Get eligibility
			const eligibilityCommand = minterIface.encodeFunctionData('getUserBadgeEligibility', [badgeId, userEvmAddress]);
			const eligibilityResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				eligibilityCommand,
				operatorId,
				false,
			);
			const [eligible, remainingMints, alreadyMinted] = minterIface.decodeFunctionResult('getUserBadgeEligibility', eligibilityResult);

			console.log(`--- Badge ${badgeId}: ${badgeName} ---`);
			console.log('Eligible:', eligible ? '✅ Yes' : '❌ No');
			console.log('Already Minted:', Number(alreadyMinted));

			if (eligible) {
				eligibleCount++;
				const remaining = Number(remainingMints);
				console.log('Can Mint:', remaining > 1000000000 ? 'Unlimited' : remaining);
			}

			totalMinted += Number(alreadyMinted);
			console.log('');
		}

		console.log('===========================================');
		console.log('SUMMARY');
		console.log('===========================================');
		console.log('Total Badges:', activeBadgeIds[0].length);
		console.log('Eligible For:', eligibleCount);
		console.log('Total Minted by User:', totalMinted);

	}
	catch (error) {
		console.log('❌ Error checking eligibility:', error.message);
	}
}

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});