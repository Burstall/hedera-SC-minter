const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const {
	readOnlyEVMFromMirrorNode,
} = require('../../utils/solidityHelpers');
const fs = require('fs');
const { ethers } = require('ethers');

// Get operator from .env file
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? 'MinterContract';

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;

// check-out the deployed script - test read-only method
const main = async () => {
	if (operatorId === undefined || operatorId == null) {
		console.log('Environment required, please specify ACCOUNT_ID in the .env file');
		return;
	}
	else if (contractId === undefined || contractId == null) {
		console.log('Contract ID required, please specify CONTRACT_ID in the .env file');
		return;
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using contract:', contractId.toString());
	console.log('\n-Using contract name:', contractName);


	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const minterIface = new ethers.Interface(json.abi);

	// get totalMinted from the mirror nodes
	let encodedCommand = minterIface.encodeFunctionData('totalMinted');

	const totalMintedOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const totalMinted = Number(minterIface.decodeFunctionResult('totalMinted', totalMintedOutput)[0]);

	// now get maxSupply
	encodedCommand = minterIface.encodeFunctionData('maxSupply');

	const maxSupplyOutput = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const maxSupply = Number(minterIface.decodeFunctionResult('maxSupply', maxSupplyOutput)[0]);

	const remainingMints = maxSupply - totalMinted;

	console.log(`\nTotal minted: ${totalMinted}`);
	console.log(`Max supply: ${maxSupply}`);
	console.log(`Remaining mints: ${remainingMints}`);

};

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
