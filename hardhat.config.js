require('@nomicfoundation/hardhat-toolbox');

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
				runs: 100,
			},
		},
	},
};