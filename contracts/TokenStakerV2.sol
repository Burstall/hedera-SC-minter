// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Core Staking Module for NFTs
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract handles the movement of NFTs between the user and other contracts
/// @dev removes the usage of $LAZY for gas refills / token movements instead only hbar is used
/// @version 2.0 -- allows for sizing the amount of hbar

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenService} from "./HederaTokenService.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";

import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract TokenStakerV2 is HederaTokenService {
    using SafeCast for uint256;
    using SafeCast for int256;

    error FailedToInitialize();
    error BadArguments();
    error NFTTransferFailed(TransferDirection _direction);
    error AssociationFailed();
    error BatchAssociationFailed();

    enum TransferDirection {
        STAKING,
        WITHDRAWAL
    }

    address public lazyToken;
    ILazyGasStation public lazyGasStation;
    ILazyDelegateRegistry public lazyDelegateRegistry;
    uint256 private constant MAX_NFTS_PER_TX = 8;

    modifier refill() {
        // check the balance of the contract and refill if necessary
        if (address(this).balance < 20) {
            lazyGasStation.refillHbar(50);
        }
        _;
    }

    function initContracts(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry
    ) internal {
        lazyToken = _lazyToken;
        lazyGasStation = ILazyGasStation(_lazyGasStation);
        lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);

        int256 response = HederaTokenService.associateToken(
            address(this),
            lazyToken
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert FailedToInitialize();
        }
    }

    // **DOES NOT HAVE REFILL MODIFIER**
    // USE BATCHMOVE FOR REFILLING first
    //function to transfer NFTs
    function moveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
        bool _delegate,
        int64 _hbarAmount
    ) internal {
        if (_serials.length > 8) revert BadArguments();
        // ensure at least 1 tinybar is used for the transfer
        if (_hbarAmount < 1) _hbarAmount = 1;
        address receiverAddress;
        address senderAddress;
        bool isHbarApproval;

        if (_direction == TransferDirection.STAKING) {
            receiverAddress = address(this);
            senderAddress = _transferInitiator;
        } else {
            receiverAddress = _transferInitiator;
            senderAddress = address(this);
            isHbarApproval = true;
        }

        // hbar moves sit seperate from NFT moves (max 8 NFTs + 2 hbar legs +1/-1 tiny bar)
        IHederaTokenService.TokenTransferList[]
            memory _transfers = new IHederaTokenService.TokenTransferList[](
                _serials.length
            );

        // prep the hbar transfer
        IHederaTokenService.TransferList memory _hbarTransfer;
        _hbarTransfer.transfers = new IHederaTokenService.AccountAmount[](2);

        _hbarTransfer.transfers[0].accountID = receiverAddress;
        _hbarTransfer.transfers[0].amount = -_hbarAmount;
        _hbarTransfer.transfers[0].isApproval = isHbarApproval;

        _hbarTransfer.transfers[1].accountID = senderAddress;
        _hbarTransfer.transfers[1].amount = _hbarAmount;

        if (_delegate && _direction == TransferDirection.WITHDRAWAL) {
            // order matters, we can only do this BEFORE transfer as contract must hold the NFTs
            lazyDelegateRegistry.revokeDelegateNFT(
                _collectionAddress,
                _serials
            );
        }

        // transfer NFT
        for (uint256 i = 0; i < _serials.length; i++) {
            IHederaTokenService.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = senderAddress;
            _nftTransfer.receiverAccountID = receiverAddress;
            _nftTransfer.isApproval = !isHbarApproval;

            if (_serials[i] == 0) {
                continue;
            }
            _transfers[i].token = _collectionAddress;

            _transfers[i].nftTransfers = new IHederaTokenService.NftTransfer[](
                1
            );

            _nftTransfer.serialNumber = SafeCast.toInt64(int256(_serials[i]));
            _transfers[i].nftTransfers[0] = _nftTransfer;
        }

        int256 response = HederaTokenService.cryptoTransfer(
            _hbarTransfer,
            _transfers
        );

        if (response != HederaResponseCodes.SUCCESS) {
            // could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
            revert NFTTransferFailed(_direction);
        }

        if (_delegate && _direction == TransferDirection.STAKING) {
            // order matters, we can only do this AFTER transfer as contract must hold the NFTs
            lazyDelegateRegistry.delegateNFT(
                senderAddress,
                _collectionAddress,
                _serials
            );
        }
    }

    /**
     * @dev associate token with hedera service
     * @param tokenId address to associate
     */
    function tokenAssociate(address tokenId) public {
        int256 response = HederaTokenService.associateToken(
            address(this),
            tokenId
        );

        if (
            !(response == SUCCESS ||
                response == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            revert AssociationFailed();
        }
    }

    function batchTokenAssociate(address[] memory tokenIds) public {
        int256 response = HederaTokenService.associateTokens(
            address(this),
            tokenIds
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert BatchAssociationFailed();
        }
    }

    /**
     * @dev associate a group of tokens one at a time to ensure alrady associated tokens are safely handled
     * less gas efficient than batchTokenAssociate
     * @param tokenIds array of token addresses to associate
     */
    function safeBatchTokenAssociate(address[] memory tokenIds) public {
        uint256 tokenArrayLength = tokenIds.length;
        for (uint256 i = 0; i < tokenArrayLength; ) {
            tokenAssociate(tokenIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev associate a group of tokens one at a time comparing to a list of already associated tokens
     * less gas efficient than batchTokenAssociate but should be more efficient than safeBatchTokenAssociate
     * lots of loop work here, so gas costs are high
     * @param tokenIds array of token addresses to associate
     * @param existingTokenIds array of token addresses already associated
     */
    function noClashBatchTokenAssociate(
        address[] memory tokenIds,
        address[] memory existingTokenIds
    ) public {
        uint256 tokenArrayLength = tokenIds.length;
        uint256 existingTokenArrayLength = existingTokenIds.length;
        for (uint256 i = 0; i < tokenArrayLength; ) {
            bool clash = false;
            for (uint256 j = 0; j < existingTokenArrayLength; ) {
                if (tokenIds[i] == existingTokenIds[j]) {
                    clash = true;
                    break;
                }
                unchecked {
                    ++j;
                }
            }
            if (!clash) {
                tokenAssociate(tokenIds[i]);
            }
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Batch move NFTs in a single transaction
     * @param _direction Direction of the transfer (staking or unstaking)
     * @param _collectionAddress Address of the NFT collection
     * @param _serials Array of NFT serial numbers
     * @param _transferInitiator Address initiating the transfer
     * @param _delegate Whether to use delegation for the transfer
     * @param _hbarAmount Total hbar amount to be used for the transfer (will be divided among NFTs)
     */
    function batchMoveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
        bool _delegate,
        int64 _hbarAmount
    ) internal refill {
        // Calculate the amount per serial
        int64 amountPerSerial = _hbarAmount / int64(_serials.length.toUint64());

        // check the number of serials and send in batchs of 8
        for (
            uint256 outer = 0;
            outer < _serials.length;
            outer += MAX_NFTS_PER_TX
        ) {
            uint256 batchSize = (_serials.length - outer) >= MAX_NFTS_PER_TX
                ? MAX_NFTS_PER_TX
                : (_serials.length - outer);
            uint256[] memory serials = new uint256[](batchSize);
            for (
                uint256 inner = 0;
                ((outer + inner) < _serials.length) &&
                    (inner < MAX_NFTS_PER_TX);
                inner++
            ) {
                if (outer + inner < _serials.length) {
                    serials[inner] = _serials[outer + inner];
                }
            }
            moveNFTs(
                _direction,
                _collectionAddress,
                serials,
                _transferInitiator,
                _delegate,
                amountPerSerial * int64(batchSize.toUint64())
            );
        }
    }
}
