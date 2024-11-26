// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import { EnumerableMap } from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IPrngGenerator } from "./IPrngGenerator.sol";

library MinterLibrary {
    using EnumerableMap for EnumerableMap.AddressToUintMap;
    using EnumerableMap for EnumerableMap.UintToUintMap;
    using EnumerableSet for EnumerableSet.UintSet;

    error BadArguments();

	function selectMetdataToMint(
		string[] storage metadata, 
		uint256 numberToMint, 
		string storage cid,
		address prngGenerator
		) 
		public returns (bytes[] memory metadataForMint) {
		// size the return array
		metadataForMint = new bytes[](numberToMint);

		if (prngGenerator == address(0)) {
			for (uint256 m = 0; m < numberToMint; m++) {
				metadataForMint[m] = bytes(string.concat(cid, metadata[metadata.length - 1]));
				// pop discarding the element used up
				metadata.pop();
			}
		}
		else {
			for (uint256 m = 0; m < numberToMint; ) {
				// if only 1 item left, no need to generate random number
				if (metadata.length == 1) {
					metadataForMint[m] = bytes(string.concat(cid, metadata[0]));
					metadata.pop();
					// should only be here on the last iteration anyway
					break;
				}
				else {
					uint256 index = IPrngGenerator(prngGenerator).getPseudorandomNumber(0, metadata.length - 1, m);
					string memory chosen = metadata[index];
					// swap the chosen element with the last element
					metadata[index] = metadata[metadata.length - 1];
					metadataForMint[m] = bytes(string.concat(cid, chosen));
					// pop discarding the element used up
					metadata.pop();
				}

				unchecked {
					++m;
				}
			}
		}
	}

    function getNumberMintedByAllWlAddressesBatch(
        EnumerableMap.AddressToUintMap storage wlAddressToNumMintedMap,
        uint256 offset,
        uint256 batchSize
    )
        public
        view
        returns (
            address[] memory wlWalletList,
            uint256[] memory wlNumMintedList
        )
    {
        if ((offset + batchSize) > wlAddressToNumMintedMap.length())
            revert BadArguments();
        wlWalletList = new address[](batchSize);
        wlNumMintedList = new uint256[](batchSize);
        for (uint256 a = 0; a < batchSize; a++) {
            (wlWalletList[a], wlNumMintedList[a]) = wlAddressToNumMintedMap.at(
                a + offset
            );
        }
    }

    function checkWhitelistConditions(
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap,
        address _user,
        uint256 maxWlAddressMint
    ) public view returns (bool allowedToMint) {
        (bool found, uint256 qty) = whitelistedAddressQtyMap.tryGet(_user);
        if (found) {
            if (maxWlAddressMint > 0) {
                allowedToMint = qty > 0 ? true : false;
            } else {
                allowedToMint = true;
            }
        } else {
            allowedToMint = false;
        }
    }

    function clearWhitelist(
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap
    ) public returns (uint256 numAddressesRemoved) {
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
    ) public returns (uint256 remainingItems) {
        uint256 size = addressToNumMintedMap.length();
		if (size > batch) {
			remainingItems = size - batch;
			size = batch;
		}

        for (uint256 a = size; a > 0; ) {
            (address key, ) = addressToNumMintedMap.at(a - 1);
            addressToNumMintedMap.remove(key);
            unchecked {
                --a;
            }
        }
        size = metadata.length;
        size = size > batch ? batch : size;
		if (size > batch) {
			remainingItems = Math.max(remainingItems, size - batch);
			size = batch;
		}
		
        for (uint256 a = size; a > 0; ) {
            metadata.pop();
            unchecked {
                --a;
            }
        }
        size = walletMintTimeMap.length();
        if (size > batch) {
			remainingItems = Math.max(remainingItems, size - batch);
			size = batch;
		}
        for (uint256 a = size; a > 0; ) {
            (address key, ) = walletMintTimeMap.at(a - 1);
            walletMintTimeMap.remove(key);
            unchecked {
                --a;
            }
        }
        size = wlAddressToNumMintedMap.length();
        if (size > batch) {
			remainingItems = Math.max(remainingItems, size - batch);
			size = batch;
		}
        for (uint256 a = size; a > 0; ) {
            (address key, ) = wlAddressToNumMintedMap.at(a - 1);
            wlAddressToNumMintedMap.remove(key);
            unchecked {
                --a;
            }
        }
        size = serialMintTimeMap.length();
        if (size > batch) {
			remainingItems = Math.max(remainingItems, size - batch);
			size = batch;
		}
        for (uint256 a = size; a > 0; ) {
            (uint256 key, ) = serialMintTimeMap.at(a - 1);
            serialMintTimeMap.remove(key);
            unchecked {
                --a;
            }
        }
        size = wlSerialsUsed.length();
        if (size > batch) {
			remainingItems = Math.max(remainingItems, size - batch);
			size = batch;
		}
        for (uint256 a = size; a > 0; ) {
            uint256 key = wlSerialsUsed.at(a - 1);
            wlSerialsUsed.remove(key);
            unchecked {
                --a;
            }
        }
    }
}
