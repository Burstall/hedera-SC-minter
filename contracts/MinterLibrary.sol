// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import { EnumerableMap } from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IPrngGenerator } from "./IPrngGenerator.sol";

library MinterLibrary {
    using EnumerableMap for EnumerableMap.AddressToUintMap;
	using EnumerableMap for EnumerableMap.UintToUintMap;
	using EnumerableSet for EnumerableSet.UintSet;

	int8 internal constant CONTRACT_TOKEN_NOT_RESET = 1; // Need to reset contract token before second init
    int8 internal constant MEMO_TOO_LONG = 2; // Memo is > 100bytes
	int8 internal constant ROYALTY_TOO_MANY = 3; // Too many custom fees supplied (10 is limit)
	int8 internal constant TOKEN_CREATE_FAILED = 4; // HTS token creation failed
	int8 internal constant LAZY_BURN_FAILED = 5; // Failed when burnign the supplied $LAZY
	int8 internal constant NOT_ENOUGH_LAZY = 6; // User does not have enough $LAZY
	int8 internal constant MINT_ERROR_ASSOCIATE_TOKEN = 7; // failed to associate $LAZY with minter contract
	int8 internal constant INSUFFICIENT_PAYMENT_HBAR = 8; // send more hbar to cover the fee
	int8 internal constant MINT_ZERO = 9; // requested a zero mint quantity
	int8 internal constant TOO_MUCH_METADATA = 10; // too many items in the metadata array vs max supply
	int8 internal constant NO_METADATA_LOADED = 11; // no items of metadata loaded!
	int8 internal constant MINT_NOT_OPEN = 12; // not yet open for minting
	int8 internal constant PAUSED = 13; // contract paused
	int8 internal constant MINT_OUT = 14; // not enough left to mint to satisfy the request
	int8 internal constant ABOVE_MAX_MINT = 15; // too many mints requested
	int8 internal constant NOT_ENOUGH_WL_SLOTS = 16; // trying to mint more than WL slots exist
	int8 internal constant ABOVE_MAX_MINT_PER_WALLET = 17; // above max mint per wallet
	int8 internal constant HTS_MINT_FAIL = 18; // failed to call mint
	int8 internal constant HTS_TRANSFER_TOKEN_FAIL = 19; // failed to transfer minted token
	int8 internal constant HTS_TRANSFER_LAZY_FAIL = 20; // failed to transfer $LAZY
	int8 internal constant REFUND_WINDOW_NOT_PASSED = 21; // need to cooldown before encomic value retrieved
	int8 internal constant UNABLE_TO_BUY_WL_LAZY = 22; // WL buying disabled
	int8 internal constant UNABLE_TO_BUY_WL_TOKEN = 23; // no WL token set
	int8 internal constant SERIAL_ALREADY_USED = 24; // token serial already used to redeem WL
	int8 internal constant SERIAL_NOT_OWNED = 25; // msg.sender does not own the serial
	int8 internal constant BAD_ARGUMENTS = 26; // incorrect arguments
	int8 internal constant OUT_OF_RANGE = 27; // out of range
	int8 internal constant BURN_FAILED = 28; // failed to BURN/WIPE NFT
	int8 internal constant TOO_MANY_SERIALS_SUPPLIED = 29; // 10 per TX is the limit
	int8 internal constant WIPE_FAILED = 30; // Wipe NFT failed

    function checkWhitelistConditions(
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap,
        uint maxWlAddressMint
    ) public view returns (bool allowedToMint) {
		(bool found, uint qty) = whitelistedAddressQtyMap.tryGet(msg.sender);
		if (found) {
			if (maxWlAddressMint > 0) {
				allowedToMint = qty > 0 ? true : false;
			}
			else {
				allowedToMint = true;
			}
		}
		else {
			allowedToMint = false;
		}
	}

    function clearWhitelist(EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap) public returns(uint numAddressesRemoved) {
		numAddressesRemoved = whitelistedAddressQtyMap.length();
		for (uint a = numAddressesRemoved; a > 0; a--) {
			(address key, ) = whitelistedAddressQtyMap.at(a - 1);
			whitelistedAddressQtyMap.remove(key);
		}
	}

	function selectMetdataToMint(
		string[] storage metadata, 
		uint numberToMint, 
		string storage cid,
		address prngGenerator
		) 
		internal returns (bytes[] memory metadataForMint) {

		if (prngGenerator == address(0)) {
			metadataForMint = new bytes[](numberToMint);
			for (uint m = 0; m < numberToMint; m++) {
				// TODO: use hedera PRGN to move a random element to the end of the array
				metadataForMint[m] = bytes(string.concat(cid, metadata[metadata.length - 1]));
				// pop discarding the element used up
				metadata.pop();
			}
		}
		else {
			for (uint m = 0; m < numberToMint; m++) {
				uint256 index = IPrngGenerator(prngGenerator).getPseudorandomNumber(0, metadata.length - 1, m);
				string memory chosen = metadata[index];
				// swap the chosen element with the last element
				metadata[index] = metadata[metadata.length - 1];
				metadataForMint[m] = bytes(string.concat(cid, chosen));
				// pop discarding the element used up
				metadata.pop();
			}
		}
	}

    function resetContract(
        EnumerableMap.AddressToUintMap storage addressToNumMintedMap,
        string[] storage metadata,
        EnumerableMap.AddressToUintMap storage walletMintTimeMap,
        EnumerableMap.AddressToUintMap storage wlAddressToNumMintedMap,
        EnumerableMap.UintToUintMap storage serialMintTimeMap,
        EnumerableSet.UintSet storage wlSerialsUsed,
		uint batch
        ) 
        public {

		uint size = addressToNumMintedMap.length();
		size = size > batch ? batch : size; 
		for (uint a = size; a > 0; a--) {
			(address key, ) = addressToNumMintedMap.at(a - 1);
			addressToNumMintedMap.remove(key);
		}
		size = metadata.length;
		size = size > batch ? batch : size; 
		for (uint a = size; a > 0; a--) {
			metadata.pop();
		}
		size = walletMintTimeMap.length();
		size = size > batch ? batch : size; 
		for (uint a = size; a > 0; a--) {
			(address key, ) = walletMintTimeMap.at(a - 1);
			walletMintTimeMap.remove(key);
		}
		size = wlAddressToNumMintedMap.length();
		size = size > batch ? batch : size; 
		for (uint a = size; a > 0; a--) {
			(address key, ) = wlAddressToNumMintedMap.at(a - 1);
			wlAddressToNumMintedMap.remove(key);
		}
		size = serialMintTimeMap.length();
		size = size > batch ? batch : size; 
		for (uint a = size; a > 0; a--) {
			(uint key, ) = serialMintTimeMap.at(a - 1);
			serialMintTimeMap.remove(key);
		}
		size = wlSerialsUsed.length();
		size = size > batch ? batch : size; 
		for (uint a = size; a > 0; a--) {
			uint key = wlSerialsUsed.at(a - 1);
			wlSerialsUsed.remove(key);
		}

	}

}