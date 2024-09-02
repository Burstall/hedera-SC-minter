const { AccountId } = require('@hashgraph/sdk');
const { default: axios } = require('axios');

function getBaseURL(env) {
	if (env.toLowerCase() == 'test') {
		return 'https://testnet.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'main') {
		return 'https://mainnet-public.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'preview') {
		return 'https://previewnet.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'local') {
		return 'http://localhost:8000';
	}
	else {
		throw new Error('ERROR: Must specify either MAIN, TEST, LOCAL or PREVIEW as environment');
	}
}

/**
 * Check mirror for the allowance
 * @param {string} env
 * @param {AccountId} _userId
 * @param {TokenId} _tokenId
 * @param {AccountId} _spenderId
 */
async function checkMirrorAllowance(env, _userId, _tokenId, _spenderId) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/accounts/${_userId.toString()}/allowances/tokens?token.id=${_tokenId.toString()}&spender.id=${_spenderId.toString()}`;

	let rtnVal = 0;
	await axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;

			jsonResponse.allowances.forEach(allowance => {
				if (allowance.spender == _spenderId.toString()) {
					// console.log(' -Mirror Node: Found allowance for', allowance.owner, 'with allowance', allowance.amount, 'of token', allowance.token_id);
					rtnVal = Number(allowance.amount);
				}
			});
		})
		.catch(function(err) {
			console.error(err);
			return 0;
		});

	return rtnVal;
}

/**
 * Check mirror for hbar allowance
 * @param {string} env
 * @param {*} _userId
 * @param {*} _spenderId
 * @returns {Number | null} the amount of hbar allowed (or null if none found)
 */
async function checkMirrorHbarAllowance(env, _userId, _spenderId) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/accounts/${_userId.toString()}/allowances/crypto`;

	let rtnVal = 0;
	await axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;

			jsonResponse.allowances.forEach(allowance => {
				if (allowance.spender == _spenderId.toString()) {
					// console.log(' -Mirror Node: Found hbar allowance for', allowance.owner, 'with allowance', allowance.amount);
					rtnVal = Number(allowance.amount);
				}
			});
		})
		.catch(function(err) {
			console.error(err);
			return 0;
		});

	return rtnVal;
}

/**
 * Check mirror for NFT allowance
 * @param {*} env
 * @param {*} _userId
 * @param {*} _tokenId
 * @param {*} _serial
 * @returns {Number | null} the amount of NFT allowed (or null if none found)
 */
async function checkMirrorNFTAllowance(env, _userId, _tokenId, _serial) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/tokens/${_tokenId.toString()}/nfts?account.id=${_userId.toString()}`;

	let rtnVal;
	await axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;

			jsonResponse.nfts.forEach(nft => {
				if (nft.serial_number == _serial && nft.token_id == _tokenId.toString()) {
					// console.log(' -Mirror Node: Found NFT allowance for', nft.account_id, 'serial', nft.serial_number, 'to be spent by', nft.spender, '(delegating spender =', nft.delegating_spender, ')');
					rtnVal = nft.spender;
				}
			});
		})
		.catch(function(err) {
			console.error(err);
			return 0;
		});

	return rtnVal;
}

async function checkFTAllowances(env, _userId) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/accounts/${_userId.toString()}/allowances/tokens`;

	console.log('Checking FT Allowances:', url);

	const rtnVal = [];
	return axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;
			jsonResponse.allowances.forEach(allowance => {
				rtnVal.push(allowance);
			});
			return rtnVal;
		})
		.catch(function(err) {
			console.error(err);
			return 0;
		});
}

