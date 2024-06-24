const ethers = require('ethers');
const axios = require('axios');
const dotenv = require('dotenv');
const { ContractCallQuery, Client, TransactionRecordQuery, ContractExecuteTransaction, ContractCreateFlow } = require('@hashgraph/sdk');
const { getBaseURL } = require('./hederaMirrorHelpers');
dotenv.config();

const SLEEP_TIME = process.env.SLEEP_TIME ?? 5000;

/**
 * Generic setter
 * @param {ContractId} contractId the contract to call
 * @param {ethers.Interface} iface defined ABI of the contract
 * @param {Client} client the client to use for execution
 * @param {string} fcnName
 * @param {number} gasLim	optional gas limit else 100_000
 * @param {...*} values
 * @returns {string}
 */
async function useSetter(contractId, iface, client, fcnName, gasLim, ...values) {
	const params = [];

	for (let i = 0; i < values.length; i++) {
		params.push(values[i]);
	}
	const [setterIntsRx, setterResult] = await contractExecuteFunction(contractId, iface, client, gasLim, fcnName, params);
	return [setterIntsRx?.status.toString(), setterResult];
}

/**
 * Generalised parseing function to error handle
 * @param {ethers.Interface} iface the interface boostrapped by the function ABI
 * @param {*} errorData bytes of the error
 * @returns {String} the error message
 */
function parseError(iface, errorData) {

	if (errorData.startsWith('0x08c379a0')) {
		// decode Error(string)

		const content = `0x${errorData.substring(10)}`;
		return `REVERT: ${ethers.AbiCoder.defaultAbiCoder().decode(['string'], content)}`;
		// reason: string; for standard revert error string
	}

	if (errorData.startsWith('0x4e487b71')) {
		// decode Panic(uint)
		const content = `0x${errorData.substring(10)}`;
		const code = ethers.AbiCoder.defaultAbiCoder().decode(['uint'], content);

		let type;
		switch (Number(code[0])) {
		case 0:
			type = 'Generic compiler inserted panic';
			break;
		case 1:
			type = 'Assert with an argument that evaluates to false';
			break;
		case 17:
			type = 'Arithmetic operation results in underflow or overflow outside of an unchecked { ... } block';
			break;
		case 18:
			type = 'Divide or modulo by zero (e.g. 5 / 0 or 23 % 0)';
			break;
		case 33:
			type = 'Convert a value that is too big or negative into an enum type';
			break;
		case 34:
			type = 'Access a storage byte array that is incorrectly encoded';
			break;
		case 49:
			type = 'Call .pop() on an empty array';
			break;
		case 50:
			type = 'Access an array, bytesN or an array slice at an out-of-bounds or negative index (i.e. x[i] where i >= x.length or i < 0)';
			break;
		case 65:
			type = 'Allocate too much memory or create an array that is too large';
			break;
		case 81:
			type = 'Call a zero-initialized variable of internal function type';
			break;
		default:
			type = 'Unknown';
		}

		return `Panic code: ${code[0]} : ${type}`;
	}

	try {
		const errDescription = iface.parseError(errorData);
		return errDescription;
	}
	catch (e) {
		console.error(errorData, e);
		return `UNKNOWN ERROR: ${errorData}`;
	}
}

/**
 * Generalised parseing function to error handle
 * If a client is passed in, it will use the network to get the record (paid for by the client).
 * If a environment (string) is passed in, it will use the mirror node to get the record (free but lower).
 * @param {String | Client} envOrClient Environment being used to inform the mirror node call
 * @param {TransactionId} transactionId Hedera Tx Id
 * @param {ethers.Interface} iface the interface boostrapped by the function ABI
 */
