// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;
pragma experimental ABIEncoderV2;

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {IHederaTokenServiceLite} from "./interfaces/IHederaTokenServiceLite.sol";

abstract contract HederaTokenServiceLite is HederaResponseCodes {
    address internal constant HTS_PRECOMPILE_ADDRESS = address(0x167);
    int32 constant defaultAutoRenewPeriod = 7776000;

    /// Performs transfers among combinations of tokens and hbars
    /// @param transferList the list of hbar transfers to do
    /// @param tokenTransfers the list of transfers to do
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    /// @custom:version 0.3.0 the signature of the previous version was cryptoTransfer(TokenTransferList[] memory tokenTransfers)
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
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }

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
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }

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
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }

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
            : (HederaResponseCodes.UNKNOWN, address(0));
    }

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
            : (HederaResponseCodes.UNKNOWN, 0, new int64[](0));
    }

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
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }

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
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }

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
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }
}
