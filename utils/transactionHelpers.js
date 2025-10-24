/**
 * Helper functions for analyzing Hedera transaction records
 */

/**
 * Parse and format a TransactionRecord for better debugging
 * @param {TransactionRecord} record - The transaction record to parse
 * @returns {Object} Formatted transaction details
 */
function parseTransactionRecord(record) {
	const parsed = {
		transactionId: record.transactionId?.toString(),
		status: record.receipt?.status?.toString(),
		statusCode: record.receipt?.status?._code,
		consensusTimestamp: record.consensusTimestamp?.toString(),
		transactionHash: record.transactionHash?.toString('hex'),
		transactionFee: record.transactionFee?.toString(),
		contractFunction: {
			contractId: record.contractFunctionResult?.contractId?.toString(),
			gasUsed: record.contractFunctionResult?.gasUsed?.toString(),
			errorMessage: record.contractFunctionResult?.errorMessage,
			bytes: record.contractFunctionResult?.bytes?.toString('hex'),
			logs: record.contractFunctionResult?.logs?.length || 0,
			bloom: record.contractFunctionResult?.bloom?.toString('hex'),
			evmAddress: record.contractFunctionResult?.evmAddress?.toString(),
		},
		transfers: record.transfers?.map(t => ({
			accountId: t.accountId?.toString(),
			amount: t.amount?.toString(),
			isApproved: t.isApproved,
		})) || [],
		tokenTransfers: record.tokenTransfersList?.length || 0,
		nftTransfers: record.nftTransfers?._map?.size || 0,
		createdContractIds: record.contractFunctionResult?.createdContractIds?.map(id => id.toString()) || [],
		assessedCustomFees: record.assessedCustomFees?.length || 0,
	};

	return parsed;
}

/**
 * Get human-readable status information
 * @param {number} statusCode - The status code from the transaction
 * @returns {Object} Status information
 */
