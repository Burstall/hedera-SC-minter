require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
let abi, iface;

const main = async () => {
	const args = process.argv.slice(2);
	// check only one argument is supplied at command line
	if (args.length != 2) {
		console.error('Usage: node parseError.js <contractName> <errorName>');
		process.exit(1);
	}

	// get contract name from command line
	const contractName = args[0];
	const errorName = args[1];

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	abi = json.abi;
	console.log('\n -Loading ABI...\n');

	iface = new ethers.utils.Interface(abi);

	console.log('\n -Looking for error...', errorName);

	console.log(iface.getError(errorName));

};

main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		// process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});