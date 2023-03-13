// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

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

    function checkWhitelistConditions(
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap,
        uint maxWlAddressMint
    ) internal view returns (bool allowedToMint) {
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

    function clearWhitelist(EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap) internal returns(uint numAddressesRemoved) {
		numAddressesRemoved = whitelistedAddressQtyMap.length();
		for (uint a = numAddressesRemoved; a > 0; a--) {
			(address key, ) = whitelistedAddressQtyMap.at(a - 1);
			whitelistedAddressQtyMap.remove(key);
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
        internal {

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