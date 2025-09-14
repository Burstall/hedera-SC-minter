// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IHederaTokenService} from "./IHederaTokenServiceV2.sol";
import {IPrngGenerator} from "./IPrngGenerator.sol";

library MinterLibraryV2 {
    using EnumerableMap for EnumerableMap.AddressToUintMap;
    using EnumerableMap for EnumerableMap.UintToUintMap;
    using EnumerableSet for EnumerableSet.UintSet;

    uint256 internal constant ONE = uint256(1);

    event MinterLibraryContractMessage(
        address indexed _caller,
        ContractEventType _eventType,
        address indexed _msgAddress,
        uint256 _msgNumeric
    );

    enum ContractEventType {
        INITIALISE,
        REFUND,
        PAUSE,
        UNPAUSE,
        LAZY_PMT,
        WL_PURCHASE_TOKEN,
        WL_PURCHASE_LAZY,
        WL_ADD,
        WL_REMOVE,
        RESET_CONTRACT,
        RESET_INC_TOKEN,
        UPDATE_WL_TOKEN,
        UPDATE_WL_LAZY_BUY,
        UPDATE_WL_ONLY,
        UPDATE_WL_MAX,
        UPDATE_WL_DISCOUNT,
        UPDATE_MAX_MINT,
        UPDATE_MAX_WALLET_MINT,
        UPDATE_COOLDOWN,
        UPDATE_MINT_PRICE,
        UPDATE_MINT_PRICE_LAZY,
        UPDATE_LAZY_BURN_PERCENTAGE,
        UPDATE_LAZY_FROM_CONTRACT,
        UPDATE_CID,
        UPDATE_MINT_START_TIME,
        UPDATE_REFUND_WINDOW,
        REVOKE_SBT,
        AIRDROP
    }

    enum KeyType {
        ADMIN,
        KYC,
        FREEZE,
        WIPE,
        SUPPLY,
        FEE,
        PAUSE,
        METADATA
    }

    error BadArguments();
    error NoWLToken();
    error WLTokenUsed();
    error NotTokenOwner();

    function selectMetdataToMint(
        string[] storage metadata,
        uint256 numberToMint,
        string storage cid,
        address prngGenerator
    ) public returns (bytes[] memory metadataForMint) {
        // size the return array
        metadataForMint = new bytes[](numberToMint);

        if (prngGenerator == address(0)) {
            for (uint256 m = 0; m < numberToMint; m++) {
                metadataForMint[m] = bytes(
                    string.concat(cid, metadata[metadata.length - 1])
                );
                // pop discarding the element used up
                metadata.pop();
            }
        } else {
            for (uint256 m = 0; m < numberToMint; ) {
                // if only 1 item left, no need to generate random number
                if (metadata.length == 1) {
                    metadataForMint[m] = bytes(string.concat(cid, metadata[0]));
                    metadata.pop();
                    // should only be here on the last iteration anyway
                    break;
                } else {
                    uint256 index = IPrngGenerator(prngGenerator)
                        .getPseudorandomNumber(0, metadata.length - 1, m);
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

    function removeFromWhitelist(
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap,
        address[] memory _oldAddresses
    ) public {
        uint256 _length = _oldAddresses.length;
        for (uint256 a = 0; a < _length; ) {
            bool result = whitelistedAddressQtyMap.remove(_oldAddresses[a]);
            emit MinterLibraryContractMessage(
                msg.sender,
                ContractEventType.WL_REMOVE,
                _oldAddresses[a],
                result ? 1 : 0
            );

            unchecked {
                ++a;
            }
        }
    }

    function addToWhitelist(
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap,
        address[] memory _newAddresses,
        uint256 maxWlAddressMint
    ) public {
        uint256 _length = _newAddresses.length;
        for (uint256 a = 0; a < _length; ) {
            bool result = whitelistedAddressQtyMap.set(
                _newAddresses[a],
                maxWlAddressMint
            );
            emit MinterLibraryContractMessage(
                msg.sender,
                ContractEventType.WL_ADD,
                _newAddresses[a],
                result ? 1 : 0
            );

            unchecked {
                ++a;
            }
        }
    }

    function getSBTContractMintKey(
        bool _revocable,
        address _contract
    ) public pure returns (IHederaTokenService.TokenKey[] memory keys) {
        uint256 n = _revocable ? 3 : 2; // SUPPLY, FREEZE, (+ WIPE if revocable)
        keys = new IHederaTokenService.TokenKey[](n);

        keys[0] = _singleContractKey(KeyType.SUPPLY, _contract);
        keys[1] = _singleContractKey(KeyType.FREEZE, _contract);

        if (_revocable) {
            keys[2] = _singleContractKey(KeyType.WIPE, _contract);
        }
    }

    function _getKeyType(KeyType keyType) internal pure returns (uint256 ktId) {
        if (keyType == KeyType.ADMIN) {
            ktId = 1;
        } else if (keyType == KeyType.KYC) {
            ktId = 2;
        } else if (keyType == KeyType.FREEZE) {
            ktId = 4;
        } else if (keyType == KeyType.WIPE) {
            ktId = 8;
        } else if (keyType == KeyType.SUPPLY) {
            ktId = 16;
        } else if (keyType == KeyType.FEE) {
            ktId = 32;
        } else if (keyType == KeyType.PAUSE) {
            ktId = 64;
        } else if (keyType == KeyType.METADATA) {
            ktId = 128;
        } else {
            revert BadArguments();
        }
    }

    /// Build a single-bit TokenKey bound to the contract.
    function _singleContractKey(
        KeyType kt,
        address _contract
    ) internal pure returns (IHederaTokenService.TokenKey memory k) {
        IHederaTokenService.KeyValue memory kv;
        kv.contractId = _contract;

        k = IHederaTokenService.TokenKey({keyType: _getKeyType(kt), key: kv});
    }

    function setBit(uint256 self, uint8 index) internal pure returns (uint256) {
        return self | (ONE << index);
    }

    function buyWlWithTokens(
        uint256[] memory _serials,
        address _wlToken,
        uint256 _maxWlAddressMint,
        EnumerableMap.AddressToUintMap storage whitelistedAddressQtyMap,
        EnumerableSet.UintSet storage wlSerialsUsed
    ) public returns (uint256 _wlSpotsPurchased) {
        if (_wlToken == address(0)) revert NoWLToken();

        for (uint8 i = 0; i < _serials.length; i++) {
            // check no double dipping
            if (wlSerialsUsed.contains(_serials[i])) revert WLTokenUsed();
            // check user owns the token
            if (IERC721(_wlToken).ownerOf(_serials[i]) != msg.sender)
                revert NotTokenOwner();
            wlSerialsUsed.add(_serials[i]);
            emit MinterLibraryContractMessage(
                msg.sender,
                ContractEventType.WL_PURCHASE_TOKEN,
                tx.origin,
                _serials[i]
            );
        }

        _wlSpotsPurchased = whitelistedAddressQtyMap.contains(msg.sender)
            ? whitelistedAddressQtyMap.get(msg.sender) +
                (_maxWlAddressMint * _serials.length)
            : (_maxWlAddressMint * _serials.length);
        whitelistedAddressQtyMap.set(msg.sender, _wlSpotsPurchased);
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
        for (uint256 a = 0; a < batchSize; ) {
            (wlWalletList[a], wlNumMintedList[a]) = wlAddressToNumMintedMap.at(
                a + offset
            );
            unchecked {
                ++a;
            }
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
