import readlineSync from 'readline-sync';

const abstractionParser = async () => {

	// ask for the token
	const token = readlineSync.question('Enter the token to mint: ');
	const contractId = readlineSync.question('Enter the contract ID: ');

	console.log('Looking for accounts with 0 balance...');
	console.log('Token:', token);
	console.log('Contract ID:', contractId);

	try {
		const resp = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/tokens/${token}/balances?limit=100&account.balance=0`);
		const balances = (await resp.json()).balances;

		console.log('Found', balances.length, 'accounts with 0 balance');

		// check if the user wants to proceed
		const proceed = readlineSync.keyInYNStrict('Do you wish to mint tokens for these accounts?');
		if (!proceed) {
			console.log('User aborted.');
			return;
		}

		for (const balance of balances) {
			try {
				const response = await fetch('https://dapp.lazysuperheroes.com/api/abstractionMinter', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						type: 'Soulbound',
						contractId: contractId,
						quantity: 1,
						cost: 0,
						gas: 875_000,
						tokenToMint: token,
						accountId: balance.account,
					}),
				});

				if (!response.ok) {
					const jsonResp = await response.json();
					throw new Error(`Failed to mint token: ${jsonResp.error}`);
				}
				const txId = (await response.text()).replace(/"/g, '');

				console.log('Token minting transaction submitted:', balance.account, txId);
			}
			catch (error) {
				console.error('Error during token minting request:', error);
			}
		}

	}
	catch (error) {
		console.error('Error during account lookup:', error);
	}
};

abstractionParser();
