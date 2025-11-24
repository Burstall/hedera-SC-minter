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
const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { getSerialsOwned } = require('../../../utils/hederaMirrorHelpers');

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'ForeverMinter';
const contractId = ContractId.fromString(process.env.FOREVER_MINTER_CONTRACT_ID || '');
const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	if (!operatorId || !operatorKey || !contractId || contractId.toString() === '0.0.0') {
		console.log('❌ Error: Missing configuration in .env file');
		return;
	}

	console.log('\n🔄 ForeverMinter - Refund Eligibility Check');
	console.log('==============================================\n');

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

		// Get owned NFTs
		console.log('🔍 Checking your NFT holdings...');
		const ownedSerials = await getSerialsOwned(env, operatorId, nftTokenId);

		if (ownedSerials.length === 0) {
			console.log(`\n❌ You do not own any NFTs from token ${nftTokenId.toString()}`);
			console.log('   No refunds available');
			return;
		}

		console.log(`✅ You own ${ownedSerials.length} NFT(s)`);
		console.log(`   Token: ${nftTokenId.toString()}`);
		console.log(`   Serials: ${ownedSerials.join(', ')}`);

		// Check refund eligibility
		console.log('\n⏰ Checking refund eligibility...\n');

		const eligibilityCommand = minterIface.encodeFunctionData('isRefundOwed', [ownedSerials]);
		const eligibilityResult = await readOnlyEVMFromMirrorNode(env, contractId, eligibilityCommand, operatorId, false);
		const [isOwed, expiryTimes] = minterIface.decodeFunctionResult('isRefundOwed', eligibilityResult);

		const now = Math.floor(Date.now() / 1000);
		const eligibleSerials = [];
		const expiredSerials = [];
		const neverMintedSerials = [];

		for (let i = 0; i < ownedSerials.length; i++) {
			const serial = ownedSerials[i];
			const expiry = Number(expiryTimes[i]);
			const owed = isOwed[i];

			if (expiry === 0) {
				// Never minted via this contract
				neverMintedSerials.push(serial);
			}
			else if (owed && expiry > now) {
				// Eligible
				const timeLeft = expiry - now;
				const hours = Math.floor(timeLeft / 3600);
				const minutes = Math.floor((timeLeft % 3600) / 60);
				const seconds = timeLeft % 60;

				eligibleSerials.push({ serial, expiry, timeLeft });

				console.log(`✅ Serial ${serial}: ELIGIBLE`);
				console.log(`   Time remaining: ${hours}h ${minutes}m ${seconds}s`);
				console.log(`   Expires: ${new Date(expiry * 1000).toLocaleString()}`);
			}
			else {
				// Expired
				expiredSerials.push(serial);
				console.log(`❌ Serial ${serial}: EXPIRED`);
			}
		}

		if (neverMintedSerials.length > 0) {
			console.log('\n📝 Not eligible (not minted via this contract):');
			console.log(`   ${neverMintedSerials.join(', ')}`);
		}

		if (eligibleSerials.length > 0) {
			console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('💰 Refund Details');
			console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

			let totalHbarRefund = 0;
			let totalLazyRefund = 0;

			for (const { serial } of eligibleSerials) {
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
			console.log('📋 SUMMARY');
			console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

			console.log(`Eligible NFTs: ${eligibleSerials.length}`);
			console.log(`   Serials: ${eligibleSerials.map(e => e.serial).join(', ')}`);

			console.log('\nTotal Refund Available:');
			console.log(`   ${totalHbarRefund} tℏ + ${totalLazyRefund} LAZY`);

			console.log('\n⚠️  Warning: Refunding NFTs returns them to the contract pool');

			console.log('\n📝 To process refund:');
			console.log(`   node refund.js ${eligibleSerials.map(e => e.serial).join(' ')}`);

			// Show expiry order
			const sortedByExpiry = [...eligibleSerials].sort((a, b) => a.expiry - b.expiry);

			console.log('\n⏰ Expiry Order (refund soonest first):');
			for (const { serial, expiry } of sortedByExpiry) {
				const timeLeft = expiry - now;
				const hours = Math.floor(timeLeft / 3600);
				const minutes = Math.floor((timeLeft % 3600) / 60);
				console.log(`   Serial ${serial}: ${hours}h ${minutes}m remaining`);
			}
		}
		else {
			console.log('\n❌ No eligible NFTs for refund');

			if (expiredSerials.length > 0) {
				console.log('\n⚠️  Some NFTs have expired refund windows:');
				console.log(`   ${expiredSerials.join(', ')}`);
			}
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.log('❌ Error checking refund eligibility:', error.message);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.log(error);
		process.exit(1);
	});
