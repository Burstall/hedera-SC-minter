const {
	Client,
	AccountId,
	PrivateKey,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
require('dotenv').config();
const { getArgFlag, getArg } = require('../../utils/nodeHelpers');
const readlineSync = require('readline-sync');
const { checkMirrorHbarBalance } = require('../../utils/hederaMirrorHelpers');
const { sweepHbar } = require('../../utils/hederaHelpers');

let operatorId;
let operatorKey;

try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

async function scoopTestHbar() {
	// check args for an account ot send to and a percentage of the total to send
	const toAccount = getArg('to');
	const percent = Number(getArg('percent'));

	if (getArgFlag('h') || getArgFlag('help') || !toAccount || !percent) {
		console.log('Usage: node scoopTestHbar.js -to 0.0.1234 -percent 50');
		process.exit(0);
	}

	const to = AccountId.fromString(toAccount);
	const percentage = parseInt(percent);


	if (!toAccount) {
		console.log('ERROR: Must specify -to to send to an account');
		process.exit(1);
	}

	if (!percent) {
		console.log('ERROR: Must specify -percent to send a percentage of the total');
		process.exit(1);
	}

	// pull the SCOOP_ACCOUNTS from the .env file
	const scoopAccounts = process.env.SCOOP_ACCOUNTS.split(',').map((account) => {
		return AccountId.fromString(account);
	});

	// get the keys from the .env file, if begins with 0x then assume ECDSA key, else assume Ed25519 key
	const keys = [];
	const keyStrings = process.env.SCOOP_KEYS.split(',');
	keyStrings.forEach((key) => {
		if (key.startsWith('e')) {
			keys.push(PrivateKey.fromStringECDSA(key.split(':')[1]));
		}
		else {
			keys.push(PrivateKey.fromStringED25519(key));
		}
	});

	const balances = [];
	const sendAmounts = [];

	const client = Client.forTestnet();
	client.setOperator(operatorId, operatorKey);

	// get the balances of the accounts
	for (let i = 0; i < scoopAccounts.length; i++) {
		const balance = await checkMirrorHbarBalance('test', scoopAccounts[i]);
		balances.push(Number(balance));
		sendAmounts.push(Math.floor(Number(balance) * (percentage / 100)));
	}

	// display the balances we are pulling
	console.log('**TESTNET**');
	console.log('Sccop Accounts:', scoopAccounts.map((account) => account.toString()).join(', '));
	console.log('Balances:', balances.map((balance) => new Hbar(balance, HbarUnit.Tinybar).toString()).join(', '));
	console.log('Percent to send:', percentage, '%');
	console.log('Total to send:', new Hbar(balances.reduce((a, b) => a + b, 0), HbarUnit.Tinybar).toString());

	// confirm the send
	const confirm = readlineSync.keyInYNStrict('Send the above amounts?');
	if (!confirm) {
		console.log('Exiting');
		process.exit(0);
	}

	// send the amounts
	for (let i = 0; i < scoopAccounts.length; i++) {
		const amount = new Hbar(sendAmounts[i], HbarUnit.Tinybar);
		const result = await sweepHbar(client, scoopAccounts[i], keys[i], to, amount);
		console.log('Sent', amount.toString(), 'from', scoopAccounts[i].toString(), 'to', to.toString(), 'with result', result);
	}

}

scoopTestHbar()
	.then(() => {
		console.log('Done');
		process.exit(0);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});