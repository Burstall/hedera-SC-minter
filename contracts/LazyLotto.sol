// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Farming mission
/// @author stowerling.eth / stowerling.hbar
/// @notice Degens going to degen - this contract allows users to spend their $LAZY in the hope
/// of getting prizes from the lotto.
/// @dev now uses hbar for royalty handling currently

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IPrngGenerator} from "./interfaces/IPrngGenerator.sol";
import {HTSLazyForeverMintLibrary} from "./HTSLazyForeverMintLibrary.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

/// @title  LazyLottoV2
/// @notice On-chain lotto pools with Hedera VRF randomness, multi-roll batching, burn on entry, and transparent prize management.
contract LazyLotto is ReentrancyGuard, Pausable {
    // --- DATA STRUCTURES ---
    struct PrizePackage {
        address token; // HTS token address (0 = HBAR)
        uint256 amount; // amount for fungible prizes
        address[] nftTokens; // NFT addresses
        uint256[][] nftSerials; // NFT serials
    }
    struct LottoPool {
        string ticketCID;
        string winCID;
        uint256 winRateThousandthsOfBps; // Moved up
        uint256 entryFee; // Moved up
        PrizePackage[] prizes; // Moved up
        uint256 outstandingEntries; // Moved up
        address poolTokenId;
        bool paused; // Grouped with poolTokenId and closed
        bool closed; // Grouped with poolTokenId and paused
        address feeToken; // Moved down
    }
    struct PendingPrize {
        uint256 poolId; // pool ID
        bool asNFT; // true if the prize is an NFT - Moved up to pack with prize.token
        PrizePackage prize; // prize package
    }
    struct TimeWindow {
        uint256 start;
        uint256 end;
        uint16 bonusBps;
    }

    /// --- CONSTANTS ---
    /// @notice Maximum possible threshold for winning (100%)
    /// @dev Expressed as integer from 0-100,000,000 where 100,000,000 represents 100%
    uint256 public constant MAX_WIN_RATE_THRESHOLD = 100_000_000;
    uint256 public constant NFT_BATCH_SIZE = 10;

    // --- ENUMS ---
    enum MethodEnum {
        FALLBACK,
        RECEIVE,
        FT_TRANSFER,
        HBAR_TRANSFER
    }

    // --- ERRORS ---
    error LottoPoolNotFound(uint256 _poolId);
    error BalanceError(
        address _tokenAddress,
        uint256 _balance,
        uint256 _requestedAmount
    );
    error AssociationFailed(address _tokenAddress);
    error BadParameters();
    error NotAdmin();
    error FungibleTokenTransferFailed();
    error LastAdminError();
    error PoolIsClosed();
    error PoolNotClosed();
    error NotEnoughHbar(uint256 _needed, uint256 _presented);
    error NotEnoughFungible(uint256 _needed, uint256 _presented);
    error NotEnoughTickets(
        uint256 _poolId,
        uint256 _requested,
        uint256 _available
    );
    error NoTickets(uint256 _poolId, address _user);
    error NoPendingPrizes();
    error FailedNFTCreate();
    error FailedNFTMintAndSend();
    error FailedNFTWipe();
    error PoolOnPause();
    error EntriesOutstanding(uint256 _outstanding, uint256 _tokensOutstanding);
    error NoPrizesAvailable();
    error AlreadyWinningTicket();

    /// --- EVENTS ---
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event PoolCreated(uint256 indexed poolId);
    event PoolPaused(uint256 indexed poolId);
    event PoolClosed(uint256 indexed poolId);
    event PoolOpened(uint256 indexed poolId);
    event EntryPurchased(
        address indexed user,
        uint256 indexed poolId,
        uint256 count
    );
    event Rolled(
        address indexed user,
        uint256 indexed poolId,
        bool won,
        uint256 rollBps
    );
    event PrizeClaimed(address indexed user, PrizePackage prize);
    event TicketEvent(
        uint256 indexed poolId,
        address indexed tokenId,
        address indexed user,
        int64[] serialNumber,
        bool mint
    );
    event TimeBonusAdded(uint256 start, uint256 end, uint16 bonusBps);
    event NFTBonusSet(address indexed token, uint16 bonusBps);
    event LazyBalanceBonusSet(uint256 threshold, uint16 bonusBps);
    event ContractUpdate(MethodEnum method, address _sender, uint256 _amount);

    // --- STATE ---
    mapping(address => bool) private _isAddressAdmin;
    uint256 private _adminCount;

    IPrngGenerator public prng;
    uint256 public burnPercentage;

    LottoPool[] private pools;
    // allow a lookup of prizes available to a user

    mapping(address => PendingPrize[]) private pending;
    // switched to the hash of tokenId + serialNumber when redeemed to NFT
    mapping(bytes32 => PendingPrize) private pendingNFTs;
    // need to track how much of an FT the contract needs for prizes (won and pledged to pools)
    mapping(address => uint256) private ftTokensForPrizes;

    // Bonus config
    uint16 public timeBonusBps;
    mapping(address => uint16) public nftBonusBps;
    address[] public nftBonusTokens;
    uint256 public lazyBalanceThreshold;
    uint16 public lazyBalanceBonusBps;
    TimeWindow[] public timeBonuses;
    // mapping of poolId -> User -> entries in state
    mapping(uint256 => mapping(address => uint256)) public userEntries;

    address public lazyToken;
    ILazyGasStation public lazyGasStation;
    ILazyDelegateRegistry public lazyDelegateRegistry;

    // --- MODIFIERS ---
    modifier onlyAdmin() {
        if (!_isAddressAdmin[msg.sender]) {
            revert NotAdmin();
        }
        _;
    }
    modifier validPool(uint256 id) {
        if (id >= pools.length) {
            revert LottoPoolNotFound(id);
        }

        if (pools[id].closed) {
            revert PoolIsClosed();
        }
        _;
    }

    modifier refill() {
        // check the $LAZY balance of the contract and refill if necessary
        if (IERC20(lazyToken).balanceOf(address(this)) < 20) {
            lazyGasStation.refillLazy(50);
        }
        // check the balance of the contract and refill if necessary
        if (address(this).balance < 20) {
            lazyGasStation.refillHbar(50);
        }
        _;
    }

    constructor(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry,
        address _prng,
        uint256 _burnPercentage
    ) {
        if (
            _lazyToken == address(0) ||
            _lazyGasStation == address(0) ||
            _lazyDelegateRegistry == address(0) ||
            _prng == address(0)
        ) {
            revert BadParameters();
        }

        lazyToken = _lazyToken;
        lazyGasStation = ILazyGasStation(_lazyGasStation);
        lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);
        prng = IPrngGenerator(_prng);

        burnPercentage = _burnPercentage;

        // Initialize the admin with the deployer
        _isAddressAdmin[msg.sender] = true;
        _adminCount = 1;
        emit AdminAdded(msg.sender);
    }

    // --- ADMIN FUNCTIONS ---
    function addAdmin(address a) external onlyAdmin {
        if (a == address(0)) revert BadParameters();
        if (!_isAddressAdmin[a]) {
            _isAddressAdmin[a] = true;
            _adminCount++;
            emit AdminAdded(a);
        }
    }

    function removeAdmin(address a) external onlyAdmin {
        if (a == address(0)) revert BadParameters();
        if (_adminCount <= 1) {
            revert LastAdminError();
        }
        if (_isAddressAdmin[a]) {
            _isAddressAdmin[a] = false;
            _adminCount--;
            emit AdminRemoved(a);
        } else {
            revert NotAdmin();
        }
    }

    function setBurnPercentage(uint256 _burnPercentage) external onlyAdmin {
        if (_burnPercentage > 100) {
            revert BadParameters();
        }
        burnPercentage = _burnPercentage;
    }

    function setLazyBalanceBonus(
        uint256 _threshold,
        uint16 _bonusBps
    ) external onlyAdmin {
        if (_threshold == 0 || _bonusBps > 10000) {
            revert BadParameters();
        }
        lazyBalanceThreshold = _threshold;
        lazyBalanceBonusBps = _bonusBps;
        emit LazyBalanceBonusSet(_threshold, _bonusBps);
    }

    function setNFTBonus(address _token, uint16 _bonusBps) external onlyAdmin {
        if (_token == address(0) || _bonusBps > 10000) {
            revert BadParameters();
        }
        nftBonusTokens.push(_token);
        nftBonusBps[_token] = _bonusBps;
        emit NFTBonusSet(_token, _bonusBps);
    }

    function setTimeBonus(
        uint256 _start,
        uint256 _end,
        uint16 _bonusBps
    ) external onlyAdmin {
        if (_start == 0 || _end == 0 || _bonusBps > 10000) {
            revert BadParameters();
        }
        timeBonuses.push(TimeWindow(_start, _end, _bonusBps));
        emit TimeBonusAdded(_start, _end, _bonusBps);
    }

    function removeTimeBonus(uint256 index) external onlyAdmin {
        if (index >= timeBonuses.length) {
            revert BadParameters();
        }
        timeBonuses[index] = timeBonuses[timeBonuses.length - 1];
        timeBonuses.pop();
    }

    function removeNFTBonus(uint256 index) external onlyAdmin {
        if (index >= nftBonusTokens.length) {
            revert BadParameters();
        }
        nftBonusTokens[index] = nftBonusTokens[nftBonusTokens.length - 1];
        delete nftBonusBps[nftBonusTokens[index]];
        nftBonusTokens.pop();
    }

    /// Initializes a fresh Lotto pool with the given parameters
    /// @param _name The name of the Pool (for the token)
    /// @param _symbol The symbol of the pool token
    /// @param _memo The memo for the token
    /// @param _royalties The royalties for the token (NFT)
    /// @param _ticketCID The CID for the (unrolled) ticket metadata
    /// @param _winCID The CID for the winning metadata
    /// @param _winRateTenThousandthsOfBps The winning rate in basis points (0-100_000_000)
    function createPool(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        HTSLazyForeverMintLibrary.NFTFeeObject[] memory _royalties,
        string memory _ticketCID,
        string memory _winCID,
        uint256 _winRateTenThousandthsOfBps,
        uint256 _entryFee,
        address _feeToken
    ) external onlyAdmin {
        // check the parameters are valid
        if (
            bytes(_name).length == 0 ||
            bytes(_symbol).length == 0 ||
            bytes(_memo).length == 0 ||
            bytes(_ticketCID).length == 0 ||
            bytes(_winCID).length == 0 ||
            bytes(_memo).length > 100 ||
            _royalties.length > 10 ||
            _winRateTenThousandthsOfBps > MAX_WIN_RATE_THRESHOLD ||
            _entryFee == 0
        ) {
            revert BadParameters();
        }

        // we need to associate the _feeToken with the contract
        if (
            _feeToken != address(0) &&
            _feeToken != lazyToken &&
            IERC20(_feeToken).balanceOf(address(this)) == 0
        ) {
            bool success = HTSLazyForeverMintLibrary.tokenAssociate(_feeToken);
            if (!success) {
                revert AssociationFailed(_feeToken);
            }
        }

        (int256 responseCode, address tokenAddress) = HTSLazyForeverMintLibrary
            .createTokenForNewPool(
                address(this),
                _name,
                _symbol,
                _memo,
                _royalties
            );

        if (responseCode != HTSLazyForeverMintLibrary.SUCCESS) {
            revert FailedNFTCreate();
        }

        // now create the pool and add it to the list of pools;
        pools.push(
            LottoPool({
                ticketCID: _ticketCID,
                winCID: _winCID,
                poolTokenId: tokenAddress,
                winRateThousandthsOfBps: _winRateTenThousandthsOfBps,
                entryFee: _entryFee,
                feeToken: _feeToken,
                prizes: new PrizePackage[](0),
                outstandingEntries: 0,
                paused: false,
                closed: false
            })
        );

        emit PoolCreated(pools.length - 1);
    }

    function addPrizePackage(
        uint256 poolId,
        address token,
        uint256 amount,
        address[] memory nftTokens,
        uint256[][] memory nftSerials
    ) external payable validPool(poolId) refill {
        if (nftTokens.length != nftSerials.length) {
            revert BadParameters();
        }

        _checkAndPullFungible(token, amount);
        HTSLazyForeverMintLibrary.bulkTransfer(
            HTSLazyForeverMintLibrary.TransferDirection.STAKING,
            nftTokens,
            nftSerials,
            address(this),
            msg.sender
        );

        LottoPool storage p = pools[poolId];
        p.prizes.push(
            PrizePackage({
                token: token,
                amount: amount,
                nftTokens: nftTokens,
                nftSerials: nftSerials
            })
        );
    }

    function addMultipleFungiblePrizes(
        uint256 poolId,
        address tokenId,
        uint256[] memory amounts
    ) external payable validPool(poolId) {
        if (amounts.length == 0) {
            revert BadParameters();
        }

        // for efficiency we will pull all the tokens in one go
        // and then split them out into the prize packages

        // get the total amount of tokens to transfer
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; ) {
            totalAmount += amounts[i];
            unchecked {
                ++i;
            }
        }

        // check the contract has enough of the token to pay the prize
        _checkAndPullFungible(tokenId, totalAmount);

        LottoPool storage p = pools[poolId];

        uint256 _length = amounts.length;
        for (uint256 i = 0; i < _length; ) {
            p.prizes.push(
                PrizePackage({
                    token: tokenId,
                    amount: amounts[i],
                    nftTokens: new address[](0),
                    nftSerials: new uint256[][](0)
                })
            );

            unchecked {
                ++i;
            }
        }
    }

    /// Admin can pause a pool preventing the purchase of further tickets
    function pausePool(uint256 poolId) external onlyAdmin validPool(poolId) {
        LottoPool storage p = pools[poolId];
        p.paused = true;
        emit PoolPaused(poolId);
    }

    /// Admin can unpause a pool allowing the purchase of further tickets
    function unpausePool(uint256 poolId) external onlyAdmin validPool(poolId) {
        LottoPool storage p = pools[poolId];
        p.paused = false;
        emit PoolOpened(poolId);
    }

    /// Admin can permanently close a pool preventing any further actions
    /// Required to be able to remove prizes from the pool
    function closePool(uint256 poolId) external onlyAdmin validPool(poolId) {
        LottoPool storage p = pools[poolId];

        // we can only close a pool if there are no outstanding entries and no oustanding tokens too
        if (
            p.outstandingEntries > 0 || IERC20(p.poolTokenId).totalSupply() > 0
        ) {
            revert EntriesOutstanding(
                p.outstandingEntries,
                IERC20(p.poolTokenId).totalSupply()
            );
        }

        p.closed = true;
        emit PoolClosed(poolId);
    }

    /// Admin can remove prizes from a pool if closed
    function removePrizes(
        uint256 poolId,
        uint256 prizeIndex
    ) external onlyAdmin refill {
        LottoPool storage p = pools[poolId];
        if (!p.closed) {
            revert PoolNotClosed();
        }

        // check the prize index is valid
        if (prizeIndex >= p.prizes.length) {
            revert BadParameters();
        }

        PrizePackage memory prize = p.prizes[prizeIndex];

        // remove the prize from the pool
        p.prizes[prizeIndex] = p.prizes[p.prizes.length - 1];
        p.prizes.pop();

        // reduce the amount of the token needed for prizes
        ftTokensForPrizes[prize.token] -= prize.amount;

        // transfer the token amount back to the caller
        if (prize.token == address(0)) {
            // transfer the HBAR to the caller
            Address.sendValue(payable(msg.sender), prize.amount);
        } else if (prize.token == lazyToken) {
            // transfer the $LAZY to the caller
            lazyGasStation.payoutLazy(msg.sender, prize.amount, 0);
        } else {
            // attempt to transfer the token to the caller
            IERC20(prize.token).transfer(msg.sender, prize.amount);
        }

        // then transfer the NFTs back to the caller
        HTSLazyForeverMintLibrary.bulkTransfer(
            HTSLazyForeverMintLibrary.TransferDirection.WITHDRAWAL,
            prize.nftTokens,
            prize.nftSerials,
            address(this),
            msg.sender
        );
    }

    // PAUSE
    function pause() external onlyAdmin {
        _pause();
    }
    function unpause() external onlyAdmin {
        _unpause();
    }

    // --- USER ACTIONS ---
    function buyEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused validPool(poolId) nonReentrant {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        _buyEntry(poolId, ticketCount, false);
    }

    /// Helper function to allow the user to buy and roll in one transaction
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    function buyAndRollEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused validPool(poolId) nonReentrant {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        _buyEntry(poolId, ticketCount, false);
        _roll(poolId, ticketCount);
    }

    function buyAndRedeemEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused validPool(poolId) nonReentrant {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        _buyEntry(poolId, ticketCount, false);
        _redeemEntriesToNFT(poolId, ticketCount, msg.sender);
    }

    function adminBuyEntry(
        uint256 poolId,
        uint256 ticketCount,
        address onBehalfOf
    ) external whenNotPaused onlyAdmin validPool(poolId) nonReentrant {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        _buyEntry(poolId, ticketCount, false);
        _redeemEntriesToNFT(poolId, ticketCount, onBehalfOf);
    }

    /// User rolls all tickets in the pool (in memory not any NFT entries)
    function rollAll(
        uint256 poolId
    )
        external
        whenNotPaused
        validPool(poolId)
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        if (userEntries[poolId][msg.sender] == 0) {
            revert NoTickets(poolId, msg.sender);
        }
        return _roll(poolId, userEntries[poolId][msg.sender]);
    }

    function rollBatch(
        uint256 poolId,
        uint256 numberToRoll
    )
        external
        whenNotPaused
        validPool(poolId)
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        if (numberToRoll == 0) {
            revert BadParameters();
        }
        if (numberToRoll > userEntries[poolId][msg.sender]) {
            revert NotEnoughTickets(
                poolId,
                numberToRoll,
                userEntries[poolId][msg.sender]
            );
        }

        return _roll(poolId, numberToRoll);
    }

    function rollWithNFT(
        uint256 poolId,
        int64[] memory serialNumbers
    )
        external
        whenNotPaused
        validPool(poolId)
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        if (serialNumbers.length == 0) {
            revert BadParameters();
        }

        // redeem the tickets for the user and credit the entries
        _redeemEntriesFromNFT(poolId, serialNumbers);
        return _roll(poolId, serialNumbers.length);
    }

    function redeemPrizeToNFT(
        uint256[] memory indices
    ) external nonReentrant returns (int64[] memory serials) {
        return _redeemPendingPrizeToNFT(indices);
    }

    function claimPrizeFromNFT(
        address tokenId,
        int64[] memory serialNumbers
    ) external nonReentrant {
        uint256[] memory prizeSlots = _redeemPendingPrizeFromNFT(
            tokenId,
            serialNumbers
        );
        uint256 _length = prizeSlots.length;
        // Claim in reverse order to avoid index shifting issues
        for (uint256 i = _length; i > 0; ) {
            _claimPrize(prizeSlots[i - 1]);
            unchecked {
                --i;
            }
        }
    }

    function claimPrize(uint256 pkgIdx) external nonReentrant {
        _claimPrize(pkgIdx);
    }

    function claimAllPrizes() external nonReentrant {
        if (pending[msg.sender].length == 0) {
            revert NoPendingPrizes();
        }
        // Iterate by always claiming the prize at index 0
        // This is safe as the array shrinks and elements shift (or last is swapped to 0 and popped)
        while (pending[msg.sender].length > 0) {
            _claimPrize(0);
        }
    }

    /// --- VIEWS (Getters) ---
    function totalPools() external view returns (uint256) {
        return pools.length;
    }
    function getPoolDetails(
        uint256 id
    ) external view returns (LottoPool memory) {
        if (id < pools.length) {
            return pools[id];
        } else {
            revert LottoPoolNotFound(id);
        }
    }
    function getUsersEntries(
        uint256 poolId,
        address user
    ) external view returns (uint256) {
        return userEntries[poolId][user];
    }
    function getUserEntries(
        address user
    ) external view returns (uint256[] memory) {
        uint256[] memory entries = new uint256[](pools.length);
        for (uint256 i = 0; i < pools.length; i++) {
            entries[i] = userEntries[i][user];
        }
        return entries;
    }
    function getPendingPrizes(
        address user
    ) external view returns (PendingPrize[] memory) {
        return pending[user];
    }
    function getPendingPrize(
        address user,
        uint256 index
    ) external view returns (PendingPrize memory) {
        // check the user has a pending prize at this index
        if (index >= pending[user].length) {
            revert BadParameters();
        }
        return pending[user][index];
    }
    function getPendingPrizes(
        address tokenId,
        uint256 serialNumber
    ) external view returns (PendingPrize memory) {
        return pendingNFTs[keccak256(abi.encode(tokenId, serialNumber))];
    }
    function isAdmin(address a) external view returns (bool) {
        return _isAddressAdmin[a];
    }
    function totalTimeBonuses() external view returns (uint256) {
        return timeBonuses.length;
    }
    function totalNFTBonusTokens() external view returns (uint256) {
        return nftBonusTokens.length;
    }

    /// Function to calculate the boost for a user based on their holdings and time bonuses
    /// @param _user The address of the user to calculate the boost for
    /// @return boost The calculated boost in basis points (bps)
    function calculateBoost(address _user) public view returns (uint32) {
        uint32 boost;
        uint256 ts = block.timestamp;
        for (uint256 i; i < timeBonuses.length; ) {
            if (ts >= timeBonuses[i].start && ts <= timeBonuses[i].end) {
                boost += timeBonuses[i].bonusBps;
            }

            unchecked {
                i++;
            }
        }
        for (uint256 i; i < nftBonusTokens.length; ) {
            address tkn = nftBonusTokens[i];
            if (
                IERC721(tkn).balanceOf(_user) > 0 ||
                lazyDelegateRegistry.getSerialsDelegatedTo(_user, tkn).length >
                0
            ) boost += nftBonusBps[tkn];

            unchecked {
                i++;
            }
        }
        if (IERC20(lazyToken).balanceOf(_user) >= lazyBalanceThreshold) {
            boost += lazyBalanceBonusBps;
        }

        // scale bps to tens of thousands of bps
        boost *= 10_000;

        return boost;
    }

    /// --- INTERNAL FUNCTIONS ---
    function _checkAndPullFungible(address tokenId, uint256 amount) internal {
        ftTokensForPrizes[tokenId] += amount;

        if (tokenId == address(0)) {
            if (address(this).balance < ftTokensForPrizes[tokenId]) {
                revert BalanceError(
                    address(0),
                    address(this).balance,
                    ftTokensForPrizes[address(0)]
                );
            }
        } else if (tokenId == lazyToken) {
            // transfer the $LAZY to the LGS
            lazyGasStation.drawLazyFrom(msg.sender, amount, 0);
        } else {
            // attempt to transfer the token to the contract
            if (
                IERC20(tokenId).balanceOf(address(this)) <
                ftTokensForPrizes[tokenId]
            ) {
                // first check if the contract has a balance > 0 (else try to associate)
                if (IERC20(tokenId).balanceOf(address(this)) == 0) {
                    bool success = HTSLazyForeverMintLibrary.tokenAssociate(
                        tokenId
                    );
                    if (!success) {
                        revert AssociationFailed(tokenId);
                    }
                }

                // now try and move the token to the contract (needs an allowance to be in place)
                IERC20(tokenId).transferFrom(msg.sender, address(this), amount);

                // check the contract has enough of the token to pay the prize
                if (
                    IERC20(tokenId).balanceOf(address(this)) <
                    ftTokensForPrizes[tokenId]
                ) {
                    revert BalanceError(
                        tokenId,
                        IERC20(tokenId).balanceOf(address(this)),
                        ftTokensForPrizes[tokenId]
                    );
                }
            }
        }
    }

    function _redeemEntriesFromNFT(
        uint256 _poolId,
        int64[] memory serialNumbers
    ) internal {
        LottoPool storage p = pools[_poolId];

        // check the serials are not winning tickets
        // then wipe the NFTs from the user
        // and credit the entries
        uint256 _numTickets = serialNumbers.length;
        for (uint256 outer = 0; outer < _numTickets; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (_numTickets - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (_numTickets - outer);
            int64[] memory batchSerialsForBurn = new int64[](thisBatch);
            for (
                uint256 inner = 0;
                ((outer + inner) < _numTickets) && (inner < thisBatch);

            ) {
                // check the serial is not a winning ticket
                if (
                    // hash the tokenId and serial number to get the key
                    pendingNFTs[
                        keccak256(
                            abi.encode(
                                p.poolTokenId,
                                serialNumbers[outer + inner]
                            )
                        )
                    ].asNFT
                ) {
                    revert AlreadyWinningTicket();
                }

                batchSerialsForBurn[inner] = serialNumbers[outer + inner];

                unchecked {
                    ++inner;
                }
            }

            emit TicketEvent(
                _poolId,
                p.poolTokenId,
                msg.sender,
                batchSerialsForBurn,
                false
            );

            int256 response = HTSLazyForeverMintLibrary.wipeTokenAccountNFT(
                p.poolTokenId,
                msg.sender,
                batchSerialsForBurn
            );

            if (response != HTSLazyForeverMintLibrary.SUCCESS) {
                revert FailedNFTWipe();
            }

            // now credit the entries to the user
            userEntries[_poolId][msg.sender] += thisBatch;
            p.outstandingEntries += thisBatch;
        }
    }

    function _redeemPendingPrizeToNFT(
        uint256[] memory _idxs
    ) internal returns (int64[] memory mintedSerialsToUser) {
        uint256 count = _idxs.length;
        if (count == 0) {
            revert BadParameters();
        }
        mintedSerialsToUser = new int64[](count);

        // Sort _idxs descending to handle removals from pending[msg.sender] correctly
        for (uint256 i = 0; i < count; ) {
            for (uint256 j = i + 1; j < count; ) {
                if (_idxs[i] < _idxs[j]) {
                    uint256 tmp = _idxs[i];
                    _idxs[i] = _idxs[j];
                    _idxs[j] = tmp;
                }
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }

        for (uint256 k = 0; k < count; ) {
            uint256 prizeIndexInPendingArray = _idxs[k];

            if (prizeIndexInPendingArray >= pending[msg.sender].length) {
                revert BadParameters(); // Index out of bounds
            }

            PendingPrize memory prizeToConvert = pending[msg.sender][
                prizeIndexInPendingArray
            ];

            // Remove from pending[msg.sender] by swapping with the last element and popping
            if (prizeIndexInPendingArray < pending[msg.sender].length - 1) {
                pending[msg.sender][prizeIndexInPendingArray] = pending[
                    msg.sender
                ][pending[msg.sender].length - 1];
            }
            pending[msg.sender].pop();

            prizeToConvert.asNFT = true; // Mark that this prize is now represented by an NFT

            bytes[] memory metadata = new bytes[](1);
            metadata[0] = abi.encodePacked(pools[prizeToConvert.poolId].winCID);
            address poolTokenIdForPrizeNFT = pools[prizeToConvert.poolId]
                .poolTokenId;

            (
                int32 responseCode,
                int64[] memory mintedSerials
            ) = HTSLazyForeverMintLibrary.mintAndTransferNFT(
                    poolTokenIdForPrizeNFT,
                    address(this),
                    msg.sender,
                    metadata
                );

            if (responseCode != HTSLazyForeverMintLibrary.SUCCESS) {
                revert FailedNFTMintAndSend();
            }

            // 3. Store in pendingNFTs mapping
            bytes32 nftKey = keccak256(
                abi.encode(poolTokenIdForPrizeNFT, mintedSerials[0])
            );
            pendingNFTs[nftKey] = prizeToConvert;
            mintedSerialsToUser[k] = mintedSerials[0];

            emit TicketEvent(
                prizeToConvert.poolId,
                poolTokenIdForPrizeNFT,
                msg.sender,
                mintedSerials,
                true
            );

            unchecked {
                ++k;
            }
        }
    }

    function _redeemPendingPrizeFromNFT(
        address poolTokenId, // This is the poolTokenId of the NFT voucher
        int64[] memory serialNumbers
    ) internal returns (uint256[] memory prizeSlotsInPendingArray) {
        uint256 numSerials = serialNumbers.length;
        if (numSerials == 0) {
            revert BadParameters();
        }

        prizeSlotsInPendingArray = new uint256[](numSerials);
        uint256 successfullyRedeemedCount = 0;
        uint256 poolId = 0;

        for (uint256 i = 0; i < numSerials; ) {
            bytes32 nftKey = keccak256(
                abi.encode(poolTokenId, serialNumbers[i])
            );
            PendingPrize memory prize = pendingNFTs[nftKey];

            if (!prize.asNFT) {
                // If asNFT is false, it's not a valid entry from pendingNFTs or was already processed.
                // Could revert, or skip this serial. For now, revert.
                revert BadParameters();
            }

            delete pendingNFTs[nftKey]; // Remove from NFT voucher mapping

            prize.asNFT = false; // Mark as a regular pending prize again
            poolId = prize.poolId;
            pending[msg.sender].push(prize);
            prizeSlotsInPendingArray[successfullyRedeemedCount] =
                pending[msg.sender].length -
                1;
            successfullyRedeemedCount++;

            // Wipe the NFT voucher from the sender's account
            int64[] memory singleSerialArray = new int64[](1);
            singleSerialArray[0] = serialNumbers[i];
            int256 responseWipe = HTSLazyForeverMintLibrary.wipeTokenAccountNFT(
                poolTokenId,
                msg.sender,
                singleSerialArray
            );

            if (responseWipe != HTSLazyForeverMintLibrary.SUCCESS) {
                // If wipe fails, the state might be inconsistent. Reverting is safest.
                // Consider if this should revert all or just this specific redemption.
                revert FailedNFTWipe();
            }

            unchecked {
                ++i;
            }
        }

        emit TicketEvent(poolId, poolTokenId, msg.sender, serialNumbers, false);

        // If some redemptions failed and we chose to skip (not current logic), resize array.
        // For now, successfullyRedeemedCount should equal numSerials if no reverts.
        if (successfullyRedeemedCount < numSerials) {
            uint256[] memory sizedPrizeSlots = new uint256[](
                successfullyRedeemedCount
            );
            for (uint256 j = 0; j < successfullyRedeemedCount; ) {
                sizedPrizeSlots[j] = prizeSlotsInPendingArray[j];
                unchecked {
                    ++j;
                }
            }
            return sizedPrizeSlots;
        }
        return prizeSlotsInPendingArray;
    }

    function _redeemEntriesToNFT(
        uint256 _poolId,
        uint256 _numTickets,
        address _onBehalfOf
    ) internal returns (int64[] memory mintedSerials) {
        if (userEntries[_poolId][msg.sender] < _numTickets) {
            revert NotEnoughTickets(
                _poolId,
                _numTickets,
                userEntries[_poolId][msg.sender]
            );
        }

        // Remove the tickets from the user's entry count
        userEntries[_poolId][msg.sender] -= _numTickets;

        LottoPool storage p = pools[_poolId];
        // @dev: not adjusting the oustanding entries here, as the tickets are not being rolled yet

        // mint the NFTs for the user
        for (uint256 outer = 0; outer < _numTickets; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (_numTickets - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (_numTickets - outer);
            bytes[] memory batchMetadataForMint = new bytes[](thisBatch);
            for (
                uint256 inner = 0;
                ((outer + inner) < _numTickets) && (inner < thisBatch);

            ) {
                batchMetadataForMint[inner] = bytes(p.ticketCID);
                unchecked {
                    ++inner;
                }
            }

            int32 responseCode;

            (responseCode, mintedSerials) = HTSLazyForeverMintLibrary
                .mintAndTransferNFT(
                    p.poolTokenId,
                    address(this),
                    _onBehalfOf,
                    batchMetadataForMint
                );

            if (responseCode != HTSLazyForeverMintLibrary.SUCCESS) {
                revert FailedNFTMintAndSend();
            }

            emit TicketEvent(
                _poolId,
                p.poolTokenId,
                msg.sender,
                mintedSerials,
                true
            );
        }
    }

    function _buyEntry(
        uint256 poolId,
        uint256 ticketCount,
        bool isFreeOfPayment
    ) internal {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        LottoPool storage p = pools[poolId];

        if (p.paused) {
            revert PoolOnPause();
        }

        if (!isFreeOfPayment) {
            uint256 totalFee = p.entryFee * ticketCount;

            if (p.feeToken == address(0)) {
                if (msg.value < totalFee) {
                    revert NotEnoughHbar(totalFee, msg.value);
                }
                // Refund excess HBAR
                if (msg.value > totalFee) {
                    Address.sendValue(
                        payable(msg.sender),
                        msg.value - totalFee
                    );
                }
            } else if (p.feeToken == lazyToken) {
                // If the token is $LAZY, take payment to LGS and burn part of the fee

                // This is a SAFE transfer method and will revert if the transfer fails
                lazyGasStation.drawLazyFrom(
                    msg.sender,
                    totalFee,
                    burnPercentage
                );
            } else {
                bool success = IERC20(p.feeToken).transferFrom(
                    msg.sender,
                    address(this),
                    totalFee
                );

                if (!success) {
                    revert NotEnoughFungible(totalFee, msg.value);
                }
            }
        }

        p.outstandingEntries += ticketCount;
        userEntries[poolId][msg.sender] += ticketCount;
        emit EntryPurchased(msg.sender, poolId, ticketCount);
    }

    function _roll(
        uint256 poolId,
        uint256 numberToRoll
    ) internal returns (uint256 wins, uint256 offset) {
        uint32 boostBps = calculateBoost(msg.sender);

        LottoPool storage p = pools[poolId];

        // ensure we know the total number of prizes available
        uint256 totalPrizesAvailable = p.prizes.length;
        if (totalPrizesAvailable == 0) {
            revert NoPrizesAvailable();
        }

        if (p.outstandingEntries < numberToRoll) {
            revert NotEnoughTickets(poolId, numberToRoll, p.outstandingEntries);
        }
        if (userEntries[poolId][msg.sender] < numberToRoll) {
            revert NotEnoughTickets(
                poolId,
                numberToRoll,
                userEntries[poolId][msg.sender]
            );
        }

        p.outstandingEntries -= numberToRoll;
        userEntries[poolId][msg.sender] -= numberToRoll;

        // boostBps is already scaled to 10_000s of bps in calculateBoost
        uint256 winRateWithBoost = p.winRateThousandthsOfBps + boostBps;

        if (winRateWithBoost > MAX_WIN_RATE_THRESHOLD) {
            winRateWithBoost = MAX_WIN_RATE_THRESHOLD;
        }

        offset = pending[msg.sender].length;

        uint256[] memory rolls = prng.getPseudorandomNumberArray(
            0, // min value for random number
            MAX_WIN_RATE_THRESHOLD, // max value for random number (exclusive for PRNG, so 0 to 99,999,999)
            uint256(
                keccak256(
                    abi.encodePacked(
                        block.timestamp,
                        msg.sender,
                        poolId,
                        numberToRoll
                    )
                )
            ), // seed
            numberToRoll
        );

        for (uint256 i = 0; i < numberToRoll; i++) {
            bool won = rolls[i] < winRateWithBoost;
            emit Rolled(msg.sender, poolId, won, rolls[i]); // Emit roll event regardless of win

            if (won && totalPrizesAvailable > 0) {
                // Use a different random number for prize selection to avoid bias from the win roll
                // Or, if PRNG is good enough, can use a portion of the same roll or a subsequent one if available.
                // For simplicity, let's use a modulo of the win roll for now, assuming PRNG distribution is fine.
                // A more robust way would be another PRNG call or a hash-based selection.
                uint256 prizeSelectionIndex = rolls[i] % totalPrizesAvailable;
                PrizePackage memory pkg = p.prizes[prizeSelectionIndex];

                // Remove prize from pool by swapping with last and popping
                p.prizes[prizeSelectionIndex] = p.prizes[
                    totalPrizesAvailable - 1
                ];
                p.prizes.pop();

                totalPrizesAvailable--; // Decrement available prizes
                wins++;

                pending[msg.sender].push(
                    PendingPrize({poolId: poolId, prize: pkg, asNFT: false})
                );
            }
        }
    }

    function _claimPrize(uint256 pkgIdx) internal {
        PendingPrize[] memory userPending = pending[msg.sender];
        if (userPending.length == 0) {
            revert NoPendingPrizes();
        }

        // check the user has a pending prize at this index
        if (pkgIdx >= userPending.length) {
            revert BadParameters();
        }

        // get the prize from the array and remove it
        PendingPrize memory claimedPrize = userPending[pkgIdx];
        pending[msg.sender][pkgIdx] = pending[msg.sender][
            pending[msg.sender].length - 1
        ];
        pending[msg.sender].pop();

        emit PrizeClaimed(msg.sender, claimedPrize.prize);

        // update the ftTokensForPrizes
        ftTokensForPrizes[claimedPrize.prize.token] -= claimedPrize
            .prize
            .amount;

        // time to pay out the prize and update ftTokensForPrizes
        if (claimedPrize.prize.token == address(0)) {
            // transfer the HBAR to the user
            Address.sendValue(payable(msg.sender), claimedPrize.prize.amount);
        } else if (claimedPrize.prize.token == lazyToken) {
            // transfer the $LAZY to the user
            lazyGasStation.payoutLazy(msg.sender, claimedPrize.prize.amount, 0);
        } else {
            // attempt to transfer the token to the user
            IERC20(claimedPrize.prize.token).transfer(
                msg.sender,
                claimedPrize.prize.amount
            );
        }

        HTSLazyForeverMintLibrary.bulkTransfer(
            HTSLazyForeverMintLibrary.TransferDirection.WITHDRAWAL,
            claimedPrize.prize.nftTokens,
            claimedPrize.prize.nftSerials,
            address(this),
            msg.sender
        );
    }

    /// --- Token Transfer Functions ---

    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyAdmin {
        if (receiverAddress == address(0) || amount == 0) {
            revert BadParameters();
        }

        if (address(this).balance < amount) {
            revert BalanceError(address(0), address(this).balance, amount);
        }

        // safe transfer of hbar to the receiver address
        Address.sendValue(receiverAddress, amount);

        emit ContractUpdate(MethodEnum.HBAR_TRANSFER, msg.sender, amount);
    }

    function transferFungible(
        address _tokenAddress,
        address _receiver,
        uint256 _amount
    ) external onlyAdmin {
        if (
            _receiver == address(0) ||
            _amount == 0 ||
            _tokenAddress == address(0)
        ) {
            revert BadParameters();
        }

        if (IERC20(_tokenAddress).balanceOf(address(this)) < _amount) {
            revert BalanceError(
                _tokenAddress,
                IERC20(_tokenAddress).balanceOf(address(this)),
                _amount
            );
        }

        bool success = IERC20(_tokenAddress).transfer(_receiver, _amount);

        if (!success) {
            revert FungibleTokenTransferFailed();
        }

        emit ContractUpdate(MethodEnum.FT_TRANSFER, msg.sender, _amount);
    }

    receive() external payable {
        emit ContractUpdate(MethodEnum.RECEIVE, msg.sender, msg.value);
    }

    fallback() external payable {
        emit ContractUpdate(MethodEnum.FALLBACK, msg.sender, msg.value);
    }
}
