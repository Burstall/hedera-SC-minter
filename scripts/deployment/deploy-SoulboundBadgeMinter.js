const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
	ContractCreateTransaction,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'SoulboundBadgeMinter';

let revocable = process.env.REVOCABLE || false;

const env = process.env.ENVIRONMENT ?? null;

let client;

async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setAutoRenewAccountId(operatorId)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addBool(revocable),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	const contractId = contractCreateRx.contractId;
	const contractAddress = contractId.toSolidityAddress();
	return [contractId, contractAddress];
}

async function contractCreateFcn(bytecodeFileId, gasLim) {
	const contractCreateTx = new ContractCreateTransaction()
		.setBytecodeFileId(bytecodeFileId)
		.setGas(gasLim)
		.setAutoRenewAccountId(operatorId)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addBool(revocable),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	const contractId = contractCreateRx.contractId;
	const contractAddress = contractId.toSolidityAddress();
	return [contractId, contractAddress];
}

const main = async () => {

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Revocable SBT Mints:', revocable);

	// ask user to confirm revocable status given it is immutable
	const revocableUpdate = readlineSync.keyInYNStrict('Do you want to update the revocable status?');
	if (revocableUpdate) {
		revocable = readlineSync.keyInYNStrict('Is the SoulboundBadgeMinter revocable?');

		console.log('\n-*NEW* Revocable SBT Mints:', revocable);
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to deploy the SoulboundBadgeMinter?');

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
			console.log('deploying in *LOCAL*');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		const contractBytecode = json.bytecode;

		console.log('\n- Deploying contract...', contractName);
		const gasLimit = 4_800_000;

		const args = process.argv.slice(2);

		let contractId, contractAddress;
		if (args.length == 1) {
			console.log('Using FileID', args[0]);
			[contractId, contractAddress] = await contractCreateFcn(args[0], gasLimit);
		}
		else {
			console.log('Uploading bytecode and deploying...');
			[contractId, contractAddress] = await contractDeployFcn(contractBytecode, gasLimit);
		}

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);
		console.log('\n===========================================');
		console.log('DEPLOYMENT COMPLETE');
		console.log('===========================================');
		console.log('Contract Name:', contractName);
		console.log('Contract ID:', contractId.toString());
		console.log('Contract Address:', contractAddress);
		console.log('Revocable:', revocable);
		console.log('Environment:', env.toUpperCase());
		console.log('===========================================');

		console.log('\n📝 Next Steps:');
		console.log('1. Add CONTRACT_ID to your .env file:');
		console.log(`   CONTRACT_ID=${contractId.toString()}`);
		console.log('2. Run initialization script:');
		console.log('   node scripts/interactions/BadgeMinter/prepareBadgeMinter.js -init');
		console.log('3. Create badge types and whitelist users');
		console.log('4. Start minting badges!');
	}
	else {
		console.log('User aborted deployment');
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});