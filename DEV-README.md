Bytecode linking example:

	console.log('\n-Deploying library:', libraryName);

	const libraryBytecode = JSON.parse(fs.readFileSync(`./artifacts/contracts/${libraryName}.sol/${libraryName}.json`)).bytecode;

	const [libContractId] = await contractDeployFunction(client, libraryBytecode, 2_500_000);
	console.log(`Library created with ID: ${libContractId} / ${libContractId.toSolidityAddress()}`);

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

	const contractBytecode = json.bytecode;

	// replace library address in bytecode
	console.log('\n-Linking library address in bytecode...');
	const readyToDeployBytecode = linkBytecode(contractBytecode, [libraryName], [libContractId]);

	[contractId, contractAddress] = await contractDeployFunction(client, readyToDeployBytecode, 6_500_000, constructorParams);

