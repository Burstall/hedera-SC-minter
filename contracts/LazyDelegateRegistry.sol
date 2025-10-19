// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

contract LazyDelegateRegistry is ILazyDelegateRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;
	using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableMap for EnumerableMap.UintToAddressMap;
    using EnumerableMap for EnumerableMap.AddressToUintMap;

    // wallet => delegate
    mapping(address => address) private delegateWallet;
    // wallet => EnumerableSet.AddressSet
    // to allow a wallet to look up all the wallets that have delegated to it
    mapping(address => EnumerableSet.AddressSet) private delegatedTo;
    // token -> serial -> delegate
    mapping(address => EnumerableMap.UintToAddressMap) private delegatedNFT;
    // delegate wallet => token set
    // allows O(1) lookup of all tokens delegated to a wallet
    mapping(address => EnumerableSet.AddressSet)
        private delegateWalletToTokenSetMap;
    // owner wallet => token set
    // allows O(1) lookup of all tokens delegated by a wallet
    mapping(address => EnumerableSet.AddressSet)
        private walletToTokenDelegations;

	// map the has of Wallet/Token -> List of serials delegated
	mapping(bytes32 => EnumerableSet.UintSet) private delegatedNFTSerialsByHash;
	// map of token/serial hash to owner
	mapping(bytes32 => address) private delegatedNFTSerialsOwnerByHash;

	// enumerable sets to track the tokens and wallets with delegates
    EnumerableSet.AddressSet private walletsWithDelegates;
    EnumerableSet.AddressSet private tokensWithDelegates;

    uint256 public totalSerialsDelegated;

	/**
	 * @dev delegate a wallet to act on behalf of callers wallet
	 * Only one delegate per wallet is allowed
	 * @param _delegate the address of the wallet to delegate to
	 */
    function delegateWalletTo(address _delegate) external {
        delegateWallet[msg.sender] = _delegate;
        delegatedTo[_delegate].add(msg.sender);
        walletsWithDelegates.add(msg.sender);

        emit WalletDelegated(msg.sender, _delegate, true);
    }

	/**
	 * @dev revoke the delegation of a wallet
	 */
    function revokeDelegateWallet() external {
        address currentDelegate = delegateWallet[msg.sender];
        delete delegateWallet[msg.sender];
        if (currentDelegate != address(0)) {
            delegatedTo[currentDelegate].remove(msg.sender);
            walletsWithDelegates.remove(msg.sender);
            emit WalletDelegated(msg.sender, currentDelegate, false);
        }
    }

	/**
	 * @dev delegate serials of a token to a wallet
	 * @param _delegate the address of the wallet to delegate to
	 * @param _token the address of the NFT contract
	 * @param _serials an array of serial numbers to delegate
	 */
	function delegateNFT(
        address _delegate,
        address _token,
        uint256[] memory _serials
    ) public {
		// add the token to the list of tokens with delegates
		// returns false if the token is already in the list but we do not care
		tokensWithDelegates.add(_token);
		walletToTokenDelegations[msg.sender].add(_token);
		delegateWalletToTokenSetMap[_delegate].add(_token);
		bytes32 delegateTokenHash = keccak256(abi.encodePacked(_delegate, _token));
		bytes32 ownerTokenHash = keccak256(abi.encodePacked(msg.sender, _token));
		uint256 serialLength = _serials.length;
		for (uint256 i = 0; i < serialLength;) {
			uint256 _serial = _serials[i];
			address currentOwner = IERC721(_token).ownerOf(_serial);
			if (currentOwner != msg.sender) {
				revert LazyDelegateRegistryOnlyOwner(currentOwner, msg.sender);
			}
			// bytes32 tokenSerialHash = keccak256(abi.encodePacked(_token, _serial));

			// // this is the point where we need to check if the delegate is already set
			// (bool exists, address delegateTokenController) = delegatedNFT[_token]
			// 	.tryGet(_serial);
			// if (exists && delegateTokenController != address(0)) {
			// 	// find who delegated the token
			// 	address currentDelegator = delegatedNFTSerialsOwnerByHash[tokenSerialHash];
			// 	// remove the serial from the list for currentDelegator
			// 	bytes32 currentDelegatorTokenHash = keccak256(abi.encodePacked(currentDelegator, _token));
			// 	delegatedNFTSerialsByHash[currentDelegatorTokenHash].remove(_serial);
			// 	// and clean up entry if it was the last one
			// 	if (delegatedNFTSerialsByHash[currentDelegatorTokenHash].length() == 0) {
			// 		// tidy up the address set
			// 		walletToTokenDelegations[currentDelegator].remove(_token);
			// 	}

			// 	// unwind the delegate
			// 	bytes32 currentDelegateTokenHash = keccak256(abi.encodePacked(delegateTokenController, _token));
				
			// 	// remove the serial from the list of serials delegated to the delegate
			// 	delegatedNFTSerialsByHash[currentDelegateTokenHash].remove(_serial);
			// 	// and clean up entry if it was the last one
			// 	if (delegatedNFTSerialsByHash[currentDelegateTokenHash].length() == 0) {
			// 		// tidy up the address set
			// 		delegateWalletToTokenSetMap[delegateTokenController].remove(_token);
			// 	}

			// 	// post the world the delegation has been removed
			// 	emit TokenDelegated(_token, _serial, delegateTokenController, currentOwner, false);
			// }

			// remove the old delnpegation if it exists
			bool removed = _revokeDelegateNFT(ownerTokenHash, currentOwner, _token, _serial, false);
			if (!removed) {
				// if we failed to clean up then this is a fresh delegation
				totalSerialsDelegated++;
				// need to set the delegator of the token/serial
				bytes32 tokenSerialHash = keccak256(abi.encodePacked(_token, _serial));
				delegatedNFTSerialsOwnerByHash[tokenSerialHash] = currentOwner;
			}

			// add the serial to the list of serials delegated by the owner
			// is the token/serial has moved to a new owner then the delegation is no longer valid
			// so we need to add here knowing it just costs gas and will not revert even if present
			delegatedNFTSerialsByHash[ownerTokenHash].add(_serial);

			delegatedNFT[_token].set(_serial, _delegate);
			
			// add the serial to the list of serials delegated
			delegatedNFTSerialsByHash[delegateTokenHash].add(_serial);

			emit TokenDelegated(_token, _serial, _delegate, currentOwner, true);

			unchecked { ++i; }
		}
    }


	/**
	 * Only the owner can revoke their delegation. If no record of delegation exists
	 * then it will complete silently as nothing to clean up.
	 * @dev revoke the delegation of a token
	 * @param _token the address of the NFT contract
	 * @param _serials an array of serial numbers to revoke
	 */
    function revokeDelegateNFT(address _token, uint256[] memory _serials) public {
		bytes32 ownerTokenHash = keccak256(abi.encodePacked(msg.sender, _token));
		for (uint256 i = 0; i < _serials.length;) {
			uint256 serial = _serials[i];
			address currentOwner = IERC721(_token).ownerOf(serial);
			if (currentOwner != msg.sender) {
				revert LazyDelegateRegistryOnlyOwner(currentOwner, msg.sender);
			}
			
			_revokeDelegateNFT(ownerTokenHash, currentOwner, _token, serial, true);

			unchecked { ++i; }
		}
    }

	/**
	 * @dev helper function to handle the revocation of a delegation for many tokens/serials
	 * @param _tokens an array of NFT contract addresses
	 * @param _serials an array of arrays of serial numbers
	 */
    function revokeDelegateNFTs(
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external {
        for (uint256 i = 0; i < _tokens.length; i++) {
            revokeDelegateNFT(_tokens[i], _serials[i]);
        }
    }

		/**
	 * @dev internal logic to centralize revokation of the delegation of an NFT token
	 * given used when adding to unwind old delegations as well as explcit revocation
	 * @param _ownerTokenHash the hash of the owner and token
	 * @param _currentOwner the current owner of the NFT
	 * @param _token the address of the NFT
	 * @param _serial the serial number of the NFT
	 * @param _fullRemoval if true then purge as full removal else just tidy up
	 * @return _removed true if the delegation was removed
	 */
	function _revokeDelegateNFT(bytes32 _ownerTokenHash, address _currentOwner, address _token, uint256 _serial, bool _fullRemoval) internal returns (bool _removed) {
		// get current delegate
		(bool found, address currentDelegate) = delegatedNFT[_token].tryGet(_serial);

		// check if there is a delegate
		// if so and no more instances of this token delegated to the delegate
		// then delete the delegate listing
		if (found && currentDelegate != address(0)) {
			bytes32 tokenSerialHash = keccak256(abi.encodePacked(_token, _serial));

			// find if we might have a hanging delegator
			address currentDelegator = delegatedNFTSerialsOwnerByHash[tokenSerialHash];
			bytes32 currentDelegatorTokenHash = keccak256(abi.encodePacked(currentDelegator, _token));

			// no point removing the serial as we are about to add it back
			if (_fullRemoval) {
				// decrement global counter only on full removal
				totalSerialsDelegated--;

				delegatedNFT[_token].remove(_serial);
				// check if there are any more serials of this token delegated
				if (delegatedNFT[_token].length() == 0) {
					// tidy up the address set
					tokensWithDelegates.remove(_token);
				}
				delegatedNFTSerialsOwnerByHash[tokenSerialHash] = address(0);

				delegatedNFTSerialsByHash[_ownerTokenHash].remove(_serial);

				if (delegatedNFTSerialsByHash[_ownerTokenHash].length() == 0) {
					// tidy up the address set
					walletToTokenDelegations[_currentOwner].remove(_token);
				}
			}
			else {
				delegatedNFTSerialsOwnerByHash[tokenSerialHash] = _currentOwner;
			}

			// unwind existing delegation
			bytes32 delegateTokenHash = keccak256(abi.encodePacked(currentDelegate, _token));
				delegatedNFTSerialsByHash[delegateTokenHash].remove(_serial);

			// check if the mapping has length = 0
			// if so then remove the mapping else just delete the serial
			if (delegatedNFTSerialsByHash[delegateTokenHash].length() == 0) {
				// tidy up the address set
				delegateWalletToTokenSetMap[currentDelegate].remove(_token);
			}

			// if we are doing a full removal then we need to tidy up the delegator
			// or if the delegator has changed
			if (_fullRemoval || currentDelegator != _currentOwner) {
				delegatedNFTSerialsByHash[currentDelegatorTokenHash].remove(_serial);
				if (delegatedNFTSerialsByHash[currentDelegatorTokenHash].length() == 0) {
					// tidy up the address set
					walletToTokenDelegations[currentDelegator].remove(_token);
				}
			}

			emit TokenDelegated(
				_token,
				_serial,
				currentDelegate,
				currentDelegator,
				false
			);
			return true;
		}
		return false;
	}

	/**
	 * @dev helper function to batch delegate NFTs
	 * @param _delegate the address of the wallet to delegate to
	 * @param _tokens an array of NFT contract addresses
	 * @param _serials an array of arrays of serial numbers to delegate
	 */
    function delegateNFTs(
        address _delegate,
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external {
		if (_tokens.length != _serials.length) {
			revert BadArgumentLength(_tokens.length, _serials.length);
		}
		uint256 tokenLength = _tokens.length;
        for (uint256 i = 0; i < tokenLength;) {
            delegateNFT(_delegate, _tokens[i], _serials[i]);
			unchecked { ++i; }
        }
    }

	/**
	 * @dev get the current delegate of a wallet
	 * @param _wallet the address of the wallet to check
	 * @return delegate the address of the delegate wallet (or address(0) if not delegated
	 */
    function getDelegateWallet(
        address _wallet
    ) external view returns (address delegate) {
        return delegateWallet[_wallet];
    }

	/**
	 * @dev check if a proposed delegate can act on behalf of a wallet
	 * @param _actualWallet the address of the wallet to check
	 * @param _proposedDelegate the address of the proposed delegate
	 * @return true if the wallet is delegated to the proposed delegate
	 */
    function checkDelegateWallet(
        address _actualWallet,
        address _proposedDelegate
    ) external view returns (bool) {
        return delegateWallet[_actualWallet] == _proposedDelegate;
    }

	/**
	 * @dev check if a token has been delegated to a proposed wallet
	 * @param _proposedDelegate the address of the proposed delegate
	 * @param _token the address of the NFT contract
	 * @param _serial the serial number of the NFT
	 * @return true if the token has been delegated to the proposed delegate
	 */
    function checkDelegateToken(
        address _proposedDelegate,
        address _token,
        uint256 _serial
    ) external view returns (bool) {
        address currentOwner = IERC721(_token).ownerOf(_serial);
        // check if the wallet is delegated
        address delegate = delegateWallet[currentOwner];
        // check iif we have a delegate
        (bool exists, address delegateTokenController) = delegatedNFT[_token]
            .tryGet(_serial);
		// check if the delegation is still valid
        if (!exists || !checkNFTDelegationIsValid(_token, _serial)) {
            delegateTokenController = address(0);
        }
        // heirarchy:
		// 1. currentOwner
		// 2. delegateWallet
		// 3. delegateTokenController
        return
            currentOwner == _proposedDelegate ||
			delegate == _proposedDelegate ||
			delegateTokenController == _proposedDelegate;
    }

	/**
	 * @dev check which wallets have been designated to a given address
	 * @param _delegateWallet the address of the delegate wallet
	 * @return wallets an array of wallet addresses
	 */
    function getWalletsDelegatedTo(
        address _delegateWallet
    ) external view returns (address[] memory) {
        return delegatedTo[_delegateWallet].values();
    }

	/**
	 * @dev get the delegate address of a token/serial pair
	 * @param _token the address of the NFT contract
	 * @param _serial the serial number of the NFT
	 * @return wallet the address of the delegate wallet or address(0) if not delegated
	 */
    function getNFTDelegatedTo(
        address _token,
        uint256 _serial
    ) external view returns (address wallet) {
        bool exists;
        (exists, wallet) = delegatedNFT[_token].tryGet(_serial);
        if (!exists) {
            return address(0);
        }
    }

	/**
	 * @dev helper function to batch get the delegate address of a list of NFTs
	 * @param _tokens an array of NFT contract addresses
	 * @param _serials an array of arrays of serial numbers
	 * @return delegateList an array of arrays of delegate addresses
	 */
    function getNFTListDelegatedTo(
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external view returns (address[][] memory delegateList) {
        delegateList = new address[][](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            delegateList[i] = new address[](_serials[i].length);
            for (uint256 j = 0; j < _serials[i].length; j++) {
                (bool found, address delegate) = delegatedNFT[_tokens[i]]
                    .tryGet(_serials[i][j]);
                if (!found) {
                    delegate = address(0);
                } else {
                    delegateList[i][j] = delegate;
                }
            }
        }
    }

	/**
	 * @dev check if the delegation is still valid. If a user transfers the NFT serial to a new wallet
	 * then the delegation is no longer valid. This function will return false if the delegation is no longer valid.
	 * The delegation will show but be stale however the contract will not auhorize the delegate to act on the NFT.
	 * @param _token the address of the NFT contract
	 */
	function checkNFTDelegationIsValid(
		address _token,
		uint256 _serial
	) public view returns (bool) {
		address currentOwner = IERC721(_token).ownerOf(_serial);
		
		// calculate the hash of the token and serial
		bytes32 tokenSerialHash = keccak256(abi.encodePacked(_token, _serial));
		// check if the owner that delegated the token
		// is still the owner of the token
		return delegatedNFTSerialsOwnerByHash[tokenSerialHash] == currentOwner;
	}

	/**
	 * @dev check if the delegation is still valid. Batched helper function to
	 * reduce number of calls to the mirror nodes
	 */
	function checkNFTDelegationIsValidBatch(
		address[] memory _tokens,
		uint256[][] memory _serials
	) external view returns (bool[][] memory valid) {
		// create an array of arrays to match the size of the _serials array
		valid = new bool[][](_tokens.length);
		for (uint256 i = 0; i < _tokens.length; i++) {
			valid[i] = new bool[](_serials[i].length);
			for (uint256 j = 0; j < _serials[i].length; j++) {
				valid[i][j] = checkNFTDelegationIsValid(_tokens[i], _serials[i][j]);
			}
		}
	}

	/**
	 * @dev get the tokens/serials delegated to a wallet
	 * @param _delegate the address of the delegate wallet
	 * @return tokens an array of NFT contract addresses
	 * @return serials an array of arrays of serial numbers
	 */
    function getNFTsDelegatedTo(
        address _delegate
    )
        external
        view
        returns (address[] memory tokens, uint256[][] memory serials)
    {
        tokens = delegateWalletToTokenSetMap[_delegate].values();
        serials = new uint256[][](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
			bytes32 delegateTokenHash = keccak256(abi.encodePacked(_delegate, tokens[i]));
			serials[i] = delegatedNFTSerialsByHash[delegateTokenHash].values();
        }
    }

	/**
	 * @dev get the tokens/serials delegated by a wallet
	 * @param _ownerWallet the address of the wallet
	 * @param _includeSerials if true then return the serials for each token
	 * @return tokens an array of NFT contract addresses
	 * @return serials an array of arrays of serial numbers (if requested)
	 */
    function getDelegatedNFTsBy(
        address _ownerWallet,
        bool _includeSerials
    )
        external
        view
        returns (address[] memory tokens, uint256[][] memory serials)
    {
        tokens = walletToTokenDelegations[_ownerWallet].values();
        if (_includeSerials) {
            serials = new uint256[][](tokens.length);
            for (uint256 i = 0; i < tokens.length; i++) {
				bytes32 ownerTokenHash = keccak256(abi.encodePacked(_ownerWallet, tokens[i]));
				serials[i] = delegatedNFTSerialsByHash[ownerTokenHash].values();
            }
        } else {
            serials = new uint256[][](0);
        }
    }

	/**
	 * @dev get the serials delegated to a delegate wallet
	 * @param _delegate the address of the delegate wallet
	 * @param _token the address of the NFT contract
	 * @return serials an array of serial numbers
	 */
    function getSerialsDelegatedTo(
        address _delegate,
        address _token
    ) external view returns (uint256[] memory serials) {
        if (!delegateWalletToTokenSetMap[_delegate].contains(_token)) {
            return new uint256[](0);
        }

		bytes32 delegateTokenHash = keccak256(abi.encodePacked(_delegate, _token));

        return
            getSerialsDelegatedToRange(
                _delegate,
                _token,
                0,
                delegatedNFTSerialsByHash[delegateTokenHash].length()
            );
    }

	/**
	 * @dev get the serials delegated to a delegate wallet based on a range in case the list is too long
	 * @param _delegate the address of the delegate wallet§
	 * @param _token the address of the NFT contract
	 * @param _offset the start of the range
	 * @param _limit the number of items to return
	 * @return serials an array of serial numbers
	 */
    function getSerialsDelegatedToRange(
        address _delegate,
        address _token,
        uint256 _offset,
        uint256 _limit
    ) public view returns (uint256[] memory serials) {
        serials = new uint256[](_limit);
		// get the serial list for the delegate and token
		uint256[] memory delegateTokenSerials = delegatedNFTSerialsByHash[keccak256(abi.encodePacked(_delegate, _token))].values();
		require(_offset + _limit <= delegateTokenSerials.length, "LDR: Range OOB");
		// fill serials array based on offset and limit
		for (uint256 j = _offset; j < _offset + _limit; j++) {
			serials[j] = delegateTokenSerials[j];
		}
    }

	/**
	 * @dev get the serials delegated by a wallet
	 * @param _ownerWallet the address of the wallet
	 * @param _token the address of the NFT contract
	 * @return serials an array of serial numbers
	 */
    function getSerialsDelegatedBy(
        address _ownerWallet,
        address _token
    ) external view returns (uint256[] memory serials) {
        if (!walletToTokenDelegations[_ownerWallet].contains(_token)) {
            return new uint256[](0);
        }

		bytes32 ownerDelegateHash = keccak256(abi.encodePacked(_ownerWallet, _token));

        return
            getSerialsDelegatedByRange(
                _ownerWallet,
                _token,
                0,
                delegatedNFTSerialsByHash[ownerDelegateHash].length()
            );
    }

	/**
	 * @dev get the serials delegated by a wallet based on a range in case the list is too long
	 * @param _ownerWallet the address of the wallet
	 * @param _token the address of the NFT contract
	 * @param _offset the start of the range
	 * @param _limit the number of items to return
	 * @return serials an array of serial numbers
	 */
    function getSerialsDelegatedByRange(
        address _ownerWallet,
        address _token,
        uint256 _offset,
        uint256 _limit
    ) public view returns (uint256[] memory serials) {
        serials = new uint256[](_limit);
		// get the serial list for the delegate and token
		uint256[] memory ownerDelegateSerials = delegatedNFTSerialsByHash[keccak256(abi.encodePacked(_ownerWallet, _token))].values();
		require(_offset + _limit <= ownerDelegateSerials.length, "LDR: Range OOB");
		// fill serials array based on offset and limit
		for (uint256 j = 0; j < _limit; j++) {
			serials[j] = ownerDelegateSerials[_offset + j];
		}
    }

	/**
	 * @dev get the list of tokens with delegates
	 * @return addresses an array of token addresses
	 */
    function getTokensWithDelegates() external view returns (address[] memory) {
        return tokensWithDelegates.values();
    }

	/**
	 * @dev helper to check unique colelctions delegated
	 * @return total number of tokens with delegates
	 */
    function getTotalTokensWithDelegates() external view returns (uint256) {
        return tokensWithDelegates.length();
    }

	/**
	 * @dev get the list of tokens with delegates based on a range in case the list is too long
	 * @param _offset the start of the range
	 * @param _limit the number of items to return
	 * @return tokens an array of token addresses
	 */
    function getTokensWithDelegatesRange(
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory tokens) {
		require(_offset + _limit <= tokensWithDelegates.length(), "LDR: Range OOB");
        tokens = new address[](_limit);
        for (uint256 i = 0; i < _limit; i++) {
            tokens[i] = tokensWithDelegates.at(_offset + i);
        }
    }

	/**
	 * @dev get the list of wallets with delegates
	 * @return addresses an array of wallet addresses
	 */
    function getWalletsWithDelegates()
        external
        view
        returns (address[] memory)
    {
        return walletsWithDelegates.values();
    }

	/**
	 * @dev helper to check unique wallets delegated
	 * @return total number of wallets with delegates
	 */
    function getTotalWalletsWithDelegates() external view returns (uint256) {
        return walletsWithDelegates.length();
    }

	/**
	 * @dev get the list of wallets with delegates based on a range in case the list is too long
	 * @param _offset the start of the range
	 * @param _limit the number of items to return
	 * @return wallets an array of wallet addresses
	 */
    function getWalletsWithDelegatesRange(
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory wallets) {
		require(_offset + _limit <= walletsWithDelegates.length(), "LDR: Range OOB");
        wallets = new address[](_limit);
        for (uint256 i = 0; i < _limit; i++) {
            wallets[i] = walletsWithDelegates.at(_offset + i);
        }
    }
}
