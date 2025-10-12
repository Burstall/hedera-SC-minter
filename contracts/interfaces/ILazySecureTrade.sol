// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title ILazySecureTrade
 * @notice Interface for LazySecureTrade contract integration
 */
interface ILazySecureTrade {
    /// @notice Trade structure for single NFT trades
    struct Trade {
        address seller;
        address buyer;
        address token;
        uint256 serial;
        uint256 tinybarPrice;
        uint256 lazyPrice;
        uint256 expiryTime;
        uint256 nonce;
    }

    /**
     * @notice Create a trade on behalf of a user (factory use only)
     * @param _seller Address of the NFT seller
     * @param _token Address of the NFT token contract
     * @param _buyer Address of the buyer (BidderContract address)
     * @param _serial Serial number of the NFT
     * @param _tinybarPrice The price in tinybars (0 for free)
     * @param _lazyPrice The price in Lazy tokens (0 for free)
     * @param _expiryTime The expiry time of the trade (0 for no expiry)
     * @return tradeId The ID of the trade as a bytes32 hash of token and serial
     */
    function createTradeOnBehalf(
        address _seller,
        address _token,
        address _buyer,
        uint256 _serial,
        uint256 _tinybarPrice,
        uint256 _lazyPrice,
        uint256 _expiryTime
    ) external returns (bytes32 tradeId);

    /**
     * @notice Execute a trade
     * @param _tradeId The ID of the trade (hash of token and serial)
     */
    function executeTrade(bytes32 _tradeId) external payable;

    /**
     * @notice Get trade details (needed for arbitrage validation)
     * @param _tradeId The ID of the trade
     * @return Trade struct with all trade details
     */
    function getTrade(bytes32 _tradeId) external view returns (Trade memory);
}
