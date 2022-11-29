// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

library MinterLibrary {
    using EnumerableMap for EnumerableMap.AddressToUintMap;
	using EnumerableMap for EnumerableMap.UintToUintMap;
	using EnumerableSet for EnumerableSet.UintSet;

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
        EnumerableSet.UintSet storage wlSerialsUsed
        ) 
        internal {

		uint size = addressToNumMintedMap.length();
		for (uint a = size; a > 0; a--) {
			(address key, ) = addressToNumMintedMap.at(a - 1);
			addressToNumMintedMap.remove(key);
		}
		size = metadata.length;
		for (uint a = size; a > 0; a--) {
			metadata.pop();
		}
		size = walletMintTimeMap.length();
		for (uint a = size; a > 0; a--) {
			(address key, ) = walletMintTimeMap.at(a - 1);
			walletMintTimeMap.remove(key);
		}
		size = wlAddressToNumMintedMap.length();
		for (uint a = size; a > 0; a--) {
			(address key, ) = wlAddressToNumMintedMap.at(a - 1);
			wlAddressToNumMintedMap.remove(key);
		}
		size = serialMintTimeMap.length();
		for (uint a = size; a > 0; a--) {
			(uint key, ) = serialMintTimeMap.at(a - 1);
			serialMintTimeMap.remove(key);
		}
		size = wlSerialsUsed.length();
		for (uint a = size; a > 0; a--) {
			uint key = wlSerialsUsed.at(a - 1);
			wlSerialsUsed.remove(key);
		}

	}

}