async function getSerialsOwned(env, _userId, _tokenId) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/tokens/${_tokenId.toString()}/nfts?account.id=${_userId.toString()}`;

	const rtnVal = [];
	return axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;
			jsonResponse.nfts.forEach(token => {
				rtnVal.push(Number(token.serial_number));
			});
			return rtnVal;
		})
		.catch(function(err) {
			console.error(err);
			return null;
		});
}

/**
 * Helper function to check the last event on the mirror node
 * @param {string} env
 * @param {ContractId} contractId
 * @param {ethers.Interface} iface
 * @param {Number} offset
 * @param {boolean} account if the return should be an account id instead of a number
 * @returns {Number|AccountId} the value of the event
 * @throws {Error} if the event is not found
 */
async function checkLastMirrorEvent(env, contractId, iface, offset = 1, account = false) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=desc&limit=1`;

	let rtnVal;
	await axios.get(url)
		.then(function(response) {
			const jsonResponse = response.data;

			jsonResponse.logs.forEach(log => {
				// decode the event data
				if (log.data == '0x') return;
				const event = iface.parseLog({ topics: log.topics, data: log.data });

				let outputStr = 'Block: ' + log.block_number
						+ ' : Tx Hash: ' + log.transaction_hash
						+ ' : Event: ' + event.name + ' : ';

				for (let f = 0; f < event.args.length; f++) {
					const field = event.args[f];
					// console.log('Field:', f, field, typeof field);

					let output;
					if (typeof field === 'string') {
						output = field.startsWith('0x') ? AccountId.fromEvmAddress(0, 0, field).toString() : field;
					}
					else {
						output = field.toString();
					}
					output = f == 0 ? output : ' : ' + output;
					outputStr += output;
				}
				console.log(outputStr);
				rtnVal = account ? AccountId.fromEvmAddress(0, 0, event.args[offset]) : Number(event.args[offset]);
			});
		})
		.catch(function(err) {
			console.error(err);
			return null;
		});
	return rtnVal;
}

async function getEventsFromMirror(env, contractId, iface) {
	const baseUrl = getBaseURL(env);

	const url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=desc&limit=100`;

	const eventsToReturn = [];
	return axios.get(url)
		.then(function(response) {
			const jsonResponse = response.data;
			jsonResponse.logs.forEach(log => {
				// decode the event data
				if (log.data == '0x') return;
				const event = iface.parseLog({ topics: log.topics, data: log.data });

				let outputStr = 'Block: ' + log.block_number
						+ ' : Tx Hash: ' + log.transaction_hash
						+ ' : Event: ' + event.name + ' : ';

				for (let f = 0; f < event.args.length; f++) {
					const field = event.args[f];
					// console.log('Field:', f, field, typeof field);

					let output;
					if (typeof field === 'string') {
						output = field.startsWith('0x') ? AccountId.fromEvmAddress(0, 0, field).toString() : field;
					}
					else {
						output = field.toString();
					}
					output = f == 0 ? output : ' : ' + output;
					outputStr += output;
					eventsToReturn.push(outputStr);
				}
			});
			return eventsToReturn;
		})
		.catch(function(err) {
			console.error(err);
		});
}

/**
 * Basic query of mirror node for token balance
 * @param {string} env
 * @param {AccountId} _userId
 * @param {TokenId} _tokenId
 * @returns {Number} balance of the token
 */
async function checkMirrorBalance(env, _userId, _tokenId) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/accounts/${_userId.toString()}/tokens?token.id=${_tokenId.toString()}`;

	let rtnVal = null;
	await axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;

			jsonResponse.tokens.forEach(token => {
				if (token.token_id == _tokenId.toString()) {
					// console.log(' -Mirror Node: Found balance for', _userId.toString(), 'of', token.balance, 'of token', token.token_id);
					rtnVal = Number(token.balance);
				}
			});
		})
		.catch(function(err) {
			console.error(err);
			return null;
		});

	return rtnVal;
}

