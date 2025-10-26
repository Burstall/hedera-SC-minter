# EditionWithPrize - UX Implementation Guide (Part 1: Core Concepts & State Management)

**Version:** 1.0  
**Last Updated:** October 26, 2025  
**Contract:** EditionWithPrize.sol v1.0  

---

## Table of Contents

1. [Overview](#overview)
2. [Contract Architecture](#contract-architecture)
3. [Phase Lifecycle](#phase-lifecycle)
4. [State Query Methods](#state-query-methods)
5. [View Functions Reference](#view-functions-reference)
6. [Network Configuration](#network-configuration)
7. [Error Handling](#error-handling)

---

## Overview

The EditionWithPrize contract implements a multi-winner NFT minting system where buyers can win additional prizes. This guide provides frontend developers with everything needed to integrate the contract into a user interface.

### Key Features

- **Multi-Winner System**: Select 1+ winners from minted NFTs using Hedera PRNG
- **Bearer Asset Model**: Winning serials are tradeable before prize claiming
- **Multi-Payment Support**: Accept HBAR, LAZY (fungible token with burn), and USDC (dual-token support)
- **Whitelist System**: Three purchase methods (free, LAZY burn, token holding)
- **Gas Optimized**: EnumerableSet for O(1) lookups, transparent gas warnings
- **5-Phase Lifecycle**: Structured workflow from initialization to prize claiming

### Target Audience

This document is for frontend developers, UI/UX designers, and integration engineers building interfaces for the EditionWithPrize contract.

---

## Contract Architecture

### Core Components

```
EditionWithPrize Contract
├── NFT Collection (HIP-412 compliant)
├── Payment System (HBAR/LAZY/USDC)
├── Whitelist Manager
├── Prize Distribution System
└── Winner Selection (Hedera PRNG)
```

### Dependencies

- **Hedera Token Service (HTS)**: NFT creation and management
- **PRNG Contract**: Random number generation for winner selection
- **Lazy Gas Station**: Optional gas sponsorship for LAZY payments
- **Lazy Delegate Registry**: Token ownership verification for whitelist

### Payment Token Addresses

**Testnet:**
- LAZY Token: `0.0.6841468`
- USDC Native: `0.0.7110482`
- USDC Bridged: `0.0.7110483`

**Mainnet:**
- LAZY Token: TBD (set via environment)
- USDC Native: `0.0.456858`
- USDC Bridged: `0.0.5249969`

---

## Phase Lifecycle

The contract progresses through 5 distinct phases. Understanding these phases is critical for UI state management.

### Phase Diagram

```
NOT_INITIALIZED (0)
    ↓ [initialize()]
EDITION_MINTING (1)
    ↓ [all NFTs sold OR admin sets sold out]
EDITION_SOLD_OUT (2)
    ↓ [selectWinners()]
WINNER_SELECTED (3)
    ↓ [claimPrize() by winner]
PRIZE_CLAIMED (4)
```

### Phase Details

#### Phase 0: NOT_INITIALIZED
- **State**: Contract deployed but not configured
- **User Actions**: None
- **Admin Actions**: `initialize()` with collection details
- **UI Display**: "Coming Soon" or "Configuration Pending"

#### Phase 1: EDITION_MINTING
- **State**: Active minting period
- **User Actions**: 
  - `mint()` with HBAR/LAZY/USDC
  - `purchaseWhitelistSpot()` if WL-only enabled
  - Check whitelist status
  - Check NFT availability
- **Admin Actions**: 
  - Add/remove whitelist addresses
  - Toggle WL-only mode
  - Set sold out early
  - Withdraw collected funds
- **UI Display**: 
  - Mint counter: "X / MAX_SUPPLY minted"
  - Payment options selector
  - Whitelist status indicator
  - Real-time availability updates

#### Phase 2: EDITION_SOLD_OUT
- **State**: All NFTs minted, awaiting winner selection
- **User Actions**: None (waiting state)
- **Admin Actions**: `selectWinners(numberOfWinners)`
- **UI Display**: 
  - "Sold Out - Winner Selection Pending"
  - Total minted count
  - Expected number of winners (if announced)

#### Phase 3: WINNER_SELECTED
- **State**: Winners chosen, prizes unclaimed
- **User Actions**: 
  - `claimPrize(serialNumber)` if holding winning serial
  - Check if owned serial is a winner
  - View winner list
- **Admin Actions**: None (immutable winner set)
- **UI Display**: 
  - "Winners Announced!"
  - Winner list with claim status
  - Claim button for eligible users
  - "Check Your NFTs" prompt

#### Phase 4: PRIZE_CLAIMED
- **State**: All prizes claimed (terminal state)
- **User Actions**: View historical data only
- **Admin Actions**: None
- **UI Display**: 
  - "Collection Complete"
  - Winner list with timestamps
  - Historical minting data

---

## State Query Methods

These methods read contract state without modifying it. All are gas-free and can be called frequently.

### Critical State Queries

#### 1. Get Current Phase

```javascript
const phase = await contract.getCurrentPhase();

// Phase values:
// 0 = NOT_INITIALIZED
// 1 = EDITION_MINTING
// 2 = EDITION_SOLD_OUT
// 3 = WINNER_SELECTED
// 4 = PRIZE_CLAIMED
```

**Usage:** Query before every user interaction to ensure UI shows correct state.

**Update Frequency:** After any transaction or every 5-10 seconds during active phases.

#### 2. Get Collection Info

```javascript
const info = await contract.getCollectionInfo();

// Returns:
// {
//   nftTokenAddress: "0x...",  // Token ID as 0x address
//   maxSupply: 100,            // Total mintable NFTs
//   prizeValue: 5000000000,    // Prize amount in tinybars (50 HBAR)
//   lazyCost: 10000000000,     // LAZY cost per mint (100 LAZY)
//   lazyBurnPercentage: 5000,  // Burn % (5000 = 50%)
//   usdcCost: 1000000,         // USDC cost (6 decimals)
//   acceptedUSDCToken: 1       // 1=Native, 2=Bridged, 3=Both
// }
```

**Usage:** Display pricing, show max supply, calculate user costs.

**Update Frequency:** Cache on initial load, refresh if admin might have changed settings.

#### 3. Get Mint Count

```javascript
const mintCount = await contract.getMintCount();

// Returns current number of minted NFTs (0 to maxSupply)
```

**Usage:** Display "X / MAX_SUPPLY" counter, check availability.

**Update Frequency:** After minting transactions, poll every 5 seconds during active minting.

#### 4. Get Winner Count

```javascript
const winnerCount = await contract.getWinnerCount();

// Returns number of winners selected (0 if not yet selected)
```

**Usage:** Display winner count after selection, validate claim eligibility.

**Update Frequency:** After winner selection, then cache (immutable after selection).

#### 5. Check Whitelist Status

```javascript
const isWhitelisted = await contract.isWhitelisted("0xUserAddress");

// Returns: true/false
```

**Usage:** Show whitelist badge, enable/disable minting based on WL-only mode.

**Update Frequency:** On user connect, after whitelist purchase attempts.

#### 6. Check WL-Only Mode

```javascript
const wlOnlyActive = await contract.getWLOnlyActive();

// Returns: true/false
```

**Usage:** Show "Whitelist Only" banner, restrict minting UI for non-WL users.

**Update Frequency:** Every 10-30 seconds during minting phase.

#### 7. Get WL Purchase Options

```javascript
const options = await contract.getWLPurchaseOptions();

// Returns:
// {
//   lazyCost: 50000000000,      // LAZY cost to buy WL spot (50 LAZY)
//   requiredTokenId: "0x...",   // Token user must hold (0x0 if disabled)
//   requiredTokenAmount: 1      // Amount required to hold
// }
```

**Usage:** Display WL purchase pricing, check token requirements.

**Update Frequency:** Cache on load, refresh if admin changes settings.

#### 8. Check if Serial is Winner

```javascript
const isWinner = await contract.isWinner(serialNumber);

// Returns: true/false
```

**Usage:** Highlight winning NFTs in user's wallet, enable claim button.

**Update Frequency:** After winner selection when displaying user's NFTs.

#### 9. Check if Prize Claimed

```javascript
const isClaimed = await contract.isPrizeClaimed(serialNumber);

// Returns: true/false
```

**Usage:** Show "Claimed" badge on winner NFTs, disable claim button.

**Update Frequency:** After claim transactions, when displaying winner list.

#### 10. Get Winner at Index

```javascript
const winnerSerial = await contract.getWinnerAtIndex(index);

// Returns: serial number (1 to maxSupply)
// Throws if index >= winnerCount
```

**Usage:** Iterate through all winners to build winner list UI.

**Update Frequency:** After winner selection, then cache (immutable).

---

## View Functions Reference

Complete reference for all read-only contract methods.

### Collection Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `getCurrentPhase()` | uint8 | Current lifecycle phase (0-4) | Free |
| `getCollectionInfo()` | CollectionInfo struct | All collection parameters | Free |
| `getMintCount()` | uint256 | Number of NFTs minted | Free |
| `getMaxSupply()` | uint256 | Maximum mintable NFTs | Free |
| `getPrizeValue()` | uint256 | Prize amount in tinybars | Free |
| `getNFTTokenAddress()` | address | NFT token contract address | Free |

### Pricing Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `getLazyCost()` | uint256 | LAZY token cost per mint | Free |
| `getLazyBurnPercentage()` | uint16 | LAZY burn % (10000 = 100%) | Free |
| `getUSDCCost()` | uint256 | USDC cost per mint (6 decimals) | Free |
| `getAcceptedUSDCToken()` | uint8 | Which USDC tokens accepted (1/2/3) | Free |

### Whitelist Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `isWhitelisted(address)` | bool | Check if address is whitelisted | Free |
| `getWLOnlyActive()` | bool | Check if WL-only mode enabled | Free |
| `getWLPurchaseOptions()` | WLPurchaseOptions struct | WL purchase requirements | Free |

### Winner Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `getWinnerCount()` | uint256 | Number of winners selected | Free |
| `isWinner(uint256)` | bool | Check if serial number won | Free |
| `isPrizeClaimed(uint256)` | bool | Check if prize was claimed | Free |
| `getWinnerAtIndex(uint256)` | uint256 | Get winner serial by index | Free |

### Owner Information

| Function | Returns | Description | Gas Cost |
|----------|---------|-------------|----------|
| `owner()` | address | Contract owner address | Free |

---

## Network Configuration

### Environment Setup

The contract uses environment-specific token addresses. Your frontend should detect the network and use appropriate values.

#### Detecting Network

```javascript
// Using Hedera SDK
const client = Client.forTestnet(); // or Client.forMainnet()
const networkName = client._network.name; // "testnet" or "mainnet"

// Using HashConnect or wallet adapter
const network = walletData.network; // "testnet" or "mainnet"
```

#### Token Addresses by Network

```javascript
const NETWORK_CONFIG = {
  testnet: {
    lazyToken: "0.0.6841468",
    usdcNative: "0.0.7110482",
    usdcBridged: "0.0.7110483",
    lazyGasStation: "0.0.7092284",
    prngContract: "0.0.7091122",
    delegateRegistry: "0.0.7091124"
  },
  mainnet: {
    lazyToken: process.env.LAZY_TOKEN_ID,
    usdcNative: "0.0.456858",
    usdcBridged: "0.0.5249969",
    lazyGasStation: process.env.LAZY_GAS_STATION_CONTRACT_ID,
    prngContract: process.env.PRNG_CONTRACT_ID,
    delegateRegistry: process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID
  }
};

// Usage
const config = NETWORK_CONFIG[networkName];
```

#### Contract Addresses

The EditionWithPrize contract address should be configurable per deployment:

```javascript
const CONTRACT_ADDRESS = process.env.EDITION_WITH_PRIZE_CONTRACT_ID;
```

### Token Associations

Users must associate tokens before transacting. Check associations proactively:

```javascript
// Check if user has associated required tokens
async function checkTokenAssociations(accountId) {
  const requiredTokens = [
    config.lazyToken,      // For LAZY payments
    config.usdcNative,     // For USDC payments (if native accepted)
    config.usdcBridged,    // For USDC payments (if bridged accepted)
    nftTokenAddress        // For receiving NFTs
  ];
  
  // Query mirror node for user's token balances
  const balances = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/tokens`
  ).then(r => r.json());
  
  const associatedTokens = new Set(
    balances.tokens.map(t => t.token_id)
  );
  
  const missingAssociations = requiredTokens.filter(
    tokenId => !associatedTokens.has(tokenId)
  );
  
  return {
    allAssociated: missingAssociations.length === 0,
    missingAssociations
  };
}
```

---

## Error Handling

### Contract Error Codes

The contract uses custom errors for specific failure conditions. Your UI should catch and display user-friendly messages.

#### Common Errors

| Error | Trigger Condition | User Message | UI Action |
|-------|------------------|--------------|-----------|
| `InvalidPhase()` | Action attempted in wrong phase | "This action is not available right now" | Refresh phase state |
| `NotWhitelisted()` | Non-WL user minting in WL-only mode | "You need to be whitelisted to mint" | Show WL purchase options |
| `MaxSupplyReached()` | Attempting to mint when sold out | "Sold out!" | Disable mint button |
| `InsufficientPayment()` | HBAR payment too low | "Insufficient payment amount" | Show correct price |
| `UnauthorizedAccess()` | Non-owner calling admin function | "Admin access required" | Hide admin UI |
| `InvalidWinnerSelection()` | Selecting 0 or too many winners | "Invalid winner count" | Admin validation |
| `NotAWinner()` | Claiming prize with non-winning serial | "This NFT didn't win a prize" | Check winner status |
| `PrizeAlreadyClaimed()` | Claiming already-claimed prize | "Prize already claimed for this NFT" | Show claimed status |
| `TokenNotOwned()` | Claiming prize when not NFT owner | "You don't own this NFT" | Refresh ownership |

#### HTS Error Codes

When token operations fail, Hedera returns response codes. Map these to user messages:

```javascript
const HTS_ERROR_MESSAGES = {
  167: "Token not associated. Please associate the token first.",
  193: "Insufficient token balance",
  289: "Token allowance exceeded",
  // Add more as needed
};

function getHTSErrorMessage(responseCode) {
  return HTS_ERROR_MESSAGES[responseCode] || 
         `Token operation failed (code ${responseCode})`;
}
```

### Transaction Failure Patterns

#### Pattern 1: Insufficient Gas

```javascript
try {
  const tx = await contract.mint({
    value: hbarAmount,
    gasLimit: 500000  // Insufficient for mint operation
  });
} catch (error) {
  if (error.message.includes("out of gas")) {
    // Show: "Transaction failed due to insufficient gas. Please try again."
    // Retry with higher gas limit
  }
}
```

**Recommended Gas Limits:**
- `mint()`: 800,000 - 1,200,000
- `selectWinners()`: 1,000,000 + (numberOfWinners * 150,000)
- `claimPrize()`: 1,500,000 - 2,000,000
- View functions: No gas needed

#### Pattern 2: User Rejection

```javascript
try {
  const tx = await contract.mint({ value: hbarAmount });
  await tx.wait();
} catch (error) {
  if (error.code === "ACTION_REJECTED" || error.code === 4001) {
    // User rejected in wallet
    // Show: "Transaction cancelled"
    // Don't show as error, just acknowledge
  }
}
```

#### Pattern 3: Network Issues

```javascript
try {
  const tx = await contract.mint({ value: hbarAmount });
  await tx.wait();
} catch (error) {
  if (error.message.includes("timeout") || 
      error.message.includes("network")) {
    // Show: "Network issue. Transaction may still succeed. Check your wallet."
    // Offer option to check transaction status
  }
}
```

### Error Recovery Strategies

#### Strategy 1: State Sync Recovery

If UI state gets out of sync with contract:

```javascript
async function recoverState() {
  try {
    // Refresh all critical state
    const [phase, mintCount, isWL, wlOnly] = await Promise.all([
      contract.getCurrentPhase(),
      contract.getMintCount(),
      contract.isWhitelisted(userAddress),
      contract.getWLOnlyActive()
    ]);
    
    // Update UI state
    updatePhaseUI(phase);
    updateMintCounter(mintCount);
    updateWhitelistStatus(isWL, wlOnly);
    
    return true;
  } catch (error) {
    console.error("State recovery failed:", error);
    return false;
  }
}
```

#### Strategy 2: Transaction Status Checking

For potentially-successful transactions that threw errors:

```javascript
async function checkTransactionStatus(txHash) {
  // Query mirror node for transaction receipt
  const receipt = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/transactions/${txHash}`
  ).then(r => r.json());
  
  if (receipt.result === "SUCCESS") {
    // Transaction actually succeeded
    await recoverState();
    return { success: true, message: "Transaction completed successfully" };
  } else {
    return { 
      success: false, 
      message: `Transaction failed: ${receipt.result}` 
    };
  }
}
```

#### Strategy 3: Retry Logic

For transient failures:

```javascript
async function retryTransaction(txFunction, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await txFunction();
      return { success: true, result };
    } catch (error) {
      if (i === maxRetries - 1) {
        return { success: false, error };
      }
      
      // Check if error is retryable
      if (error.code === "ACTION_REJECTED") {
        // Don't retry user rejections
        return { success: false, error };
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, i) * 1000)
      );
    }
  }
}
```

### Validation Helpers

Pre-validate user actions before attempting transactions:

```javascript
async function validateMintAction(userAddress, paymentMethod) {
  const errors = [];
  
  // Check phase
  const phase = await contract.getCurrentPhase();
  if (phase !== 1) {
    errors.push("Minting is not currently active");
    return { valid: false, errors };
  }
  
  // Check supply
  const mintCount = await contract.getMintCount();
  const maxSupply = await contract.getMaxSupply();
  if (mintCount >= maxSupply) {
    errors.push("Collection is sold out");
    return { valid: false, errors };
  }
  
  // Check whitelist
  const wlOnly = await contract.getWLOnlyActive();
  if (wlOnly) {
    const isWL = await contract.isWhitelisted(userAddress);
    if (!isWL) {
      errors.push("Whitelist required to mint");
      return { valid: false, errors };
    }
  }
  
  // Check payment-specific requirements
  if (paymentMethod === "LAZY") {
    const lazyBalance = await checkLazyBalance(userAddress);
    const lazyCost = await contract.getLazyCost();
    if (lazyBalance < lazyCost) {
      errors.push("Insufficient LAZY balance");
    }
  }
  
  return { 
    valid: errors.length === 0, 
    errors 
  };
}
```

---

## Next Steps

Continue to **Part 2: Transaction Flows & Integration** for:
- Complete minting workflows with code examples
- Whitelist purchase implementations
- Admin operation guides
- Event handling and real-time updates
- Multi-payment integration patterns
- Gas optimization strategies
- Production-ready code examples

---

## Reference Links

- **Contract Source**: `contracts/EditionWithPrize.sol`
- **Business Logic**: `docs/EditionWithPrize-BUSINESS-LOGIC.md`
- **Testing Guide**: `docs/EditionWithPrize-TESTING.md`
- **Interaction Scripts**: `scripts/interactions/EditionWithPrize/`

---

**Document Version:** 1.0  
**Last Updated:** October 26, 2025  
**Maintained By:** Burstall Development Team
