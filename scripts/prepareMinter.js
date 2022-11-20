const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	ContractExecuteTransaction,
	ContractCallQuery,
	TokenId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
require('dotenv').config();
const readlineSync = require('readline-sync');
const fs = require('fs');
const path = require('path');
const Web3 = require('web3');
const web3 = new Web3();
let abi;

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? null;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;
let gas = 500000;

// check-out the deployed script - test read-only method
const main = async () => {
	if (getArgFlag('h')) {
		console.log('Usage: prepareMinter.js [-gas X] -[upload|init|reset|hardreset]');
		console.log('			-gas X								where X is the gas overide to use');
		console.log('			-upload <path_to_file>/*.json		containing an array of metadata to upload');
		console.log('			-init [-royalty <path_to_json>] -name NNN -symbol SSS -memo MMM -cid CCC');
		console.log('			-reset								remove data -- minimise SC rent(?)');
		console.log('			-hardreset							remove data & token ID');
		return;
	}

	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());

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

	if (getArgFlag('gas')) {
		gas = Number(getArg('gas'));
	}

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	abi = json.abi;
	console.log('\n -Loading ABI...\n');

	console.log('Using contract:', contractId.toString());
	console.log('Using default gas:', gas);

	if (getArgFlag('reset')) {
		const proceed = readlineSync.keyInYNStrict('Do you wish to reset contract data only (token intact)?');
		if (proceed) {
			const result = await useSetterBool('resetContract', false, gas);
			console.log(result);
		}
		else {
			console.log('User Aborted');
		}
	}
	else if (getArgFlag('hardreset')) {
		const proceed = readlineSync.keyInYNStrict('Do you wish to **HARD** reset contract data AND TOKEN ID - burn function will be lost?');
		if (proceed) {
			const result = await useSetterBool('resetContract', true, gas);
			console.log(result);
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
			// shuffle 10 times...
			for (let p = 1; p <= 10; p++) {
				console.log('Shuffle pass:', p);
				for (let i = pinnedMetadataList.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[pinnedMetadataList[i], pinnedMetadataList[j]] = [pinnedMetadataList[j], pinnedMetadataList[i]];
				}
			}
			await uploadMetadata(pinnedMetadataList);
		}
	}
	else if (getArgFlag('init')) {
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
					'\nCID path:\t' + cid;

			if (royaltyList.length > 0) tokenDetails += royaltiesAsString;
			else tokenDetails += '\nNO ROYALTIES SET\n';

			console.log(tokenDetails);

			// take user input
			const execute = readlineSync.keyInYNStrict('Do wish to create the token?');

			if (execute) {
				const [, tokenAddressSolidity] = await initialiseNFTMint(
					nftName,
					nftSymbol,
					nftDesc,
					cid,
					royaltyList,
				);
				const tokenId = TokenId.fromSolidityAddress(tokenAddressSolidity);
				console.log('Token Created:', tokenId.toString(), ' / ', tokenAddressSolidity);
			}
			else {
				console.log('User Aborted');
			}

		}
		else {
			console.log('User aborted.');
		}
	}
	else {
		console.log('No option slected, run with -h for usage pattern');
	}
};

/**
 * Call a methos with no arguments
 * @param {string} fcnName
 * @param {number=} gas
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function methodCallerNoArgs(fcnName, gasLim = 500000) {
	const params = new ContractFunctionParameters();
	const [setterAddressRx, setterResults ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterAddressRx.status.toString(), setterResults];
}

/**
 *
 * @param {string} name
 * @param {string} symbol
 * @param {string} memo
 * @param {string} cid
 * @param {*} royaltyList
 */
async function initialiseNFTMint(name, symbol, memo, cid, royaltyList, gasLim = 1000000) {
	const params = [name, symbol, memo, cid, royaltyList];

	const [initialiseRx, initialiseResults] = await contractExecuteWithStructArgs(contractId, gasLim, 'initialiseNFTMint', params, MINT_PAYMENT);
	return [initialiseRx.status.toString(), initialiseResults['createdTokenAddress'], initialiseResults['maxSupply']] ;
}

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVar the variable to exeppect to get back
 * @return {*}
 */
// eslint-disable-next-line no-unused-vars
async function getSetting(fcnName, expectedVar) {
	// check the Lazy Token and LSCT addresses
	// generate function call with function name and parameters
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, []);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setMaxQueryPayment(new Hbar(2))
		.setGas(100000)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	return queryResult[expectedVar];
}

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVars the variable to exeppect to get back
 * @return {*} array of results
 */
// eslint-disable-next-line no-unused-vars
async function getSettings(fcnName, ...expectedVars) {
	// check the Lazy Token and LSCT addresses
	// generate function call with function name and parameters
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, []);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setMaxQueryPayment(new Hbar(2))
		.setGas(100000)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	const results = [];
	for (let v = 0 ; v < expectedVars.length; v++) {
		results.push(queryResult[expectedVars[v]]);
	}
	return results;
}

async function contractExecuteWithStructArgs(cId, gasLim, fcnName, params, amountHbar) {
	// use web3.eth.abi to encode the struct for sending.
	// console.log('pre-encode:', JSON.stringify(params, null, 4));
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, params);

	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunctionParameters(functionCallAsUint8Array)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	const functionParameters = functionAbi.outputs;
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
	return result;
}

function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

/**
 * Method top upload the metadata using chunking
 * @param {string[]} metadata
 * @return {[string, Number]}
 */
async function uploadMetadata(metadata) {
	const uploadBatchSize = 60;
	const gasLim = 1500000;
	let totalLoaded = 0;
	let result;
	for (let outer = 0; outer < metadata.length; outer += uploadBatchSize) {
		const dataToSend = [];
		for (let inner = 0; (inner < uploadBatchSize) && ((inner + outer) < metadata.length); inner++) {
			dataToSend.push(metadata[inner + outer]);
		}
		[, result] = await useSetterStringArray('addMetadata', dataToSend, gasLim);
		totalLoaded = Number(result['totalLoaded']);
		console.log('Uploaded metadata:', totalLoaded);
	}
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {string[]} value
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterStringArray(fcnName, value, gasLim = 200000) {
	const params = new ContractFunctionParameters()
		.addStringArray(value);
	const [setterAddressRx, setterResults] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterAddressRx.status.toString(), setterResults];
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} cId the contract to call
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {ContractFunctionParameters} params the function arguments
 * @param {string | number | Hbar | Long.Long | BigNumber} amountHbar the amount of hbar to send in the methos call
 * @returns {[TransactionReceipt, any, TransactionRecord]} the transaction receipt and any decoded results
 */
async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {boolean} value
 * @param {number=} gasLim
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterBool(fcnName, value, gasLim = 200000) {
	const params = new ContractFunctionParameters()
		.addBool(value);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

function getArg(arg) {
	const customidx = process.argv.indexOf(`-${arg}`);
	let customValue;

	if (customidx > -1) {
		// Retrieve the value after --custom
		customValue = process.argv[customidx + 1];
	}

	return customValue;
}

function getArgFlag(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);

	if (customIndex > -1) {
		return true;
	}

	return false;
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
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
