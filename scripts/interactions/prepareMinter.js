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
const readlineSync = require('readline-sync');
const fs = require('fs');
const { ethers } = require('ethers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode, contractDeployFunction } = require('../../utils/solidityHelpers');
const { getArgFlag, getArg } = require('../../utils/nodeHelpers');
const path = require('path');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? 'MinterContract';
const sbtContractName = process.env.SBT_CONTRACT_NAME ?? 'SoulboundMinter';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const METADATA_BATCH = process.env.METADATA_BATCH || 60;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;

const env = process.env.ENVIRONMENT ?? null;
let client, minterIface;
let gas = 500_000;

const main = async () => {
	if (getArgFlag('h')) {
		console.log('Usage: prepareMinter.js [-gas X] -[upload|init|reset|hardreset]');
		console.log('			-gas X								where X is the gas overide to use');
		console.log('			-upload <path_to_file>/*.json		containing an array of metadata to upload');
		console.log('			-init [-royalty <path_to_json>] [-max MM] -name NNN -symbol SSS -memo MMM -cid CCC');
		console.log('			-reset								remove data -- minimise SC rent(?)');
		console.log('			-hardreset							remove data & token ID');
		return;
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('CONTRACT NAME:', contractName);

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('interacting in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('interacting in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));

	minterIface = new ethers.Interface(json.abi);

	if (getArgFlag('gas')) {
		gas = Number(getArg('gas'));
	}

	console.log('Using default gas:', gas);

	if (getArgFlag('reset')) {
		const proceed = readlineSync.keyInYNStrict('Do you wish to reset contract data only (token intact)?');
		if (proceed) {
			let status;
			let remaining;
			do {
				const result = await contractExecuteFunction(
					contractId,
					minterIface,
					client,
					3_200_000,
					'resetContract',
					[false, 100],
				);

				console.log('resetContract result:', result[0]?.status?.toString());
				console.log('resetContract transaction:', result[2]?.transactionId?.toString());
				status = result[0]?.status?.toString();
				remaining = Number(result[1][0]);
			} while (status == 'SUCCESS' && remaining > 0);
		}
		else {
			console.log('User Aborted');
		}
	}
	else if (getArgFlag('hardreset')) {
		const proceed = readlineSync.keyInYNStrict('Do you wish to **HARD** reset contract data AND TOKEN ID - burn function will be lost?');
		if (proceed) {
			let status;
			let remaining;
			do {
				const result = await contractExecuteFunction(
					contractId,
					minterIface,
					client,
					3_200_000,
					'resetContract',
					[true, 100],
				);

				console.log('resetContract result:', result[0]?.status?.toString());
				console.log('resetContract transaction:', result[2]?.transactionId?.toString());
				status = result[0]?.status?.toString();
				remaining = Number(result[1][0]);
			} while (status == 'SUCCESS' && remaining > 0);
		}
		else {
			console.log('User Aborted');
		}
	}
	else if (getArgFlag('upload')) {
		// read in the metadata file
		const fileToProcess = getArg('upload');
		const fullpath = path.resolve(fileToProcess);

		if (!fullpath) {
			console.log('ERROR: must specifiy file to upload - EXITING');
			process.exit(1);
		}
		let metadataJSONString;
		// read in the file specified
		try {
			metadataJSONString = fs.readFileSync(fullpath, 'utf8');
		}
		catch (err) {
			console.log(`ERROR: Could not read file (${fullpath})`, err);
			process.exit(1);
		}

		// parse JSON
		let pinnedMetadataObjFromFile;
		try {
			pinnedMetadataObjFromFile = JSON.parse(metadataJSONString);
		}
		catch (err) {
			console.log('ERROR: failed to parse the specified JSON', err, metadataJSONString);
			process.exit(1);
		}

		const pinnedMetadataObjFromFileLength = Object.keys(pinnedMetadataObjFromFile).length;
		const pinnedMetadataList = [];
		for (let p = 0; p < pinnedMetadataObjFromFileLength; p++) {
			pinnedMetadataList.push(pinnedMetadataObjFromFile[p]);
		}

		console.log('Found ', pinnedMetadataList.length, 'metadata to upload');

		// tell user how many found
		const proceed = readlineSync.keyInYNStrict('Do you want to upload metadata?');
		if (proceed) {
			for (let p = 1; p <= 10; p++) {
				console.log('Shuffle pass:', p);
				for (let i = pinnedMetadataList.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[pinnedMetadataList[i], pinnedMetadataList[j]] = [pinnedMetadataList[j], pinnedMetadataList[i]];
				}
			}
			const [status, numUploaded] = await uploadMetadata(pinnedMetadataList);
			console.log('Upload Status:', status, 'Uploaded:', numUploaded);
		}
	}
	else if (getArgFlag('init')) {
		// check the current settings for the contract then step through setup
		// getMintEconomics from mirror nodes
		let encodedCommand = minterIface.encodeFunctionData('getMintEconomics');

		const mintEconOutput = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const mintEcon = minterIface.decodeFunctionResult('getMintEconomics', mintEconOutput)[0];

		// get the $LAZY token details
		encodedCommand = minterIface.encodeFunctionData('getLazyToken');

		const lazyTokenOutput = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const lazyToken = TokenId.fromSolidityAddress(minterIface.decodeFunctionResult('getLazyToken', lazyTokenOutput)[0]);

		const lazyTokenDetails = await getTokenDetails(env, lazyToken);

		console.log('Current mint economics:');
		console.log('Contract Pays $LAZY:', Boolean(mintEcon[0]));
		console.log('HBAR Px:', new Hbar(Number(mintEcon[1]), HbarUnit.Tinybar).toString());
		console.log('$LAZY Px:', Number(mintEcon[2]) / 10 ** lazyTokenDetails.decimals, lazyTokenDetails.symbol);
		console.log('WL discount (during WL period):', Number(mintEcon[3]), '%');
		console.log('Max Mints (per tx):', Number(mintEcon[4]));
		console.log('WL cost in $LAZY (0 = N/A):', Number(mintEcon[5]) ? `${Number(mintEcon[5]) / 10 ** lazyTokenDetails.decimals} ${lazyTokenDetails.symbol}` : 'N/A');
		console.log('WL slots per purchase (0 = uncapped):', Number(mintEcon[6]));
		console.log('Max Mints per Wallet:', Number(mintEcon[7]));
		console.log('Token to buy WL with:', TokenId.fromSolidityAddress(mintEcon[8]).toString());

		encodedCommand = minterIface.encodeFunctionData('getMintTiming');

		const mintTimingOutput = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const mintTiming = minterIface.decodeFunctionResult('getMintTiming', mintTimingOutput)[0];

		console.log('Current mint timing:');
		console.log('last mint:', mintTiming[0], ' -> ', new Date(Number(mintTiming[0]) * 1000).toISOString());
		console.log('mint start:', mintTiming[1], ' -> ', new Date(Number(mintTiming[1]) * 1000).toISOString());
		console.log('PAUSE STATUS:', Boolean(mintTiming[2]));
		console.log('Cooldown period:', Number(mintTiming[3]), ' seconds');
		console.log('Refund Window (if applicable):', Number(mintTiming[4]));
		console.log('WL ONLY:', Boolean(mintTiming[5]));

		// call addMetadata with an empty string[] to get the current number of metadata loaded
		let result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000,
			'addMetadata',
			[[]],
		);

		const totalLoaded = Number(result[1][0]);

		console.log('Current metadata loaded:', totalLoaded);

		// check if user wants to use PRNG
		const usePRNG = readlineSync.keyInYNStrict('Do you wish to use PRNG to ensure random metadata (not used if it is fixed edition)?');

		if (usePRNG) {
			let prngContractId;
			if (process.env.PRNG_CONTRACT_ID) {
				prngContractId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
				if (!prngContractId) {
					console.log('ERROR: PRNG_CONTRACT_ID not set in .env file');
					const proceed = readlineSync.keyInYNStrict('Do you wish to deploy a new PRNG (best not to if you have done it before!)?');
					if (proceed) {
						const prngContractName = process.env.PRNG_CONTRACT_NAME ?? 'PRNGContract';
						const prngJson = JSON.parse(fs.readFileSync(`./artifacts/contracts/${prngContractName}.sol/${prngContractName}.json`, 'utf8'));

						const gasLimit = 800_000;
						console.log('\n- Deploying contract...', prngContractName, '\n\tgas@', gasLimit);

						const prngBytecode = prngJson.bytecode;

						[prngContractId] = await contractDeployFunction(client, prngBytecode, gasLimit);

					}
					else {
						console.log('User Aborted');
					}
				}

				console.log('Using PRNG Contract:', prngContractId.toString());
			}
			const proceed = readlineSync.keyInYNStrict('Do you wish to use this PRNG contract?');
			if (proceed) {
				result = await contractExecuteFunction(
					contractId,
					minterIface,
					client,
					500_000,
					'updatePrng',
					[prngContractId.toSolidityAddress()],
				);
			}
			else {
				console.log('Skipping PRNG setup - can add later');
			}
		}


		// ask user if they are implementing a SBT mint or a regular one
		const isSBT = readlineSync.keyInYNStrict('Is this a SBT mint?');

		if (isSBT) {
			console.log('SBT mint selected');

			// bring in the correct ABI
			const sbtJson = JSON.parse(fs.readFileSync(`./artifacts/contracts/${sbtContractName}.sol/${sbtContractName}.json`, 'utf8'));
			minterIface = new ethers.Interface(sbtJson.abi);

			// add an option of a fixed edition mint.
			// no need for royalties as it can't be resold
			// adds in ability to deifne a fixed edition mint
			const fixedEdition = readlineSync.keyInYNStrict('Is this a fixed edition mint?');

			let maxSupply = 0;
			let unlimited = false;
			if (fixedEdition) {
				maxSupply = Number(readlineSync.questionInt('Enter the number of editions (0 == unlimited):'));

				if (maxSupply == 0) {
					unlimited = true;
				}
			}
			else {
				maxSupply = getArg('max') ?? 0;
			}

			const nftName = getArg('name');
			const nftSymbol = getArg('symbol');
			let nftDesc = getArg('memo');
			const cid = getArg('cid');

			// check memo length
			const memoAsBytes = new TextEncoder().encode(Buffer.from(nftDesc));
			if (memoAsBytes.length > 100) {
				console.log('Memo too long -- max 100 bytes', nftDesc);
				nftDesc = new TextDecoder().decode(memoAsBytes.slice(0, 100));
			}

			const tokenDetails = 'Name:\t' + nftName +
					'\nSymbol:\t' + nftSymbol +
					'\nDescription/Memo (max 100 bytes!):\t' + nftDesc +
					'\nCID path:\t' + cid +
					'\nMax Supply:\t' + maxSupply + '\t' + '(0 => supply equal to metadata uploaded)'
					+ '\nFixed Edition:\t' + fixedEdition;

			console.log(tokenDetails);

			// take user input
			const execute = readlineSync.keyInYNStrict('Do wish to create the token?');

			if (execute) {
				result = await contractExecuteFunction(
					contractId,
					minterIface,
					client,
					1_600_000,
					'initialiseNFTMint',
					[nftName, nftSymbol, nftDesc, cid, maxSupply, fixedEdition, unlimited],
					MINT_PAYMENT,
				);

				console.log('TX Status:', result[0]?.status?.toString(), 'tx:', result[2]?.transactionId?.toString());
				const tokenId = TokenId.fromSolidityAddress(result[1][0]);
				console.log('Token Created:', tokenId.toString());
				console.log('Max Supply:', Number(result[1][1]));
			}
			else {
				console.log('User Aborted');
			}
		}
		else {
			console.log('Regular mint selected');

			const proceed = readlineSync.keyInYNStrict('Do you wish to initalise the contract based on the metadata you have uploaded?');
			if (proceed) {

				const royaltyList = [];
				let royaltiesAsString = '\n\n';
				if (getArgFlag('royalty')) {
					// read in the file specified
					const fileToProcess = getArg('royalty');
					let royaltiesJSONAsString;
					try {
						royaltiesJSONAsString = fs.readFileSync(fileToProcess, 'utf8');
					}
					catch (err) {
						console.log(`ERROR: Could not read file (${fileToProcess})`, err);
						process.exit(1);
					}

					// parse JSON
					let royaltyObjFromFile;
					try {
						royaltyObjFromFile = JSON.parse(royaltiesJSONAsString);
					}
					catch (err) {
						console.log('ERROR: failed to parse the specified JSON', err, royaltyObjFromFile);
						process.exit(1);
					}
					for (const idx in royaltyObjFromFile) {
						let fee;
						const royalty = royaltyObjFromFile[idx];
						// console.log('Processing custom fee:', royalty);
						if (royalty.percentage) {
							// ensure collector account
							if (!royalty.account) {
								console.log('ERROR: Royalty defined as ' + royalty.percentage + ' but no account specified', royalty.account);
								process.exit(1);
							}
							fee = new NFTFeeObject(royalty.percentage * 100, 10000, AccountId.fromString(royalty.account).toSolidityAddress());
							royaltiesAsString += 'Pay ' + royalty.percentage + '% to ' + royalty.account;
						}
						if (royalty.fbf) {
							fee.fallbackfee = Number(royalty.fbf);
							royaltiesAsString += ' with Fallback of: ' + royalty.fbf + 'hbar\n';
						}
						else {
							royaltiesAsString += ' NO FALLBACK\n';
						}
						royaltyList.push(fee);
					}
				}

				const maxSupply = getArg('max') ?? 0;

				const nftName = getArg('name');
				const nftSymbol = getArg('symbol');
				let nftDesc = getArg('memo');
				const cid = getArg('cid');

				// check memo length
				const memoAsBytes = new TextEncoder().encode(Buffer.from(nftDesc));
				if (memoAsBytes.length > 100) {
					console.log('Memo too long -- max 100 bytes', nftDesc);
					nftDesc = new TextDecoder().decode(memoAsBytes.slice(0, 100));
				}

				let tokenDetails = 'Name:\t' + nftName +
						'\nSymbol:\t' + nftSymbol +
						'\nDescription/Memo (max 100 bytes!):\t' + nftDesc +
						'\nCID path:\t' + cid +
						'\nMax Supply:\t' + maxSupply + '\t' + '(0 => supply equal to metadata uploaded)';

				if (royaltyList.length > 0) tokenDetails += royaltiesAsString;
				else tokenDetails += '\nNO ROYALTIES SET\n';

				console.log(tokenDetails);

				// take user input
				const execute = readlineSync.keyInYNStrict('Do wish to create the token?');

				if (execute) {
					result = await contractExecuteFunction(
						contractId,
						minterIface,
						client,
						1_600_000,
						'initialiseNFTMint',
						[nftName, nftSymbol, nftDesc, cid, royaltyList, maxSupply],
						MINT_PAYMENT,
					);

					console.log('TX Status:', result[0]?.status?.toString(), 'tx:', result[2]?.transactionId?.toString());
					const tokenId = TokenId.fromSolidityAddress(result[1][0]);
					console.log('Token Created:', tokenId.toString());
					console.log('Max Supply:', Number(result[1][1]));
				}
				else {
					console.log('User Aborted');
				}

			}
			else {
				console.log('User aborted.');
			}
		}
	}
	else {
		console.log('No option slected, run with -h for usage pattern');
	}
};

/**
 * Method top upload the metadata using chunking
 * @param {string[]} metadata
 * @return {[string, Number]}
 */
async function uploadMetadata(metadata) {
	const uploadBatchSize = METADATA_BATCH;
	let totalLoaded = 0;
	let result;
	let status = '';
	for (let outer = 0; outer < metadata.length; outer += uploadBatchSize) {
		const dataToSend = [];
		for (let inner = 0; (inner < uploadBatchSize) && ((inner + outer) < metadata.length); inner++) {
			dataToSend.push(metadata[inner + outer]);
		}
		// use addMetadata method
		result = await contractExecuteFunction(
			contractId,
			minterIface,
			client,
			300_000 + (dataToSend.length * 20_000),
			'addMetadata',
			[dataToSend],
		);

		status = result[0].status.toString();
		totalLoaded = Number(result[1][0]);
		console.log('Uploaded:', totalLoaded, 'of', metadata.length);
	}

	return [status, totalLoaded];
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

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
