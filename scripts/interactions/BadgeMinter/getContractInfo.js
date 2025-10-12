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
		console.log('\n===========================================');
		console.log('CONTRACT INFORMATION');
		console.log('===========================================');

		// Get token information
		const tokenCommand = minterIface.encodeFunctionData('getToken');
		const tokenResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			tokenCommand,
			operatorId,
			false,
		);
		const tokenAddress = minterIface.decodeFunctionResult('getToken', tokenResult);

		console.log('\n📋 Token Information:');
		if (tokenAddress[0] === '0x0000000000000000000000000000000000000000') {
			console.log('Token: ❌ Not initialized');
		}
		else {
			console.log('Token Address:', tokenAddress[0]);

			// Get max supply
			const maxSupplyCommand = minterIface.encodeFunctionData('getMaxSupply');
			const maxSupplyResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				maxSupplyCommand,
				operatorId,
				false,
			);
			const maxSupply = minterIface.decodeFunctionResult('getMaxSupply', maxSupplyResult);

			console.log('Max Supply:', Number(maxSupply[0]) > 1000000000 ? 'Unlimited' : Number(maxSupply[0]));

			// Get total minted
			const totalMintedCommand = minterIface.encodeFunctionData('totalMinted');
			const totalMintedResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				totalMintedCommand,
				operatorId,
				false,
			);
			const totalMinted = minterIface.decodeFunctionResult('totalMinted', totalMintedResult);

			console.log('Total Minted:', Number(totalMinted[0]));

			// Get remaining supply
			const remainingCommand = minterIface.encodeFunctionData('getRemainingSupply');
			const remainingResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				remainingCommand,
				operatorId,
				false,
			);
			const remainingSupply = minterIface.decodeFunctionResult('getRemainingSupply', remainingResult);

			const remaining = Number(remainingSupply[0]);
			console.log('Remaining Supply:', remaining > 1000000000 ? 'Unlimited' : remaining);
		}

		// Get admin information
		console.log('\n👥 Admin Information:');
		const adminsCommand = minterIface.encodeFunctionData('getAdmins');
		const adminsResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			adminsCommand,
			operatorId,
			false,
		);
		const adminList = minterIface.decodeFunctionResult('getAdmins', adminsResult);

		console.log(`Total Admins: ${adminList[0].length}`);

		// Check if operator is admin
		const isAdminCommand = minterIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);
		const isAdminResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			isAdminCommand,
			operatorId,
			false,
		);
		const isAdmin = minterIface.decodeFunctionResult('isAdmin', isAdminResult);

		console.log('You are admin:', isAdmin[0] ? '✅ Yes' : '❌ No');

		// Get active badge information
		console.log('\n🏅 Badge Information:');
		const activeBadgesCommand = minterIface.encodeFunctionData('getActiveBadgeIds');
		const activeBadgesResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			activeBadgesCommand,
			operatorId,
			false,
		);
		const activeBadgeIds = minterIface.decodeFunctionResult('getActiveBadgeIds', activeBadgesResult);

		console.log(`Active Badges: ${activeBadgeIds[0].length}`);

		if (activeBadgeIds[0].length > 0) {
			for (let i = 0; i < Math.min(5, activeBadgeIds[0].length); i++) {
				const badgeId = Number(activeBadgeIds[0][i]);

				const badgeCommand = minterIface.encodeFunctionData('getBadge', [badgeId]);
				const badgeResult = await readOnlyEVMFromMirrorNode(
					env,
					contractId,
					badgeCommand,
					operatorId,
					false,
				);
				const [name, , totalMinted, maxSupply] = minterIface.decodeFunctionResult('getBadge', badgeResult);

				console.log(`  ${badgeId}: ${name} (${Number(totalMinted)}/${Number(maxSupply) === 0 ? '∞' : Number(maxSupply)})`);
			}

			if (activeBadgeIds[0].length > 5) {
				console.log(`  ... and ${activeBadgeIds[0].length - 5} more`);
			}
		}

		// Get capacity analysis
		console.log('\n📊 Capacity Analysis:');
		try {
			const capacityCommand = minterIface.encodeFunctionData('getCapacityAnalysis');
			const capacityResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				capacityCommand,
				operatorId,
				false,
			);
			const [tokenMaxSupply, tokenMinted, tokenRemaining, totalBadgeCapacity, reservedCapacity, hasUnlimitedBadges] = minterIface.decodeFunctionResult('getCapacityAnalysis', capacityResult);

			console.log('Token Max Supply:', Number(tokenMaxSupply) > 1000000000 ? 'Unlimited' : Number(tokenMaxSupply));
			console.log('Token Minted:', Number(tokenMinted));
			console.log('Token Remaining:', Number(tokenRemaining) > 1000000000 ? 'Unlimited' : Number(tokenRemaining));
			console.log('Total Badge Capacity:', Number(totalBadgeCapacity) > 1000000000 ? 'Unlimited' : Number(totalBadgeCapacity));
			console.log('Reserved Capacity:', Number(reservedCapacity) > 1000000000 ? 'Unlimited' : Number(reservedCapacity));
			console.log('Has Unlimited Badges:', hasUnlimitedBadges ? 'Yes' : 'No');

			// Calculate utilization if not unlimited
			if (Number(tokenMaxSupply) <= 1000000000 && Number(totalBadgeCapacity) <= 1000000000) {
				const utilization = Number(totalBadgeCapacity) > 0 ?
					((Number(tokenMinted) / Number(totalBadgeCapacity)) * 100).toFixed(2) : 0;
				console.log('Capacity Utilization:', `${utilization}%`);
			}
		}
		catch (error) {
			console.log('Capacity analysis not available', error);
		}

		// Contract version and features
		console.log('\n🔧 Contract Features:');
		console.log('Contract Type: SoulboundBadgeMinter');
		console.log('Multi-Badge Support: ✅ Yes');
		console.log('Whitelist Management: ✅ Yes');
		console.log('Admin Management: ✅ Yes');

		// Get revocable status from contract
		try {
			const revocableCommand = minterIface.encodeFunctionData('REVOCABLE');
			const revocableResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				revocableCommand,
				operatorId,
				false,
			);
			const revocable = minterIface.decodeFunctionResult('REVOCABLE', revocableResult);
			console.log('Revocable SBTs:', revocable[0] ? '✅ Yes' : '❌ No');
		}
		catch (error) {
			console.log('Revocable SBTs: ❓ Could not determine -', error.message);
		}

	}
	catch (error) {
		console.log('❌ Error fetching contract information:', error.message);
	}
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});