async function checkMirrorHbarBalance(env, _userId) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/accounts/${_userId.toString()}`;

	let rtnVal = null;
	await axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;
			rtnVal = jsonResponse.balance.balance;
		})
		.catch(function(err) {
			console.error(err);
			return null;
		});

	return rtnVal;
}

async function getTokenBalancesForAccount(env, _userId) {
	const baseUrl = getBaseURL(env);
	let url = `/api/v1/accounts/${_userId.toString()}/tokens?limit=100`;

	let rtnVal = [];
	// use do while to get all the tokens until links is null
	do {
		await axios.get(`${baseUrl}${url}`)
			.then((response) => {
				const jsonResponse = response.data;
				jsonResponse.tokens.forEach(token => {
					rtnVal.push(token);
				});
				url = jsonResponse.links.next;
			})
			.catch(function(err) {
				console.error(err);
				return null;
			});
	} while (url != null);

	return rtnVal;
}

/**
 * Get the token decimal form mirror
 * @param {string} env
 * @param {TokenId} _tokenId
 * @returns {Object} details of the token
 */
async function getTokenDetails(env, _tokenId) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/tokens/${_tokenId}`;

	let rtnVal = null;
	await axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;
			rtnVal = {
				symbol: jsonResponse.symbol,
				name: jsonResponse.name,
				decimals: jsonResponse.decimals,
				total_supply: jsonResponse.total_supply,
				treasury_account_id: jsonResponse.treasury_account_id,
				type: jsonResponse.type,
			};
		})
		.catch(function(err) {
			console.error(err);
			return null;
		});

	return rtnVal;
}

async function getContractResult(env, transactionIdOrHash, iface) {

	const isTransactionIdObject = typeof transactionIdOrHash === 'object';
	const idOrHashStr = isTransactionIdObject ? constructTransactionIdString(transactionIdOrHash) : transactionIdOrHash;

	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/contracts/results/${idOrHashStr}`;

	// declared here to avoid circular dependency
	const { parseError } = require('./solidityHelpers');

	try {
		const response = await axios.get(url);
		// console.log('Response:', response.data.result);
		// console.log('Error:', response.data.error_message);
		// console.log('Call Result:', response.data.call_result);

		if (response?.data && response?.data?.result) {
			if (response.data.result === 'SUCCESS') {
				// infer the function parameters from the transaction
				const txCalled = iface.parseTransaction({ data: response.data.function_parameters });
				const functionName = txCalled.name;
				const decoded = iface.decodeFunctionResult(functionName, response.data.call_result);

				return {
					success: true,
					result: 'Transaction executed successfully!',
					call_result: decoded,
					error: null,
				};
			}
			else {
				return {
					success: false,
					result: response?.data?.result,
					call_result: null,
					error: parseError(iface, response.data.error_message) ?? null,
				};
			}
		}
		else {
			return { success: false, error: 'No result found' };
		}

	}
	catch (error) {
		console.error('Error:', error);
		return { success: false, error: 'Failed to query the mirror node' };
	}
}

const translateTransactionForWebCall = (transactionHash) => {
	// check if it contains the @ symbol
	if (!transactionHash.includes('@')) {
		return transactionHash;
	}
	const transactionHashParts = transactionHash.split('@');
	const transactionTime = transactionHashParts[1].split('.');

	return `${transactionHashParts[0]}-${transactionTime[0]}-${transactionTime[1]}`;
};

// Function to convert transaction ID object to string format
const constructTransactionIdString = (transactionIdObj) => {
	const shard = transactionIdObj.accountId.shard.low;
	const realm = transactionIdObj.accountId.realm.low;
	const num = transactionIdObj.accountId.num.low;

	const seconds = transactionIdObj.validStart.seconds.low;
	const nanos = transactionIdObj.validStart.nanos.low;

	return `${shard}.${realm}.${num}-${seconds}-${nanos}`;
};

async function getContractEVMAddress(env, contractId) {
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/contracts/${contractId.toString()}`;

	return await axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;
			return jsonResponse.evm_address;
		})
		.catch(function(err) {
			console.error(err);
			return null;
		});
}

module.exports = {
	checkMirrorAllowance,
	checkMirrorNFTAllowance,
	getSerialsOwned,
	getBaseURL,
	checkLastMirrorEvent,
	checkMirrorBalance,
	checkFTAllowances,
	getEventsFromMirror,
	getTokenDetails,
	getContractResult,
	translateTransactionForWebCall,
	getContractEVMAddress,
	checkMirrorHbarBalance,
	checkMirrorHbarAllowance,
	getTokenBalancesForAccount,
};