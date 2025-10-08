// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/*
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 * ⚡                                                             ⚡
 * ⚡                        LAZY SUPERHEROES                     ⚡
 * ⚡                      The OG Hedera Project                  ⚡
 * ⚡                                                             ⚡
 * ⚡                        %%%%#####%%@@@@                      ⚡
 * ⚡                   @%%%@%###%%%%###%%%%%@@                   ⚡
 * ⚡                %%%%%%@@@@@@@@@@@@@@@@%##%%@@                ⚡
 * ⚡              @%%@#@@@@@@@@@@@@@@@@@@@@@@@@*%%@@             ⚡
 * ⚡            @%%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*%@@           ⚡
 * ⚡           %%%#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%#%@@         ⚡
 * ⚡          %%%@@@@@@@@@@@@@@#-:--==+#@@@@@@@@@@@@@*%@@        ⚡
 * ⚡         %@#@@@@@@@@@@@@@@*-------::%@@@@@@@@%%%%%*%@@       ⚡
 * ⚡        %%#@@@@@@@@@@@@@@@=-------:#@@@@@@@@@%%%%%%*%@@      ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@#-------:+@@@@@@@@@@%%%%%%%#%@@     ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@=------:=@@@@@@@@@@@%%%%%%%%#@@     ⚡
 * ⚡      #%#@@@%%%%%%%@@@@@%------:-@@@@@@@@@@@@@%%%%%%%#%@@    ⚡
 * ⚡      %%#@@@%%%%%%%%@@@@=------------:::@@@@@@@@%%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@%:------------::%@@@@@@@@@%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@=:::---------:-@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      #%#@@@%%%%%%%@@@@*:::::::----:-@@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      %%%%@@@@%%%%%@@@@@@@@@@-:---:=@@@@@@@@@@@@@@@@@%@@@    ⚡
 * ⚡       %%#@@@@%%%%@@@@@@@@@@@::--:*@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡       %#%#@@@%@%%%@@@@@@@@@#::::#@@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡        %%%%@@@%%%%%%@@@@@@@*:::%@@@@@@@@@@@@@@@@@@%@@@      ⚡
 * ⚡         %%#%@@%%%%%%%@@@@@@=.-%@@@@@@@@@@@@@@@@@@%@@@       ⚡
 * ⚡          %##*@%%%%%%%%%@@@@=+@@@@@@@@@@@@@@@@@@%%@@@        ⚡
 * ⚡           %##*%%%%%%%%%%@@@@@@@@@@@@@@@@@@@@@@%@@@@         ⚡
 * ⚡             %##+#%%%%%%%%@@@@@@@@@@@@@@@@@@@%@@@@           ⚡
 * ⚡               %##*=%%%%%%%@@@@@@@@@@@@@@@#@@@@@             ⚡
 * ⚡                 %##%#**#@@@@@@@@@@@@%%%@@@@@@               ⚡
 * ⚡                    %%%%@@%@@@%%@@@@@@@@@@@                  ⚡
 * ⚡                         %%%%%%%%%%%@@                       ⚡
 * ⚡                                                             ⚡
 * ⚡                 Development Team Focused on                 ⚡
 * ⚡                   Decentralized Solutions                   ⚡
 * ⚡                                                             ⚡
 * ⚡         Visit: http://lazysuperheroes.com/                  ⚡
 * ⚡            or: https://dapp.lazysuperheroes.com/            ⚡
 * ⚡                   to get your LAZY on!                      ⚡
 * ⚡                                                             ⚡
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 */

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenService} from "./HederaTokenService.sol";
import {IHederaTokenService} from "./IHederaTokenService.sol";
import {ExpiryHelper} from "./ExpiryHelper.sol";

// Import OpenZeppelin Contracts libraries where needed
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title SoulboundBadgeMinter
 * @notice Enhanced Soulbound NFT Minter with Type-based Badge System
 *
 * This contract allows for different categories of badges within a single token.
 * Each type has its own metadata, whitelist, and supply limits.
 *
 * Key Features:
 * - Multi-admin system: Enumerable set of admins who can manage badges and whitelists
 * - Type-based minting: Each type has its own metadata, whitelist, and supply limits
 * - Per-type tracking: Track what users have minted for each type
 * - Granular access control: Each type has its own whitelist with configurable quantities
 * - Burn tracking: Properly handle mint count reductions when tokens are burned
 * - Query functions: Comprehensive functions to check eligibility and remaining capacity
 */
