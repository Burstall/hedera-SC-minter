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
import {ExpiryHelper} from "./ExpiryHelper.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";

// Import Ownable from the OpenZeppelin Contracts library
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

// Expiry Helper extends FeeHelper which extends KeyHelper inherits HederaStokeService
// Ownable from OZ to limit access control

contract FungibleTokenCreator is ExpiryHelper, Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    // List of trusted addresses which can mint tokens
    EnumerableSet.AddressSet private _allowanceWL;

    // Custom errors
    error MintWipeKeyFailed();
    error MintWipeSupplyFailed();
    error MintNoKeysFailed();
    error TooManyFees();
    error MintWithFeesFailed();
    error MintSupplyFailed();
    error BurnAtTreasuryFailed();
    error BurnFailed();
    error TransferBatchFailed();
    error SpenderNotOnWL();
    error AllowanceApprovalFailed();
    error GetAllowanceFailed();
    error PositiveTransfersOnly();
    error TransferHTSFailed();
    error TransferTokensFailed();
    error SendHbarFailed();

    event TokenControllerMessage(
        string msgType,
        address indexed fromAddress,
        uint256 amount,
        string message
    );

    // to avoid serialisation related default causing odd behaviour
    // implementing custom object as a wrapper
    struct FTFixedFeeObject {
        uint32 amount;
        address tokenAddress;
        bool useHbarsForPayment;
        bool useCurrentTokenForPayment;
        address feeCollector;
    }

    struct FTFractionalFeeObject {
        uint32 numerator;
        uint32 denominator;
        address feeCollector;
        uint32 minimumAmount;
        uint32 maximumAmount;
        bool netOfTransfers;
    }

    // create a fungible Token with no custom fees,
    // with calling contract as admin key
    // add a wipe key in order to allow implmentation of burn function
    // => no additional mint, no pause
    /// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
    /// @param initialSupply number of tokens to mint
    /// @param decimals decimal for the token -> 100 of the token divisible to 1dp will be 1000 supply with decimal 1
    /// @param maxSupply Set to 0 for an infinite token, set > 0 to enforce capped suply @ maxSupply
    /// @return createdTokenAddress the address of the new token
    function createFungibleWithBurn(
        // bytes memory ed25519Key,
        string memory name,
        string memory symbol,
        string memory memo,
        uint64 initialSupply,
        uint32 decimals,
        int64 maxSupply
    ) external payable onlyOwner returns (address createdTokenAddress) {
        // instantiate the list of keys we'll use for token create
        IHederaTokenService.TokenKey[]
            memory keys = new IHederaTokenService.TokenKey[](1);

        keys[0] = getSingleKey(
            KeyType.WIPE,
            KeyValueType.CONTRACT_ID,
            address(this)
        );

        // define the token
        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.memo = memo;
        token.treasury = address(this);
        token.tokenKeys = keys;

        if (maxSupply > 0) {
            token.tokenSupplyType = true;
            token.maxSupply = maxSupply;
        }

        // create the expiry schedule for the token using ExpiryHelper
        token.expiry = createAutoRenewExpiry(
            address(this),
            DEFAULT_AUTO_RENEW_PERIOD
        );

        // call HTS precompiled contract, passing initial supply and decimals
        (int32 responseCode, address tokenAddress) = createFungibleToken(
            token,
            initialSupply,
            decimals
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert MintWipeKeyFailed();
        }

        emit TokenControllerMessage(
            "MINT",
            msg.sender,
            initialSupply,
            "Minted with wipe key"
        );

        createdTokenAddress = tokenAddress;
    }

    // create a fungible Token with no custom fees,
    // with calling contract as admin key
    // add a wipe key in order to allow implmentation of burn function
    // add a supply key to allow mint and burn in place
    // => no admin key, no pause key
    /// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
    /// @param initialSupply number of tokens to mint
    /// @param decimals decimal for the token -> 100 of the token divisible to 1dp will be 1000 supply with decimal 1
    /// @param maxSupply Set to 0 for an infinite token, set > 0 to enforce capped suply @ maxSupply
    /// @return createdTokenAddress the address of the new token
    function createFungibleWithSupplyAndBurn(
        // bytes memory ed25519Key,
        string memory name,
        string memory symbol,
        string memory memo,
        uint64 initialSupply,
        uint32 decimals,
        int64 maxSupply
    ) external payable onlyOwner returns (address createdTokenAddress) {
        // instantiate the list of keys we will use for token create
        IHederaTokenService.TokenKey[]
            memory keys = new IHederaTokenService.TokenKey[](1);

        keys[0] = getSingleKey(
            KeyType.WIPE,
            KeyType.SUPPLY,
            KeyValueType.CONTRACT_ID,
            address(this)
        );

        // define the token
        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.memo = memo;
        token.treasury = address(this);
        token.tokenKeys = keys;

        if (maxSupply > 0) {
            token.tokenSupplyType = true;
            token.maxSupply = maxSupply;
        }
        // create the expiry schedule for the token using ExpiryHelper
        token.expiry = createAutoRenewExpiry(
            address(this),
            DEFAULT_AUTO_RENEW_PERIOD
        );

        // call HTS precompiled contract, passing initial supply and decimals
        (int32 responseCode, address tokenAddress) = createFungibleToken(
            token,
            initialSupply,
            decimals
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert MintWipeSupplyFailed();
        }

        emit TokenControllerMessage(
            "MINT",
            msg.sender,
            initialSupply,
            "Success minting token with supply/wipe keys"
        );

        createdTokenAddress = tokenAddress;
    }

    // mint an FT with no keys - not adjustable, 1 time mint as clean and transparent as possible
    /// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
    /// @param initialSupply number of tokens to mint
    /// @param decimals decimal for the token -> 100 of the token divisible to 1dp will be 1000 supply with decimal 1
    /// @param maxSupply Set to 0 for an infinite token, set > 0 to enforce capped suply @ maxSupply
    /// @return createdTokenAddress the address of the new token
    function createTokenWithNoKeys(
        string memory name,
        string memory symbol,
        string memory memo,
        uint64 initialSupply,
        uint32 decimals,
        int64 maxSupply
    ) external payable onlyOwner returns (address createdTokenAddress) {
        //define the token
        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.memo = memo;
        token.treasury = address(this);

        if (maxSupply > 0) {
            token.tokenSupplyType = false;
            token.maxSupply = maxSupply;
        }

        // create the expiry schedule for the token using ExpiryHelper
        token.expiry = createAutoRenewExpiry(
            address(this),
            DEFAULT_AUTO_RENEW_PERIOD
        );

        (int32 responseCode, address tokenAddress) = createFungibleToken(
            token,
            initialSupply,
            decimals
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert MintNoKeysFailed();
        }

        emit TokenControllerMessage(
            "MINT",
            msg.sender,
            initialSupply,
            "Success minting token without keys"
        );

        createdTokenAddress = tokenAddress;
    }

    // mint an FT with no keys - not adjustable, 1 time mint as clean and transparent as possible
    /// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
    /// @param initialSupply number of tokens to mint
    /// @param decimals decimal for the token -> 100 of the token divisible to 1dp will be 1000 supply with decimal 1
    /// @param maxSupply Set to 0 for an infinite token, set > 0 to enforce capped suply @ maxSupply
    /// @return createdTokenAddress the address of the new token
    function createTokenWithCustomFees(
        string memory name,
        string memory symbol,
        string memory memo,
        uint64 initialSupply,
        uint32 decimals,
        int64 maxSupply,
        FTFixedFeeObject[] memory fixedFees,
        FTFractionalFeeObject[] memory fractionalFees
    ) external payable onlyOwner returns (address createdTokenAddress) {
        if ((fixedFees.length + fractionalFees.length) > 10) {
            revert TooManyFees();
        }
        //define the token
        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.memo = memo;
        token.treasury = address(this);

        if (maxSupply > 0) {
            token.tokenSupplyType = false;
            token.maxSupply = maxSupply;
        }

        // create the expiry schedule for the token using ExpiryHelper
        token.expiry = createAutoRenewExpiry(
            address(this),
            DEFAULT_AUTO_RENEW_PERIOD
        );

        IHederaTokenService.FixedFee[]
            memory nativeFixedFees = new IHederaTokenService.FixedFee[](
                fixedFees.length
            );
        for (uint8 i = 0; i < fixedFees.length; i++) {
            IHederaTokenService.FixedFee memory fxdFee;
            fxdFee.amount = fixedFees[i].amount;
            fxdFee.feeCollector = fixedFees[i].feeCollector;

            if (fixedFees[i].useHbarsForPayment) {
                fxdFee.useHbarsForPayment = true;
            } else if (fixedFees[i].useCurrentTokenForPayment) {
                fxdFee.useCurrentTokenForPayment = true;
            } else {
                fxdFee.tokenId = fixedFees[i].tokenAddress;
            }

            nativeFixedFees[i] = fxdFee;
        }

        IHederaTokenService.FractionalFee[]
            memory nativeFractionalFees = new IHederaTokenService.FractionalFee[](
                fractionalFees.length
            );
        for (uint8 i = 0; i < fractionalFees.length; i++) {
            IHederaTokenService.FractionalFee memory fractionalFee;
            fractionalFee.feeCollector = fractionalFees[i].feeCollector;
            fractionalFee.numerator = fractionalFees[i].numerator;
            fractionalFee.denominator = fractionalFees[i].denominator;
            fractionalFee.netOfTransfers = fractionalFees[i].netOfTransfers;
            fractionalFee.minimumAmount = fractionalFees[i].minimumAmount;
            fractionalFee.maximumAmount = fractionalFees[i].maximumAmount;

            nativeFractionalFees[i] = fractionalFee;
        }

        (
            int32 responseCode,
            address tokenAddress
        ) = createFungibleTokenWithCustomFees(
                token,
                initialSupply,
                decimals,
                nativeFixedFees,
                nativeFractionalFees
            );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert MintWithFeesFailed();
        }

        emit TokenControllerMessage(
            "MINT",
            msg.sender,
            initialSupply,
            "Success minting token without keys"
        );

        createdTokenAddress = tokenAddress;
    }

    /// @param token address in EVM format of token to mint more supply to
    /// @param amount the number of new units to mint
    /// (inclusive of decimal eg 10 more of a decimal 1 token => amount = 100)
    /// @return responseCode result of the operation
    /// @return newTotalSupply new supply post mint
    function mintAdditionalSupply(
        address token,
        uint64 amount
    ) external onlyOwner returns (int32 responseCode, uint64 newTotalSupply) {
        bytes[] memory _metadata;

        (responseCode, newTotalSupply, ) = mintToken(token, amount, _metadata);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert MintSupplyFailed();
        }
    }

    /// @param token address in EVM format of token to mint more supply to
    /// @param amount the number of new units to mint
    /// (inclusive of decimal eg 10 more of a decimal 1 token => amount = 100)
    /// @return responseCode result of the operation
    /// @return newTotalSupply new supply post mint
    function burnFromTreasury(
        address token,
        uint64 amount,
        int64[] memory _serials
    ) external onlyOwner returns (int32 responseCode, uint64 newTotalSupply) {
        (responseCode, newTotalSupply) = burnToken(token, amount, _serials);

        emit TokenControllerMessage(
            "BURN",
            msg.sender,
            amount,
            "Burn (from treasury) complete"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert BurnAtTreasuryFailed();
        }
    }

    /// Operation to wipe fungible tokens from caller's account
    /// This method os open to all as the address foor burning is the msg.sender the call
    /// can only burn tokens they own
    /// @param token The token address
    /// @param amount The number of tokens to wipe
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    function burn(
        address token,
        uint32 amount
    ) external returns (int32 responseCode) {
        (responseCode) = wipeTokenAccount(token, msg.sender, amount);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert BurnFailed();
        }
        emit TokenControllerMessage(
            "BURN",
            msg.sender,
            amount,
            "Burn (from user) complete"
        );
    }

    /// Initiates a Fungible Token Transfer
    /// @param token The ID of the token as a solidity address
    /// @param accountIds account to do a transfer to/from
    /// @param amounts The amount from the accountId at the same index
    function batchTransferTokens(
        address token,
        address[] memory accountIds,
        int64[] memory amounts
    ) external onlyOwner returns (int32 responseCode) {
        (responseCode) = transferTokens(token, accountIds, amounts);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert TransferBatchFailed();
        }
    }

    /// Allows spender to withdraw from your account multiple times, up to the value amount. If this function is called
    /// again it overwrites the current allowance with value.
    /// Only Applicable to Fungible Tokens
    /// @param token The hedera token address to approve
    /// @param spender the account authorized to spend
    /// @param amount the amount of tokens authorized to spend.
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    function approveAllowance(
        address token,
        address spender,
        uint256 amount
    ) external onlyOwner returns (int256 responseCode) {
        if (!_allowanceWL.contains(spender)) {
            revert SpenderNotOnWL();
        }

        (responseCode) = approve(token, spender, amount);

        emit TokenControllerMessage(
            "Approval",
            spender,
            amount,
            "Allowance approved"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert AllowanceApprovalFailed();
        }
    }

    /// Check the allowance for a specific user via an SC call [mirror node better?]
    /// @param token The Hedera token address to check the allowance of
    /// @param spender the spender of the tokens
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    /// @return amount thw number of tokens authorised to spend
    function checkAllowance(
        address token,
        address spender
    ) external returns (int256 responseCode, uint256 amount) {
        (responseCode, amount) = allowance(token, address(this), spender);

        emit TokenControllerMessage(
            "Allowance checked",
            spender,
            amount,
            "checked"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert GetAllowanceFailed();
        }
    }

    /// Use HTS to transfer FT
    /// @param token The token to transfer to/from
    /// @param receiver The receiver of the transaction
    /// @param amount Non-negative value to send. a negative value will result in a failure.
    function transferHTS(
        address token,
        address receiver,
        int64 amount
    ) external onlyOwner returns (int32 responseCode) {
        if (amount <= 0) {
            revert PositiveTransfersOnly();
        }

        responseCode = transferToken(token, address(this), receiver, amount);

        emit TokenControllerMessage(
            "Transfer with HTS",
            receiver,
            uint256(uint64(amount)),
            "completed"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert TransferHTSFailed();
        }
    }

    /// Transfer token from this contract to the recipient
    /// @param token address in EVM format of the token to transfer
    /// @param recipient address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in long form adjusted for decimal)
    /// @return sent a boolean signalling success
    function transfer(
        address token,
        address recipient,
        uint256 amount
    ) external onlyOwner returns (bool sent) {
        sent = IERC20(token).transfer(recipient, amount);
        if (!sent) {
            revert TransferTokensFailed();
        }

        emit TokenControllerMessage("Transfer", recipient, amount, "complete");
    }

    // Left in for example purposes - will remove for production
    // Low level call to call hbar from the contract to avoid it getting trapped
    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in long form adjusted for decimal)
    /// @return sent a boolean signalling success
    function callHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyOwner returns (bool sent) {
        (sent, ) = receiverAddress.call{value: amount}("");
        if (!sent) {
            revert SendHbarFailed();
        }
        receiverAddress.transfer(amount);

        emit TokenControllerMessage(
            "Hbar Call",
            receiverAddress,
            amount,
            "complete"
        );
    }

    // Transfer hbar oput of the contract - using secure ether transfer pattern
    // on top of onlyOwner as max gas of 2300 (not adjustable) will limit re-entrrant attacks
    // also throws error on failure causing contract to auutomatically revert
    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in long form adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyOwner {
        // throws error on failure
        Address.sendValue(receiverAddress, amount);

        emit TokenControllerMessage(
            "Hbar Transfer",
            receiverAddress,
            amount,
            "complete"
        );
    }

    // Add an address to the allowance WL
    /// @param newAddress the newss address to add
    function addAllowanceWhitelist(address newAddress) external onlyOwner {
        _allowanceWL.add(newAddress);
        emit TokenControllerMessage(
            "ADD WL",
            newAddress,
            0,
            "allowance WL updated"
        );
    }

    // Remove an address from the allowance WL
    /// @param oldAddress the address to remove
    function removeAllowanceWhitelist(address oldAddress) external onlyOwner {
        _allowanceWL.remove(oldAddress);
        emit TokenControllerMessage(
            "REMOVE WL",
            oldAddress,
            0,
            "allowance WL updated"
        );
    }

    /// Check the current White List for Approvals
    /// @return wl an array of addresses currently enabled for allownace approval
    function getAllowanceWhitelist()
        external
        view
        returns (address[] memory wl)
    {
        return _allowanceWL.values();
    }

    // Check if the address is in the WL
    /// @param addressToCheck the address to check in WL
    /// @return bool if in the WL
    function isAddressWL(address addressToCheck) external view returns (bool) {
        return _allowanceWL.contains(addressToCheck);
    }

    // allows the contract top recieve HBAR
    receive() external payable {
        emit TokenControllerMessage(
            "Receive",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }

    fallback() external payable {
        emit TokenControllerMessage(
            "Fallback",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }
}
