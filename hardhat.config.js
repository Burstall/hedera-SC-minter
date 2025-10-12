require('@nomicfoundation/hardhat-toolbox');
require('hardhat-contract-sizer');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
	mocha: {
		timeout: 10000000,
	},
	solidity: {
		version: '0.8.18',
		settings: {
			optimizer: {
				enabled: true,
				runs: 200,
			},
			viaIR: true,
		},
	},
	contractSizer: {
		alphaSort: true,
		runOnCompile: true,
		disambiguatePaths: false,
		strict: true,
	},
};