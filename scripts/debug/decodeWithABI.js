const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
	// get arguments from the command line, ensure there are 2 only else print usage
	const args = process.argv.slice(2);
	if (args.length != 2) {
		console.log('usage: node decodeWithABI.js contract <encoded>');
		console.log('example: node .\\scripts\\decodeWithABI.js MissionFactory 0x0a45aa1f0000000000000000000000000000000000000000000000000000000000000000');
		process.exit(1);
	}

	const contract = args[0];
	const encoded = args[1];

	const contractJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts${contract.startsWith('I') ? '/interfaces/' : '/'}${contract}.sol/${contract}.json`,
		),
	);

	const iface = new ethers.Interface(contractJSON.abi);

	// const decoded = iface.parseTransaction({ data: encoded });
	const decoded = iface.decodeFunctionData('cryptoTransfer', encoded);

	console.dir(decoded, { depth: 5 });
}

main();