contract SoulboundBadgeMinter is ExpiryHelper, Ownable, ReentrancyGuard {
    using EnumerableMap for EnumerableMap.AddressToUintMap;
    using EnumerableMap for EnumerableMap.UintToUintMap;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeCast for uint256;
    using SafeCast for int64;
    using SafeCast for int256;
    using Address for address;
    using Strings for string;

    // ========== CONSTANTS ==========

    uint256 private constant ONE = uint256(1);

    // ========== STATE VARIABLES ==========

    // Admin management
    EnumerableSet.AddressSet private admins;

    // Type system structures
    struct BadgeType {
        uint256 typeId;
        string name;
        string metadata;
        EnumerableMap.AddressToUintMap whitelist; // address -> allowed quantity
        uint256 totalMinted;
        uint256 maxSupply; // 0 = unlimited
        bool active;
    }

    // Core type data
    mapping(uint256 => BadgeType) private badgeTypes;
    EnumerableSet.UintSet private activeTypeIds;
    uint256 private nextTypeId;

    // Tracking mappings
    mapping(uint256 => EnumerableMap.AddressToUintMap)
        private typeMintsPerAddress;
    EnumerableMap.UintToUintMap private serialToTypeMap;

    // Basic contract state
    address private token;
    uint256 public totalMinted;
    uint256 public maxSupply;
    uint256 public totalReservedCapacity; // Sum of all badge maxSupply values (0 = unlimited badges exist)
    bool public immutable REVOCABLE;

    // ========== ERRORS ==========
    error NotAdmin();
    error AdminAlreadyExists();
    error AdminNotFound();
    error CannotRemoveLastAdmin();
    error TypeNotFound();
    error TypeInactive();
    error NotWhitelistedForType();
    error TypeMintedOut();
    error NotEnoughWLSlots();
    error BadQuantity();
    error BadArguments();
    error UnlimitedBadgeNotAllowed();
    error FailedToMint();
    error FailedNFTMint();
    error NFTTransferFailed();
    error FreezingFailed();
    error BurnFailed();
    error UnFreezingFailed();
    error TokenAlreadyInitialized();
    error TokenNotInitialized();
    error MaxSerialsExceeded();
    error NotRevokable();
    error NFTNotOwned();

    // ========== EVENTS ==========
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event BadgeCreated(uint256 indexed typeId, string name, string metadata);
    event BadgeUpdated(uint256 indexed typeId, string name, string metadata);
    event BadgeActivated(uint256 indexed typeId);
    event BadgeDeactivated(uint256 indexed typeId);
    event WhitelistUpdated(
        uint256 indexed typeId,
        address indexed user,
        uint256 quantity
    );
    event BadgeMintEvent(
        address indexed minter,
        address indexed recipient,
        uint256 indexed typeId,
        uint256 serial,
        string metadata
    );
    event BurnEvent(
        address indexed burnerAddress,
        int64[] serials,
        uint64 newSupply
    );

    // ========== MODIFIERS ==========
    modifier onlyAdmin() {
        if (!admins.contains(msg.sender) && msg.sender != owner()) {
            revert NotAdmin();
        }
        _;
    }

    // ========== CONSTRUCTOR ==========
    constructor(bool _revocable) {
        REVOCABLE = _revocable;

        // Initialize admin system - owner is the first admin
        admins.add(msg.sender);
        nextTypeId = 1;
    }

    // ========== TOKEN INITIALIZATION ==========

    function initialiseNFTMint(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        int64 _maxSupply,
        bool _unlimitedSupply
    )
        external
        payable
        onlyOwner
        returns (address _createdTokenAddress, uint256 _tokenSupply)
    {
        if (token != address(0)) revert TokenAlreadyInitialized();
        if (bytes(_memo).length > 100) revert BadArguments();

        // Create mint key for the contract
        IHederaTokenService.TokenKey[]
            memory _keys = new IHederaTokenService.TokenKey[](1);
        _keys[0] = _createSBTContractMintKey(REVOCABLE, address(this));

        IHederaTokenService.HederaToken memory _token;
        _token.name = _name;
        _token.symbol = _symbol;
        _token.memo = _memo;
        _token.treasury = address(this);
        _token.tokenKeys = _keys;

        if (_unlimitedSupply) {
            _token.tokenSupplyType = false; // Infinite supply
            // int64 max value for unlimited supply
            maxSupply = 0x7FFFFFFFFFFFFFFF;
        } else {
            _token.tokenSupplyType = true; // Finite supply
            if (_maxSupply <= 0) revert BadArguments();
            _token.maxSupply = _maxSupply;
            maxSupply = _maxSupply.toUint256();
        }

        _token.expiry = createAutoRenewExpiry(
            address(this),
            HederaTokenService.defaultAutoRenewPeriod
        );

        (int32 responseCode, address tokenAddress) = HederaTokenService
            .createNonFungibleToken(_token);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedToMint();
        }

        token = tokenAddress;
        _createdTokenAddress = token;
        _tokenSupply = maxSupply;

        return (_createdTokenAddress, _tokenSupply);
    }

    // ========== BADGE MANAGEMENT ==========

    function createBadge(
        string memory _name,
        string memory _metadata,
        uint256 _maxSupply
    ) external onlyAdmin returns (uint256 _typeId) {
        // Must initialize token before creating badges
        if (token == address(0)) revert TokenNotInitialized();

        // Prevent unlimited badge supply when token has limited supply
        if (_maxSupply == 0 && !_hasUnlimitedTokenSupply()) {
            revert UnlimitedBadgeNotAllowed(); // Cannot create unlimited badge when token has limited supply
        }

        // Validate there's enough capacity for this badge type (only if token has limited supply)
        if (_maxSupply > 0) {
            _validateCapacityReservation(_maxSupply);
        }

        _typeId = nextTypeId++;

        BadgeType storage newType = badgeTypes[_typeId];
        newType.typeId = _typeId;
        newType.name = _name;
        newType.metadata = _metadata;
        newType.maxSupply = _maxSupply;
        newType.active = true;
        newType.totalMinted = 0;

        activeTypeIds.add(_typeId);

        // Update reserved capacity tracking
        _updateReservedCapacity(0, _maxSupply);

        emit BadgeCreated(_typeId, _name, _metadata);
    }

    function updateBadge(
        uint256 _typeId,
        string memory _name,
        string memory _metadata,
        uint256 _maxSupply
    ) external onlyAdmin {
        if (token == address(0)) revert TokenNotInitialized();
        if (!activeTypeIds.contains(_typeId)) revert TypeNotFound();

        BadgeType storage badgeType = badgeTypes[_typeId];

        // Validate supply changes
        if (_maxSupply != badgeType.maxSupply) {
            // Prevent unlimited badge supply when token has limited supply
            if (_maxSupply == 0 && !_hasUnlimitedTokenSupply()) {
                revert UnlimitedBadgeNotAllowed(); // Cannot set unlimited badge supply when token has limited supply
            }

            // Don't allow reducing max supply below what's already minted for THIS badge
            if (_maxSupply > 0 && _maxSupply < badgeType.totalMinted) {
                revert TypeMintedOut(); // Cannot reduce badge supply below already minted for this badge
            }

            // Validate capacity reservation if increasing supply
            if (_maxSupply > badgeType.maxSupply) {
                uint256 additionalNeeded = _maxSupply - badgeType.maxSupply;
                _validateCapacityReservation(additionalNeeded);
            }

            // Update reserved capacity tracking
            _updateReservedCapacity(badgeType.maxSupply, _maxSupply);

            badgeType.maxSupply = _maxSupply;
        }

        badgeType.name = _name;
        badgeType.metadata = _metadata;

        emit BadgeUpdated(_typeId, _name, _metadata);
    }

    function setBadgeActive(uint256 _typeId, bool _active) external onlyAdmin {
        // Check if badge type exists (was ever created)
        if (_typeId == 0 || _typeId >= nextTypeId) revert TypeNotFound();

        BadgeType storage badgeType = badgeTypes[_typeId];

        // Only update if the status is actually changing
        if (badgeType.active != _active) {
            badgeType.active = _active;

            if (_active) {
                activeTypeIds.add(_typeId);
                // Recalculate capacity when reactivating a badge
                _recalculateReservedCapacity();
                emit BadgeActivated(_typeId);
            } else {
                activeTypeIds.remove(_typeId);
                // Recalculate capacity when deactivating a badge
                _recalculateReservedCapacity();
                emit BadgeDeactivated(_typeId);
            }
        }
    }

    function addToBadgeWhitelist(
        uint256 _typeId,
        address[] memory _addresses,
        uint256[] memory _quantities
    ) external onlyAdmin {
        if (!activeTypeIds.contains(_typeId)) revert TypeNotFound();
        if (_addresses.length != _quantities.length) revert BadArguments();

        BadgeType storage badgeType = badgeTypes[_typeId];

        for (uint256 i = 0; i < _addresses.length; i++) {
            badgeType.whitelist.set(_addresses[i], _quantities[i]);
            emit WhitelistUpdated(_typeId, _addresses[i], _quantities[i]);
        }
    }

    function removeFromBadgeWhitelist(
        uint256 _typeId,
        address[] memory _addresses
    ) external onlyAdmin {
        if (!activeTypeIds.contains(_typeId)) revert TypeNotFound();

        BadgeType storage badgeType = badgeTypes[_typeId];

        for (uint256 i = 0; i < _addresses.length; i++) {
            badgeType.whitelist.remove(_addresses[i]);
            emit WhitelistUpdated(_typeId, _addresses[i], 0);
        }
    }

    // ========== MINTING ==========

    function mintBadge(
        uint256 _typeId,
        uint256 _numberToMint
    ) external returns (int64[] memory _serials) {
        return _mintBadge(_typeId, _numberToMint, msg.sender);
    }

    function mintBadgeOnBehalf(
        uint256 _typeId,
        uint256 _numberToMint,
        address _onBehalfOf
    ) external returns (int64[] memory _serials) {
        return _mintBadge(_typeId, _numberToMint, _onBehalfOf);
    }

    function _mintBadge(
        uint256 _typeId,
        uint256 _numberToMint,
        address _onBehalfOf
    ) internal nonReentrant returns (int64[] memory _serials) {
        // CHECKS - Validate all parameters and eligibility
        _validateMintParameters(_typeId, _numberToMint);
        _checkMintEligibility(_typeId, _numberToMint, _onBehalfOf);

        // EFFECTS - Update state before external interactions
        _updateMintTracking(_typeId, _numberToMint, _onBehalfOf);

        // INTERACTIONS - Execute external minting
        int64[] memory serialNumbers = _executeMint(
            _typeId,
            _numberToMint,
            _onBehalfOf
        );

        return serialNumbers;
    }

    function _validateMintParameters(
        uint256 _typeId,
        uint256 _numberToMint
    ) internal view {
        if (_numberToMint == 0 || _numberToMint > 10) revert BadQuantity();
        if (!activeTypeIds.contains(_typeId)) revert TypeNotFound();

        BadgeType storage badgeType = badgeTypes[_typeId];
        if (!badgeType.active) revert TypeInactive();

        // Check overall token supply limit (if not unlimited)
        if (!_hasUnlimitedTokenSupply()) {
            if ((totalMinted + _numberToMint) > maxSupply) {
                revert TypeMintedOut();
            }
        }
    }

    function _checkMintEligibility(
        uint256 _typeId,
        uint256 _numberToMint,
        address _onBehalfOf
    ) internal view {
        BadgeType storage badgeType = badgeTypes[_typeId];

        // Check whitelist eligibility
        (bool isWhitelisted, uint256 allowedQuantity) = badgeType
            .whitelist
            .tryGet(_onBehalfOf);
        if (!isWhitelisted) revert NotWhitelistedForType();

        // Check if user has remaining mints for this type
        (bool hasMinted, uint256 alreadyMinted) = typeMintsPerAddress[_typeId]
            .tryGet(_onBehalfOf);
        if (!hasMinted) alreadyMinted = 0;

        if (
            allowedQuantity > 0 &&
            (alreadyMinted + _numberToMint) > allowedQuantity
        ) {
            revert NotEnoughWLSlots();
        }

        // Check type supply limit
        if (
            badgeType.maxSupply > 0 &&
            (badgeType.totalMinted + _numberToMint) > badgeType.maxSupply
        ) {
            revert TypeMintedOut();
        }
    }

    function _executeMint(
        uint256 _typeId,
        uint256 _numberToMint,
        address _onBehalfOf
    ) internal returns (int64[] memory serialNumbers) {
        BadgeType storage badgeType = badgeTypes[_typeId];

        // Prepare metadata for minting
        bytes[] memory metadataForMint = new bytes[](_numberToMint);
        for (uint256 i = 0; i < _numberToMint; i++) {
            metadataForMint[i] = bytes(badgeType.metadata);
        }

        // Execute the mint
        (int32 response, , int64[] memory mintedSerials) = mintToken(
            token,
            0,
            metadataForMint
        );
        if (response != HederaResponseCodes.SUCCESS) {
            revert FailedNFTMint();
        }

        // Transfer and track serials
        _transferAndTrackSerials(
            _typeId,
            mintedSerials,
            _onBehalfOf,
            badgeType.metadata
        );

        return mintedSerials;
    }

    function _transferAndTrackSerials(
        uint256 _typeId,
        int64[] memory serialNumbers,
        address _onBehalfOf,
        string memory metadata
    ) internal {
        uint256 length = serialNumbers.length;
        address[] memory senderList = new address[](length);
        address[] memory receiverList = new address[](length);

        // Check if user already has tokens (and is therefore frozen)
        bool needsUnfreeze = IERC721(token).balanceOf(_onBehalfOf) > 0;

        // Unfreeze the token for the user if they already have tokens
        if (needsUnfreeze) {
            int32 unfreezeResponse = unfreezeToken(token, _onBehalfOf);
            if (unfreezeResponse != HederaResponseCodes.SUCCESS) {
                revert UnFreezingFailed();
            }
        }

        for (uint256 i = 0; i < length; i++) {
            senderList[i] = address(this);
            receiverList[i] = _onBehalfOf;

            // Map serial to type for burn tracking
            uint256 serialUint = SafeCast.toUint256(serialNumbers[i]);
            serialToTypeMap.set(serialUint, _typeId);

            emit BadgeMintEvent(
                msg.sender,
                _onBehalfOf,
                _typeId,
                serialUint,
                metadata
            );
        }

        int32 response = transferNFTs(
            token,
            senderList,
            receiverList,
            serialNumbers
        );
        if (response != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed();
        }

        // Freeze tokens to make them soulbound
        response = freezeToken(token, _onBehalfOf);
        if (response != HederaResponseCodes.SUCCESS) {
            revert FreezingFailed();
        }
    }

    function _updateMintTracking(
        uint256 _typeId,
        uint256 _numberToMint,
        address _onBehalfOf
    ) internal {
        BadgeType storage badgeType = badgeTypes[_typeId];

        // Get current minted count for user
        (bool hasMinted, uint256 alreadyMinted) = typeMintsPerAddress[_typeId]
            .tryGet(_onBehalfOf);
        if (!hasMinted) alreadyMinted = 0;

        // Update tracking - this happens BEFORE external interactions
        badgeType.totalMinted += _numberToMint;
        typeMintsPerAddress[_typeId].set(
            _onBehalfOf,
            alreadyMinted + _numberToMint
        );
        totalMinted += _numberToMint;
    }

    // ========== BURNING ==========

    function burnNFTs(
        int64[] memory _serialNumbers
    ) external returns (uint64 _newTotalSupply) {
        if (_serialNumbers.length > 10) revert MaxSerialsExceeded();

        // need to transfer back to treasury to burn
        address[] memory senderList = new address[](_serialNumbers.length);
        address[] memory receiverList = new address[](_serialNumbers.length);

        for (uint256 s = 0; s < _serialNumbers.length; s++) {
            senderList[s] = msg.sender;
            receiverList[s] = address(this);
        }

        // unfreeze the token to allow transfer and burn
        int32 responseCode = unfreezeToken(token, msg.sender);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert UnFreezingFailed();
        }

        responseCode = transferNFTs(
            token,
            senderList,
            receiverList,
            _serialNumbers
        );
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed();
        }

        (responseCode, _newTotalSupply) = burnToken(token, 0, _serialNumbers);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert BurnFailed();
        }

        // Update tracking for burned tokens
        for (uint256 s = 0; s < _serialNumbers.length; s++) {
            uint256 serialUint = SafeCast.toUint256(_serialNumbers[s]);

            // Get type for this serial and update counts
            (bool found, uint256 typeId) = serialToTypeMap.tryGet(serialUint);
            if (found) {
                // Update user's mint count for this type
                (bool userFound, uint256 currentCount) = typeMintsPerAddress[
                    typeId
                ].tryGet(msg.sender);
                if (userFound && currentCount > 0) {
                    typeMintsPerAddress[typeId].set(
                        msg.sender,
                        currentCount - 1
                    );
                }

                // Update total minted for this type
                if (badgeTypes[typeId].totalMinted > 0) {
                    badgeTypes[typeId].totalMinted--;
                }

                // Remove serial from tracking
                serialToTypeMap.remove(serialUint);
            }
        }

        totalMinted -= _serialNumbers.length;

        // if the user has more of the token refreeze it
        if (IERC721(token).balanceOf(msg.sender) > 0) {
            responseCode = freezeToken(token, msg.sender);
            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert FreezingFailed();
            }
        }

        emit BurnEvent(msg.sender, _serialNumbers, _newTotalSupply);
    }

    // ========== REVOCATION ==========

    /// @notice Revoke (wipe) an SBT from a user's account (only available for revocable contracts)
    /// @param _user The address of the user to revoke the SBT from
    /// @param _serialToWipe The serial number of the NFT to wipe
    /// @return responseCode The Hedera response code
    function revokeSBT(
        address _user,
        uint256 _serialToWipe
    ) external onlyOwner returns (int32 responseCode) {
        if (!REVOCABLE) revert NotRevokable();

        // Verify the user owns this NFT
        if (IERC721(token).ownerOf(_serialToWipe) != _user) {
            revert NFTNotOwned();
        }

        // Get the badge type for this serial to remove from appropriate whitelist
        (bool found, uint256 typeId) = serialToTypeMap.tryGet(_serialToWipe);
        if (found) {
            // Remove user from this badge type's whitelist
            BadgeType storage badgeType = badgeTypes[typeId];
            badgeType.whitelist.remove(_user);
            emit WhitelistUpdated(typeId, _user, 0);
        }

        int64[] memory serials = new int64[](1);
        serials[0] = SafeCast.toInt64(SafeCast.toInt256(_serialToWipe));

        // Unfreeze the token to allow the wipe
        responseCode = unfreezeToken(token, _user);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert UnFreezingFailed();
        }

        // Wipe the NFT from the user's account
        responseCode = wipeTokenAccountNFT(token, _user, serials);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert BurnFailed(); // Reuse burn failed error for wipe failure
        }

        // Update tracking if the serial was found
        if (found) {
            // Update user's mint count for this type
            (bool userFound, uint256 currentCount) = typeMintsPerAddress[typeId]
                .tryGet(_user);
            if (userFound && currentCount > 0) {
                typeMintsPerAddress[typeId].set(_user, currentCount - 1);
            }

            // Update total minted for this type
            if (badgeTypes[typeId].totalMinted > 0) {
                badgeTypes[typeId].totalMinted--;
            }

            // Remove serial from tracking
            serialToTypeMap.remove(_serialToWipe);
        }

        // Update total minted count
        if (totalMinted > 0) {
            totalMinted--;
        }

        // Re-freeze if the user has more tokens
        if (IERC721(token).balanceOf(_user) > 0) {
            responseCode = freezeToken(token, _user);
            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert FreezingFailed();
            }
        }

        return responseCode;
    }

    // ========== QUERY FUNCTIONS ==========

    function getBadge(
        uint256 _typeId
    )
        external
        view
        returns (
            string memory _name,
            string memory _metadata,
            uint256 _totalMinted,
            uint256 _maxSupply,
            bool _active
        )
    {
        // Check if badge type exists (was ever created) regardless of active status
        if (_typeId == 0 || _typeId >= nextTypeId) revert TypeNotFound();
        BadgeType storage badgeType = badgeTypes[_typeId];
        return (
            badgeType.name,
            badgeType.metadata,
            badgeType.totalMinted,
            badgeType.maxSupply,
            badgeType.active
        );
    }

    function getActiveBadgeIds() external view returns (uint256[] memory) {
        return activeTypeIds.values();
    }

    function getUserBadgeEligibility(
        uint256 _typeId,
        address _user
    )
        external
        view
        returns (
            bool _eligible,
            uint256 _remainingMints,
            uint256 _alreadyMinted
        )
    {
        if (!activeTypeIds.contains(_typeId)) {
            return (false, 0, 0);
        }

        BadgeType storage badgeType = badgeTypes[_typeId];
        (bool isWhitelisted, uint256 allowedQuantity) = badgeType
            .whitelist
            .tryGet(_user);

        if (!isWhitelisted || !badgeType.active) {
            return (false, 0, 0);
        }

        (bool hasMinted, uint256 alreadyMinted) = typeMintsPerAddress[_typeId]
            .tryGet(_user);
        if (!hasMinted) alreadyMinted = 0;

        _eligible = true;
        _alreadyMinted = alreadyMinted;

        if (allowedQuantity == 0) {
            _remainingMints = type(uint256).max;
        } else {
            _remainingMints = allowedQuantity > alreadyMinted
                ? allowedQuantity - alreadyMinted
                : 0;
            if (_remainingMints == 0) _eligible = false;
        }
    }

    function getBadgeWhitelist(
        uint256 _typeId
    )
        external
        view
        returns (address[] memory _addresses, uint256[] memory _quantities)
    {
        if (!activeTypeIds.contains(_typeId)) revert TypeNotFound();

        BadgeType storage badgeType = badgeTypes[_typeId];
        uint256 length = badgeType.whitelist.length();

        _addresses = new address[](length);
        _quantities = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            (_addresses[i], _quantities[i]) = badgeType.whitelist.at(i);
        }
    }

    function getSerialBadgeId(
        uint256 _serial
    ) external view returns (uint256 _typeId) {
        (bool found, uint256 typeId) = serialToTypeMap.tryGet(_serial);
        if (!found) revert BadArguments();
        return typeId;
    }

    function getBadgeRemainingSupply(
        uint256 _typeId
    ) external view returns (uint256 _remaining) {
        if (!activeTypeIds.contains(_typeId)) revert TypeNotFound();

        BadgeType storage badgeType = badgeTypes[_typeId];
        if (badgeType.maxSupply == 0) {
            return type(uint256).max;
        } else {
            return
                badgeType.maxSupply > badgeType.totalMinted
                    ? badgeType.maxSupply - badgeType.totalMinted
                    : 0;
        }
    }

    function getUserBadgeMintCounts(
        address _user,
        uint256[] memory _typeIds
    ) external view returns (uint256[] memory _mintCounts) {
        _mintCounts = new uint256[](_typeIds.length);

        for (uint256 i = 0; i < _typeIds.length; i++) {
            (bool found, uint256 count) = typeMintsPerAddress[_typeIds[i]]
                .tryGet(_user);
            _mintCounts[i] = found ? count : 0;
        }
    }

    function getToken() external view returns (address) {
        return token;
    }

    function getMaxSupply() external view returns (uint256) {
        return maxSupply;
    }

    function getRemainingSupply() external view returns (uint256) {
        return _getTokenRemaining();
    }

    function getReservedCapacity() external view returns (uint256) {
        return totalReservedCapacity;
    }

    function getUnreservedCapacity() external view returns (uint256) {
        if (_hasUnlimitedTokenSupply()) {
            return type(uint256).max; // Unlimited
        }
        if (_hasUnlimitedBadgesInternal()) {
            return 0; // Cannot reserve capacity when unlimited badges exist
        }
        return
            maxSupply > totalReservedCapacity
                ? maxSupply - totalReservedCapacity
                : 0;
    }

    function getTotalBadgeCapacity()
        external
        view
        returns (uint256 _totalCapacity)
    {
        return _calculateTotalBadgeCapacity();
    }

    function getCapacityAnalysis()
        external
        view
        returns (
            uint256 _tokenMaxSupply,
            uint256 _tokenMinted,
            uint256 _tokenRemaining,
            uint256 _totalBadgeCapacity,
            uint256 _reservedCapacity,
            bool _hasUnlimitedBadges
        )
    {
        _tokenMaxSupply = maxSupply;
        _tokenMinted = totalMinted;
        _tokenRemaining = _hasUnlimitedTokenSupply()
            ? type(uint256).max
            : (_getTokenRemaining());
        _reservedCapacity = totalReservedCapacity;
        _hasUnlimitedBadges = _hasUnlimitedBadgesInternal();
        _totalBadgeCapacity = _calculateTotalBadgeCapacity();
    }

    // ========== ADMIN MANAGEMENT ==========

    function addAdmin(address _admin) external onlyAdmin {
        if (admins.contains(_admin)) revert AdminAlreadyExists();
        admins.add(_admin);
        emit AdminAdded(_admin);
    }

    function removeAdmin(address _admin) external onlyAdmin {
        if (!admins.contains(_admin)) revert AdminNotFound();

        // Prevent removing the last admin to avoid orphaning the contract
        // Since owner() is always considered an admin (see isAdmin function),
        if (admins.length() == 1) {
            revert CannotRemoveLastAdmin();
        }

        admins.remove(_admin);
        emit AdminRemoved(_admin);
    }

    function isAdmin(address _address) external view returns (bool) {
        return admins.contains(_address) || _address == owner();
    }

    function getAdmins() external view returns (address[] memory) {
        return admins.values();
    }

    // ========== INTERNAL HELPERS ==========

    /// @notice Checks if the token has unlimited supply
    /// @return true if token has unlimited supply
    function _hasUnlimitedTokenSupply() internal view returns (bool) {
        return maxSupply == 0x7FFFFFFFFFFFFFFF;
    }

    /// @notice Gets the remaining token supply
    /// @return The number of tokens that can still be minted
    function _getTokenRemaining() internal view returns (uint256) {
        if (_hasUnlimitedTokenSupply()) {
            return type(uint256).max;
        }
        return maxSupply > totalMinted ? maxSupply - totalMinted : 0;
    }

    /// @notice Calculates the total badge capacity based on current state
    /// @return The effective total badge capacity considering all constraints
    function _calculateTotalBadgeCapacity() internal view returns (uint256) {
        bool hasUnlimitedBadges = _hasUnlimitedBadgesInternal();

        if (hasUnlimitedBadges) {
            // Even with unlimited badges, we're still constrained by token supply
            if (_hasUnlimitedTokenSupply()) {
                return type(uint256).max; // Token has unlimited supply - unlimited badge capacity
            } else {
                return _getTokenRemaining(); // Token has limited supply - badge capacity limited by remaining tokens
            }
        } else {
            // Badge capacity is limited by remaining token capacity, not just reserved capacity
            if (_hasUnlimitedTokenSupply()) {
                return totalReservedCapacity; // Unlimited token supply - badge capacity is sum of all badge limits
            } else {
                uint256 tokenRemaining = _getTokenRemaining();
                return
                    tokenRemaining < totalReservedCapacity
                        ? tokenRemaining
                        : totalReservedCapacity; // Limited token supply - badge capacity is constrained by remaining tokens
            }
        }
    }

    /// @notice Updates the total reserved capacity when badge supplies change
    /// @param _oldSupply The previous maxSupply of the badge
    /// @param _newSupply The new maxSupply of the badge
    function _updateReservedCapacity(
        uint256 _oldSupply,
        uint256 _newSupply
    ) internal {
        // If any badge has unlimited supply (0), reserved capacity becomes unlimited
        if (_newSupply == 0 || _oldSupply == 0) {
            _recalculateReservedCapacity();
            return;
        }

        // For limited supplies, update the difference
        if (_newSupply > _oldSupply) {
            totalReservedCapacity += (_newSupply - _oldSupply);
        } else if (_oldSupply > _newSupply) {
            totalReservedCapacity -= (_oldSupply - _newSupply);
        }
    }

    /// @notice Recalculates total reserved capacity from scratch (used when unlimited badges are involved)
    function _recalculateReservedCapacity() internal {
        uint256[] memory typeIds = activeTypeIds.values();
        totalReservedCapacity = 0;

        for (uint256 i = 0; i < typeIds.length; i++) {
            BadgeType storage badgeType = badgeTypes[typeIds[i]];
            if (badgeType.maxSupply == 0) {
                totalReservedCapacity = 0; // Unlimited badge exists, so no capacity limit
                return;
            }
            totalReservedCapacity += badgeType.maxSupply;
        }
    }

    /// @notice Validates that reserved capacity doesn't exceed token capacity
    /// @param _additionalReservation Additional capacity being requested
    function _validateCapacityReservation(
        uint256 _additionalReservation
    ) internal view {
        // Skip validation if token has unlimited supply
        if (_hasUnlimitedTokenSupply()) {
            return;
        }

        // Skip validation if any badge has unlimited supply
        if (totalReservedCapacity == 0 && _hasUnlimitedBadgesInternal()) {
            return;
        }

        // Check if adding this reservation would exceed token capacity
        if ((totalReservedCapacity + _additionalReservation) > maxSupply) {
            revert TypeMintedOut(); // Would exceed token capacity
        }
    }

    /// @notice Checks if any active badge type has unlimited supply
    function _hasUnlimitedBadgesInternal() internal view returns (bool) {
        uint256[] memory typeIds = activeTypeIds.values();
        for (uint256 i = 0; i < typeIds.length; i++) {
            if (badgeTypes[typeIds[i]].maxSupply == 0) {
                return true;
            }
        }
        return false;
    }

    /// @notice Creates the token key structure for soulbound tokens
    /// @param _revocable Whether the token can be wiped (revoked)
    /// @param _contract The contract address that will control the token
    /// @return mintKey The token key with appropriate permissions
    function _createSBTContractMintKey(
        bool _revocable,
        address _contract
    ) internal pure returns (IHederaTokenService.TokenKey memory mintKey) {
        uint256 keyType;
        keyType = _setBit(keyType, uint8(KeyType.SUPPLY));
        keyType = _setBit(keyType, uint8(KeyType.FREEZE));

        if (_revocable) {
            keyType = _setBit(keyType, uint8(KeyType.WIPE));
        }

        IHederaTokenService.KeyValue memory keyValue;
        keyValue.contractId = _contract;

        mintKey = IHederaTokenService.TokenKey(keyType, keyValue);
    }

    /// @notice Sets a bit at the specified index in a uint256
    /// @param self The uint256 to modify
    /// @param index The bit index to set
    /// @return The modified uint256 with the bit set
    function _setBit(
        uint256 self,
        uint8 index
    ) internal pure returns (uint256) {
        return self | (ONE << index);
    }

    // ========== EMERGENCY & UTILITY ==========

    /// @notice Transfer HBAR out of the contract
    /// @param _receiverAddress address in EVM format of the receiver of the HBAR
    /// @param _amount amount of HBAR to send in tinybars
    function transferHbar(
        address payable _receiverAddress,
        uint256 _amount
    ) external onlyAdmin {
        // throws error on failure
        Address.sendValue(_receiverAddress, _amount);
    }

    receive() external payable {}
    fallback() external payable {}
}
