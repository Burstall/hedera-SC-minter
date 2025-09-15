// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;
pragma experimental ABIEncoderV2;

interface IHederaTokenServiceLite {
    struct Expiry {
        int64 second;
        address autoRenewAccount;
        int64 autoRenewPeriod;
    }

    // KeyValue is simplified as TokenStaker builds it internally for the specific keys needed.
    // For the purpose of IHederaTokenServiceLite, we only need the structure TokenKey expects.
    // If more complex key structures were needed by other functions, this would need to be expanded.
    struct KeyValue {
        bool inheritAccountKey;
        address contractId;
        bytes ed25519;
        bytes ECDSA_secp256k1;
        address delegatableContractId;
    }

    struct TokenKey {
        uint256 keyType;
        KeyValue keyValue;
    }

    struct AccountAmount {
        // The Account ID, as a solidity address, that sends/receives cryptocurrency or tokens
        address accountID;
        // The amount of  the lowest denomination of the given token that
        // the account sends(negative) or receives(positive)
        int64 amount;
        // If true then the transfer is expected to be an approved allowance and the
        // accountID is expected to be the owner. The default is false (omitted).
        bool isApproval;
    }

    struct HederaToken {
        string name;
        string symbol;
        address treasury;
        string memo;
        bool tokenSupplyType; // true for INFINITE, false for FINITE
        int64 maxSupply;
        bool freezeDefault;
        TokenKey[] tokenKeys;
        Expiry expiry;
    }

    struct FixedFee {
        uint32 amount;
        address tokenId;
        bool useHbarsForPayment;
        bool useCurrentTokenForPayment;
        address feeCollector;
    }

    struct NftTransfer {
        // The solidity address of the sender
        address senderAccountID;
        // The solidity address of the receiver
        address receiverAccountID;
        // The serial number of the NFT
        int64 serialNumber;
        // If true then the transfer is expected to be an approved allowance and the
        // accountID is expected to be the owner. The default is false (omitted).
        bool isApproval;
    }

    struct TokenTransferList {
        // The ID of the token as a solidity address
        address token;
        // Applicable to tokens of type FUNGIBLE_COMMON. Multiple list of AccountAmounts, each of which
        // has an account and amount.
        AccountAmount[] transfers;
        // Applicable to tokens of type NON_FUNGIBLE_UNIQUE. Multiple list of NftTransfers, each of
        // which has a sender and receiver account, including the serial number of the NFT
        NftTransfer[] nftTransfers;
    }

    struct TransferList {
        // Multiple list of AccountAmounts, each of which has an account and amount.
        // Used to transfer hbars between the accounts in the list.
        AccountAmount[] transfers;
    }

    struct RoyaltyFee {
        uint32 numerator;
        uint32 denominator;
        uint32 amount; // Fallback fee amount
        address tokenId; // Fallback fee token ID (0x0 for HBAR)
        bool useHbarsForPayment; // If true, fallback fee is in HBAR
        address feeCollector;
    }

    /// Performs transfers among combinations of tokens and hbars
    /// @param transferList the list of hbar transfers to do
    /// @param tokenTransfers the list of token transfers to do
    /// @custom:version 0.3.0 the signature of the previous version was cryptoTransfer(TokenTransferList[] memory tokenTransfers)
    function cryptoTransfer(
        TransferList memory transferList,
        TokenTransferList[] memory tokenTransfers
    ) external returns (int64 responseCode);

    function createNonFungibleTokenWithCustomFees(
        HederaToken memory token,
        FixedFee[] memory fixedFees,
        RoyaltyFee[] memory royaltyFees
    ) external payable returns (int32 responseCode, address tokenAddress);

    function associateToken(
        address account,
        address token
    ) external returns (int32 responseCode);

    function associateTokens(
        address account,
        address[] memory tokens
    ) external returns (int64 responseCode);

    function mintToken(
        address token,
        uint64 amount,
        bytes[] memory metadata
    )
        external
        returns (
            int32 responseCode,
            uint64 newTotalSupply,
            int64[] memory serialNumbers
        );

    function transferNFTs(
        address token,
        address[] memory sender,
        address[] memory receiver,
        int64[] memory serialNumber
    ) external returns (int32 responseCode);

    // This is the ABIv1 version used by TokenStaker's batchMoveNFTs
    function transferNFT(
        address token,
        address sender,
        address receiver,
        int64 serialNumber
    ) external returns (int32 responseCode);

    function wipeTokenAccountNFT(
        address token,
        address account,
        int64[] memory serialNumbers
    ) external returns (int32 responseCode);
}
