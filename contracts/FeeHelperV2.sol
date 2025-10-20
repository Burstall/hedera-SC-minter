// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;
pragma experimental ABIEncoderV2;

import {KeyHelperV2} from "./KeyHelperV2.sol";
import {IHederaTokenServiceV2} from "./interfaces/IHederaTokenServiceV2.sol";

abstract contract FeeHelperV2 is KeyHelperV2 {
    function createFixedHbarFee(
        int64 amount,
        address feeCollector
    ) internal pure returns (IHederaTokenServiceV2.FixedFee memory fixedFee) {
        fixedFee.amount = amount;
        fixedFee.useHbarsForPayment = true;
        fixedFee.feeCollector = feeCollector;
    }

    function createFixedTokenFee(
        int64 amount,
        address tokenId,
        address feeCollector
    ) internal pure returns (IHederaTokenServiceV2.FixedFee memory fixedFee) {
        fixedFee.amount = amount;
        fixedFee.tokenId = tokenId;
        fixedFee.feeCollector = feeCollector;
    }

    function createFixedSelfDenominatedFee(
        int64 amount,
        address feeCollector
    ) internal pure returns (IHederaTokenServiceV2.FixedFee memory fixedFee) {
        fixedFee.amount = amount;
        fixedFee.useCurrentTokenForPayment = true;
        fixedFee.feeCollector = feeCollector;
    }

    function createFractionalFee(
        int64 numerator,
        int64 denominator,
        bool netOfTransfers,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FractionalFee memory fractionalFee)
    {
        fractionalFee.numerator = numerator;
        fractionalFee.denominator = denominator;
        fractionalFee.netOfTransfers = netOfTransfers;
        fractionalFee.feeCollector = feeCollector;
    }

    function createFractionalFeeWithMinAndMax(
        int64 numerator,
        int64 denominator,
        int64 minimumAmount,
        int64 maximumAmount,
        bool netOfTransfers,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FractionalFee memory fractionalFee)
    {
        fractionalFee.numerator = numerator;
        fractionalFee.denominator = denominator;
        fractionalFee.minimumAmount = minimumAmount;
        fractionalFee.maximumAmount = maximumAmount;
        fractionalFee.netOfTransfers = netOfTransfers;
        fractionalFee.feeCollector = feeCollector;
    }

    function createFractionalFeeWithLimits(
        int64 numerator,
        int64 denominator,
        int64 minimumAmount,
        int64 maximumAmount,
        bool netOfTransfers,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FractionalFee memory fractionalFee)
    {
        fractionalFee.numerator = numerator;
        fractionalFee.denominator = denominator;
        fractionalFee.minimumAmount = minimumAmount;
        fractionalFee.maximumAmount = maximumAmount;
        fractionalFee.netOfTransfers = netOfTransfers;
        fractionalFee.feeCollector = feeCollector;
    }

    function createRoyaltyFeeWithoutFallback(
        int64 numerator,
        int64 denominator,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee memory royaltyFee)
    {
        royaltyFee.numerator = numerator;
        royaltyFee.denominator = denominator;
        royaltyFee.feeCollector = feeCollector;
    }

    function createRoyaltyFeeWithHbarFallbackFee(
        int64 numerator,
        int64 denominator,
        int64 amount,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee memory royaltyFee)
    {
        royaltyFee.numerator = numerator;
        royaltyFee.denominator = denominator;
        royaltyFee.amount = amount;
        royaltyFee.useHbarsForPayment = true;
        royaltyFee.feeCollector = feeCollector;
    }

    function createRoyaltyFeeWithTokenDenominatedFallbackFee(
        int64 numerator,
        int64 denominator,
        int64 amount,
        address tokenId,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee memory royaltyFee)
    {
        royaltyFee.numerator = numerator;
        royaltyFee.denominator = denominator;
        royaltyFee.amount = amount;
        royaltyFee.tokenId = tokenId;
        royaltyFee.feeCollector = feeCollector;
    }

    function createNAmountFixedFeesForHbars(
        uint8 numberOfFees,
        int64 amount,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {
        fixedFees = new IHederaTokenServiceV2.FixedFee[](numberOfFees);

        for (uint8 i = 0; i < numberOfFees; i++) {
            IHederaTokenServiceV2.FixedFee
                memory fixedFee = createFixedFeeForHbars(amount, feeCollector);
            fixedFees[i] = fixedFee;
        }
    }

    function createSingleFixedFeeForToken(
        int64 amount,
        address tokenId,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {
        fixedFees = new IHederaTokenServiceV2.FixedFee[](1);
        IHederaTokenServiceV2.FixedFee memory fixedFee = createFixedFeeForToken(
            amount,
            tokenId,
            feeCollector
        );
        fixedFees[0] = fixedFee;
    }

    function createFixedFeesForToken(
        int64 amount,
        address tokenId,
        address firstFeeCollector,
        address secondFeeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {
        fixedFees = new IHederaTokenServiceV2.FixedFee[](1);
        IHederaTokenServiceV2.FixedFee
            memory fixedFee1 = createFixedFeeForToken(
                amount,
                tokenId,
                firstFeeCollector
            );
        IHederaTokenServiceV2.FixedFee
            memory fixedFee2 = createFixedFeeForToken(
                2 * amount,
                tokenId,
                secondFeeCollector
            );
        fixedFees[0] = fixedFee1;
        fixedFees[0] = fixedFee2;
    }

    function createSingleFixedFeeForHbars(
        int64 amount,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {
        fixedFees = new IHederaTokenServiceV2.FixedFee[](1);
        IHederaTokenServiceV2.FixedFee memory fixedFee = createFixedFeeForHbars(
            amount,
            feeCollector
        );
        fixedFees[0] = fixedFee;
    }

    function createSingleFixedFeeForCurrentToken(
        int64 amount,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {
        fixedFees = new IHederaTokenServiceV2.FixedFee[](1);
        IHederaTokenServiceV2.FixedFee
            memory fixedFee = createFixedFeeForCurrentToken(
                amount,
                feeCollector
            );
        fixedFees[0] = fixedFee;
    }

    function createSingleFixedFeeWithInvalidFlags(
        int64 amount,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {
        fixedFees = new IHederaTokenServiceV2.FixedFee[](1);
        IHederaTokenServiceV2.FixedFee
            memory fixedFee = createFixedFeeWithInvalidFlags(
                amount,
                feeCollector
            );
        fixedFees[0] = fixedFee;
    }

    function createSingleFixedFeeWithTokenIdAndHbars(
        int64 amount,
        address tokenId,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {
        fixedFees = new IHederaTokenServiceV2.FixedFee[](1);
        IHederaTokenServiceV2.FixedFee
            memory fixedFee = createFixedFeeWithTokenIdAndHbars(
                amount,
                tokenId,
                feeCollector
            );
        fixedFees[0] = fixedFee;
    }

    function createFixedFeesWithAllTypes(
        int64 amount,
        address tokenId,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {
        fixedFees = new IHederaTokenServiceV2.FixedFee[](3);
        IHederaTokenServiceV2.FixedFee
            memory fixedFeeForToken = createFixedFeeForToken(
                amount,
                tokenId,
                feeCollector
            );
        IHederaTokenServiceV2.FixedFee
            memory fixedFeeForHbars = createFixedFeeForHbars(
                amount * 2,
                feeCollector
            );
        IHederaTokenServiceV2.FixedFee
            memory fixedFeeForCurrentToken = createFixedFeeForCurrentToken(
                amount * 4,
                feeCollector
            );
        fixedFees[0] = fixedFeeForToken;
        fixedFees[1] = fixedFeeForHbars;
        fixedFees[2] = fixedFeeForCurrentToken;
    }

    function createFixedFeeForToken(
        int64 amount,
        address tokenId,
        address feeCollector
    ) internal pure returns (IHederaTokenServiceV2.FixedFee memory fixedFee) {
        fixedFee.amount = amount;
        fixedFee.tokenId = tokenId;
        fixedFee.feeCollector = feeCollector;
    }

    function createFixedFeeForHbars(
        int64 amount,
        address feeCollector
    ) internal pure returns (IHederaTokenServiceV2.FixedFee memory fixedFee) {
        fixedFee.amount = amount;
        fixedFee.useHbarsForPayment = true;
        fixedFee.feeCollector = feeCollector;
    }

    function createFixedFeeForCurrentToken(
        int64 amount,
        address feeCollector
    ) internal pure returns (IHederaTokenServiceV2.FixedFee memory fixedFee) {
        fixedFee.amount = amount;
        fixedFee.useCurrentTokenForPayment = true;
        fixedFee.feeCollector = feeCollector;
    }

    //Used for negative scenarios
    function createFixedFeeWithInvalidFlags(
        int64 amount,
        address feeCollector
    ) internal pure returns (IHederaTokenServiceV2.FixedFee memory fixedFee) {
        fixedFee.amount = amount;
        fixedFee.useHbarsForPayment = true;
        fixedFee.useCurrentTokenForPayment = true;
        fixedFee.feeCollector = feeCollector;
    }

    //Used for negative scenarios
    function createFixedFeeWithTokenIdAndHbars(
        int64 amount,
        address tokenId,
        address feeCollector
    ) internal pure returns (IHederaTokenServiceV2.FixedFee memory fixedFee) {
        fixedFee.amount = amount;
        fixedFee.tokenId = tokenId;
        fixedFee.useHbarsForPayment = true;
        fixedFee.feeCollector = feeCollector;
    }

    function getEmptyFixedFees()
        internal
        pure
        returns (IHederaTokenServiceV2.FixedFee[] memory fixedFees)
    {}

    function createNAmountFractionalFees(
        uint8 numberOfFees,
        int64 numerator,
        int64 denominator,
        bool netOfTransfers,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FractionalFee[] memory fractionalFees)
    {
        fractionalFees = new IHederaTokenServiceV2.FractionalFee[](
            numberOfFees
        );

        for (uint8 i = 0; i < numberOfFees; i++) {
            IHederaTokenServiceV2.FractionalFee
                memory fractionalFee = createFractionalFee(
                    numerator,
                    denominator,
                    netOfTransfers,
                    feeCollector
                );
            fractionalFees[i] = fractionalFee;
        }
    }

    function createSingleFractionalFee(
        int64 numerator,
        int64 denominator,
        bool netOfTransfers,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FractionalFee[] memory fractionalFees)
    {
        fractionalFees = new IHederaTokenServiceV2.FractionalFee[](1);
        IHederaTokenServiceV2.FractionalFee
            memory fractionalFee = createFractionalFee(
                numerator,
                denominator,
                netOfTransfers,
                feeCollector
            );
        fractionalFees[0] = fractionalFee;
    }

    function createSingleFractionalFeeWithLimits(
        int64 numerator,
        int64 denominator,
        int64 minimumAmount,
        int64 maximumAmount,
        bool netOfTransfers,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.FractionalFee[] memory fractionalFees)
    {
        fractionalFees = new IHederaTokenServiceV2.FractionalFee[](1);
        IHederaTokenServiceV2.FractionalFee
            memory fractionalFee = createFractionalFeeWithLimits(
                numerator,
                denominator,
                minimumAmount,
                maximumAmount,
                netOfTransfers,
                feeCollector
            );
        fractionalFees[0] = fractionalFee;
    }

    function getEmptyFractionalFees()
        internal
        pure
        returns (IHederaTokenServiceV2.FractionalFee[] memory fractionalFees)
    {
        fractionalFees = new IHederaTokenServiceV2.FractionalFee[](0);
    }

    function createNAmountRoyaltyFees(
        uint8 numberOfFees,
        int64 numerator,
        int64 denominator,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee[] memory royaltyFees)
    {
        royaltyFees = new IHederaTokenServiceV2.RoyaltyFee[](numberOfFees);

        for (uint8 i = 0; i < numberOfFees; i++) {
            IHederaTokenServiceV2.RoyaltyFee
                memory royaltyFee = createRoyaltyFee(
                    numerator,
                    denominator,
                    feeCollector
                );
            royaltyFees[i] = royaltyFee;
        }
    }

    function getEmptyRoyaltyFees()
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee[] memory royaltyFees)
    {
        royaltyFees = new IHederaTokenServiceV2.RoyaltyFee[](0);
    }

    function createSingleRoyaltyFee(
        int64 numerator,
        int64 denominator,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee[] memory royaltyFees)
    {
        royaltyFees = new IHederaTokenServiceV2.RoyaltyFee[](1);

        IHederaTokenServiceV2.RoyaltyFee memory royaltyFee = createRoyaltyFee(
            numerator,
            denominator,
            feeCollector
        );
        royaltyFees[0] = royaltyFee;
    }

    function createSingleRoyaltyFeeWithFallbackFee(
        int64 numerator,
        int64 denominator,
        int64 amount,
        address tokenId,
        bool useHbarsForPayment,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee[] memory royaltyFees)
    {
        royaltyFees = new IHederaTokenServiceV2.RoyaltyFee[](1);

        IHederaTokenServiceV2.RoyaltyFee
            memory royaltyFee = createRoyaltyFeeWithFallbackFee(
                numerator,
                denominator,
                amount,
                tokenId,
                useHbarsForPayment,
                feeCollector
            );
        royaltyFees[0] = royaltyFee;
    }

    function createRoyaltyFeesWithAllTypes(
        int64 numerator,
        int64 denominator,
        int64 amount,
        address tokenId,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee[] memory royaltyFees)
    {
        royaltyFees = new IHederaTokenServiceV2.RoyaltyFee[](3);
        IHederaTokenServiceV2.RoyaltyFee
            memory royaltyFeeWithoutFallback = createRoyaltyFee(
                numerator,
                denominator,
                feeCollector
            );
        IHederaTokenServiceV2.RoyaltyFee
            memory royaltyFeeWithFallbackHbar = createRoyaltyFeeWithFallbackFee(
                numerator,
                denominator,
                amount,
                address(0x0),
                true,
                feeCollector
            );
        IHederaTokenServiceV2.RoyaltyFee
            memory royaltyFeeWithFallbackToken = createRoyaltyFeeWithFallbackFee(
                numerator,
                denominator,
                amount,
                tokenId,
                false,
                feeCollector
            );
        royaltyFees[0] = royaltyFeeWithoutFallback;
        royaltyFees[1] = royaltyFeeWithFallbackHbar;
        royaltyFees[2] = royaltyFeeWithFallbackToken;
    }

    function createRoyaltyFee(
        int64 numerator,
        int64 denominator,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee memory royaltyFee)
    {
        royaltyFee.numerator = numerator;
        royaltyFee.denominator = denominator;
        royaltyFee.feeCollector = feeCollector;
    }

    function createRoyaltyFeeWithFallbackFee(
        int64 numerator,
        int64 denominator,
        int64 amount,
        address tokenId,
        bool useHbarsForPayment,
        address feeCollector
    )
        internal
        pure
        returns (IHederaTokenServiceV2.RoyaltyFee memory royaltyFee)
    {
        royaltyFee.numerator = numerator;
        royaltyFee.denominator = denominator;
        royaltyFee.amount = amount;
        royaltyFee.tokenId = tokenId;
        royaltyFee.useHbarsForPayment = useHbarsForPayment;
        royaltyFee.feeCollector = feeCollector;
    }
}
