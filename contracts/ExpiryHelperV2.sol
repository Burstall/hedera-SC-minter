// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;
pragma experimental ABIEncoderV2;

import {HederaTokenService} from "./HederaTokenServiceV2.sol";
import {FeeHelper} from "./FeeHelperV2.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenServiceV2.sol";

contract ExpiryHelper is FeeHelper {
    function createAutoRenewExpiry(
        address autoRenewAccount,
        int64 autoRenewPeriod
    ) internal pure returns (IHederaTokenService.Expiry memory expiry) {
        expiry.autoRenewAccount = autoRenewAccount;
        expiry.autoRenewPeriod = autoRenewPeriod;
    }

    function createSecondExpiry(
        int64 second
    ) internal pure returns (IHederaTokenService.Expiry memory expiry) {
        expiry.second = second;
    }
}
