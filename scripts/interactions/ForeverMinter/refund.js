const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const {
	contractExecuteFunction,
	readOnlyEVMFromMirrorNode,
} = require('../../../utils/solidityHelpers');
const { getSerialsOwned, getNFTApprovedForAllAllowances } = require('../../../utils/hederaMirrorHelpers');
const { estimateGas, logTransactionResult } = require('../../../utils/gasHelpers');
const { setNFTAllowanceAll } = require('../../../utils/hederaHelpers');

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

		// Get LAZY token details
		const lazyCommand = minterIface.encodeFunctionData('getLazyDetails');
		const lazyResult = await readOnlyEVMFromMirrorNode(env, contractId, lazyCommand, operatorId, false);
		const lazyDetails = minterIface.decodeFunctionResult('getLazyDetails', lazyResult)[0];
		const lazyTokenId = TokenId.fromSolidityAddress(lazyDetails.lazyToken);

		// Get token details for formatting
		const { getTokenDetails } = require('../../../utils/hederaMirrorHelpers');
		const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
		if (!lazyTokenInfo) {
			console.log('❌ Error: Could not fetch LAZY token details');
			return;
		}
		const lazyDecimals = parseInt(lazyTokenInfo.decimals);

		// Check ownership and find all owned NFTs
		console.log('🔍 Checking your NFT ownership...');
		const ownedSerials = await getSerialsOwned(env, operatorId, nftTokenId);

		if (ownedSerials.length === 0) {
			console.log('❌ Error: You do not own any NFTs from this collection');
			return;
		}

		console.log(`✅ You own ${ownedSerials.length} NFT(s): [${ownedSerials.slice(0, 20).join(', ')}${ownedSerials.length > 20 ? '...' : ''}]`);

		// Check refund eligibility for all owned NFTs
		console.log('\n⏰ Checking refund eligibility...\n');

		const eligibilityCommand = minterIface.encodeFunctionData('isRefundOwed', [ownedSerials]);
		const eligibilityResult = await readOnlyEVMFromMirrorNode(env, contractId, eligibilityCommand, operatorId, false);
		const [isOwed, expiryTimes] = minterIface.decodeFunctionResult('isRefundOwed', eligibilityResult);

		const now = Math.floor(Date.now() / 1000);
		const eligibleNFTs = [];
		const ineligibleNFTs = [];

		for (let i = 0; i < ownedSerials.length; i++) {
			const serial = ownedSerials[i];
			const expiry = Number(expiryTimes[i]);
			const owed = isOwed[i];

			if (owed && expiry > now) {
				const timeLeft = expiry - now;
				const hours = Math.floor(timeLeft / 3600);
				const minutes = Math.floor((timeLeft % 3600) / 60);

				// Get payment info for this serial
				const paymentCommand = minterIface.encodeFunctionData('getSerialPayment', [serial]);
				const paymentResult = await readOnlyEVMFromMirrorNode(env, contractId, paymentCommand, operatorId, false);
				const payment = minterIface.decodeFunctionResult('getSerialPayment', paymentResult)[0];

				const hbarPaid = Number(payment.hbarPaid);
				const lazyPaid = Number(payment.lazyPaid);
				const hbarRefund = Math.floor((hbarPaid * Number(timing.refundPercentage)) / 100);
				const lazyRefund = Math.floor((lazyPaid * Number(timing.refundPercentage)) / 100);

				eligibleNFTs.push({
					serial,
					timeLeft,
					hours,
					minutes,
					hbarPaid,
					lazyPaid,
					hbarRefund,
					lazyRefund,
				});

				const hbarRefundFormatted = new Hbar(hbarRefund, HbarUnit.Tinybar);
				const lazyRefundFormatted = (lazyRefund / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals);

				console.log(`✅ Serial ${serial}: ELIGIBLE`);
				console.log(`   Time remaining: ${hours}h ${minutes}m`);
				console.log(`   Refund: ${hbarRefundFormatted.toString()} + ${lazyRefundFormatted} ${lazyTokenInfo.symbol}`);
			}
			else if (expiry === 0) {
				ineligibleNFTs.push({ serial, reason: 'Not minted via this contract' });
			}
			else {
				ineligibleNFTs.push({ serial, reason: 'Refund window expired' });
			}
		}

		if (eligibleNFTs.length === 0) {
			console.log('\n❌ No eligible NFTs for refund');
			if (ineligibleNFTs.length > 0) {
				console.log('\nIneligible NFTs:');
				ineligibleNFTs.forEach(nft => {
					console.log(`   Serial ${nft.serial}: ${nft.reason}`);
				});
			}
			return;
		}

		console.log(`\n📋 Summary: ${eligibleNFTs.length} eligible NFT(s) for refund`);

		if (ineligibleNFTs.length > 0) {
			console.log(`   (${ineligibleNFTs.length} ineligible NFT(s) not shown)`);
		}

		// Let user select which serials to refund
		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎯 SELECT NFTs TO REFUND');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		let selectedSerials = [];

		if (eligibleNFTs.length <= 10) {
			// Interactive menu selection for 10 or fewer NFTs
			console.log('📝 Select NFTs to refund (interactive menu):\n');

			while (true) {
				// Show available options (not yet selected)
				const availableNFTs = eligibleNFTs.filter(nft => !selectedSerials.includes(nft.serial));

				if (availableNFTs.length === 0) {
					console.log('✅ All eligible NFTs selected');
					break;
				}

				// Build menu
				const menuItems = [];
				availableNFTs.forEach((nft) => {
					const hbarRefundFormatted = Hbar.fromTinybars(nft.hbarRefund);
					const lazyRefundFormatted = (nft.lazyRefund / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals);
					menuItems.push(`Serial ${nft.serial} (Refund: ${hbarRefundFormatted.to(HbarUnit.Hbar)} HBAR + ${lazyRefundFormatted} ${lazyTokenInfo.symbol}, ${nft.hours}h ${nft.minutes}m left)`);
				});

				// Add special options
				if (selectedSerials.length > 0) {
					menuItems.push(`--- DONE (${selectedSerials.length} selected) ---`);
				}
				menuItems.push('--- Select ALL remaining ---');
				menuItems.push('--- CANCEL ---');

				const index = readlineSync.keyInSelect(menuItems, 'Choose an NFT to add to refund:', { cancel: false });

				if (index === menuItems.length - 1) {
					// Cancel
					console.log('❌ Cancelled');
					return;
				}
				else if (index === menuItems.length - 2) {
					// Select all remaining
					availableNFTs.forEach(nft => selectedSerials.push(nft.serial));
					console.log(`\n✅ Added all remaining NFTs (${availableNFTs.length})`);
					break;
				}
				else if (selectedSerials.length > 0 && index === menuItems.length - 3) {
					// Done
					break;
				}
				else {
					// Add selected NFT
					const selectedNFT = availableNFTs[index];
					selectedSerials.push(selectedNFT.serial);
					console.log(`\n✅ Added Serial ${selectedNFT.serial}`);
				}
			}

			console.log(`\n📊 Final selection: ${selectedSerials.length} NFT(s)`);
		}
		else {
			// Manual entry for more than 10 NFTs
			console.log('📋 You have more than 10 eligible NFTs');
			console.log('Showing first 10 for reference:\n');

			for (let i = 0; i < Math.min(10, eligibleNFTs.length); i++) {
				const nft = eligibleNFTs[i];
				const hbarRefundFormatted = Hbar.fromTinybars(nft.hbarRefund);
				const lazyRefundFormatted = (nft.lazyRefund / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals);
				console.log(`   Serial ${nft.serial}: ${hbarRefundFormatted.to(HbarUnit.Hbar)} HBAR + ${lazyRefundFormatted} ${lazyTokenInfo.symbol} (${nft.hours}h ${nft.minutes}m left)`);
			}

			if (eligibleNFTs.length > 10) {
				console.log(`   ... and ${eligibleNFTs.length - 10} more`);
			}

			console.log('\nEnter serial numbers to refund (comma separated)');
			console.log('Or enter "all" to refund all eligible NFTs\n');

			const input = readlineSync.question('Serials to refund: ');

			if (input.trim().toLowerCase() === 'all') {
				selectedSerials = eligibleNFTs.map(nft => nft.serial);
				console.log(`\n✅ Selected all ${selectedSerials.length} eligible NFT(s)`);
			}
			else {
				const inputSerials = input.split(',').map(s => parseInt(s.trim())).filter(s => !isNaN(s));

				if (inputSerials.length === 0) {
					console.log('❌ No valid serials entered');
					return;
				}

				// Validate all selected serials are eligible
				const invalidSerials = inputSerials.filter(s => !eligibleNFTs.find(nft => nft.serial === s));
				if (invalidSerials.length > 0) {
					console.log(`❌ Error: The following serials are not eligible: ${invalidSerials.join(', ')}`);
					return;
				}

				selectedSerials = inputSerials;
				console.log(`\n✅ Selected ${selectedSerials.length} NFT(s) for refund`);
			}
		}

		if (selectedSerials.length === 0) {
			console.log('\n❌ No NFTs selected for refund');
			return;
		}

		const selectedNFTs = eligibleNFTs.filter(nft => selectedSerials.includes(nft.serial));

		// Calculate total refund amounts
		console.log('\n💰 Refund Breakdown:\n'); let totalHbarRefund = 0;
		let totalLazyRefund = 0;

		for (const nft of selectedNFTs) {
			totalHbarRefund += nft.hbarRefund;
			totalLazyRefund += nft.lazyRefund;

			const hbarRefundFormatted = Hbar.fromTinybars(nft.hbarRefund);
			const lazyRefundFormatted = (nft.lazyRefund / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals);

			console.log(`Serial ${nft.serial}: ${hbarRefundFormatted.to(HbarUnit.Hbar)} HBAR + ${lazyRefundFormatted} ${lazyTokenInfo.symbol}`);
		}

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 REFUND SUMMARY');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`Refunding ${selectedSerials.length} NFT(s):`);
		console.log(`   Serials: ${selectedSerials.join(', ')}`);

		const totalHbarFormatted = Hbar.fromTinybars(totalHbarRefund);
		const totalLazyFormatted = (totalLazyRefund / Math.pow(10, lazyDecimals)).toFixed(lazyDecimals);

		console.log('\nTotal Refund:');
		console.log(`   ${totalHbarFormatted.toString()} + ${totalLazyFormatted} ${lazyTokenInfo.symbol}`);

		console.log('\n⚠️  Warning: NFTs will be returned to the contract pool');

		console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const confirm = readlineSync.question('Proceed with refund? (y/N): ');
		if (confirm.toLowerCase() !== 'y') {
			console.log('❌ Cancelled');
			return;
		}

		// Check if NFT "approved for all" allowance is already set
		console.log('\n🔐 Checking NFT allowance...');
		const approvedForAllMap = await getNFTApprovedForAllAllowances(env, operatorId);
		const hasAllowance = approvedForAllMap.has(contractId.toString()) &&
			approvedForAllMap.get(contractId.toString()).includes(nftTokenId.toString());

		if (!hasAllowance) {
			console.log('⏳ Setting NFT "approved for all" allowance...');
			console.log('   (Contract needs permission to transfer NFTs back to pool)\n');
			try {
				await setNFTAllowanceAll(
					client,
					[nftTokenId],
					operatorId,
					contractId,
				);
				console.log('✅ NFT allowance set successfully');
			}
			catch (allowanceError) {
				console.log('❌ Error setting NFT allowance:', allowanceError.message);
				console.log('   Cannot proceed with refund without allowance');
				return;
			}
		}
		else {
			console.log('✅ NFT allowance already set');
		}
		// Execute refund
		console.log('\n🔄 Processing refund...\n');

		const gasInfo = await estimateGas(
			env,
			contractId,
			minterIface,
			operatorId,
			'refundNFT',
			[selectedSerials],
			600_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			gasInfo.gasLimit,
			'refundNFT',
			[selectedSerials],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('✅ SUCCESS! Refund processed');
			console.log(`   Transaction ID: ${result[2]?.transactionId?.toString()}`);

			console.log('\n💰 Refund Amount:');
			console.log(`   HBAR: ${totalHbarFormatted.toString()}`);
			console.log(`   ${lazyTokenInfo.symbol}: ${totalLazyFormatted} ${lazyTokenInfo.symbol}`);

			console.log('\n📦 NFTs returned to pool:');
			console.log(`   Serials: ${selectedSerials.join(', ')}`);

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
