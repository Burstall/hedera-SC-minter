const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { associateTokenToAccount } = require('../../../utils/hederaHelpers');
const { homebrewPopulateAccountEvmAddress } = require('../../../utils/hederaMirrorHelpers');
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
	if (process.argv.length < 4 || process.argv.length > 5) {
		console.log('Usage: node mintBadge.js <badgeId> <quantity> [recipient]');
		console.log('Examples:');
		console.log('  node mintBadge.js 1 2                    # Mint 2 of badge type 1 for yourself');
		console.log('  node mintBadge.js 3 1                    # Mint 1 of badge type 3 for yourself');
		console.log('  node mintBadge.js 1 1 0.0.123456         # Mint 1 of badge type 1 for account 0.0.123456');
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

	const badgeId = parseInt(process.argv[2]);
	const quantity = parseInt(process.argv[3]);
	const recipientArg = process.argv[4];

	// Determine recipient
	let recipientId = operatorId;
	let isMintOnBehalf = false;

	if (recipientArg) {
		try {
			recipientId = AccountId.fromString(recipientArg);
			isMintOnBehalf = true;
		}
		catch {
			console.log('❌ Error: Invalid recipient account ID format');
			console.log('Expected format: 0.0.123456');
			return;
		}
	}

	if (quantity <= 0) {
		console.log('Error: Quantity must be greater than 0');
		return;
	}

	// Convert recipient to proper EVM address
	let recipientEvmAddress;
	try {
		recipientEvmAddress = await homebrewPopulateAccountEvmAddress(env, recipientId);
	}
	catch {
		recipientEvmAddress = recipientId.toSolidityAddress();
	}

	try {
		// Get token address for association
		const tokenCommand = minterIface.encodeFunctionData('getToken');
		const tokenResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			tokenCommand,
			operatorId,
			false,
		);
		const tokenAddress = minterIface.decodeFunctionResult('getToken', tokenResult);

		if (tokenAddress[0] === '0x0000000000000000000000000000000000000000') {
			console.log('❌ Error: Token not initialized. Run prepareBadgeMinter.js -init first.');
			return;
		}

		const tokenId = TokenId.fromSolidityAddress(tokenAddress[0]);

		// Check recipient eligibility
		const eligibilityCommand = minterIface.encodeFunctionData('getUserBadgeEligibility', [badgeId, recipientEvmAddress]);
		const eligibilityResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			eligibilityCommand,
			operatorId,
			false,
		);
		const [eligible, remainingMints, alreadyMinted] = minterIface.decodeFunctionResult('getUserBadgeEligibility', eligibilityResult);

		console.log('\n===========================================');
		console.log('MINT BADGE');
		console.log('===========================================');
		console.log('Badge ID:', badgeId);
		console.log('Quantity:', quantity);
		console.log('Recipient:', recipientId.toString());
		console.log('Token:', tokenId.toString());
		console.log('Mint Type:', isMintOnBehalf ? 'On Behalf Of' : 'Self Mint');

		console.log('\nEligibility Check:');
		console.log('Eligible:', eligible ? '✅ Yes' : '❌ No');
		console.log('Already Minted:', Number(alreadyMinted));
		console.log('Remaining Mints:', Number(remainingMints) > 1000000000 ? 'Unlimited' : Number(remainingMints));

		if (!eligible) {
			console.log('❌ Error: The recipient is not eligible to mint this badge type.');
			return;
		}

		if (Number(remainingMints) < quantity && Number(remainingMints) <= 1000000000) {
			console.log(`❌ Error: Insufficient remaining mints. Recipient can only mint ${Number(remainingMints)} more.`);
			return;
		}

		// Check token association
		console.log('\n📋 Checking token association...');

		if (isMintOnBehalf) {
			// For mint-on-behalf, we can't auto-associate - the recipient must have done it themselves
			console.log('⚠️  Warning: For mint-on-behalf, the recipient must have already associated the token.');
			console.log('    The transaction will fail if the recipient has not associated the token.');
		}
		else {
			// For self-mint, we can auto-associate
			try {
				await associateTokenToAccount(client, operatorId, operatorKey, tokenId);
				console.log('✅ Token association confirmed');
			}
			catch (error) {
				if (error.message.includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
					console.log('✅ Token already associated');
				}
				else {
					console.log('❌ Token association failed:', error.message);
					return;
				}
			}
		}

		const proceed = readlineSync.question('\nProceed with minting? (y/N): ');
		if (proceed.toLowerCase() !== 'y') {
			console.log('Cancelled.');
			return;
		}

		console.log('\n🎯 Minting badges...');

		// Calculate dynamic gas limit: 500,000 base + (quantity * 250,000)
		const dynamicGasLimit = 500_000 + (quantity * 250_000);

		// Estimate gas for the operation
		const functionName = isMintOnBehalf ? 'mintBadgeOnBehalf' : 'mintBadge';
		const parameters = isMintOnBehalf
			? [badgeId, quantity, recipientEvmAddress]
			: [badgeId, quantity];

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			functionName,
			parameters,
			dynamicGasLimit,
		);

		let result;
		if (isMintOnBehalf) {
			result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasInfo.gasLimit,
				'mintBadgeOnBehalf',
				[
					badgeId,
					quantity,
					recipientEvmAddress,
				],
			);
		}
		else {
			result = await contractExecuteFunction(
				contractId,
				minterIface,
				client,
				gasInfo.gasLimit,
				'mintBadge',
				[
					badgeId,
					quantity,
				],
			);
		}

		if (result[0]?.status?.toString() === 'SUCCESS') {
			const serialNumbers = result[1][0];
			console.log('✅ Badges minted successfully!');
			console.log('Serial Numbers:', serialNumbers.map(s => Number(s)));
			logTransactionResult(result, 'Badge Minting', gasInfo);
		}
		else {
			console.log('❌ Failed to mint badges:', result[0]?.status?.toString());
			if (result[2]?.transactionId) {
				console.log('📝 Failed Transaction ID:', result[2].transactionId.toString());
			}
			if (result[0]?.status?.name === 'NotWhitelistedForType') {
				console.log('Error: The recipient is not whitelisted for this badge type.');
			}
			else if (result[0]?.status?.name === 'TypeNotFound') {
				console.log('Error: Badge type not found or inactive.');
			}
			else if (result[0]?.status?.name === 'NotEnoughWLSlots') {
				console.log('Error: Insufficient whitelist allocation remaining.');
			}
			else if (result[0]?.status?.name === 'InsufficientBadgeSupply') {
				console.log('Error: Insufficient badge supply remaining.');
			}
			else if (result[0]?.status?.name === 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT' || result[0]?.status?.toString().includes('TOKEN_NOT_ASSOCIATED')) {
				console.log('Error: Recipient account has not associated the token. They must associate it first.');
			}
		}
	}
	catch (error) {
		console.log('❌ Error during minting:', error.message);
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