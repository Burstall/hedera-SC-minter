// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;
pragma experimental ABIEncoderV2;

import {HederaTokenServiceV2} from "./HederaTokenServiceV2.sol";
import {FeeHelperV2} from "./FeeHelperV2.sol";
import {IHederaTokenServiceV2} from "./interfaces/IHederaTokenServiceV2.sol";

contract ExpiryHelperV2 is FeeHelperV2 {
    function createAutoRenewExpiry(
        address autoRenewAccount,
        int64 autoRenewPeriod
    ) internal pure returns (IHederaTokenServiceV2.Expiry memory expiry) {
        expiry.autoRenewAccount = autoRenewAccount;
        expiry.autoRenewPeriod = autoRenewPeriod;
    }

    function createSecondExpiry(
        int64 second
    ) internal pure returns (IHederaTokenServiceV2.Expiry memory expiry) {
        expiry.second = second;
    }
}
