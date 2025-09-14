# Hedera Smart Contract Minter

This project provides a suite of Solidity smart contracts and Node.js scripts for deploying and interacting with NFT minting contracts on the Hedera network. It supports both regular NFT mints and Soulbound Tokens (SBTs), with integration for $LAZY token fees, royalties, whitelisting, and more.

## Table of Contents

- [Overview](#overview)
- [Contracts](#contracts)
- [Scripts](#scripts)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Compilation](#compilation)
- [Deployment](#deployment)
- [Interaction](#interaction)
- [Testing](#testing)
- [Debugging](#debugging)
- [Environment Variables](#environment-variables)
- [Contributing](#contributing)
- [License](#license)

## Overview

The project enables users to mint NFTs on Hedera, with features like metadata management, access control, PRNG for randomness, and support for fixed-edition or unlimited mints. It uses the Hedera Token Service (HTS) for token creation and management, and integrates with a $LAZY fungible token for transaction fees.

Key features:
- Regular NFT minting with customizable economics (cost, max per wallet, etc.).
- Soulbound Token (SBT) minting for non-transferable tokens.
- Royalty support for resales.
- Whitelist management.
- Contract pausing/unpausing.
- Metadata uploading and updating.
- Burn functionality for NFTs.

## Contracts

### Core Contracts

- **[`contracts/MinterContract.sol`](contracts/MinterContract.sol )**: The primary contract for minting regular NFTs. Handles token creation, minting logic, metadata storage, and economics (e.g., cost, limits). Uses Ownable for access control and integrates with $LAZY for fees.

- **[contracts/SoulboundMinter.sol](contracts/SoulboundMinter.sol)**: Specialized for minting Soulbound Tokens (SBTs), which are non-transferable. Supports revocable SBTs and fixed-edition mints. Inherits from ExpiryHelper and Ownable.

- **[contracts/HederaResponseCodes.sol](contracts/HederaResponseCodes.sol)**: Defines Hedera-specific response codes for error handling in contracts.

### Libraries and Helpers

- **[contracts/MinterLibrary.sol](contracts/MinterLibrary.sol)**: Library containing shared minting logic to reduce contract size.

- **[contracts/ExpiryHelper.sol](contracts/ExpiryHelper.sol)**: Helper for managing token expirations.

- **[contracts/FeeHelper.sol](contracts/FeeHelper.sol)**: Handles fee calculations, including $LAZY burns.

- **[`contracts/KeyHelper.sol`](contracts/KeyHelper.sol )**: Manages cryptographic keys for token operations.

- **[`contracts/IBurnableHTS.sol`](contracts/IBurnableHTS.sol )**: Interface for burnable HTS tokens.

- **[`contracts/IHederaTokenService.sol`](contracts/IHederaTokenService.sol )**: Interface for Hedera Token Service interactions.

- **[`contracts/IHRC719.sol`](contracts/IHRC719.sol )**: Interface for Hedera Resource Contract 719 (token associations).

- **[`contracts/IPrngGenerator.sol`](contracts/IPrngGenerator.sol )**: Interface for Pseudo-Random Number Generation (PRNG) contracts.

## Scripts

Scripts are organized into directories: [`scripts/deployment`](scripts/deployment ), [`scripts/interactions`](scripts/interactions ), [`scripts/testing`](scripts/testing ), [`scripts/debug`](scripts/debug ).

### Deployment Scripts

- **[`scripts/deployment/deploy-MC.js`](scripts/deployment/deploy-MC.js )**: Deploys the MinterContract. Requires $LAZY SCT and token IDs in `.env`. Usage: `node scripts/deployment/deploy-MC.js`

- **[scripts/deployment/deploy-SBT.js](scripts/deployment/deploy-SBT.js)**: Deploys the SoulboundMinter. Allows setting revocable status. Usage: `node scripts/deployment/deploy-SBT.js`

- **[scripts/deployment/extractABI.js](scripts/deployment/extractABI.js)**: Extracts ABIs from compiled contracts and saves to `abi/` directory. Usage: `node scripts/deployment/extractABI.js`

### Interaction Scripts

These scripts interact with deployed contracts. Most require `CONTRACT_ID` in `.env`.

- **[scripts/interactions/prepareMinter.js](scripts/interactions/prepareMinter.js)**: Prepares the minter by uploading metadata, setting PRNG, initializing NFT mints, etc. Flags: `-upload <file>`, `-init`, `-reset`, `-hardreset`. Usage: `node scripts/interactions/prepareMinter.js -upload metadata.json`

- **[scripts/interactions/mint.js](scripts/interactions/mint.js)**: Mints NFTs. Handles $LAZY allowances and gas estimation. Usage: `node scripts/interactions/mint.js`

- **[`scripts/interactions/mintOnBehalfOf.js`](scripts/interactions/mintOnBehalfOf.js )**: Mints on behalf of another account. Usage: `node scripts/interactions/mintOnBehalfOf.js`

- **[`scripts/interactions/burnNFTs.js`](scripts/interactions/burnNFTs.js )**: Burns NFTs owned by the user. Usage: `node scripts/interactions/burnNFTs.js`

- **[`scripts/interactions/withdrawFunds.js`](scripts/interactions/withdrawFunds.js )**: Withdraws HBAR or $LAZY from the contract. Usage: `node scripts/interactions/withdrawFunds.js`

- **[scripts/interactions/withdrawToWallet.js](scripts/interactions/withdrawToWallet.js)**: Withdraws to a specified wallet. Usage: `node scripts/interactions/withdrawToWallet.js`

- **[scripts/interactions/resetContract.js](scripts/interactions/resetContract.js)**: Resets contract data, optionally removing the token. Usage: `node scripts/interactions/resetContract.js`

- **[scripts/interactions/updateCost.js](scripts/interactions/updateCost.js)**: Updates mint cost and $LAZY burn percentage. Usage: `node scripts/interactions/updateCost.js`

- **[`scripts/interactions/updateMaxMintPerWallet.js`](scripts/interactions/updateMaxMintPerWallet.js )**: Updates max mints per wallet. Usage: `node scripts/interactions/updateMaxMintPerWallet.js`

- **[`scripts/interactions/updateContractPaysLazy.js`](scripts/interactions/updateContractPaysLazy.js )**: Toggles whether the contract pays $LAZY fees. Usage: `node scripts/interactions/updateContractPaysLazy.js 1|0`

- **[scripts/interactions/setCID.js](scripts/interactions/setCID.js)**: Updates the metadata CID. Usage: `node scripts/interactions/setCID.js https://newCID/`

- **[scripts/interactions/pause.js](scripts/interactions/pause.js)**: Pauses the contract. Usage: `node scripts/interactions/pause.js`

- **[scripts/interactions/unPause.js](scripts/interactions/unPause.js)**: Unpauses the contract. Usage: `node scripts/interactions/unPause.js`

- **[scripts/interactions/setWLOnly.js](scripts/interactions/setWLOnly.js)**: Sets whitelist-only mode. Usage: `node scripts/interactions/setWLOnly.js`

- **[scripts/interactions/removeWLOnly.js](scripts/interactions/removeWLOnly.js)**: Removes whitelist-only mode. Usage: `node scripts/interactions/removeWLOnly.js`

- **[scripts/interactions/addToWhiteList.js](scripts/interactions/addToWhiteList.js)**: Adds accounts to whitelist. Usage: `node scripts/interactions/addToWhiteList.js account1,account2`

- **[scripts/interactions/getWL.js](scripts/interactions/getWL.js)**: Retrieves whitelist. Usage: `node scripts/interactions/getWL.js`

- **[scripts/interactions/getRemainingMints.js](scripts/interactions/getRemainingMints.js)**: Gets remaining mints. Usage: `node scripts/interactions/getRemainingMints.js`

- **[scripts/interactions/revokeSBT.js](scripts/interactions/revokeSBT.js)**: Revokes SBTs (if revocable). Usage: `node scripts/interactions/revokeSBT.js`

### Testing Scripts

- **[scripts/testing/concurrentMint.js](scripts/testing/concurrentMint.js)**: Tests concurrent minting with multiple clients. Usage: `node scripts/testing/concurrentMint.js`

### Debugging Scripts

- **[scripts/debug/getContractInfo.js](scripts/debug/getContractInfo.js)**: Retrieves contract info (storage, balance, etc.). Usage: `node scripts/debug/getContractInfo.js`

- **[scripts/debug/getContractLogs.js](scripts/debug/getContractLogs.js)**: Fetches contract events from mirror node. Usage: `node scripts/debug/getContractLogs.js 0.0.CONTRACT_ID ContractName`

- **[scripts/debug/decodeSmartContractError.js](scripts/debug/decodeSmartContractError.js)**: Decodes smart contract errors. Usage: `node scripts/debug/decodeSmartContractError.js`

- **[scripts/debug/decodeWithABI.js](scripts/debug/decodeWithABI.js)**: Decodes data using ABI. Usage: `node scripts/debug/decodeWithABI.js`

## Prerequisites

- Node.js (v16+ recommended)
- npm or yarn
- Hedera account with HBAR and $LAZY tokens
- Hardhat for compilation (configured in hardhat.config.js)

## Setup

1. Clone the repository.
2. Install dependencies: `npm install`
3. Copy [`.env.example`](.env.example ) to [`.env`](.env ) and fill in your Hedera credentials, contract IDs, etc. (See Environment Variables)

## Compilation

Compile contracts using Hardhat:

```bash
npx hardhat compile
```

This generates artifacts in [`artifacts`](artifacts ) and ABIs in [`abi`](abi ).

## Deployment

1. Set environment variables in [`.env`](.env ) (e.g., [`LAZY_SCT_CONTRACT_ID`](node_modules/@types/node/globals.d.ts ), [`LAZY_TOKEN_ID`](node_modules/@types/node/globals.d.ts )).
2. Run deployment script: `node scripts/deployment/deploy-MC.js` or `node scripts/deployment/deploy-SBT.js`
3. Note the deployed contract ID and update [`.env`](.env ) with [`CONTRACT_ID`](node_modules/@types/node/globals.d.ts ).

## Interaction

After deployment, use interaction scripts. Ensure [`CONTRACT_ID`](node_modules/@types/node/globals.d.ts ) is set in [`.env`](.env ). Example:

```bash
node scripts/interactions/prepareMinter.js -upload metadata.json
node scripts/interactions/mint.js
```

## Testing

Run tests with Mocha:

```bash
npm test
```

Tests are in [`test`](test ) directory, e.g., [`test/MinterContract.test.js`](test/MinterContract.test.js ) and [`test/SoulboundMinter.test.js`](test/SoulboundMinter.test.js ).

## Debugging

Use debug scripts to inspect contracts. For example, to get logs:

```bash
node scripts/debug/getContractLogs.js 0.0.12345 MinterContract
```

## Environment Variables

Key variables in [`.env`](.env ):

- [`ENVIRONMENT`](node_modules/@types/node/globals.d.ts ): TEST, MAIN, PREVIEW, or LOCAL
- [`ACCOUNT_ID`](node_modules/@types/node/globals.d.ts ): Your Hedera account ID
- [`PRIVATE_KEY`](node_modules/@types/node/globals.d.ts ): Your private key (ED25519)
- [`CONTRACT_ID`](node_modules/@types/node/globals.d.ts ): Deployed contract ID
- [`CONTRACT_NAME`](node_modules/@types/node/globals.d.ts ): Contract name (e.g., MinterContract)
- [`LAZY_SCT_CONTRACT_ID`](node_modules/@types/node/globals.d.ts ): $LAZY Smart Contract ID
- `LAZY_TOKEN_ID`: $LAZY token ID
- [`LAZY_BURN_PERC`](node_modules/@types/node/globals.d.ts ): Burn percentage (default 25)
- [`PRNG_CONTRACT_ID`](node_modules/@types/node/globals.d.ts ): PRNG contract ID (optional)
- [`REVOCABLE`](node_modules/@types/node/globals.d.ts ): For SBTs (true/false)
- [`MINT_PAYMENT`](scripts/interactions/prepareMinter.js ): HBAR payment for mints (default 50)

See [`.env.example`](.env.example ) for a template.

## Contributing

- Follow Solidity best practices.
- Add tests for new features.
- Update this README for changes.

## License

GPL-3.0 (see contract headers).