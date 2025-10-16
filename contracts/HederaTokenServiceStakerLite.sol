// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;
pragma experimental ABIEncoderV2;

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";

/// @title Lightweight Hedera Token Service for TokenStakerV2
/// @author Optimized version by stowerling.eth / stowerling.hbar
/// @notice This contract contains ONLY the 3 HTS functions needed by TokenStakerV2
/// @dev Reduces bytecode by ~5-12 KB compared to full HederaTokenService.sol
/// @dev Contains: cryptoTransfer, associateToken, associateTokens
abstract contract HederaTokenServiceStakerLite is HederaResponseCodes {
    address public constant PRECOMPILE_ADDRESS = address(0x167);

    /// @notice Performs transfers among combinations of tokens and hbars
    /// @param transferList the list of hbar transfers to do
    /// @param tokenTransfers the list of token/NFT transfers to do
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    /// @custom:version 0.3.0
    function cryptoTransfer(
        IHederaTokenService.TransferList memory transferList,
        IHederaTokenService.TokenTransferList[] memory tokenTransfers
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenService.cryptoTransfer.selector,
                transferList,
                tokenTransfers
            )
        );
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }

    /// @notice Associates the provided account with the provided token
    /// @dev Single token association - use associateTokens for batch operations
    /// @param account The account to be associated with the provided token
    /// @param token The token to be associated with the provided account
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    function associateToken(
        address account,
        address token
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenService.associateToken.selector,
                account,
                token
            )
        );
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }

    /// @notice Associates the provided account with the provided tokens (batch operation)
    /// @dev More gas efficient than multiple associateToken calls
    /// @param account The account to be associated with the provided tokens
    /// @param tokens The tokens to be associated with the provided account
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    function associateTokens(
        address account,
        address[] memory tokens
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenService.associateTokens.selector,
                account,
                tokens
            )
        );
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }

    /// Allows spender to withdraw from your account multiple times, up to the value amount. If this function is called
    /// again it overwrites the current allowance with value.
    /// Only Applicable to Fungible Tokens
    /// @param token The hedera token address to approve
    /// @param spender the account authorized to spend
    /// @param amount the amount of tokens authorized to spend.
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    function approve(
        address token,
        address spender,
        uint256 amount
    ) internal returns (int32 responseCode) {
        (bool success, bytes memory result) = PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(
                IHederaTokenService.approve.selector,
                token,
                spender,
                amount
            )
        );
        responseCode = success
            ? abi.decode(result, (int32))
            : HederaResponseCodes.UNKNOWN;
    }
}
