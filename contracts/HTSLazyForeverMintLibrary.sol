// SPDX-License-Identifier: MIT
// filepath: d:\\github\\hedera-SC-lazy-lotto\\contracts\\HTSLazyForeverMintLibrary.sol
pragma solidity >=0.8.12 <0.9.0;
pragma experimental ABIEncoderV2;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IHederaTokenServiceLite} from "./interfaces/IHederaTokenServiceLite.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

library HTSLazyForeverMintLibrary {
    using SafeCast for int256;

    // --CONSTANTS
    address public constant HTS_PRECOMPILE_ADDRESS = address(0x167); // Address of the HTS precompile
    int32 public constant DEFAULT_AUTO_RENEW_PERIOD = 7776000; // Default auto-renew period for tokens (90 days in seconds)
    uint256 private constant MAX_NFTS_PER_TX = 8; // Maximum number of NFTs that can be transferred in a single transaction

    // -- STRUCTURES
    /**
     * @dev Defines the structure for royalty fees on an NFT.
     * @param numerator The numerator of the royalty fee fraction.
     * @param denominator The denominator of the royalty fee fraction.
     * @param fallbackfee The fallback fee in HBAR if the royalty fee cannot be paid (e.g., 0 denominator).
     * @param account The account that will receive the royalty fee.
     */
    struct NFTFeeObject {
        uint32 numerator;
        uint32 denominator;
        uint32 fallbackfee;
        address account;
    }

    // -- ENUMS
    /**
     * @dev Defines the types of keys that can be associated with a token.
     */
    enum KeyType {
        ADMIN, // 0 - Key for administrative actions
        KYC, // 1 - Key for KYC verification
        FREEZE, // 2 - Key for freezing token transfers
        WIPE, // 3 - Key for wiping tokens from an account
        SUPPLY, // 4 - Key for minting or burning tokens
        FEE, // 5 - Key for managing custom fees
        PAUSE, // 6 - Key for pausing token transfers
        METADATA // 7 - Key for updating token metadata (not used in current implementation)
    }

    /**
     * @dev Defines the types of values that a key can represent.
     */
    enum KeyValueType {
        INHERIT_ACCOUNT_KEY, // Key inherits the account's key
        CONTRACT_ID, // Key is the ID of a contract
        ED25519, // Not used by LazyLotto's current key creation path - ED25519 public key
        SECP256K1, // Not used by LazyLotto's current key creation path - SECP256K1 public key
        DELEGETABLE_CONTRACT_ID // Not used by LazyLotto's current key creation path - Delegatable contract ID
    }

    /**
     * @dev Defines the direction of an NFT transfer.
     */
    enum TransferDirection {
        STAKING, // Transferring NFTs to a staking contract
        WITHDRAWAL // Transferring NFTs from a staking contract
    }

    // -- ERRORS
    error NFTTransferFailed(TransferDirection _direction); // Error for failed NFT transfers
    error BadArguments(); // Error for invalid function arguments
    error AssociationFailed(address tokenId); // Error for failed token association

    // -- PUBLIC FUNCTIONS
    /**
     * @dev Creates a new non-fungible token (NFT) for a new prize pool.
     * @param _treasury The address of the treasury account for the token.
     * @param _name The name of the token.
     * @param _symbol The symbol of the token.
     * @param _memo A memo for the token.
     * @param _royalties An array of royalty fee objects for the token.
     * @return responseCode The response code from the HTS precompile.
     * @return tokenAddress The address of the newly created token.
     */
    function createTokenForNewPool(
        address _treasury,
        string memory _name,
        string memory _symbol,
        string memory _memo,
        NFTFeeObject[] memory _royalties
    ) public returns (int32 responseCode, address tokenAddress) {
        // now mint the token for the pool making the SC the treasury
        IHederaTokenServiceLite.TokenKey[]
            memory _keys = new IHederaTokenServiceLite.TokenKey[](1);

        // make the contract the sole supply / wipe key
        _keys[0] = getSingleKey(
            HTSLazyForeverMintLibrary.KeyType.SUPPLY,
            HTSLazyForeverMintLibrary.KeyType.WIPE,
            HTSLazyForeverMintLibrary.KeyValueType.CONTRACT_ID,
            _treasury
        );

        IHederaTokenServiceLite.HederaToken memory _token;
        _token.name = _name;
        _token.symbol = _symbol;
        _token.memo = _memo;
        _token.treasury = _treasury;
        _token.tokenKeys = _keys;
        _token.tokenSupplyType = false;
        // int64 max value
        _token.maxSupply = 0x7FFFFFFFFFFFFFFF;

        // create the expiry schedule for the token using ExpiryHelper
        _token.expiry = createAutoRenewExpiry(
            address(this),
            HTSLazyForeverMintLibrary.DEFAULT_AUTO_RENEW_PERIOD
        );

        IHederaTokenServiceLite.RoyaltyFee[]
            memory _fees = new IHederaTokenServiceLite.RoyaltyFee[](
                _royalties.length
            );

        uint256 _length = _royalties.length;
        for (uint256 f = 0; f < _length; ) {
            IHederaTokenServiceLite.RoyaltyFee memory _fee;
            _fee.numerator = _royalties[f].numerator;
            _fee.denominator = _royalties[f].denominator;
            _fee.feeCollector = _royalties[f].account;

            if (_royalties[f].fallbackfee != 0) {
                _fee.amount = _royalties[f].fallbackfee;
                _fee.useHbarsForPayment = true;
            }

            _fees[f] = _fee;

            unchecked {
                ++f;
            }
        }

        (responseCode, tokenAddress) = createNonFungibleTokenWithCustomFees(
            _token,
            new IHederaTokenServiceLite.FixedFee[](0),
            _fees
        );
    }

    /**
     * @dev Mints new NFTs and transfers them to a receiver.
     * @param token The address of the NFT collection.
     * @param sender The address of the sender (contract treasury).
     * @param receiver The address of the receiver.
     * @param metadata An array of metadata for the new NFTs.
     * @return responseCode The response code from the HTS precompile.
     * @return serialNumbers An array of serial numbers for the minted NFTs.
     */
    function mintAndTransferNFT(
        address token,
        address sender,
        address receiver,
        bytes[] memory metadata
    ) public returns (int32 responseCode, int64[] memory serialNumbers) {
        // 1. Mint NFT to contract (treasury)
        (responseCode, , serialNumbers) = mintToken(token, 0, metadata);

        if (
            responseCode != HTSLazyForeverMintLibrary.SUCCESS ||
            serialNumbers.length == 0
        ) {
            return (responseCode, serialNumbers);
        }

        // 2. Transfer the minted NFTs
        // create an array of sender and receiver addresses of length serialNumbers
        address[] memory senderAddresses = new address[](serialNumbers.length);
        address[] memory receiverAddresses = new address[](
            serialNumbers.length
        );

        for (uint256 i = 0; i < serialNumbers.length; i++) {
            senderAddresses[i] = sender;
            receiverAddresses[i] = receiver;
        }
        responseCode = HTSLazyForeverMintLibrary.transferNFTs(
            token,
            senderAddresses,
            receiverAddresses,
            serialNumbers
        );
    }

    /**
     * @dev Associates the calling contract with a token on the Hedera network.
     * @param tokenId The address of the token to associate with.
     * @return True if the association was successful or if the token was already associated, false otherwise.
     */
    function tokenAssociate(address tokenId) public returns (bool) {
        int256 response = associateToken(address(this), tokenId);

        if (
            !(response == SUCCESS ||
                response == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            return false;
        }
        return true;
    }

    /**
     * @dev Transfers multiple NFTs in bulk, either for staking or withdrawal.
     * If staking, it first associates the contract with the token if not already associated.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param nftTokens An array of NFT collection addresses.
     * @param nftSerials A 2D array where each inner array contains the serial numbers of NFTs from the corresponding collection in nftTokens.
     * @param _contractAddress The address of the contract (e.g., staking contract).
     * @param _eoaAddress The address of the externally owned account (EOA) involved in the transfer.
     */
    function bulkTransfer(
        TransferDirection _direction,
        address[] memory nftTokens,
        uint256[][] memory nftSerials,
        address _contractAddress,
        address _eoaAddress
    ) public {
        uint256 _length = nftTokens.length;
        for (uint256 i = 0; i < _length; ) {
            if (_direction == TransferDirection.STAKING) {
                if (IERC721(nftTokens[i]).balanceOf(address(this)) == 0) {
                    bool success = tokenAssociate(nftTokens[i]);
                    if (!success) {
                        revert AssociationFailed(nftTokens[i]);
                    }
                }
            }

            // now stake the NFTs for the prize
            batchMoveNFTs(
                _direction,
                nftTokens[i],
                nftSerials[i],
                _contractAddress,
                _eoaAddress
            );

            unchecked {
                ++i;
            }
        }
    }

    // -- INTERNAL FUNCTIONS

    /**
     * @dev Creates a single token key structure for HTS operations.
     * @param firstType The primary type of the key (e.g., SUPPLY).
     * @param secondType The secondary type of the key (e.g., WIPE). Can be the same as firstType if only one type is needed.
     * @param keyValueType The type of value the key represents (e.g., CONTRACT_ID).
     * @param keyAddress The address associated with the key (e.g., contract address).
     * @return tokenKey The constructed TokenKey struct.
     */
    function getSingleKey(
        KeyType firstType,
        KeyType secondType,
        KeyValueType keyValueType,
        address keyAddress
    ) internal pure returns (IHederaTokenServiceLite.TokenKey memory tokenKey) {
        tokenKey = IHederaTokenServiceLite.TokenKey(
            getDuplexKeyType(firstType, secondType),
            getKeyValueType(keyValueType, keyAddress)
        );
    }

    /**
     * @dev Combines two KeyType enums into a bitmask for HTS key creation.
     * Each KeyType corresponds to a bit in the resulting uint256.
     * @param firstType The first key type.
     * @param secondType The second key type.
     * @return keyTypeCombination A uint256 representing the combined key types as a bitmask.
     */
    function getDuplexKeyType(
        KeyType firstType,
        KeyType secondType
    ) internal pure returns (uint256 keyTypeCombination) {
        keyTypeCombination = 0; // Initialize
        // Uses the enum's underlying integer value (index) for bit position
        keyTypeCombination = setBit(keyTypeCombination, uint8(firstType));
        keyTypeCombination = setBit(keyTypeCombination, uint8(secondType));
        return keyTypeCombination;
    }

    /**
     * @dev Creates a KeyValue structure for HTS key creation based on the provided type and address.
     * @param keyValueType The type of key value (e.g., CONTRACT_ID, INHERIT_ACCOUNT_KEY).
     * @param keyAddress The address to be used for CONTRACT_ID or DELEGETABLE_CONTRACT_ID types.
     * @return keyValue The constructed KeyValue struct.
     */
    function getKeyValueType(
        KeyValueType keyValueType,
        address keyAddress
    ) internal pure returns (IHederaTokenServiceLite.KeyValue memory keyValue) {
        if (keyValueType == KeyValueType.CONTRACT_ID) {
            keyValue.contractId = keyAddress;
        } else if (keyValueType == KeyValueType.DELEGETABLE_CONTRACT_ID) {
            // This case is not used by LazyLotto's current key setup but kept for completeness of the enum.
            keyValue.delegatableContractId = keyAddress;
        } else if (keyValueType == KeyValueType.INHERIT_ACCOUNT_KEY) {
            // This case is not used by LazyLotto's current key setup.
            keyValue.inheritAccountKey = true;
        }
        // ED25519 and SECP256K1 variants (usually taking bytes) are omitted as not used by LazyLotto's address-based key.
        return keyValue;
    }

    /**
     * @dev Sets a specific bit in a uint256 value.
     * @param self The uint256 value to modify.
     * @param index The bit position to set (0-indexed).
     * @return The uint256 value with the specified bit set.
     */
    function setBit(uint256 self, uint8 index) internal pure returns (uint256) {
        return self | (uint256(1) << index);
    }

    /**
     * @dev Creates an Expiry structure for HTS token creation, defining auto-renewal properties.
     * @param autoRenewAccount The account responsible for auto-renewal fees.
     * @param autoRenewPeriod The duration of the auto-renewal period in seconds.
     * @return expiry The constructed Expiry struct.
     */
    function createAutoRenewExpiry(
        address autoRenewAccount,
        int32 autoRenewPeriod
    ) internal pure returns (IHederaTokenServiceLite.Expiry memory expiry) {
        expiry.autoRenewAccount = autoRenewAccount;
        expiry.autoRenewPeriod = autoRenewPeriod;
    }

    /**
     * @dev Performs cryptographic transfers of HBAR and tokens using the HTS precompile.
     * @param transferList A list of HBAR transfers.
     * @param tokenTransfers A list of token transfers.
     * @return responseCode The response code from the HTS precompile.
     * @custom:version 0.3.0 The signature of the previous version was cryptoTransfer(TokenTransferList[] memory tokenTransfers)
     */
    function cryptoTransfer(
        IHederaTokenServiceLite.TransferList memory transferList,
        IHederaTokenServiceLite.TokenTransferList[] memory tokenTransfers
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = HTS_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenServiceLite.cryptoTransfer.selector,
                transferList,
                tokenTransfers
            )
        );
        responseCode = success ? abi.decode(result, (int32)) : UNKNOWN;
    }

    /**
     * @dev Associates an account with a specific token using the HTS precompile.
     * @param account The account to associate.
     * @param token The token to associate with.
     * @return responseCode The response code from the HTS precompile.
     */
    function associateToken(
        address account,
        address token
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = HTS_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenServiceLite.associateToken.selector,
                account,
                token
            )
        );
        responseCode = success ? abi.decode(result, (int32)) : UNKNOWN;
    }

    /**
     * @dev Associates an account with multiple tokens using the HTS precompile.
     * @param account The account to associate.
     * @param tokens An array of token addresses to associate with.
     * @return responseCode The response code from the HTS precompile.
     */
    function associateTokens(
        address account,
        address[] memory tokens
    ) internal returns (int256 responseCode) {
        (bool success, bytes memory result) = HTS_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenServiceLite.associateTokens.selector,
                account,
                tokens
            )
        );
        responseCode = success ? abi.decode(result, (int32)) : UNKNOWN;
    }

    /**
     * @dev Creates a non-fungible token with custom fees using the HTS precompile.
     * @param token The HederaToken structure defining the token's properties.
     * @param fixedFees An array of fixed fees for the token.
     * @param royaltyFees An array of royalty fees for the token.
     * @return responseCode The response code from the HTS precompile.
     * @return tokenAddress The address of the newly created token.
     */
    function createNonFungibleTokenWithCustomFees(
        IHederaTokenServiceLite.HederaToken memory token,
        IHederaTokenServiceLite.FixedFee[] memory fixedFees,
        IHederaTokenServiceLite.RoyaltyFee[] memory royaltyFees
    )
        internal
        returns (
            // nonEmptyExpiry(token) // Expiry logic is handled by ExpiryHelper or directly in LazyLotto
            int32 responseCode,
            address tokenAddress
        )
    {
        (bool success, bytes memory result) = HTS_PRECOMPILE_ADDRESS.call{
            value: msg.value
        }( // Important: Retain payable aspect for token creation fees
            abi.encodeWithSelector(
                IHederaTokenServiceLite
                    .createNonFungibleTokenWithCustomFees
                    .selector,
                token,
                fixedFees,
                royaltyFees
            )
        );
        (responseCode, tokenAddress) = success
            ? abi.decode(result, (int32, address))
            : (UNKNOWN, address(0));
    }

    /**
     * @dev Mints new tokens (fungible or non-fungible) using the HTS precompile.
     * For NFTs, the amount should be 0.
     * @param token The address of the token to mint.
     * @param amount The amount of fungible tokens to mint (0 for NFTs).
     * @param metadata An array of metadata for NFTs (empty for fungible tokens).
     * @return responseCode The response code from the HTS precompile.
     * @return newTotalSupply The new total supply of the token.
     * @return serialNumbers An array of serial numbers for minted NFTs.
     */
    function mintToken(
        address token,
        uint64 amount, // amount is 0 for NFTs as per IHederaTokenService
        bytes[] memory metadata
    )
        internal
        returns (
            int32 responseCode,
            uint64 newTotalSupply,
            int64[] memory serialNumbers
        )
    {
        (bool success, bytes memory result) = HTS_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenServiceLite.mintToken.selector,
                token,
                amount,
                metadata
            )
        );
        (responseCode, newTotalSupply, serialNumbers) = success
            ? abi.decode(result, (int32, uint64, int64[]))
            : (UNKNOWN, 0, new int64[](0));
    }

    /**
     * @dev Transfers multiple NFTs from multiple senders to multiple receivers using the HTS precompile.
     * @param token The address of the NFT collection.
     * @param sender An array of sender addresses.
     * @param receiver An array of receiver addresses.
     * @param serialNumber An array of serial numbers of the NFTs to transfer.
     * @return responseCode The response code from the HTS precompile.
     */
    function transferNFTs(
        address token,
        address[] memory sender,
        address[] memory receiver,
        int64[] memory serialNumber
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = HTS_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenServiceLite.transferNFTs.selector,
                token,
                sender,
                receiver,
                serialNumber
            )
        );
        responseCode = success ? abi.decode(result, (int32)) : UNKNOWN;
    }

    /**
     * @dev Transfers a single NFT from a sender to a receiver using the HTS precompile.
     * @param token The address of the NFT collection.
     * @param sender The address of the sender.
     * @param receiver The address of the receiver.
     * @param serialNumber The serial number of the NFT to transfer.
     * @return responseCode The response code from the HTS precompile.
     */
    function transferNFT(
        address token,
        address sender,
        address receiver,
        int64 serialNumber
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = HTS_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenServiceLite.transferNFT.selector,
                token,
                sender,
                receiver,
                serialNumber
            )
        );
        responseCode = success ? abi.decode(result, (int32)) : UNKNOWN;
    }

    /**
     * @dev Wipes (burns) NFTs from a specific account using the HTS precompile.
     * Requires the wipe key to be set on the token.
     * @param token The address of the NFT collection.
     * @param account The account from which to wipe the NFTs.
     * @param serialNumbers An array of serial numbers of the NFTs to wipe.
     * @return responseCode The response code from the HTS precompile.
     */
    function wipeTokenAccountNFT(
        address token,
        address account,
        int64[] memory serialNumbers
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = HTS_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenServiceLite.wipeTokenAccountNFT.selector,
                token,
                account,
                serialNumbers
            )
        );
        responseCode = success ? abi.decode(result, (int32)) : UNKNOWN;
    }

    //function to transfer NFTs
    /**
     * @dev Internal function to move a batch of NFTs (up to MAX_NFTS_PER_TX).
     * It constructs the necessary transfer lists for HBAR (tinybar dust for discovery) and NFTs,
     * then calls the cryptoTransfer precompile.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param _collectionAddress The address of the NFT collection.
     * @param _serials An array of serial numbers for the NFTs to transfer (max length MAX_NFTS_PER_TX).
     * @param _contractAddress The address of the contract (e.g., staking contract).
     * @param _eoaAddress The address of the EOA involved in the transfer.
     */
    function moveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _contractAddress,
        address _eoaAddress
    ) internal {
        if (_serials.length > 8) revert BadArguments();
        address receiverAddress;
        address senderAddress;
        bool isHbarApproval;

        if (_direction == TransferDirection.STAKING) {
            receiverAddress = _contractAddress;
            senderAddress = _eoaAddress;
        } else {
            receiverAddress = _eoaAddress;
            senderAddress = _contractAddress;
            isHbarApproval = true;
        }

        // hbar moves sit separate from NFT moves (max 8 NFTs + 2 hbar legs +1/-1 tiny bar)
        IHederaTokenServiceLite.TokenTransferList[]
            memory _transfers = new IHederaTokenServiceLite.TokenTransferList[](
                _serials.length
            );

        // prep the hbar transfer
        IHederaTokenServiceLite.TransferList memory _hbarTransfer;
        _hbarTransfer.transfers = new IHederaTokenServiceLite.AccountAmount[](
            2
        );

        _hbarTransfer.transfers[0].accountID = receiverAddress;
        _hbarTransfer.transfers[0].amount = -1;
        _hbarTransfer.transfers[0].isApproval = isHbarApproval;

        _hbarTransfer.transfers[1].accountID = senderAddress;
        _hbarTransfer.transfers[1].amount = 1;

        // transfer NFT
        for (uint256 i = 0; i < _serials.length; i++) {
            IHederaTokenServiceLite.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = senderAddress;
            _nftTransfer.receiverAccountID = receiverAddress;
            _nftTransfer.isApproval = !isHbarApproval;

            if (_serials[i] == 0) {
                continue;
            }
            _transfers[i].token = _collectionAddress;

            _transfers[i]
                .nftTransfers = new IHederaTokenServiceLite.NftTransfer[](1);

            _nftTransfer.serialNumber = int256(_serials[i]).toInt64();
            _transfers[i].nftTransfers[0] = _nftTransfer;
        }

        int256 response = cryptoTransfer(_hbarTransfer, _transfers);

        if (response != SUCCESS) {
            // could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
            revert NFTTransferFailed(_direction);
        }
    }

    /**
     * @dev Internal function to move NFTs in batches, respecting MAX_NFTS_PER_TX.
     * It iterates through the provided serials and calls `moveNFTs` for each batch.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param _collectionAddress The address of the NFT collection.
     * @param _serials An array of serial numbers for all NFTs to transfer.
     * @param _contractAddress The address of the contract (e.g., staking contract).
     * @param _eoaAddress The address of the EOA involved in the transfer.
     */
    function batchMoveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _contractAddress,
        address _eoaAddress
    ) internal {
        // check the number of serials and send in batches of 8
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
                _contractAddress,
                _eoaAddress
            );
        }
    }

    // response codes - These are Hedera Response Codes, useful for decoding precompile results.
    int32 public constant OK = 0; // The transaction passed the precheck validations.
    int32 public constant INVALID_TRANSACTION = 1; // For any error not handled by specific error codes listed below.
    int32 public constant PAYER_ACCOUNT_NOT_FOUND = 2; //Payer account does not exist.
    int32 public constant INVALID_NODE_ACCOUNT = 3; //Node Account provided does not match the node account of the node the transaction was submitted to.
    int32 public constant TRANSACTION_EXPIRED = 4; // Pre-Check error when TransactionValidStart + transactionValidDuration is less than current consensus time.
    int32 public constant INVALID_TRANSACTION_START = 5; // Transaction start time is greater than current consensus time
    int32 public constant INVALID_TRANSACTION_DURATION = 6; //valid transaction duration is a positive non zero number that does not exceed 120 seconds
    int32 public constant INVALID_SIGNATURE = 7; // The transaction signature is not valid
    int32 public constant MEMO_TOO_LONG = 8; //Transaction memo size exceeded 100 bytes
    int32 public constant INSUFFICIENT_TX_FEE = 9; // The fee provided in the transaction is insufficient for this type of transaction
    int32 public constant INSUFFICIENT_PAYER_BALANCE = 10; // The payer account has insufficient cryptocurrency to pay the transaction fee
    int32 public constant DUPLICATE_TRANSACTION = 11; // This transaction ID is a duplicate of one that was submitted to this node or reached consensus in the last 180 seconds (receipt period)
    int32 public constant BUSY = 12; //If API is throttled out
    int32 public constant NOT_SUPPORTED = 13; //The API is not currently supported

    int32 public constant INVALID_FILE_ID = 14; //The file id is invalid or does not exist
    int32 public constant INVALID_ACCOUNT_ID = 15; //The account id is invalid or does not exist
    int32 public constant INVALID_CONTRACT_ID = 16; //The contract id is invalid or does not exist
    int32 public constant INVALID_TRANSACTION_ID = 17; //Transaction id is not valid
    int32 public constant RECEIPT_NOT_FOUND = 18; //Receipt for given transaction id does not exist
    int32 public constant RECORD_NOT_FOUND = 19; //Record for given transaction id does not exist
    int32 public constant INVALID_SOLIDITY_ID = 20; //The solidity id is invalid or entity with this solidity id does not exist

    int32 public constant UNKNOWN = 21; // The responding node has submitted the transaction to the network. Its final status is still unknown.
    int32 public constant SUCCESS = 22; // The transaction succeeded
    int32 public constant FAIL_INVALID = 23; // There was a system error and the transaction failed because of invalid request parameters.
    int32 public constant FAIL_FEE = 24; // There was a system error while performing fee calculation, reserved for future.
    int32 public constant FAIL_BALANCE = 25; // There was a system error while performing balance checks, reserved for future.

    int32 public constant KEY_REQUIRED = 26; //Key not provided in the transaction body
    int32 public constant BAD_ENCODING = 27; //Unsupported algorithm/encoding used for keys in the transaction
    int32 public constant INSUFFICIENT_ACCOUNT_BALANCE = 28; //When the account balance is not sufficient for the transfer
    int32 public constant INVALID_SOLIDITY_ADDRESS = 29; //During an update transaction when the system is not able to find the Users Solidity address

    int32 public constant INSUFFICIENT_GAS = 30; //Not enough gas was supplied to execute transaction
    int32 public constant CONTRACT_SIZE_LIMIT_EXCEEDED = 31; //contract byte code size is over the limit
    int32 public constant LOCAL_CALL_MODIFICATION_EXCEPTION = 32; //local execution (query) is requested for a function which changes state
    int32 public constant CONTRACT_REVERT_EXECUTED = 33; //Contract REVERT OPCODE executed
    int32 public constant CONTRACT_EXECUTION_EXCEPTION = 34; //For any contract execution related error not handled by specific error codes listed above.
    int32 public constant INVALID_RECEIVING_NODE_ACCOUNT = 35; //In Query validation, account with +ve(amount) value should be Receiving node account, the receiver account should be only one account in the list
    int32 public constant MISSING_QUERY_HEADER = 36; // Header is missing in Query request

    int32 public constant ACCOUNT_UPDATE_FAILED = 37; // The update of the account failed
    int32 public constant INVALID_KEY_ENCODING = 38; // Provided key encoding was not supported by the system
    int32 public constant NULL_SOLIDITY_ADDRESS = 39; // null solidity address

    int32 public constant CONTRACT_UPDATE_FAILED = 40; // update of the contract failed
    int32 public constant INVALID_QUERY_HEADER = 41; // the query header is invalid

    int32 public constant INVALID_FEE_SUBMITTED = 42; // Invalid fee submitted
    int32 public constant INVALID_PAYER_SIGNATURE = 43; // Payer signature is invalid

    int32 public constant KEY_NOT_PROVIDED = 44; // The keys were not provided in the request.
    int32 public constant INVALID_EXPIRATION_TIME = 45; // Expiration time provided in the transaction was invalid.
    int32 public constant NO_WACL_KEY = 46; //WriteAccess Control Keys are not provided for the file
    int32 public constant FILE_CONTENT_EMPTY = 47; //The contents of file are provided as empty.
    int32 public constant INVALID_ACCOUNT_AMOUNTS = 48; // The crypto transfer credit and debit do not sum equal to 0
    int32 public constant EMPTY_TRANSACTION_BODY = 49; // Transaction body provided is empty
    int32 public constant INVALID_TRANSACTION_BODY = 50; // Invalid transaction body provided

    int32 public constant INVALID_SIGNATURE_TYPE_MISMATCHING_KEY = 51; // the type of key (base ed25519 key, KeyList, or ThresholdKey) does not match the type of signature (base ed25519 signature, SignatureList, or ThresholdKeySignature)
    int32 public constant INVALID_SIGNATURE_COUNT_MISMATCHING_KEY = 52; // the number of key (KeyList, or ThresholdKey) does not match that of signature (SignatureList, or ThresholdKeySignature). e.g. if a keyList has 3 base keys, then the corresponding signatureList should also have 3 base signatures.

    int32 public constant EMPTY_LIVE_HASH_BODY = 53; // the livehash body is empty
    int32 public constant EMPTY_LIVE_HASH = 54; // the livehash data is missing
    int32 public constant EMPTY_LIVE_HASH_KEYS = 55; // the keys for a livehash are missing
    int32 public constant INVALID_LIVE_HASH_SIZE = 56; // the livehash data is not the output of a SHA-384 digest

    int32 public constant EMPTY_QUERY_BODY = 57; // the query body is empty
    int32 public constant EMPTY_LIVE_HASH_QUERY = 58; // the crypto livehash query is empty
    int32 public constant LIVE_HASH_NOT_FOUND = 59; // the livehash is not present
    int32 public constant ACCOUNT_ID_DOES_NOT_EXIST = 60; // the account id passed has not yet been created.
    int32 public constant LIVE_HASH_ALREADY_EXISTS = 61; // the livehash already exists for a given account

    int32 public constant INVALID_FILE_WACL = 62; // File WACL keys are invalid
    int32 public constant SERIALIZATION_FAILED = 63; // Serialization failure
    int32 public constant TRANSACTION_OVERSIZE = 64; // The size of the Transaction is greater than transactionMaxBytes
    int32 public constant TRANSACTION_TOO_MANY_LAYERS = 65; // The Transaction has more than 50 levels
    int32 public constant CONTRACT_DELETED = 66; //Contract is marked as deleted

    int32 public constant PLATFORM_NOT_ACTIVE = 67; // the platform node is either disconnected or lagging behind.
    int32 public constant KEY_PREFIX_MISMATCH = 68; // one internal key matches more than one prefixes on the signature map
    int32 public constant PLATFORM_TRANSACTION_NOT_CREATED = 69; // transaction not created by platform due to large backlog
    int32 public constant INVALID_RENEWAL_PERIOD = 70; // auto renewal period is not a positive number of seconds
    int32 public constant INVALID_PAYER_ACCOUNT_ID = 71; // the response code when a smart contract id is passed for a crypto API request
    int32 public constant ACCOUNT_DELETED = 72; // the account has been marked as deleted
    int32 public constant FILE_DELETED = 73; // the file has been marked as deleted
    int32 public constant ACCOUNT_REPEATED_IN_ACCOUNT_AMOUNTS = 74; // same accounts repeated in the transfer account list
    int32 public constant SETTING_NEGATIVE_ACCOUNT_BALANCE = 75; // attempting to set negative balance value for crypto account
    int32 public constant OBTAINER_REQUIRED = 76; // when deleting smart contract that has crypto balance either transfer account or transfer smart contract is required
    int32 public constant OBTAINER_SAME_CONTRACT_ID = 77; //when deleting smart contract that has crypto balance you can not use the same contract id as transferContractId as the one being deleted
    int32 public constant OBTAINER_DOES_NOT_EXIST = 78; //transferAccountId or transferContractId specified for contract delete does not exist
    int32 public constant MODIFYING_IMMUTABLE_CONTRACT = 79; //attempting to modify (update or delete a immutable smart contract, i.e. one created without a admin key)
    int32 public constant FILE_SYSTEM_EXCEPTION = 80; //Unexpected exception thrown by file system functions
    int32 public constant AUTORENEW_DURATION_NOT_IN_RANGE = 81; // the duration is not a subset of [MINIMUM_AUTORENEW_DURATION,MAXIMUM_AUTORENEW_DURATION]
    int32 public constant ERROR_DECODING_BYTESTRING = 82; // Decoding the smart contract binary to a byte array failed. Check that the input is a valid hex string.
    int32 public constant CONTRACT_FILE_EMPTY = 83; // File to create a smart contract was of length zero
    int32 public constant CONTRACT_BYTECODE_EMPTY = 84; // Bytecode for smart contract is of length zero
    int32 public constant INVALID_INITIAL_BALANCE = 85; // Attempt to set negative initial balance
    int32 public constant INVALID_RECEIVE_RECORD_THRESHOLD = 86; // [Deprecated]. attempt to set negative receive record threshold
    int32 public constant INVALID_SEND_RECORD_THRESHOLD = 87; // [Deprecated]. attempt to set negative send record threshold
    int32 public constant ACCOUNT_IS_NOT_GENESIS_ACCOUNT = 88; // Special Account Operations should be performed by only Genesis account, return this code if it is not Genesis Account
    int32 public constant PAYER_ACCOUNT_UNAUTHORIZED = 89; // The fee payer account doesn't have permission to submit such Transaction
    int32 public constant INVALID_FREEZE_TRANSACTION_BODY = 90; // FreezeTransactionBody is invalid
    int32 public constant FREEZE_TRANSACTION_BODY_NOT_FOUND = 91; // FreezeTransactionBody does not exist
    int32 public constant TRANSFER_LIST_SIZE_LIMIT_EXCEEDED = 92; //Exceeded the number of accounts (both from and to) allowed for crypto transfer list
    int32 public constant RESULT_SIZE_LIMIT_EXCEEDED = 93; // Smart contract result size greater than specified maxResultSize
    int32 public constant NOT_SPECIAL_ACCOUNT = 94; //The payer account is not a special account(account 0.0.55)
    int32 public constant CONTRACT_NEGATIVE_GAS = 95; // Negative gas was offered in smart contract call
    int32 public constant CONTRACT_NEGATIVE_VALUE = 96; // Negative value / initial balance was specified in a smart contract call / create
    int32 public constant INVALID_FEE_FILE = 97; // Failed to update fee file
    int32 public constant INVALID_EXCHANGE_RATE_FILE = 98; // Failed to update exchange rate file
    int32 public constant INSUFFICIENT_LOCAL_CALL_GAS = 99; // Payment tendered for contract local call cannot cover both the fee and the gas
    int32 public constant ENTITY_NOT_ALLOWED_TO_DELETE = 100; // Entities with Entity ID below 1000 are not allowed to be deleted
    int32 public constant AUTHORIZATION_FAILED = 101; // Violating one of these rules: 1) treasury account can update all entities below 0.0.1000, 2) account 0.0.50 can update all entities from 0.0.51 - 0.0.80, 3) Network Function Master Account A/c 0.0.50 - Update all Network Function accounts & perform all the Network Functions listed below, 4) Network Function Accounts: i) A/c 0.0.55 - Update Address Book files (0.0.101/102), ii) A/c 0.0.56 - Update Fee schedule (0.0.111), iii) A/c 0.0.57 - Update Exchange Rate (0.0.112).
    int32 public constant FILE_UPLOADED_PROTO_INVALID = 102; // Fee Schedule Proto uploaded but not valid (append or update is required)
    int32 public constant FILE_UPLOADED_PROTO_NOT_SAVED_TO_DISK = 103; // Fee Schedule Proto uploaded but not valid (append or update is required)
    int32 public constant FEE_SCHEDULE_FILE_PART_UPLOADED = 104; // Fee Schedule Proto File Part uploaded
    int32 public constant EXCHANGE_RATE_CHANGE_LIMIT_EXCEEDED = 105; // The change on Exchange Rate exceeds Exchange_Rate_Allowed_Percentage
    int32 public constant MAX_CONTRACT_STORAGE_EXCEEDED = 106; // Contract permanent storage exceeded the currently allowable limit
    int32 public constant TRANSFER_ACCOUNT_SAME_AS_DELETE_ACCOUNT = 107; // Transfer Account should not be same as Account to be deleted
    int32 public constant TOTAL_LEDGER_BALANCE_INVALID = 108;
    int32 public constant EXPIRATION_REDUCTION_NOT_ALLOWED = 110; // The expiration date/time on a smart contract may not be reduced
    int32 public constant MAX_GAS_LIMIT_EXCEEDED = 111; //Gas exceeded currently allowable gas limit per transaction
    int32 public constant MAX_FILE_SIZE_EXCEEDED = 112; // File size exceeded the currently allowable limit

    int32 public constant INVALID_TOPIC_ID = 150; // The Topic ID specified is not in the system.
    int32 public constant INVALID_ADMIN_KEY = 155; // A provided admin key was invalid.
    int32 public constant INVALID_SUBMIT_KEY = 156; // A provided submit key was invalid.
    int32 public constant UNAUTHORIZED = 157; // An attempted operation was not authorized (ie - a deleteTopic for a topic with no adminKey).
    int32 public constant INVALID_TOPIC_MESSAGE = 158; // A ConsensusService message is empty.
    int32 public constant INVALID_AUTORENEW_ACCOUNT = 159; // The autoRenewAccount specified is not a valid, active account.
    int32 public constant AUTORENEW_ACCOUNT_NOT_ALLOWED = 160; // An adminKey was not specified on the topic, so there must not be an autoRenewAccount.
    // The topic has expired, was not automatically renewed, and is in a 7 day grace period before the topic will be
    // deleted unrecoverably. This error response code will not be returned until autoRenew functionality is supported
    // by HAPI.
    int32 public constant TOPIC_EXPIRED = 162;
    int32 public constant INVALID_CHUNK_NUMBER = 163; // chunk number must be from 1 to total (chunks) inclusive.
    int32 public constant INVALID_CHUNK_TRANSACTION_ID = 164; // For every chunk, the payer account that is part of initialTransactionID must match the Payer Account of this transaction. The entire initialTransactionID should match the transactionID of the first chunk, but this is not checked or enforced by Hedera except when the chunk number is 1.
    int32 public constant ACCOUNT_FROZEN_FOR_TOKEN = 165; // Account is frozen and cannot transact with the token
    int32 public constant TOKENS_PER_ACCOUNT_LIMIT_EXCEEDED = 166; // An involved account already has more than <tt>tokens.maxPerAccount</tt> associations with non-deleted tokens.
    int32 public constant INVALID_TOKEN_ID = 167; // The token is invalid or does not exist
    int32 public constant INVALID_TOKEN_DECIMALS = 168; // Invalid token decimals
    int32 public constant INVALID_TOKEN_INITIAL_SUPPLY = 169; // Invalid token initial supply
    int32 public constant INVALID_TREASURY_ACCOUNT_FOR_TOKEN = 170; // Treasury Account does not exist or is deleted
    int32 public constant INVALID_TOKEN_SYMBOL = 171; // Token Symbol is not UTF-8 capitalized alphabetical string
    int32 public constant TOKEN_HAS_NO_FREEZE_KEY = 172; // Freeze key is not set on token
    int32 public constant TRANSFERS_NOT_ZERO_SUM_FOR_TOKEN = 173; // Amounts in transfer list are not net zero
    int32 public constant MISSING_TOKEN_SYMBOL = 174; // A token symbol was not provided
    int32 public constant TOKEN_SYMBOL_TOO_LONG = 175; // The provided token symbol was too long
    int32 public constant ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN = 176; // KYC must be granted and account does not have KYC granted
    int32 public constant TOKEN_HAS_NO_KYC_KEY = 177; // KYC key is not set on token
    int32 public constant INSUFFICIENT_TOKEN_BALANCE = 178; // Token balance is not sufficient for the transaction
    int32 public constant TOKEN_WAS_DELETED = 179; // Token transactions cannot be executed on deleted token
    int32 public constant TOKEN_HAS_NO_SUPPLY_KEY = 180; // Supply key is not set on token
    int32 public constant TOKEN_HAS_NO_WIPE_KEY = 181; // Wipe key is not set on token
    int32 public constant INVALID_TOKEN_MINT_AMOUNT = 182; // The requested token mint amount would cause an invalid total supply
    int32 public constant INVALID_TOKEN_BURN_AMOUNT = 183; // The requested token burn amount would cause an invalid total supply
    int32 public constant TOKEN_NOT_ASSOCIATED_TO_ACCOUNT = 184; // A required token-account relationship is missing
    int32 public constant CANNOT_WIPE_TOKEN_TREASURY_ACCOUNT = 185; // The target of a wipe operation was the token treasury account
    int32 public constant INVALID_KYC_KEY = 186; // The provided KYC key was invalid.
    int32 public constant INVALID_WIPE_KEY = 187; // The provided wipe key was invalid.
    int32 public constant INVALID_FREEZE_KEY = 188; // The provided freeze key was invalid.
    int32 public constant INVALID_SUPPLY_KEY = 189; // The provided supply key was invalid.
    int32 public constant MISSING_TOKEN_NAME = 190; // Token Name is not provided
    int32 public constant TOKEN_NAME_TOO_LONG = 191; // Token Name is too long
    int32 public constant INVALID_WIPING_AMOUNT = 192; // The provided wipe amount must not be negative, zero or bigger than the token holder balance
    int32 public constant TOKEN_IS_IMMUTABLE = 193; // Token does not have Admin key set, thus update/delete transactions cannot be performed
    int32 public constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194; // An <tt>associateToken</tt> operation specified a token already associated to the account
    int32 public constant TRANSACTION_REQUIRES_ZERO_TOKEN_BALANCES = 195; // An attempted operation is invalid until all token balances for the target account are zero
    int32 public constant ACCOUNT_IS_TREASURY = 196; // An attempted operation is invalid because the account is a treasury
    int32 public constant TOKEN_ID_REPEATED_IN_TOKEN_LIST = 197; // Same TokenIDs present in the token list
    int32 public constant TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED = 198; // Exceeded the number of token transfers (both from and to) allowed for token transfer list
    int32 public constant EMPTY_TOKEN_TRANSFER_BODY = 199; // TokenTransfersTransactionBody has no TokenTransferList
    int32 public constant EMPTY_TOKEN_TRANSFER_ACCOUNT_AMOUNTS = 200; // TokenTransfersTransactionBody has a TokenTransferList with no AccountAmounts

    int32 public constant INVALID_SCHEDULE_ID = 201; // The Scheduled entity does not exist; or has now expired, been deleted, or been executed
    int32 public constant SCHEDULE_IS_IMMUTABLE = 202; // The Scheduled entity cannot be modified. Admin key not set
    int32 public constant INVALID_SCHEDULE_PAYER_ID = 203; // The provided Scheduled Payer does not exist
    int32 public constant INVALID_SCHEDULE_ACCOUNT_ID = 204; // The Schedule Create Transaction TransactionID account does not exist
    int32 public constant NO_NEW_VALID_SIGNATURES = 205; // The provided sig map did not contain any new valid signatures from required signers of the scheduled transaction
    int32 public constant UNRESOLVABLE_REQUIRED_SIGNERS = 206; // The required signers for a scheduled transaction cannot be resolved, for example because they do not exist or have been deleted
    int32 public constant SCHEDULED_TRANSACTION_NOT_IN_WHITELIST = 207; // Only whitelisted transaction types may be scheduled
    int32 public constant SOME_SIGNATURES_WERE_INVALID = 208; // At least one of the signatures in the provided sig map did not represent a valid signature for any required signer
    int32 public constant TRANSACTION_ID_FIELD_NOT_ALLOWED = 209; // The scheduled field in the TransactionID may not be set to true
    int32 public constant IDENTICAL_SCHEDULE_ALREADY_CREATED = 210; // A schedule already exists with the same identifying fields of an attempted ScheduleCreate (that is, all fields other than scheduledPayerAccountID)
    int32 public constant INVALID_ZERO_BYTE_IN_STRING = 211; // A string field in the transaction has a UTF-8 encoding with the prohibited zero byte
    int32 public constant SCHEDULE_ALREADY_DELETED = 212; // A schedule being signed or deleted has already been deleted
    int32 public constant SCHEDULE_ALREADY_EXECUTED = 213; // A schedule being signed or deleted has already been executed
    int32 public constant MESSAGE_SIZE_TOO_LARGE = 214; // ConsensusSubmitMessage request's message size is larger than allowed.
}
