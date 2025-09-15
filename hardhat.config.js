require('hardhat-contract-sizer');
require('@nomicfoundation/hardhat-toolbox');
require('hardhat-docgen');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
	mocha: {
		timeout: 100000000,
		slow: 100000,
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
	docgen: {
		path: './docs',
		clear: true,
		runOnCompile: true,
	},
};
