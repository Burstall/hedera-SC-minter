const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');

require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { ethers } = require('ethers');

const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'http://testnet.mirrornode.hedera.com';
const env = process.env.ENVIRONMENT ?? null;
const contractName = process.env.CONTRACT_NAME ?? null;
const eventName = process.env.EVENT_NAME ?? null;

let abi, iface;

async function main() {
	console.log('Using ENIVRONMENT:', env);

	if (env === undefined || env == null) {
		console.log('Environment required, please specify TEST or MAIN in the .env file');
		return;
	}

	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}

	if (eventName === undefined || eventName == null) {
		console.log('Environment required, please specify EVENT_NAME to decode in the .env file');
		return;
	}

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	abi = json.abi;

	iface = new ethers.utils.Interface(abi);

	const contractId = ContractId.fromString(process.env.CONTRACT_ID);

	// get contract events from a mirror node
	await getEventsFromMirror(contractId);
}

/**
 * Gets all the events for a given ContractId from a mirror node
 * @param contractId
 */

async function getEventsFromMirror(contractId) {
	console.log('\n -Getting event(s) from mirror nodes');

	const baseUrl = env.toUpperCase() == 'MAIN' ? baseUrlForMainnet : baseUrlForTestnet;

	const url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=desc&limit=100`;
	console.log(url);
	axios.get(url)
		.then(function(response) {
			const jsonResponse = response.data;
			jsonResponse.logs.forEach(log => {
				// console.log(log);
				// decode the event data
				if (log.data == '0x') return;
				const data = log.data;
				const topics = log.topics;
				const event = iface.parseLog({ data, topics });

				// console.log('EVENT:\n', JSON.stringify(event, null, 3));

				let outputStr = '@ ' + log.timestamp + ' : ' + event.name + ' : ';
				for (let f = 0; f < event.args.length; f++) {
					const field = event.args[f];
					// console.log(field);
					let output;
					switch (typeof field) {
					case 'string':
						output = field.startsWith('0x') ? AccountId.fromSolidityAddress(field).toString() : field;
						break;
					default:
						output = field;
					}
					output = f == 0 ? output : ' : ' + output;
					outputStr += output;
				}

				console.log(outputStr);
			});
		})
		.catch(function(err) {
			console.error(err);
		});
}

void main();