// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

library MinterLibrary {
    using EnumerableMap for EnumerableMap.AddressToUintMap;
	using EnumerableMap for EnumerableMap.UintToUintMap;
	using EnumerableSet for EnumerableSet.UintSet;

    function checkWhitelistConditions(
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap,
        uint256 maxWlAddressMint
    ) internal view returns (bool allowedToMint) {
		(bool found, uint256 qty) = whitelistedAddressQtyMap.tryGet(msg.sender);
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

    function clearWhitelist(EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap) internal returns(uint256 numAddressesRemoved) {
		numAddressesRemoved = whitelistedAddressQtyMap.length();
		for (uint256 a = numAddressesRemoved; a > 0; ) {
			(address key, ) = whitelistedAddressQtyMap.at(a - 1);
			whitelistedAddressQtyMap.remove(key);
			unchecked {
				--a;
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
		uint256 batch
        ) 
        internal {

		uint256 size = addressToNumMintedMap.length();
		size = size > batch ? batch : size; 
		for (uint256 a = size; a > 0; ) {
			(address key, ) = addressToNumMintedMap.at(a - 1);
			addressToNumMintedMap.remove(key);
			unchecked {
				--a;
			}
		}
		size = metadata.length;
		size = size > batch ? batch : size; 
		for (uint256 a = size; a > 0; ) {
			metadata.pop();
			unchecked {
				--a;
			}
		}
		size = walletMintTimeMap.length();
		size = size > batch ? batch : size; 
		for (uint256 a = size; a > 0; ) {
			(address key, ) = walletMintTimeMap.at(a - 1);
			walletMintTimeMap.remove(key);
			unchecked {
				--a;
			}
		}
		size = wlAddressToNumMintedMap.length();
		size = size > batch ? batch : size; 
		for (uint256 a = size; a > 0; ) {
			(address key, ) = wlAddressToNumMintedMap.at(a - 1);
			wlAddressToNumMintedMap.remove(key);
			unchecked {
				--a;
			}
		}
		size = serialMintTimeMap.length();
		size = size > batch ? batch : size; 
		for (uint256 a = size; a > 0; ) {
			(uint256 key, ) = serialMintTimeMap.at(a - 1);
			serialMintTimeMap.remove(key);
			unchecked {
				--a;
			}
		}
		size = wlSerialsUsed.length();
		size = size > batch ? batch : size; 
		for (uint256 a = size; a > 0; ) {
			uint256 key = wlSerialsUsed.at(a - 1);
			wlSerialsUsed.remove(key);
			unchecked {
				--a;
			}
		}

	}

}