function getStatusInfo(statusCode) {
	const statusMap = {
		// Success codes
		0: { name: 'OK', description: 'The transaction passed the precheck validations' },
		22: { name: 'SUCCESS', description: 'The transaction succeeded' },

		// Basic error codes
		1: { name: 'INVALID_TRANSACTION', description: 'For any error not handled by specific error codes' },
		2: { name: 'PAYER_ACCOUNT_NOT_FOUND', description: 'Payer account does not exist' },
		3: { name: 'INVALID_NODE_ACCOUNT', description: 'Node Account provided does not match the node account' },
		4: { name: 'TRANSACTION_EXPIRED', description: 'Transaction expired' },
		5: { name: 'INVALID_TRANSACTION_START', description: 'Transaction start time is greater than current consensus time' },
		6: { name: 'INVALID_TRANSACTION_DURATION', description: 'Valid transaction duration exceeded' },
		7: { name: 'INVALID_SIGNATURE', description: 'The transaction signature is not valid' },
		8: { name: 'MEMO_TOO_LONG', description: 'Transaction memo size exceeded 100 bytes' },
		9: { name: 'INSUFFICIENT_TX_FEE', description: 'The fee provided is insufficient' },
		10: { name: 'INSUFFICIENT_PAYER_BALANCE', description: 'Payer account has insufficient cryptocurrency' },
		11: { name: 'DUPLICATE_TRANSACTION', description: 'This transaction ID is a duplicate' },
		12: { name: 'BUSY', description: 'API is throttled out' },
		13: { name: 'NOT_SUPPORTED', description: 'The API is not currently supported' },

		// Entity errors
		14: { name: 'INVALID_FILE_ID', description: 'The file id is invalid or does not exist' },
		15: { name: 'INVALID_ACCOUNT_ID', description: 'The account id is invalid or does not exist' },
		16: { name: 'INVALID_CONTRACT_ID', description: 'The contract id is invalid or does not exist' },
		17: { name: 'INVALID_TRANSACTION_ID', description: 'Transaction id is not valid' },
		18: { name: 'RECEIPT_NOT_FOUND', description: 'Receipt for given transaction id does not exist' },
		19: { name: 'RECORD_NOT_FOUND', description: 'Record for given transaction id does not exist' },
		20: { name: 'INVALID_SOLIDITY_ID', description: 'The solidity id is invalid or entity does not exist' },

		// System errors
		21: { name: 'UNKNOWN', description: 'Transaction submitted to network, final status unknown' },
		23: { name: 'FAIL_INVALID', description: 'System error - transaction failed due to invalid request parameters' },
		24: { name: 'FAIL_FEE', description: 'System error while performing fee calculation' },
		25: { name: 'FAIL_BALANCE', description: 'System error while performing balance checks' },

		// Key and encoding errors
		26: { name: 'KEY_REQUIRED', description: 'Key not provided in the transaction body' },
		27: { name: 'BAD_ENCODING', description: 'Unsupported algorithm/encoding used for keys' },
		28: { name: 'INSUFFICIENT_ACCOUNT_BALANCE', description: 'Account balance not sufficient for transfer' },
		29: { name: 'INVALID_SOLIDITY_ADDRESS', description: 'Cannot find Users Solidity address' },

		// Contract execution errors
		30: { name: 'INSUFFICIENT_GAS', description: 'Not enough gas was supplied to execute transaction' },
		31: { name: 'CONTRACT_SIZE_LIMIT_EXCEEDED', description: 'Contract byte code size is over the limit' },
		32: { name: 'LOCAL_CALL_MODIFICATION_EXCEPTION', description: 'Local execution requested for state-changing function' },
		33: { name: 'CONTRACT_REVERT_EXECUTED', description: 'Contract REVERT OPCODE executed' },
		34: { name: 'CONTRACT_EXECUTION_EXCEPTION', description: 'Contract execution related error' },
		35: { name: 'INVALID_RECEIVING_NODE_ACCOUNT', description: 'Invalid receiving node account' },
		36: { name: 'MISSING_QUERY_HEADER', description: 'Header is missing in Query request' },

		// Account and contract update errors
		37: { name: 'ACCOUNT_UPDATE_FAILED', description: 'The update of the account failed' },
		38: { name: 'INVALID_KEY_ENCODING', description: 'Provided key encoding was not supported' },
		39: { name: 'NULL_SOLIDITY_ADDRESS', description: 'Null solidity address' },
		40: { name: 'CONTRACT_UPDATE_FAILED', description: 'Update of the contract failed' },
		41: { name: 'INVALID_QUERY_HEADER', description: 'The query header is invalid' },
		42: { name: 'INVALID_FEE_SUBMITTED', description: 'Invalid fee submitted' },
		43: { name: 'INVALID_PAYER_SIGNATURE', description: 'Payer signature is invalid' },

		// File and key errors
		44: { name: 'KEY_NOT_PROVIDED', description: 'The keys were not provided in the request' },
		45: { name: 'INVALID_EXPIRATION_TIME', description: 'Expiration time provided was invalid' },
		46: { name: 'NO_WACL_KEY', description: 'WriteAccess Control Keys are not provided for the file' },
		47: { name: 'FILE_CONTENT_EMPTY', description: 'The contents of file are provided as empty' },
		48: { name: 'INVALID_ACCOUNT_AMOUNTS', description: 'Crypto transfer credit and debit do not sum to 0' },
		49: { name: 'EMPTY_TRANSACTION_BODY', description: 'Transaction body provided is empty' },
		50: { name: 'INVALID_TRANSACTION_BODY', description: 'Invalid transaction body provided' },

		// Token-related errors
		165: { name: 'ACCOUNT_FROZEN_FOR_TOKEN', description: 'Account is frozen and cannot transact with the token' },
		166: { name: 'TOKENS_PER_ACCOUNT_LIMIT_EXCEEDED', description: 'Account has too many token associations' },
		167: { name: 'INVALID_TOKEN_ID', description: 'The token is invalid or does not exist' },
		168: { name: 'INVALID_TOKEN_DECIMALS', description: 'Invalid token decimals' },
		169: { name: 'INVALID_TOKEN_INITIAL_SUPPLY', description: 'Invalid token initial supply' },
		170: { name: 'INVALID_TREASURY_ACCOUNT_FOR_TOKEN', description: 'Treasury Account does not exist or is deleted' },
		171: { name: 'INVALID_TOKEN_SYMBOL', description: 'Token Symbol is not UTF-8 capitalized alphabetical string' },
		172: { name: 'TOKEN_HAS_NO_FREEZE_KEY', description: 'Freeze key is not set on token' },
		173: { name: 'TRANSFERS_NOT_ZERO_SUM_FOR_TOKEN', description: 'Amounts in transfer list are not net zero' },
		174: { name: 'MISSING_TOKEN_SYMBOL', description: 'A token symbol was not provided' },
		175: { name: 'TOKEN_SYMBOL_TOO_LONG', description: 'The provided token symbol was too long' },
		176: { name: 'ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN', description: 'KYC must be granted and account does not have KYC granted' },
		177: { name: 'TOKEN_HAS_NO_KYC_KEY', description: 'KYC key is not set on token' },
		178: { name: 'INSUFFICIENT_TOKEN_BALANCE', description: 'Token balance is not sufficient for the transaction' },
		179: { name: 'TOKEN_WAS_DELETED', description: 'Token transactions cannot be executed on deleted token' },
		180: { name: 'TOKEN_HAS_NO_SUPPLY_KEY', description: 'Supply key is not set on token' },
		181: { name: 'TOKEN_HAS_NO_WIPE_KEY', description: 'Wipe key is not set on token' },
		182: { name: 'INVALID_TOKEN_MINT_AMOUNT', description: 'The requested token mint amount would cause invalid total supply' },
		183: { name: 'INVALID_TOKEN_BURN_AMOUNT', description: 'The requested token burn amount would cause invalid total supply' },
		184: { name: 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT', description: 'A required token-account relationship is missing' },
		185: { name: 'CANNOT_WIPE_TOKEN_TREASURY_ACCOUNT', description: 'The target of a wipe operation was the token treasury account' },
		186: { name: 'INVALID_KYC_KEY', description: 'The provided KYC key was invalid' },
		187: { name: 'INVALID_WIPE_KEY', description: 'The provided wipe key was invalid' },
		188: { name: 'INVALID_FREEZE_KEY', description: 'The provided freeze key was invalid' },
		189: { name: 'INVALID_SUPPLY_KEY', description: 'The provided supply key was invalid' },
		190: { name: 'MISSING_TOKEN_NAME', description: 'Token Name is not provided' },
		191: { name: 'TOKEN_NAME_TOO_LONG', description: 'Token Name is too long' },
		192: { name: 'INVALID_WIPING_AMOUNT', description: 'The provided wipe amount must not be negative, zero or bigger than the token holder balance' },
		193: { name: 'TOKEN_IS_IMMUTABLE', description: 'Token does not have Admin key set, thus update/delete transactions cannot be performed' },
		194: { name: 'TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT', description: 'An associateToken operation specified a token already associated to the account' },
		195: { name: 'TRANSACTION_REQUIRES_ZERO_TOKEN_BALANCES', description: 'An attempted operation is invalid until all token balances for the target account are zero' },
		196: { name: 'ACCOUNT_IS_TREASURY', description: 'An attempted operation is invalid because the account is a treasury' },
		197: { name: 'TOKEN_ID_REPEATED_IN_TOKEN_LIST', description: 'Same TokenIDs present in the token list' },
		198: { name: 'TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED', description: 'Exceeded the number of token transfers allowed for token transfer list' },
		199: { name: 'EMPTY_TOKEN_TRANSFER_BODY', description: 'TokenTransfersTransactionBody has no TokenTransferList' },
		200: { name: 'EMPTY_TOKEN_TRANSFER_ACCOUNT_AMOUNTS', description: 'TokenTransfersTransactionBody has a TokenTransferList with no AccountAmounts' },
	};

	return statusMap[statusCode] || {
		name: 'UNKNOWN_STATUS',
		description: `Unknown status code: ${statusCode}`,
	};
}

/**
 * Analyze transaction failure for common issues
 * @param {TransactionRecord} record - The transaction record to analyze
 * @returns {Object} Analysis results
 */
function analyzeTransactionFailure(record) {
	const parsed = parseTransactionRecord(record);
	const statusInfo = getStatusInfo(parsed.statusCode);

	const analysis = {
		status: statusInfo,
		gasAnalysis: {
			gasUsed: parsed.contractFunction.gasUsed,
			gasLimit: 'Unknown',
			gasEfficient: parseInt(parsed.contractFunction.gasUsed) < 100000,
			possibleOutOfGas: parseInt(parsed.contractFunction.gasUsed) > 1000000,
		},
		errorAnalysis: {
			hasErrorMessage: parsed.contractFunction.errorMessage && parsed.contractFunction.errorMessage !== '0x',
			errorMessage: parsed.contractFunction.errorMessage,
			hasLogs: parsed.contractFunction.logs > 0,
			hasReturnData: parsed.contractFunction.bytes && parsed.contractFunction.bytes !== '',
			returnDataHex: parsed.contractFunction.bytes,
		},
		possibleCauses: [],
	};

	// Add possible causes based on analysis
	if (parsed.statusCode === 33) {
		analysis.possibleCauses.push('Contract execution reverted');

		if (!analysis.errorAnalysis.hasErrorMessage) {
			analysis.possibleCauses.push('Silent revert - no error message (possible low-level failure)');
		}

		if (analysis.gasAnalysis.gasUsed < '50000') {
			analysis.possibleCauses.push('Low gas usage suggests early revert (possibly in constructor or modifier)');
		}

		if (!analysis.errorAnalysis.hasReturnData) {
			analysis.possibleCauses.push('No return data suggests precompile or low-level failure');
		}
	}

	return analysis;
}

/**
 * Format transaction analysis for console output
 * @param {TransactionRecord} record - The transaction record
 * @param {number} gasLimit - The gas limit that was set
 * @returns {string} Formatted output
 */
function formatTransactionAnalysis(record, gasLimit = null) {
	const analysis = analyzeTransactionFailure(record);
	const parsed = parseTransactionRecord(record);

	let output = '\n=== TRANSACTION ANALYSIS ===\n';
	output += `Transaction ID: ${parsed.transactionId}\n`;
	output += `Status: ${analysis.status.name} (${parsed.statusCode})\n`;
	output += `Description: ${analysis.status.description}\n`;
	output += `Contract: ${parsed.contractFunction.contractId}\n`;
	output += `Gas Used: ${analysis.gasAnalysis.gasUsed}`;
	if (gasLimit) {
		output += ` / ${gasLimit} (${(parseInt(analysis.gasAnalysis.gasUsed) / gasLimit * 100).toFixed(1)}%)`;
	}
	output += '\n';

	output += `Error Message: ${analysis.errorAnalysis.errorMessage || 'None'}\n`;
	output += `Return Data: ${analysis.errorAnalysis.returnDataHex || 'None'}\n`;
	output += `Logs: ${analysis.errorAnalysis.hasLogs ? analysis.gasAnalysis.logs : 'None'}\n`;

	if (analysis.possibleCauses.length > 0) {
		output += '\nPossible Causes:\n';
		analysis.possibleCauses.forEach(cause => {
			output += `  - ${cause}\n`;
		});
	}

	output += '========================\n';

	return output;
}

module.exports = {
	parseTransactionRecord,
	getStatusInfo,
	analyzeTransactionFailure,
	formatTransactionAnalysis,
};