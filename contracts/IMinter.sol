// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

interface IMinter {
	struct MintTiming {
		uint lastMintTime;
		uint mintStartTime;
		bool mintPaused;
		uint cooldownPeriod;
		uint refundWindow;
		bool wlOnly;
	}

	struct MintEconomics {
		bool lazyFromContract;
		// in tinybar
		uint mintPriceHbar;
		// adjusted for decimal 1
		uint mintPriceLazy;
		uint wlDiscount;
		uint maxMint;
		uint buyWlWithLazy;
		uint maxWlAddressMint;
		uint maxMintPerWallet;
		address wlToken;
	}

	// to avoid serialisation related default causing odd behaviour
	// implementing custom object as a wrapper
	struct NFTFeeObject {
		uint32 numerator;
		uint32 denominator;
		uint32 fallbackfee;
		address account;
	}

	enum ContractEventType {
		INITIALISE, 
		REFUND,
		BURN,
		PAUSE,
		UNPAUSE,
		LAZY_PMT,
		WL_PURCHASE_TOKEN,
		WL_PURCHASE_LAZY,
		WL_SPOTS_PURCHASED,
		WL_ADD,
		WL_REMOVE,
		RESET_CONTRACT,
		RESET_INC_TOKEN,
		UPDATE_WL_TOKEN,
		UPDATE_WL_LAZY_BUY,
		UPDATE_WL_ONLY,
		UPDATE_WL_MAX,
		UPDATE_WL_DISCOUNT,
		UPDATE_MAX_MINT,
		UPDATE_MAX_WALLET_MINT,
		UPDATE_COOLDOWN,
		UPDATE_REFUND_WINDOW,
		UPDATE_MINT_PRICE,
		UPDATE_MINT_PRICE_LAZY,
		UPDATE_LAZY_BURN_PERCENTAGE,
		UPDATE_LAZY_FROM_CONTRACT,
		UPDATE_LAZY_SCT,
		UPDATE_LAZY_TOKEN,
		UPDATE_CID,
		UPDATE_MINT_START_TIME,
		RECIEVE,
		FALLBACK
	}

	event MinterContractMessage(
		ContractEventType eventType,
		address indexed msgAddress,
		uint msgNumeric
	);

	event MintEvent(
		address indexed msgAddress,
		bool mintType,
		uint indexed serial,
		string metadata
	);

	event BurnEvent(
		address indexed burnerAddress,
		int64[] serials,
		uint64 newSupply
	);
}