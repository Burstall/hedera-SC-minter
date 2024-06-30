const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');

require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const ethers = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers');

const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'http://testnet.mirrornode.hedera.com';
const baseUrlForPreviewnet = 'https://previewnet.mirrornode.hedera.com';
const env = process.env.ENVIRONMENT ?? null;
let contractName;

let iface;

async function main() {
	if (env === undefined || env == null) {
		console.log('Environment required, please specify TEST or MAIN in the .env file');
		return;
	}

	console.log('Using ENIVRONMENT:', env);

	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: getContractLogs.js 0.0.SSS <contract name>');
		console.log('       SSS is the Smart Contract address');
		console.log('       contract name is the name of the contract');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	contractName = args[1];

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	iface = new ethers.Interface(json.abi);

	// get contract events from a mirror node
	await getEventsFromMirror(contractId);
}

/**
 * Gets all the events for a given ContractId from a mirror node
 * @param contractId
 */

async function getEventsFromMirror(contractId) {
	console.log('\n -Getting event(s) from mirror nodes');

	let baseUrl;
	if (env.toUpperCase() == 'TEST') {
		baseUrl = baseUrlForTestnet;
	}
	else if (env.toUpperCase() == 'MAIN') {
		baseUrl = baseUrlForMainnet;
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		baseUrl = baseUrlForPreviewnet;
	}
	else {
		console.log('Environment required, please specify TEST or MAIN or PREVIEW in the .env file');
		return;
	}

	const url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=desc&limit=100`;
	console.log(url);
	axios.get(url)
		.then(function(response) {
			const jsonResponse = response.data;
			jsonResponse.logs.forEach(log => {
				// decode the event data
				if (log.data == '0x') return;

				const event = iface.parseLog({ topics: log.topics, data: log.data });
				if (event == null) {
					console.log('Event not found');
				}
				else {
					let outputStr = event.name + ' : ';
					for (let f = 0; f < event.fragment.inputs.length; f++) {
						const fieldName = event.fragment.inputs[f].name;
						const fieldType = event.fragment.inputs[f].type;

						let output = `[${fieldName}] `;
						output += fieldType == 'address' ? AccountId.fromEvmAddress(0, 0, event.args[f]).toString() : event.args[f];
						output = f == 0 ? output : ' : ' + output;
						outputStr += output;
					}

					console.log(outputStr);
				}
			});
		})
		.catch(function(err) {
			console.error(err);
		});
}

void main();