const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { homebrewPopulateAccountEvmAddress, checkNFTOwnership } = require('../../../utils/hederaMirrorHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// Check for required arguments
	if (process.argv.length !== 4) {
		console.log('Usage: node revokeSBT.js <userAccount> <serialNumber>');
		console.log('Example: node revokeSBT.js 0.0.12345 42');
		console.log('Example: node revokeSBT.js 0x000000000000000000000000000000000000beef 42');
		console.log('Note: This only works if the contract was deployed as revocable');
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

	const userAccountInput = process.argv[2];
	const serialNumber = parseInt(process.argv[3]);

	// Convert account to EVM address
	let userEvmAddress;
	if (userAccountInput.startsWith('0.0.')) {
		const accountId = AccountId.fromString(userAccountInput);
		try {
			userEvmAddress = await homebrewPopulateAccountEvmAddress(env, accountId);
		}
		catch {
			userEvmAddress = accountId.toSolidityAddress();
		}
	}
	else if (userAccountInput.startsWith('0x')) {
		userEvmAddress = userAccountInput;
	}
	else {
		console.log('Invalid account format. Use either 0.0.xxxxx or 0x...');
		return;
	}

	console.log('\n===========================================');
	console.log('REVOKE SOULBOUND TOKEN');
	console.log('===========================================');
	console.log('User Account:', userAccountInput);
	console.log('EVM Address:', userEvmAddress);
	console.log('Serial Number:', serialNumber);

	// Check if contract is revocable
	console.log('\n🔍 Validating revocation...');
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

		if (!revocable[0]) {
			console.log('❌ Contract is NOT revocable!');
			console.log('   This contract was deployed without revocation capability.');
			console.log('   SBTs cannot be revoked from this contract.');
			return;
		}
		console.log('✅ Contract is revocable');
	}
	catch (error) {
		console.log('⚠️  Could not verify contract revocability:', error.message);
	}

	// Get token address
	let tokenIdString;
	try {
		const tokenCommand = minterIface.encodeFunctionData('getToken');
		const tokenResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			tokenCommand,
			operatorId,
			false,
		);
		const tokenAddress = minterIface.decodeFunctionResult('getToken', tokenResult);

		// Convert token address to token ID
		const tokenEvmAddress = tokenAddress[0];
		if (tokenEvmAddress === '0x0000000000000000000000000000000000000000') {
			console.log('❌ Token not initialized in contract');
			return;
		}

		// Extract token ID from EVM address (last 8 bytes)
		const tokenNum = parseInt(tokenEvmAddress.slice(-8), 16);
		tokenIdString = `0.0.${tokenNum}`;
		console.log('Token ID:', tokenIdString);
	}
	catch (error) {
		console.log('⚠️  Could not retrieve token information:', error.message);
		return;
	}

	// Verify NFT ownership and status
	try {
		const nftInfo = await checkNFTOwnership(env, tokenIdString, serialNumber);

		if (!nftInfo) {
			console.log('❌ NFT serial not found or query failed');
			return;
		}

		if (nftInfo.deleted) {
			console.log('❌ NFT serial', serialNumber, 'has already been deleted');
			return;
		}

		if (nftInfo.owner !== userAccountInput && !nftInfo.owner.includes(userAccountInput)) {
			console.log('❌ NFT ownership mismatch!');
			console.log(`   Expected owner: ${userAccountInput}`);
			console.log(`   Actual owner: ${nftInfo.owner}`);
			return;
		}

		console.log('✅ NFT serial', serialNumber, 'is owned by', nftInfo.owner);

		// Get badge type for this serial
		const badgeIdCommand = minterIface.encodeFunctionData('getSerialBadgeId', [serialNumber]);
		const badgeIdResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			badgeIdCommand,
			operatorId,
			false,
		);
		const badgeId = minterIface.decodeFunctionResult('getSerialBadgeId', badgeIdResult);
		console.log('Badge Type ID:', Number(badgeId[0]));

		// Get badge details
		const badgeCommand = minterIface.encodeFunctionData('getBadge', [badgeId[0]]);
		const badgeResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			badgeCommand,
			operatorId,
			false,
		);
		const badgeInfo = minterIface.decodeFunctionResult('getBadge', badgeResult);
		console.log('Badge Name:', badgeInfo[0]);
	}
	catch (error) {
		console.log('⚠️  Could not verify NFT ownership:', error.message);
		return;
	}

	console.log('\n⚠️  WARNING: This action will:');
	console.log('   - Permanently remove the NFT from the user\'s account');
	console.log('   - Remove the user from the whitelist for this badge type');
	console.log('   - Cannot be undone (NFT will be burned)');
	console.log('\n💡 NOTE: You can add the user back to the whitelist later if needed');
	console.log('   Use addToBadgeWhitelist.js to re-whitelist the user for future mints');

	const proceed = readlineSync.question('\nAre you sure you want to revoke this SBT? (y/N): ');
	if (proceed.toLowerCase() !== 'y') {
		console.log('Cancelled.');
		return;
	}

	const finalConfirm = readlineSync.question('Type "REVOKE" to confirm: ');
	if (finalConfirm !== 'REVOKE') {
		console.log('Cancelled - confirmation text did not match.');
		return;
	}

	try {
		console.log('\n🔥 Revoking SBT...');

		// Estimate gas for the operation
		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'revokeSBT',
			[userEvmAddress, serialNumber],
			800_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'revokeSBT',
			[
				userEvmAddress,
				serialNumber,
			],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SBT revoked successfully!');
			console.log('\nThe NFT has been removed from the user\'s account and they have been removed from the whitelist.');
		}
		else {
			console.log('❌ Failed to revoke SBT:', result[0]?.status?.toString());
			if (result[2]?.transactionId) {
				console.log('📝 Failed Transaction ID:', result[2].transactionId.toString());
			}
			if (result[0]?.status?.name === 'NotAdmin') {
				console.log('Error: You are not an admin of this contract.');
			}
			else if (result[0]?.status?.name === 'NotRevocable') {
				console.log('Error: This contract was not deployed as revocable.');
			}
			else if (result[0]?.status?.name === 'NFTNotOwned') {
				console.log('Error: The user does not own this NFT serial.');
			}
			else if (result[0]?.status?.name === 'TypeNotFound') {
				console.log('Error: Badge type not found for this serial.');
			}
		}

		// Centralized transaction result logging
		logTransactionResult(result, 'SBT Revocation', gasInfo);
	}
	catch (error) {
		console.log('❌ Error revoking SBT:', error.message);
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