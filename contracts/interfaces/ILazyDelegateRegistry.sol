// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/**
 * Define a registry to allow a wallet to act on behalf of the true owner.
 */
interface ILazyDelegateRegistry {
    /**
     * Emitted when a wallet delegates/revokes another wallet to act on their behalf
     */
    event WalletDelegated(address _wallet, address _delegate, bool _delegated);

    /**
     * Emitted when a token is delegated/revoked to/from another wallet
     */
    event TokenDelegated(
        address _token,
        uint256 _serial,
        address _delegate,
        address _owner,
        bool _delegated
    );

    error LazyDelegateRegistryOnlyOwner(address _owner, address _delegate);

	error BadArgumentLength(uint256 _expected, uint256 _actual);

    /**
     * msg.sender delegates another wallet to act on their behalf
     * Only one delegate wallet can set per wallet
     */
    function delegateWalletTo(address _delegate) external;

    /**
     * Caller removes wallet level delegation
     */
    function revokeDelegateWallet() external;

    /**
     * Find the wallet set as a delegate
     * @return delegate the delegate or zero address if no delegate set
     */
    function getDelegateWallet(
        address _wallet
    ) external view returns (address delegate);

    /**
     * Check if the delegate has been allowed for the actual wallet
     */
    function checkDelegateWallet(
        address _actualWallet,
        address _proposedDelegate
    ) external view returns (bool);

    /**
     * Check if the delegate is allowed to act on behalf of the specified token
     * Two stage check:
     * 1) Has this token/serial been delegated to the _proposedDelegate or anoher wallet
     * 2) If another wallet can the _proposedDelegate act on behalf of the actual owner.
     */
    function checkDelegateToken(
        address _proposedDelegate,
        address _token,
        uint256 _serial
    ) external view returns (bool);

    /**
     * Get the list of wallets the proposed _delegateWallet can act on behalf of
     */
    function getWalletsDelegatedTo(
        address _delegateWallet
    ) external view returns (address[] memory);

    /**
     * Allow call to delgate power on an NFT
     * can only delegate if you hold the NFT e.g. staking contract can then delegate out authority
     */
    function delegateNFT(
        address _delegate,
        address _token,
        uint256[] memory _serials
    ) external;

    /**
     * Allow call to delgate power on a series of NFTs
     * can only delegate if you hold the NFT e.g. staking contract can then delegate out authority
     * @dev remember to be kind on child calls
     */
    function delegateNFTs(
        address _delegate,
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external;

    /**
     * Find out which wallet has the delgate power for a given NFT
     */
    function getNFTDelegatedTo(
        address _token,
        uint256 _serial
    ) external view returns (address);

    /**
     * Find out which wallet has the delgate power for a set of NFTs
     */
    function getNFTListDelegatedTo(
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external view returns (address[][] memory);

    /**
     * Allow call to revoke power on an NFTs
     * can only delegate if you hold the NFT e.g. staking contract can then delegate out authority
     * @dev remember to be kind on child calls
     */
    function revokeDelegateNFT(address _token, uint256[] memory _serial) external;

    /**
     * Allow call to revoke power on a series of NFTs
     * can only delegate if you hold the NFT e.g. staking contract can then delegate out authority
     * @dev remember to be kind on child calls
     */
    function revokeDelegateNFTs(
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external;

    /**
     * get all the NFTs delegated to a wallet
     */
    function getNFTsDelegatedTo(
        address _delegate
    )
        external
        view
        returns (address[] memory tokens, uint256[][] memory serials);

    /**
     * get all the NFTs delegated by a wallet
     * @param _includeSerials if true then return the serials for each token
     * optionl in case scaling issues in time.
     */
    function getDelegatedNFTsBy(
        address _ownerWallet,
        bool _includeSerials
    )
        external
        view
        returns (address[] memory tokens, uint256[][] memory serials);

    /**
     * Helper function to just return serials delegate for a delegate wallet
     */
    function getSerialsDelegatedTo(
        address _delegate,
        address _token
    ) external view returns (uint256[] memory serials);

    /**
     * For a given wallet / token get the serials that have been delegated
     */
    function getSerialsDelegatedBy(
        address _ownerWallet,
        address _token
    ) external view returns (uint256[] memory serials);

    function getSerialsDelegatedByRange(
        address _ownerWallet,
        address _token,
        uint256 _from,
        uint256 _to
    ) external view returns (uint256[] memory serials);

    function getTokensWithDelegates()
        external
        view
        returns (address[] memory tokens);

    function getTokensWithDelegatesRange(
        uint256 _from,
        uint256 _to
    ) external view returns (address[] memory tokens);

    function getTotalTokensWithDelegates() external view returns (uint256);

    function getWalletsWithDelegates()
        external
        view
        returns (address[] memory wallets);

    function getWalletsWithDelegatesRange(
        uint256 _from,
        uint256 _to
    ) external view returns (address[] memory wallets);

    function getTotalWalletsWithDelegates() external view returns (uint256);
}
