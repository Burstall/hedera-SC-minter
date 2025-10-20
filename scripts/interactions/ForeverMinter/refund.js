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
const {
	contractExecuteFunction,
	readOnlyEVMFromMirrorNode,
} = require('../../../utils/solidityHelpers');
const { getSerialsOwned } = require('../../../utils/hederaMirrorHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'ForeverMinter';
const contractId = ContractId.fromString(process.env.CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	if (!operatorId || !operatorKey || !contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing configuration in .env file');
		return;
	}

	// Parse serial numbers from arguments
	if (process.argv.length < 3) {
		console.log('Usage: node refund.js <serial1> [serial2] [serial3] ...');
		console.log('\nExample: node refund.js 123 456 789');
		return;
	}

	const serials = process.argv.slice(2).map(s => parseInt(s));

	if (serials.some(s => isNaN(s))) {
		console.log('❌ Error: All arguments must be valid serial numbers');
		return;
	}

	console.log('\n🔄 ForeverMinter - NFT Refund');
	console.log('================================\n');

	// Setup client
	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
	}
	else {
		console.log('❌ Error: Invalid ENVIRONMENT in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Load ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));
	const minterIface = new ethers.Interface(json.abi);

	try {
		// Get NFT token address
		const nftTokenCommand = minterIface.encodeFunctionData('NFT_TOKEN');
		const nftTokenResult = await readOnlyEVMFromMirrorNode(env, contractId, nftTokenCommand, operatorId, false);
		const nftTokenAddress = minterIface.decodeFunctionResult('NFT_TOKEN', nftTokenResult)[0];
		const nftTokenId = TokenId.fromSolidityAddress(nftTokenAddress);

		// Get timing for refund window info
		const timingCommand = minterIface.encodeFunctionData('getMintTiming');
		const timingResult = await readOnlyEVMFromMirrorNode(env, contractId, timingCommand, operatorId, false);
		const timing = minterIface.decodeFunctionResult('getMintTiming', timingResult)[0];

		console.log('📊 Refund Configuration:');
		console.log(`   Refund Window: ${Number(timing.refundWindow) / 3600} hours`);
		console.log(`   Refund Percentage: ${Number(timing.refundPercentage)}%`);
		console.log('');

		// Check ownership
		console.log('🔍 Checking NFT ownership...');
		const ownedSerials = await getSerialsOwned(env, operatorId, nftTokenId);

		const notOwned = serials.filter(s => !ownedSerials.includes(s));
		if (notOwned.length > 0) {
			console.log(`❌ Error: You do not own the following serials: ${notOwned.join(', ')}`);
			return;
		}

		console.log('✅ You own all specified serials');

		// Check refund eligibility
		console.log('\n⏰ Checking refund eligibility...\n');

		const eligibilityCommand = minterIface.encodeFunctionData('isRefundOwed', [serials]);
		const eligibilityResult = await readOnlyEVMFromMirrorNode(env, contractId, eligibilityCommand, operatorId, false);
		const [isOwed, expiryTimes] = minterIface.decodeFunctionResult('isRefundOwed', eligibilityResult);

		const now = Math.floor(Date.now() / 1000);
		const eligibleSerials = [];
		const ineligibleSerials = [];

		for (let i = 0; i < serials.length; i++) {
			const serial = serials[i];
			const expiry = Number(expiryTimes[i]);
			const owed = isOwed[i];

			if (owed && expiry > now) {
				const timeLeft = expiry - now;
				const minutes = Math.floor(timeLeft / 60);
				const seconds = timeLeft % 60;

				eligibleSerials.push(serial);
				console.log(`✅ Serial ${serial}: Eligible (${minutes}m ${seconds}s remaining)`);
			}
			else if (expiry === 0) {
				ineligibleSerials.push(serial);
				console.log(`❌ Serial ${serial}: Not eligible (never minted via this contract)`);
			}
			else {
				ineligibleSerials.push(serial);
				console.log(`❌ Serial ${serial}: Refund window expired`);
			}
		}

		if (eligibleSerials.length === 0) {
			console.log('\n❌ Error: No eligible serials for refund');
			return;
		}

		if (ineligibleSerials.length > 0) {
			console.log(`\n⚠️  Warning: ${ineligibleSerials.length} serial(s) are not eligible and will be excluded`);
			const proceed = readlineSync.question('Continue with eligible serials only? (y/N): ');
			if (proceed.toLowerCase() !== 'y') {
				console.log('❌ Cancelled');
				return;
			}
		}

		// Calculate refund amounts
		console.log('\n💰 Calculating refund amounts...\n');

		let totalHbarRefund = 0;
		let totalLazyRefund = 0;

		for (const serial of eligibleSerials) {
			const paymentCommand = minterIface.encodeFunctionData('getSerialPayment', [serial]);
			const paymentResult = await readOnlyEVMFromMirrorNode(env, contractId, paymentCommand, operatorId, false);
			const payment = minterIface.decodeFunctionResult('getSerialPayment', paymentResult)[0];

			const hbarPaid = Number(payment.hbarPaid);
			const lazyPaid = Number(payment.lazyPaid);

			const hbarRefund = Math.floor((hbarPaid * Number(timing.refundPercentage)) / 100);
			const lazyRefund = Math.floor((lazyPaid * Number(timing.refundPercentage)) / 100);

			totalHbarRefund += hbarRefund;
			totalLazyRefund += lazyRefund;

			console.log(`Serial ${serial}:`);
			console.log(`   Paid: ${hbarPaid} tℏ + ${lazyPaid} LAZY`);
			console.log(`   Refund: ${hbarRefund} tℏ + ${lazyRefund} LAZY`);
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 REFUND SUMMARY');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Refunding ${eligibleSerials.length} NFT(s):`);
		console.log(`   Serials: ${eligibleSerials.join(', ')}`);
		console.log('\nTotal Refund:');
		console.log(`   ${totalHbarRefund} tℏ + ${totalLazyRefund} LAZY`);

		console.log('\n⚠️  Warning: NFTs will be returned to the contract pool');

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with refund? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		// Execute refund
		console.log('\n🔄 Processing refund...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'refundNFT',
			[eligibleSerials],
			600_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'refundNFT',
			[eligibleSerials],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Refund processed');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n💰 Refund Amount:');
			console.log(`   HBAR: ${totalHbarRefund} tℏ`);
			console.log(`   LAZY: ${totalLazyRefund} tokens`);

			console.log('\n📦 NFTs returned to pool:');
			console.log(`   Serials: ${eligibleSerials.join(', ')}`);

			console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('✅ Refund complete!');
		}
		else {
			console.log('❌ Failed to refund:', result[0]?.status?.toString());
		}

		logTransactionResult(result, 'NFT Refund', gasInfo);

	}
	catch (error) {
		console.log('❌ Error during refund:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
