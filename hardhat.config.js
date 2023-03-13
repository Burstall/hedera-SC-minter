require('@nomicfoundation/hardhat-toolbox');
require('hardhat-contract-sizer');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
	mocha: {
		timeout: 10000000,
	},
	solidity: {
		version: '0.8.12',
		settings: {
			optimizer: {
				enabled: true,
				runs: 200,
			},
		},
	},
	contractSizer: {
		alphaSort: true,
		disambiguatePaths: false,
		runOnCompile: true,
		strict: true,
	},
};