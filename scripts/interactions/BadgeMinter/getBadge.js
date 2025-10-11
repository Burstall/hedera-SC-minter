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

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// Check for optional badge ID or "all" argument
	let badgeId = null;
	let showAll = false;

	if (process.argv.length === 3) {
		const arg = process.argv[2];
		if (arg.toLowerCase() === 'all') {
			showAll = true;
		}
		else {
			badgeId = parseInt(arg);
			if (isNaN(badgeId)) {
				console.log('Usage: node getBadge.js [badgeId|all]');
				console.log('Example: node getBadge.js 1     # Get info for badge ID 1');
				console.log('Example: node getBadge.js       # Get info for active badges only');
				console.log('Example: node getBadge.js all   # Get info for all badges (active and inactive)');
				return;
			}
		}
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

	try {
		if (badgeId !== null) {
			// Get specific badge info
			await getBadgeInfo(minterIface, badgeId);
		}
		else {
			// Get all badges info (active only or all badges)
			await getAllBadgesInfo(minterIface, showAll);
		}
	}
	catch (error) {
		console.log('❌ Error fetching badge info:', error.message);
	}
};

async function getBadgeInfo(minterIface, badgeId) {
	console.log('\n===========================================');
	console.log(`BADGE ID ${badgeId} INFORMATION`);
	console.log('===========================================');

	try {
		const encodedCommand = minterIface.encodeFunctionData('getBadge', [badgeId]);

		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const [name, metadata, totalMinted, maxSupply, active] = minterIface.decodeFunctionResult('getBadge', result);

		console.log('Name:', name);
		console.log('Metadata:', metadata);
		console.log('Total Minted:', Number(totalMinted));
		console.log('Max Supply:', Number(maxSupply) === 0 ? 'Unlimited' : Number(maxSupply));
		console.log('Active:', active ? '✅ Yes' : '❌ No');

		// Get remaining supply
		const remainingCommand = minterIface.encodeFunctionData('getBadgeRemainingSupply', [badgeId]);
		const remainingResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			remainingCommand,
			operatorId,
			false,
		);
		const remainingSupply = minterIface.decodeFunctionResult('getBadgeRemainingSupply', remainingResult);

		const remaining = Number(remainingSupply[0]);
		console.log('Remaining Supply:', remaining > 1000000000 ? 'Unlimited' : remaining);

		// Calculate mint percentage if limited supply
		if (Number(maxSupply) > 0) {
			const percentage = ((Number(totalMinted) / Number(maxSupply)) * 100).toFixed(2);
			console.log('Minted Percentage:', `${percentage}%`);
		}

	}
	catch (error) {
		if (error.message.includes('TypeNotFound')) {
			console.log(`❌ Badge ID ${badgeId} does not exist.`);
		}
		else {
			console.log('❌ Error fetching badge info:', error.message);
		}
	}
}

async function getAllBadgesInfo(minterIface, showAll = false) {
	console.log('\n===========================================');
	console.log(showAll ? 'ALL BADGES INFORMATION (ACTIVE & INACTIVE)' : 'ACTIVE BADGES INFORMATION');
	console.log('===========================================');

	try {
		let badgeIds = [];

		if (showAll) {
			// Try to get all badges by iterating through IDs until we hit TypeNotFound
			// Start from ID 1 and keep going until we get an error
			let currentId = 1;
			// Safety limit to prevent infinite loops
			const maxAttempts = 100;

			while (currentId <= maxAttempts) {
				try {
					const testCommand = minterIface.encodeFunctionData('getBadge', [currentId]);
					await readOnlyEVMFromMirrorNode(
						env,
						contractId,
						testCommand,
						operatorId,
						false,
					);
					// If we got here, the badge exists
					badgeIds.push(currentId);
					currentId++;
				}
				catch (error) {
					if (error.message.includes('TypeNotFound')) {
						// We've reached the end of existing badges
						break;
					}
					else {
						// Some other error, skip this ID and continue
						currentId++;
					}
				}
			}

			if (badgeIds.length === 0) {
				console.log('No badges found.');
				return;
			}
		}
		else {
			// Get active badge IDs only
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
				console.log('No active badges found.');
				return;
			}

			badgeIds = activeBadgeIds[0].map(id => Number(id));
		}

		console.log(`Found ${badgeIds.length} badge(s):\n`);

		for (let i = 0; i < badgeIds.length; i++) {
			const badgeId = badgeIds[i];

			console.log(`--- Badge ID: ${badgeId} ---`);

			try {
				const encodedCommand = minterIface.encodeFunctionData('getBadge', [badgeId]);
				const result = await readOnlyEVMFromMirrorNode(
					env,
					contractId,
					encodedCommand,
					operatorId,
					false,
				);

				const [name, metadata, totalMinted, maxSupply, active] = minterIface.decodeFunctionResult('getBadge', result);

				console.log('Name:', name);
				console.log('Metadata:', metadata);
				console.log('Total Minted:', Number(totalMinted));
				console.log('Max Supply:', Number(maxSupply) === 0 ? 'Unlimited' : Number(maxSupply));
				console.log('Active:', active ? '✅' : '❌');

				if (Number(maxSupply) > 0) {
					const percentage = ((Number(totalMinted) / Number(maxSupply)) * 100).toFixed(2);
					console.log('Progress:', `${percentage}%`);
				}
			}
			catch (error) {
				if (error.message.includes('TypeNotFound')) {
					console.log(`❌ Badge ID ${badgeId} does not exist.`);
				}
				else {
					console.log('❌ Error fetching badge info:', error.message);
				}
			}

			console.log('');
		}

		// Get total minted across all badges
		const totalCommand = minterIface.encodeFunctionData('totalMinted');
		const totalResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			totalCommand,
			operatorId,
			false,
		);
		const totalMinted = minterIface.decodeFunctionResult('totalMinted', totalResult);

		console.log('===========================================');
		console.log('TOTAL MINTED ACROSS ALL BADGES:', Number(totalMinted[0]));

	}
	catch (error) {
		console.log('❌ Error fetching badges info:', error.message);
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