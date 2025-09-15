const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
	ContractId,
	TokenId,
	ContractCreateTransaction,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { contractDeployFunction, linkBytecode } = require('../../utils/solidityHelpers');
require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'MinterContract';
const libraryName = 'MinterLibrary';

const lazyContractId = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
const lazyBurnPerc = process.env.LAZY_BURN_PERC || 25;

const env = process.env.ENVIRONMENT ?? null;

let client;

async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setAutoRenewAccountId(operatorId)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addAddress(lazyContractId.toSolidityAddress())
				.addAddress(lazyTokenId.toSolidityAddress())
				.addUint256(lazyBurnPerc),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	const contractId = contractCreateRx.contractId;
	const contractAddress = contractId.toEvmAddress();
	return [contractId, contractAddress];
}

async function contractCreateFcn(bytecodeFileId, gasLim) {
	const contractCreateTx = new ContractCreateTransaction()
		.setBytecodeFileId(bytecodeFileId)
		.setGas(gasLim)
		.setAutoRenewAccountId(operatorId)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addAddress(lazyContractId.toEvmAddress())
				.addAddress(lazyTokenId.toEvmAddress())
				.addUint256(lazyBurnPerc),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	const contractId = contractCreateRx.contractId;
	const contractAddress = contractId.toEvmAddress();
	return [contractId, contractAddress];
}

const main = async () => {

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using LSCT:', lazyContractId.toString());
	console.log('\n-Using LAZY Token:', lazyTokenId.toString());
	console.log('\n-Using LAZY Burn %:', lazyBurnPerc);

	const proceed = readlineSync.keyInYNStrict('Do you want to deploy the (regular) minter?');

	if (proceed) {
		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('deploying in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('deploying in *MAINNET*');
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			console.log('deploying in *PREVIEWNET*');
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('testing in *LOCAL*');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST or PREVIEW as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);

		let libContractId;
		if (process.env.MINTER_LIBRARY_ID) {
			console.log('Library already deployed with ID:', process.env.MINTER_LIBRARY_ID);
			libContractId = ContractId.fromString(process.env.MINTER_LIBRARY_ID);
		}
		else {

			// deploy library contract
			console.log('\n-Deploying library:', libraryName);

			const libraryBytecode = JSON.parse(fs.readFileSync(`./artifacts/contracts/${libraryName}.sol/${libraryName}.json`)).bytecode;

			[libContractId] = await contractDeployFunction(client, libraryBytecode, 500_000);
			console.log(`Library created with ID: ${libContractId} / ${libContractId.toSolidityAddress()}`);
		}

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		const contractBytecode = json.bytecode;

		// replace library address in bytecode
		console.log('\n-Linking library address in bytecode...');
		const readyToDeployBytecode = linkBytecode(contractBytecode, [libraryName], [libContractId]);

		console.log('\n- Deploying contract...');
		const gasLimit = 4_600_000;

		const args = process.argv.slice(2);

		let contractId, contractAddress;
		if (args.length == 1) {
			console.log('Using FileID', args[0]);
			[contractId, contractAddress] = await contractCreateFcn(args[0], gasLimit);
		}
		else {
			console.log('Uploading bytecode and deploying...');
			[contractId, contractAddress] = await contractDeployFcn(readyToDeployBytecode, gasLimit);
		}

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);
	}
	else {
		console.log('User aborted');
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