async function parseErrorTransactionId(envOrClient, transactionId, iface) {
	if (envOrClient instanceof Client) {
		const record = await new TransactionRecordQuery()
			.setTransactionId(transactionId)
			.setValidateReceiptStatus(false)
			.execute(envOrClient);

		try {
			return parseError(iface, record.contractFunctionResult.errorMessage);
		}
		catch (e) {
			console.error(e);
			return `UNKNOWN ERROR: ${transactionId} / ${record.contractFunctionResult.errorMessage}`;
		}
	}

	let url = getBaseURL(envOrClient);

	await sleep(SLEEP_TIME);

	// take tx Id in format 0.0.XXXX@11111.11111 and convert to 0.0.XXXX-11111-11111
	const webFormatTxId = transactionId.accountId.toString() + '-' + transactionId.validStart.toString().substring(0, 10) + '-' + transactionId.validStart.toString().substring(11, 21);
	url += `/api/v1/contracts/results/${webFormatTxId}`;

	// console.log(' -Calling mirror node for transaction:', transactionId.toString(), url);

	const response = await axios.get(url);
	if (response.status != 200) {
		console.log(' -ERROR', response.status, ' from mirror node');
	}
	else {
		// console.log(' -Got', response.data.error_message, 'from mirror node');
		return parseError(iface, response.data.error_message);
	}
}

/**
 * @param {String} env
 * @param {ContractId} contractId
 * @param {String} data command and parameters encoded as a string
 * @param {AccountId} from
 * @param {Boolean} estimate gas estimate
 * @param {Number} gas gas limit
 * @returns {String} encoded result
 */
async function readOnlyEVMFromMirrorNode(env, contractId, data, from, estimate = true, gas = 300_000) {
	const baseUrl = getBaseURL(env);

	const body = {
		'block': 'latest',
		'data': data,
		'estimate': estimate,
		'from': from.toSolidityAddress(),
		'gas': gas,
		'gasPrice': 100000000,
		'to': contractId.toSolidityAddress(),
		'value': 0,
	};

	const url = `${baseUrl}/api/v1/contracts/call`;

	const response = await axios.post(url, body);

	return response.data?.result;
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} contractId the contract to call
 * @param {ethers.Interface} iface defined ABI of the contract
 * @param {Client} client the client to use for execution
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {[]} params the function arguments
 * @param {Hbar | null} queryCost the cost of the query - nullable
 * @returns {[]} decoded results
 */
async function contractExecuteQuery(contractId, iface, client, gasLim, fcnName, params = [], queryCost, ...expectedVars) {
	// check the gas lim is a numeric value else 100_000
	if (!gasLim || isNaN(gasLim)) {
		gasLim = 100_000;
	}

	const functionCallAsUint8Array = iface.encodeFunctionData(fcnName, params);

	console.log('Calling function:', fcnName, 'with params:', params, 'on contract:', contractId.toString(), 'with gas limit:', gasLim);

	let contractQuery;
	try {
		const contractQueryTx = new ContractCallQuery()
			.setContractId(contractId)
			.setFunctionParameters(Buffer.from(functionCallAsUint8Array.slice(2), 'hex'))
			.setGas(gasLim);

		if (queryCost) {
			contractQueryTx.setQueryPayment(queryCost);
		}

		contractQuery = await contractQueryTx.execute(client);
	}
	catch (err) {
		console.log('ERROR: Contract Call Failed');
		console.dir(err, { depth: 5, colors: true });

		return [(parseError(iface, err.contractFunctionResult.errorMessage))];
	}

	const queryResult = iface.decodeFunctionResult(fcnName, contractQuery.bytes);
	console.log('Query result:', fcnName, queryResult);

	if (expectedVars.length == 0) {
		return queryResult;
	}
	else {
		const results = [];
		for (let v = 0; v < expectedVars.length; v++) {
			results.push(queryResult[expectedVars[v]]);
		}
		return results;
	}
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} contractId the contract to call
 * @param {ethers.Interface} iface defined ABI of the contract
 * @param {Client} client the client to use for execution
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {[]} params the function arguments
 * @param {string | number | Hbar | Long.Long | BigNumber} amountHbar the amount of hbar to send in the method call
 * @param {boolean} flagError
 * @returns {[TransactionReceipt, any, TransactionRecord]} the transaction receipt and any decoded results
 */
