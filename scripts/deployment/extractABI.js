// get a list of files in the ../../artifacts/contracts/ directory
// read in the files and extract the .abi element from the JSON
// write the .abi to a file in the ../../abi/ directory using the same name as the contract

const fs = require('fs');
const path = require('path');

const contractDir = './artifacts/contracts/';
const abiDir = './abi/';

// check if the abi directory exists
if (!fs.existsSync(abiDir)) {
	fs.mkdirSync(abiDir);
}

const files = fs.readdirSync(contractDir);

const cwd = process.cwd();

files.forEach((file) => {
	// check the file ends in .sol
	if (!file.endsWith('.sol')) {
		return;
	}
	const abiFileName = file.split('.')[0] + '.json';
	const readPath = path.join(cwd, contractDir, file, abiFileName);

	const contractJSON = JSON.parse(
		fs.readFileSync(
			readPath,
		),
	);
	const extract = {
		'contractName': contractJSON.contractName,
		'sourceName': contractJSON.sourceName,
		'abi': contractJSON.abi,
	};
	const writePath = path.join(cwd, abiDir, abiFileName);

	fs.writeFileSync(
		writePath,
		JSON.stringify(extract, null, 4),
	);
},
);
