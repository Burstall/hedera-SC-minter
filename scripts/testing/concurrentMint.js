const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	ContractExecuteTransaction,
	HbarUnit,
	ContractCallQuery,
	TokenId,
	AccountInfoQuery,
	TokenAssociateTransaction,
} = require('@hashgraph/sdk');
require('dotenv').config();
const readlineSync = require('readline-sync');
const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3();
let abi;

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? null;

const aliceKey = PrivateKey.fromString(process.env.ALICE_PRIVATE_KEY);
const aliceId = AccountId.fromString(process.env.ALICE_ACCOUNT_ID);
const bobKey = PrivateKey.fromString(process.env.BOB_PRIVATE_KEY);
const bobId = AccountId.fromString(process.env.BOB_ACCOUNT_ID);
const tokenId = TokenId.fromString(process.env.TOKEN_ID);

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client, aliceClient, bobClient;

// check-out the deployed script - test read-only method
const main = async () => {
	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Alice:', aliceId.toString());
	console.log('\n-Using Bob:', bobId.toString());

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		aliceClient = Client.forTestnet();
		bobClient = Client.forTestnet();
		console.log('interacting in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		aliceClient = Client.forMainnet();
		bobClient = Client.forMainnet();
		console.log('interacting in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);
	aliceClient.setOperator(aliceId, aliceKey);
	bobClient.setOperator(bobId, bobKey);

	let [, nftBal] = await getAccountBalance(operatorId);
	console.log('Found NFT balance:', nftBal.toString());
	if (nftBal < 0) await associateTokenToAccount(operatorId, operatorKey);
	[, nftBal] = await getAccountBalance(aliceId);
	console.log('Found NFT balance:', nftBal.toString());
	if (nftBal < 0) await associateTokenToAccount(aliceId, aliceKey);
	[, nftBal] = await getAccountBalance(bobId);
	console.log('Found NFT balance:', nftBal.toString());
	if (nftBal < 0) await associateTokenToAccount(bobId, bobKey);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	abi = json.abi;
	console.log('\n -Loading ABI...\n');

	const [hbarCost, lazyCost] = await getSettings('getCost', 'hbarCost', 'lazyCost');
	const remainingMint = await getSetting('getRemainingMint', 'remainingMint');

	console.log('Remaining to mint:', remainingMint);
	console.log('Cost to mint:\nHbar:', new Hbar(hbarCost, HbarUnit.Tinybar).toString(),
		'\nLazy:', lazyCost / 10);

	const proceed = readlineSync.keyInYNStrict('Do you wish to test 3 accounts minting 10 each concurrently?');
	if (proceed) {
		let loop = 10;
		const promiseList = [];
		while (loop > 0) {
			promiseList.push(mintNFT(1, hbarCost, client, 'operator'));
			await sleep(125);
			promiseList.push(mintNFT(1, hbarCost, aliceClient, 'alice'));
			await sleep(125);
			promiseList.push(mintNFT(1, hbarCost, bobClient, 'bob'));
			await sleep(125);
			loop--;
		}

		const userSerialMap = new Map();
		await Promise.all(promiseList). then((results) => {
			for (let i = 0; i < results.length; i++) {
				const [user, serialList] = results[i];
				const serials = userSerialMap.get(user) ?? [];
				serials.push(serialList[0]);
				userSerialMap.set(user, serials);
			}
		});

		console.log('Operator minted:', userSerialMap.get('operator').length, userSerialMap.get('operator'));
		console.log('Alice minted:', userSerialMap.get('alice').length, userSerialMap.get('alice'));
		console.log('Bob minted:', userSerialMap.get('bob').length, userSerialMap.get('bob'));

	}
	else {
		console.log('User aborted.');
	}
};

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function associateTokenToAccount(account, key) {
	// now associate the token to the operator account
	const associateToken = await new TokenAssociateTransaction()
		.setAccountId(account)
		.setTokenIds([tokenId])
		.freezeWith(client)
		.sign(key);

	const associateTokenTx = await associateToken.execute(client);
	const associateTokenRx = await associateTokenTx.getReceipt(client);

	const associateTokenStatus = associateTokenRx.status;

	return associateTokenStatus.toString();
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

/**
 *
 * @param {number} quantity
 * @param {number | Long} tinybarPmt
 */
async function mintNFT(quantity, tinybarPmt, specificClient, user) {
	const params = [quantity];

	const gasLim = 1200000;
	const [, mintResults] =
		await contractExecuteWithStructArgs(contractId, gasLim, 'mintNFT', params, new Hbar(tinybarPmt, HbarUnit.Tinybar), specificClient);
	return [user, mintResults['serials']] ;
}

async function contractExecuteWithStructArgs(cId, gasLim, fcnName, params, amountHbar, specificClient) {
	// use web3.eth.abi to encode the struct for sending.
	// console.log('pre-encode:', JSON.stringify(params, null, 4));
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, params);

	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunctionParameters(functionCallAsUint8Array)
		.setPayableAmount(amountHbar)
		.execute(specificClient);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(specificClient);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(specificClient);
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

async function getAccountBalance(acctId) {

	const query = new AccountInfoQuery()
		.setAccountId(acctId);

	const info = await query.execute(client);

	const tokenMap = info.tokenRelationships;

	let nftBal = 0;
	if (tokenId) {
		const nftTokenBal = tokenMap.get(tokenId.toString());
		if (nftTokenBal) {
			nftBal = nftTokenBal.balance;
		}
		else {
			nftBal = -1;
		}
	}

	return [info.balance, nftBal];
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