async function contractExecuteFunction(contractId, iface, client, gasLim, fcnName, params = [], amountHbar = 0, flagError = false) {
	// check the gas lim is a numeric value else 100_000
	if (!gasLim || isNaN(gasLim)) {
		gasLim = 200_000;
	}

	const encodedCommand = iface.encodeFunctionData(fcnName, params);
	// convert to UINT8ARRAY after stripping the '0x'
	let contractExecuteTx;
	try {
		contractExecuteTx = await new ContractExecuteTransaction()
			.setContractId(contractId)
			.setGas(gasLim)
			.setFunctionParameters(Buffer.from(encodedCommand.slice(2), 'hex'))
			.setPayableAmount(amountHbar)
			.execute(client);
	}
	catch (err) {
		if (flagError) console.log('ERROR: Contract Transaction Failed');

		return [(parseError(iface, err.contractFunctionResult.errorMessage))];
	}

	let contractExecuteRx;
	try {
		contractExecuteRx = await contractExecuteTx.getReceipt(client);
	}
	catch (e) {
		try {
			const error = await parseErrorTransactionId(client, e.transactionId, iface);
			if (flagError) {
				console.log('ERROR: Fetching Contract Receipt Failed');
				console.log('ERROR:', typeof error, error);
			}
			return [{ status: error }, `${e.transactionId}`, null];
		}
		catch (subError) {
			console.log('ERROR: Parsing Error Failed');
			console.log('ERROR:', e.transactionId, typeof subError, subError);
			return [{ status: e }, `${e.transactionId}`, null];
		}

	}
	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);

	let contractResults;
	try {
		contractResults = iface.decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	}
	catch (e) {
		if (e.data == '0x') {
			console.log(contractExecuteTx.transactionId.toString(), 'No data returned from contract - check the call');
		}
		else {
			console.log('Error', contractExecuteTx.transactionId.toString(), e);
			console.log(parseError(iface, record.contractFunctionResult.bytes));
		}
	}
	// console.log('Contract Results:', contractResults);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Function to link solidity libraries into the bytecode for deployment
 * @param {string} bytecode the bytecode to link
 * @param {string[]} libNameArray the name of the library to link
 * @param {ContractId[]} libAddressArray the address of the library to link
 */
function linkBytecode(bytecode, libNameArray, libAddressArray) {
	for (let i = 0; i < libNameArray.length; i++) {
		const libName = libNameArray[i];
		const libAddress = libAddressArray[i].toSolidityAddress();

		const nameToHash = `contracts/${libName}.sol:${libName}`;

		const placeholder = `__$${ethers.keccak256(ethers.toUtf8Bytes(nameToHash)).slice(2, 36)}$__`;
		console.log('placeholder', placeholder);
		// const formattedAddress = libAddress.toLowerCase().replace('0x', '');
		console.log('libAddress', libAddress);

		if (bytecode.indexOf(placeholder) === -1) {
			throw new Error(`Unable to find placeholder for library ${libName}`);
		}
		while (bytecode.indexOf(placeholder) !== -1) {
			bytecode = bytecode.replace(placeholder, libAddress);
		}
	}

	return bytecode;
}

/**
 * Hedera native contract deployment method
 * @param {Client} client
 * @param {String} bytecode
 * @param {Number} gasLim
 * @param {ContractFunctionParameters} params
 * @returns {[ContractId, ContractAddress]} an array of the contractId and contractAddress as a string
 */
async function contractDeployFunction(client, bytecode, gasLim = 800_000, params = null) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim);

	if (params) contractCreateTx.setConstructorParameters(params);

	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	const contractId = contractCreateRx.contractId;
	const contractAddress = contractId.toSolidityAddress();
	return [contractId, contractAddress];
}

// sleep function
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
	parseError,
	parseErrorTransactionId,
	contractExecuteQuery,
	contractExecuteFunction,
	useSetter,
	readOnlyEVMFromMirrorNode,
	linkBytecode,
	contractDeployFunction,
	getBaseURL,
};