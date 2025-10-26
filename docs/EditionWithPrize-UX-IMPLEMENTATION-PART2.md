# EditionWithPrize - UX Implementation Guide (Part 2: Transaction Flows & Integration)

**Version:** 1.0  
**Last Updated:** October 26, 2025  
**Contract:** EditionWithPrize.sol v1.0  

---

## Table of Contents

1. [Minting Workflows](#minting-workflows)
2. [Whitelist Purchase Methods](#whitelist-purchase-methods)
3. [Prize Claiming Flow](#prize-claiming-flow)
4. [Admin Operations](#admin-operations)
5. [Event Handling](#event-handling)
6. [Multi-Payment Integration](#multi-payment-integration)
7. [Gas Optimization](#gas-optimization)
8. [Complete Code Examples](#complete-code-examples)

---

## Minting Workflows

### Overview

The contract supports three payment methods for minting:
1. **HBAR** - Native Hedera cryptocurrency
2. **LAZY** - Fungible token with burn mechanism
3. **USDC** - Dual-token support (native + bridged)

### Pre-Mint Validation Checklist

Before allowing users to mint, verify:

```javascript
async function canUserMint(userAddress) {
  // 1. Check phase
  const phase = await contract.getCurrentPhase();
  if (phase !== 1) {
    return { canMint: false, reason: "Minting is not active" };
  }
  
  // 2. Check supply
  const mintCount = await contract.getMintCount();
  const maxSupply = await contract.getMaxSupply();
  if (mintCount >= maxSupply) {
    return { canMint: false, reason: "Sold out" };
  }
  
  // 3. Check whitelist (if WL-only mode active)
  const wlOnly = await contract.getWLOnlyActive();
  if (wlOnly) {
    const isWL = await contract.isWhitelisted(userAddress);
    if (!isWL) {
      return { canMint: false, reason: "Whitelist required" };
    }
  }
  
  // 4. Check NFT token association
  const nftAddress = await contract.getNFTTokenAddress();
  const isAssociated = await checkTokenAssociation(userAddress, nftAddress);
  if (!isAssociated) {
    return { 
      canMint: false, 
      reason: "NFT token not associated",
      action: "associate",
      tokenId: nftAddress
    };
  }
  
  return { canMint: true };
}
```

### Minting with HBAR

**Use Case:** Simplest payment method, no token associations needed beyond NFT.

```javascript
async function mintWithHBAR(signer, contractAddress) {
  try {
    // 1. Get contract instance
    const contract = new ethers.Contract(
      contractAddress,
      EditionWithPrizeABI,
      signer
    );
    
    // 2. Validate user can mint
    const userAddress = await signer.getAddress();
    const validation = await canUserMint(userAddress);
    if (!validation.canMint) {
      throw new Error(validation.reason);
    }
    
    // 3. Calculate payment amount
    const collectionInfo = await contract.getCollectionInfo();
    const hbarCost = collectionInfo.prizeValue; // Prize value is HBAR cost
    
    // 4. Submit transaction
    const tx = await contract.mint(
      ethers.constants.AddressZero,  // paymentToken (0x0 = HBAR)
      0,                             // paymentAmount (unused for HBAR)
      false,                         // useGasStation (false for HBAR)
      {
        value: hbarCost,             // Attach HBAR payment
        gasLimit: 1000000            // Sufficient gas for mint
      }
    );
    
    console.log("Transaction submitted:", tx.hash);
    
    // 5. Wait for confirmation
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt.transactionHash);
    
    // 6. Extract serial number from events
    const mintEvent = receipt.events?.find(e => e.event === "NFTMinted");
    const serialNumber = mintEvent?.args?.serialNumber;
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      serialNumber: serialNumber?.toString()
    };
    
  } catch (error) {
    console.error("Mint with HBAR failed:", error);
    
    // Parse error for user-friendly message
    if (error.message.includes("NotWhitelisted")) {
      return { success: false, error: "You need to be whitelisted to mint" };
    } else if (error.message.includes("MaxSupplyReached")) {
      return { success: false, error: "Collection is sold out" };
    } else if (error.code === "ACTION_REJECTED") {
      return { success: false, error: "Transaction cancelled by user" };
    }
    
    return { 
      success: false, 
      error: error.message || "Mint failed. Please try again." 
    };
  }
}
```

**UI Flow:**
1. User clicks "Mint with HBAR"
2. Show loading state: "Preparing transaction..."
3. Wallet prompts for approval
4. Show pending state: "Minting in progress..."
5. On success: "NFT minted! Serial #X"
6. Refresh mint count and user's NFT balance

### Minting with LAZY

**Use Case:** Users pay with LAZY token. Contract burns a percentage and keeps remainder.

```javascript
async function mintWithLAZY(signer, contractAddress, useGasStation = true) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      EditionWithPrizeABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Validate user can mint
    const validation = await canUserMint(userAddress);
    if (!validation.canMint) {
      throw new Error(validation.reason);
    }
    
    // 2. Get LAZY cost
    const lazyCost = await contract.getLazyCost();
    const lazyBurnPerc = await contract.getLazyBurnPercentage();
    
    // 3. Check LAZY token association
    const lazyTokenId = process.env.LAZY_TOKEN_ID;
    const isAssociated = await checkTokenAssociation(userAddress, lazyTokenId);
    if (!isAssociated) {
      throw new Error("LAZY token not associated. Please associate first.");
    }
    
    // 4. Check LAZY balance
    const lazyBalance = await checkTokenBalance(userAddress, lazyTokenId);
    if (BigInt(lazyBalance) < BigInt(lazyCost)) {
      throw new Error(`Insufficient LAZY balance. Need ${formatLAZY(lazyCost)}`);
    }
    
    // 5. Approve LAZY spending
    const lazyToken = new ethers.Contract(
      lazyTokenId,
      ERC20_ABI,
      signer
    );
    
    const currentAllowance = await lazyToken.allowance(
      userAddress,
      contractAddress
    );
    
    if (BigInt(currentAllowance) < BigInt(lazyCost)) {
      console.log("Approving LAZY spending...");
      const approveTx = await lazyToken.approve(
        contractAddress,
        lazyCost,
        { gasLimit: 300000 }
      );
      await approveTx.wait();
      console.log("LAZY approved");
    }
    
    // 6. Submit mint transaction
    const tx = await contract.mint(
      lazyTokenId,     // paymentToken
      lazyCost,        // paymentAmount
      useGasStation,   // useGasStation (sponsor gas if true)
      {
        gasLimit: 1200000  // Higher gas for token operations
      }
    );
    
    console.log("Transaction submitted:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt.transactionHash);
    
    const mintEvent = receipt.events?.find(e => e.event === "NFTMinted");
    const serialNumber = mintEvent?.args?.serialNumber;
    
    // 7. Calculate what was burned
    const burnedAmount = (BigInt(lazyCost) * BigInt(lazyBurnPerc)) / 10000n;
    const keptAmount = BigInt(lazyCost) - burnedAmount;
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      serialNumber: serialNumber?.toString(),
      lazyCost: lazyCost.toString(),
      lazyBurned: burnedAmount.toString(),
      lazyKept: keptAmount.toString()
    };
    
  } catch (error) {
    console.error("Mint with LAZY failed:", error);
    return { 
      success: false, 
      error: error.message || "Mint failed. Please try again." 
    };
  }
}
```

**UI Flow:**
1. User selects "Pay with LAZY"
2. Display cost: "100 LAZY (50 burned, 50 to contract)"
3. Show toggle: "Use gas station" (checked by default)
4. On mint click:
   - Step 1: "Approving LAZY..." (if needed)
   - Step 2: "Minting NFT..."
5. On success: "Minted! #X | 50 LAZY burned"

**Important Notes:**
- LAZY approval is required before first mint
- Gas station (if enabled) sponsors transaction fees
- Burn percentage is transparent to user
- After burn, user's LAZY balance updates

### Minting with USDC

**Use Case:** Users pay with USDC. Contract accepts native, bridged, or both.

```javascript
async function mintWithUSDC(signer, contractAddress, preferredToken = "native") {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      EditionWithPrizeABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Validate user can mint
    const validation = await canUserMint(userAddress);
    if (!validation.canMint) {
      throw new Error(validation.reason);
    }
    
    // 2. Get USDC cost and accepted tokens
    const collectionInfo = await contract.getCollectionInfo();
    const usdcCost = collectionInfo.usdcCost;
    const acceptedToken = collectionInfo.acceptedUSDCToken;
    
    // 3. Determine which USDC token to use
    let usdcTokenId;
    if (acceptedToken === 1) {
      usdcTokenId = process.env.USDC_NATIVE_TOKEN_ID;
    } else if (acceptedToken === 2) {
      usdcTokenId = process.env.USDC_BRIDGED_TOKEN_ID;
    } else if (acceptedToken === 3) {
      // Both accepted - use user preference
      usdcTokenId = preferredToken === "native" 
        ? process.env.USDC_NATIVE_TOKEN_ID 
        : process.env.USDC_BRIDGED_TOKEN_ID;
    }
    
    // 4. Check USDC token association
    const isAssociated = await checkTokenAssociation(userAddress, usdcTokenId);
    if (!isAssociated) {
      throw new Error("USDC token not associated. Please associate first.");
    }
    
    // 5. Check USDC balance
    const usdcBalance = await checkTokenBalance(userAddress, usdcTokenId);
    if (BigInt(usdcBalance) < BigInt(usdcCost)) {
      const formattedCost = (Number(usdcCost) / 1e6).toFixed(2);
      throw new Error(`Insufficient USDC balance. Need $${formattedCost}`);
    }
    
    // 6. Approve USDC spending
    const usdcToken = new ethers.Contract(
      usdcTokenId,
      ERC20_ABI,
      signer
    );
    
    const currentAllowance = await usdcToken.allowance(
      userAddress,
      contractAddress
    );
    
    if (BigInt(currentAllowance) < BigInt(usdcCost)) {
      console.log("Approving USDC spending...");
      const approveTx = await usdcToken.approve(
        contractAddress,
        usdcCost,
        { gasLimit: 300000 }
      );
      await approveTx.wait();
      console.log("USDC approved");
    }
    
    // 7. Submit mint transaction
    const tx = await contract.mint(
      usdcTokenId,     // paymentToken
      usdcCost,        // paymentAmount
      false,           // useGasStation (not supported for USDC)
      {
        gasLimit: 1200000
      }
    );
    
    console.log("Transaction submitted:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt.transactionHash);
    
    const mintEvent = receipt.events?.find(e => e.event === "NFTMinted");
    const serialNumber = mintEvent?.args?.serialNumber;
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      serialNumber: serialNumber?.toString(),
      usdcPaid: (Number(usdcCost) / 1e6).toFixed(2),
      tokenUsed: preferredToken
    };
    
  } catch (error) {
    console.error("Mint with USDC failed:", error);
    return { 
      success: false, 
      error: error.message || "Mint failed. Please try again." 
    };
  }
}
```

**UI Flow:**
1. User selects "Pay with USDC"
2. Display cost: "$10.00 USDC"
3. If both tokens accepted, show selector: "Native" / "Bridged"
4. On mint click:
   - Step 1: "Approving USDC..." (if needed)
   - Step 2: "Minting NFT..."
5. On success: "Minted! #X | Paid $10.00"

**Important Notes:**
- USDC has 6 decimals (1 USDC = 1,000,000)
- Format as currency: `(amount / 1e6).toFixed(2)`
- Gas station not available for USDC payments
- Check `acceptedUSDCToken` before showing options

---

## Whitelist Purchase Methods

Users can purchase whitelist spots through three methods:

### Method 1: Free Whitelist (Admin-Added)

**Flow:** Admin adds addresses directly. No user action required.

```javascript
// Admin function - not exposed to regular users
async function addToWhitelist(adminSigner, contractAddress, addresses) {
  const contract = new ethers.Contract(
    contractAddress,
    EditionWithPrizeABI,
    adminSigner
  );
  
  const tx = await contract.addToWhitelist(
    addresses,  // Array of addresses
    { gasLimit: 200000 + (addresses.length * 50000) }
  );
  
  await tx.wait();
  return { success: true, addedCount: addresses.length };
}
```

**UI Display:**
- Show badge: "✓ Whitelisted" if `isWhitelisted()` returns true
- No purchase button needed

### Method 2: Purchase with LAZY

**Flow:** User burns LAZY tokens to get whitelist access.

```javascript
async function purchaseWhitelistWithLAZY(signer, contractAddress) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      EditionWithPrizeABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Check if already whitelisted
    const isAlreadyWL = await contract.isWhitelisted(userAddress);
    if (isAlreadyWL) {
      return { success: false, error: "You are already whitelisted" };
    }
    
    // 2. Get LAZY cost for WL purchase
    const wlOptions = await contract.getWLPurchaseOptions();
    const lazyCost = wlOptions.lazyCost;
    
    if (lazyCost === 0) {
      return { 
        success: false, 
        error: "LAZY purchase not available. Contact admin." 
      };
    }
    
    // 3. Check LAZY balance
    const lazyTokenId = process.env.LAZY_TOKEN_ID;
    const lazyBalance = await checkTokenBalance(userAddress, lazyTokenId);
    
    if (BigInt(lazyBalance) < BigInt(lazyCost)) {
      const needed = formatLAZY(lazyCost);
      const have = formatLAZY(lazyBalance);
      return { 
        success: false, 
        error: `Insufficient LAZY. Need ${needed}, have ${have}` 
      };
    }
    
    // 4. Approve LAZY spending
    const lazyToken = new ethers.Contract(
      lazyTokenId,
      ERC20_ABI,
      signer
    );
    
    const allowance = await lazyToken.allowance(userAddress, contractAddress);
    if (BigInt(allowance) < BigInt(lazyCost)) {
      const approveTx = await lazyToken.approve(
        contractAddress,
        lazyCost,
        { gasLimit: 300000 }
      );
      await approveTx.wait();
    }
    
    // 5. Purchase whitelist spot
    const tx = await contract.purchaseWhitelistSpot(
      ethers.constants.AddressZero,  // No token required
      { gasLimit: 800000 }
    );
    
    console.log("WL purchase submitted:", tx.hash);
    
    const receipt = await tx.wait();
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      lazyBurned: formatLAZY(lazyCost)
    };
    
  } catch (error) {
    console.error("WL purchase with LAZY failed:", error);
    return { success: false, error: error.message };
  }
}
```

**UI Flow:**
1. Show card: "Purchase Whitelist Access"
2. Display: "Cost: 50 LAZY (burned)"
3. Show user's LAZY balance
4. Button: "Purchase with LAZY"
5. On click:
   - "Approving LAZY..." (if needed)
   - "Purchasing whitelist..."
   - "Success! You're now whitelisted"
6. Update UI to show whitelisted badge

### Method 3: Purchase with Token Holding

**Flow:** User proves they hold required token amount to get whitelist.

```javascript
async function purchaseWhitelistWithToken(signer, contractAddress) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      EditionWithPrizeABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Check if already whitelisted
    const isAlreadyWL = await contract.isWhitelisted(userAddress);
    if (isAlreadyWL) {
      return { success: false, error: "You are already whitelisted" };
    }
    
    // 2. Get token requirements
    const wlOptions = await contract.getWLPurchaseOptions();
    const requiredTokenId = wlOptions.requiredTokenId;
    const requiredAmount = wlOptions.requiredTokenAmount;
    
    if (requiredTokenId === ethers.constants.AddressZero) {
      return { 
        success: false, 
        error: "Token-based purchase not available. Contact admin." 
      };
    }
    
    // 3. Check token balance (with delegate registry support)
    const delegateRegistry = process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID;
    const balance = await checkTokenBalanceWithDelegates(
      userAddress,
      requiredTokenId,
      delegateRegistry
    );
    
    if (BigInt(balance) < BigInt(requiredAmount)) {
      return {
        success: false,
        error: `You must hold at least ${requiredAmount} of the required token`
      };
    }
    
    // 4. Purchase whitelist spot
    const tx = await contract.purchaseWhitelistSpot(
      requiredTokenId,
      { gasLimit: 800000 }
    );
    
    console.log("WL purchase submitted:", tx.hash);
    
    const receipt = await tx.wait();
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      tokenUsed: requiredTokenId
    };
    
  } catch (error) {
    console.error("WL purchase with token failed:", error);
    
    if (error.message.includes("InsufficientTokenBalance")) {
      return { 
        success: false, 
        error: "You don't hold enough of the required token" 
      };
    }
    
    return { success: false, error: error.message };
  }
}
```

**UI Flow:**
1. Show card: "Whitelist for Token Holders"
2. Display: "Hold 1+ of Token XYZ to qualify"
3. Check user's balance automatically
4. If qualified:
   - Button: "Claim Whitelist Spot" (enabled)
5. If not qualified:
   - Message: "You need to hold the required token"
   - Button: "Claim Whitelist Spot" (disabled)
6. On claim: "Success! You're now whitelisted"

**Helper Function for Delegate Registry:**

```javascript
async function checkTokenBalanceWithDelegates(
  userAddress, 
  tokenId, 
  delegateRegistryAddress
) {
  // Check direct balance
  let balance = await checkTokenBalance(userAddress, tokenId);
  
  // Check delegated balance if registry available
  if (delegateRegistryAddress) {
    const registry = new ethers.Contract(
      delegateRegistryAddress,
      DELEGATE_REGISTRY_ABI,
      provider
    );
    
    // Get all delegated addresses
    const delegatedAddresses = await registry.getDelegatesForToken(
      userAddress,
      tokenId
    );
    
    // Sum balances from delegates
    for (const delegateAddr of delegatedAddresses) {
      const delegateBalance = await checkTokenBalance(delegateAddr, tokenId);
      balance += delegateBalance;
    }
  }
  
  return balance;
}
```

---

## Prize Claiming Flow

After winners are selected, users can claim prizes for winning NFTs they own.

### Claim Validation

```javascript
async function canUserClaimPrize(userAddress, serialNumber) {
  const errors = [];
  
  // 1. Check phase
  const phase = await contract.getCurrentPhase();
  if (phase !== 3) {
    errors.push("Winners haven't been selected yet");
    return { canClaim: false, errors };
  }
  
  // 2. Check if serial is a winner
  const isWinner = await contract.isWinner(serialNumber);
  if (!isWinner) {
    errors.push("This NFT is not a winner");
    return { canClaim: false, errors };
  }
  
  // 3. Check if already claimed
  const isClaimed = await contract.isPrizeClaimed(serialNumber);
  if (isClaimed) {
    errors.push("Prize already claimed for this NFT");
    return { canClaim: false, errors };
  }
  
  // 4. Check ownership
  const owner = await getNFTOwner(serialNumber);
  if (owner.toLowerCase() !== userAddress.toLowerCase()) {
    errors.push("You don't own this NFT");
    return { canClaim: false, errors };
  }
  
  return { canClaim: true };
}
```

### Claiming Prize

```javascript
async function claimPrize(signer, contractAddress, serialNumber) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      EditionWithPrizeABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Validate can claim
    const validation = await canUserClaimPrize(userAddress, serialNumber);
    if (!validation.canClaim) {
      return { success: false, error: validation.errors[0] };
    }
    
    // 2. Get prize value
    const prizeValue = await contract.getPrizeValue();
    
    // 3. Submit claim transaction
    const tx = await contract.claimPrize(
      serialNumber,
      {
        gasLimit: 2000000  // High gas for prize transfer
      }
    );
    
    console.log("Claim submitted:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("Claim confirmed:", receipt.transactionHash);
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      serialNumber: serialNumber,
      prizeValue: ethers.utils.formatUnits(prizeValue, 8)  // HBAR has 8 decimals
    };
    
  } catch (error) {
    console.error("Prize claim failed:", error);
    
    if (error.message.includes("NotAWinner")) {
      return { success: false, error: "This NFT is not a winner" };
    } else if (error.message.includes("PrizeAlreadyClaimed")) {
      return { success: false, error: "Prize already claimed" };
    } else if (error.message.includes("TokenNotOwned")) {
      return { success: false, error: "You don't own this NFT" };
    }
    
    return { success: false, error: error.message };
  }
}
```

### UI Implementation

**Winner Announcement Page:**

```javascript
async function displayWinnerList() {
  const winnerCount = await contract.getWinnerCount();
  const winners = [];
  
  // Fetch all winners
  for (let i = 0; i < winnerCount; i++) {
    const serialNumber = await contract.getWinnerAtIndex(i);
    const isClaimed = await contract.isPrizeClaimed(serialNumber);
    const owner = await getNFTOwner(serialNumber);
    
    winners.push({
      serial: serialNumber,
      claimed: isClaimed,
      owner: owner
    });
  }
  
  return winners;
}

// Render winners
function renderWinnerList(winners, userAddress) {
  return winners.map(winner => ({
    serial: `#${winner.serial}`,
    status: winner.claimed ? "✓ Claimed" : "Unclaimed",
    isUserWinner: winner.owner.toLowerCase() === userAddress.toLowerCase(),
    canClaim: !winner.claimed && winner.owner.toLowerCase() === userAddress.toLowerCase()
  }));
}
```

**User NFT Gallery:**

```javascript
async function displayUserNFTs(userAddress) {
  // Get user's NFT serials
  const userNFTs = await getUserNFTSerials(userAddress);
  
  // Check which are winners
  const nftsWithWinStatus = await Promise.all(
    userNFTs.map(async (serial) => {
      const isWinner = await contract.isWinner(serial);
      const isClaimed = isWinner 
        ? await contract.isPrizeClaimed(serial)
        : false;
      
      return {
        serial,
        isWinner,
        isClaimed,
        canClaim: isWinner && !isClaimed
      };
    })
  );
  
  return nftsWithWinStatus;
}

// Render NFT cards
function renderNFTCard(nft) {
  return {
    image: `ipfs://${baseURI}/${nft.serial}`,
    serial: `#${nft.serial}`,
    badge: nft.isWinner ? (nft.isClaimed ? "Prize Claimed ✓" : "🏆 WINNER!") : null,
    claimButton: nft.canClaim ? "Claim Prize" : null
  };
}
```

---

## Admin Operations

Admin functions for contract management. Restrict access to owner address only.

### Initialize Collection

```javascript
async function initializeCollection(adminSigner, params) {
  const contract = new ethers.Contract(
    contractAddress,
    EditionWithPrizeABI,
    adminSigner
  );
  
  const tx = await contract.initialize(
    params.name,          // "Cool NFT Collection"
    params.symbol,        // "COOL"
    params.maxSupply,     // 100
    params.baseURI,       // "ipfs://QmXXX/"
    params.prizeValue,    // 50 HBAR = 5000000000 tinybars
    params.lazyCost,      // 100 LAZY = 100_00000000 (8 decimals)
    params.lazyBurnPerc,  // 5000 = 50%
    params.usdcCost,      // 10 USDC = 10000000 (6 decimals)
    params.acceptedUSDC,  // 1=Native, 2=Bridged, 3=Both
    {
      value: params.prizeValue.mul(params.maxSupply),  // Fund prize pool
      gasLimit: 3000000
    }
  );
  
  await tx.wait();
  return { success: true };
}
```

### Select Winners

```javascript
async function selectWinners(adminSigner, numberOfWinners) {
  const contract = new ethers.Contract(
    contractAddress,
    EditionWithPrizeABI,
    adminSigner
  );
  
  // Validate phase
  const phase = await contract.getCurrentPhase();
  if (phase !== 2) {
    throw new Error("Can only select winners after sold out");
  }
  
  const mintCount = await contract.getMintCount();
  if (numberOfWinners > mintCount) {
    throw new Error(`Cannot select more winners than minted NFTs (${mintCount})`);
  }
  
  // Calculate gas requirement
  const baseGas = 1000000;
  const gasPerWinner = 150000;
  const totalGas = baseGas + (numberOfWinners * gasPerWinner);
  
  // Warn if high gas
  if (numberOfWinners > 10) {
    console.warn(`⚠️ Selecting ${numberOfWinners} winners requires ~${totalGas.toLocaleString()} gas`);
  }
  
  const tx = await contract.selectWinners(
    numberOfWinners,
    { gasLimit: totalGas }
  );
  
  await tx.wait();
  return { success: true, winnersSelected: numberOfWinners };
}
```

### Withdraw Funds

```javascript
async function withdrawFunds(adminSigner, amount, recipient) {
  const contract = new ethers.Contract(
    contractAddress,
    EditionWithPrizeABI,
    adminSigner
  );
  
  const tx = await contract.withdrawHBAR(
    amount,     // Amount in tinybars
    recipient,  // Recipient address
    { gasLimit: 500000 }
  );
  
  await tx.wait();
  return { success: true };
}
```

---

## Event Handling

Listen for contract events to update UI in real-time.

### Event Types

```solidity
event CollectionInitialized(address nftTokenAddress, uint256 maxSupply);
event NFTMinted(address minter, uint256 serialNumber, address paymentToken);
event WinnerSelected(uint256 serialNumber);
event PrizeClaimed(address claimer, uint256 serialNumber, uint256 prizeAmount);
event WhitelistUpdated(address[] addresses, bool added);
event WLOnlyStatusChanged(bool isActive);
```

### Event Listeners

```javascript
function setupEventListeners(contract, callbacks) {
  // Collection initialized
  contract.on("CollectionInitialized", (nftTokenAddress, maxSupply) => {
    console.log("Collection initialized:", nftTokenAddress);
    callbacks.onInitialized?.({
      nftTokenAddress,
      maxSupply: maxSupply.toNumber()
    });
  });
  
  // NFT minted
  contract.on("NFTMinted", (minter, serialNumber, paymentToken) => {
    console.log("NFT minted:", serialNumber.toString());
    callbacks.onMinted?.({
      minter,
      serialNumber: serialNumber.toString(),
      paymentToken
    });
  });
  
  // Winner selected
  contract.on("WinnerSelected", (serialNumber) => {
    console.log("Winner selected:", serialNumber.toString());
    callbacks.onWinnerSelected?.({
      serialNumber: serialNumber.toString()
    });
  });
  
  // Prize claimed
  contract.on("PrizeClaimed", (claimer, serialNumber, prizeAmount) => {
    console.log("Prize claimed:", serialNumber.toString());
    callbacks.onPrizeClaimed?.({
      claimer,
      serialNumber: serialNumber.toString(),
      prizeAmount: prizeAmount.toString()
    });
  });
  
  // Whitelist updated
  contract.on("WhitelistUpdated", (addresses, added) => {
    console.log("Whitelist updated:", addresses.length);
    callbacks.onWhitelistUpdated?.({
      addresses,
      added
    });
  });
}

// Usage
setupEventListeners(contract, {
  onMinted: (data) => {
    // Update mint counter
    updateMintCount();
    // Show notification
    showNotification(`NFT #${data.serialNumber} minted!`);
  },
  onWinnerSelected: (data) => {
    // Refresh winner list
    loadWinnerList();
  },
  onPrizeClaimed: (data) => {
    // Update claim status
    markPrizeAsClaimed(data.serialNumber);
  }
});
```

---

## Multi-Payment Integration

Comprehensive payment selector implementation.

```javascript
function PaymentSelector({ onSelect, collectionInfo }) {
  const [selectedMethod, setSelectedMethod] = useState("HBAR");
  const [usdcType, setUsdcType] = useState("native");
  const [useGasStation, setUseGasStation] = useState(true);
  
  const methods = [
    {
      id: "HBAR",
      name: "HBAR",
      cost: formatHBAR(collectionInfo.prizeValue),
      icon: "hbar-icon.svg",
      available: true
    },
    {
      id: "LAZY",
      name: "LAZY",
      cost: formatLAZY(collectionInfo.lazyCost),
      detail: `${collectionInfo.lazyBurnPercentage/100}% burned`,
      icon: "lazy-icon.svg",
      available: collectionInfo.lazyCost > 0,
      hasGasStation: true
    },
    {
      id: "USDC",
      name: "USDC",
      cost: formatUSDC(collectionInfo.usdcCost),
      icon: "usdc-icon.svg",
      available: collectionInfo.acceptedUSDCToken > 0,
      hasTypeSelector: collectionInfo.acceptedUSDCToken === 3
    }
  ];
  
  const handleSelect = (method) => {
    setSelectedMethod(method.id);
    onSelect({
      method: method.id,
      usdcType: method.id === "USDC" ? usdcType : null,
      useGasStation: method.id === "LAZY" ? useGasStation : false
    });
  };
  
  return (
    <div className="payment-selector">
      {methods.filter(m => m.available).map(method => (
        <div 
          key={method.id}
          className={`payment-option ${selectedMethod === method.id ? 'selected' : ''}`}
          onClick={() => handleSelect(method)}
        >
          <img src={method.icon} alt={method.name} />
          <div className="payment-details">
            <div className="payment-name">{method.name}</div>
            <div className="payment-cost">{method.cost}</div>
            {method.detail && <div className="payment-detail">{method.detail}</div>}
          </div>
          
          {method.hasGasStation && selectedMethod === method.id && (
            <label className="gas-station-toggle">
              <input 
                type="checkbox" 
                checked={useGasStation}
                onChange={(e) => {
                  setUseGasStation(e.target.checked);
                  handleSelect(method);
                }}
              />
              Use Gas Station (sponsored fees)
            </label>
          )}
          
          {method.hasTypeSelector && selectedMethod === method.id && (
            <div className="usdc-type-selector">
              <label>
                <input 
                  type="radio" 
                  value="native"
                  checked={usdcType === "native"}
                  onChange={(e) => {
                    setUsdcType(e.target.value);
                    handleSelect(method);
                  }}
                />
                Native USDC
              </label>
              <label>
                <input 
                  type="radio" 
                  value="bridged"
                  checked={usdcType === "bridged"}
                  onChange={(e) => {
                    setUsdcType(e.target.value);
                    handleSelect(method);
                  }}
                />
                Bridged USDC
              </label>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## Gas Optimization

### Recommended Gas Limits

| Operation | Base Gas | Variable Gas | Formula | Example |
|-----------|----------|--------------|---------|---------|
| `mint()` HBAR | 800,000 | - | 800,000 | 800,000 |
| `mint()` LAZY | 1,200,000 | - | 1,200,000 | 1,200,000 |
| `mint()` USDC | 1,200,000 | - | 1,200,000 | 1,200,000 |
| `selectWinners()` | 1,000,000 | 150,000/winner | 1M + (N * 150K) | 2.5M for 10 winners |
| `claimPrize()` | 1,500,000 | - | 1,500,000 | 1,500,000 |
| `purchaseWhitelistSpot()` | 800,000 | - | 800,000 | 800,000 |

### Gas Estimation Helper

```javascript
async function estimateGasForOperation(operation, params = {}) {
  const estimates = {
    mint: {
      HBAR: 800000,
      LAZY: 1200000,
      USDC: 1200000
    },
    selectWinners: 1000000 + (params.numberOfWinners * 150000),
    claimPrize: 1500000,
    purchaseWL: 800000
  };
  
  const estimate = estimates[operation];
  
  if (typeof estimate === 'object') {
    return estimate[params.paymentMethod] || estimate.HBAR;
  }
  
  return estimate;
}

// Usage
const gasLimit = await estimateGasForOperation('mint', { 
  paymentMethod: 'LAZY' 
});

const gasLimit = await estimateGasForOperation('selectWinners', { 
  numberOfWinners: 15 
});
```

### Gas Warning UI

```javascript
function GasWarning({ operation, params }) {
  const gasLimit = estimateGasForOperation(operation, params);
  const gasPrice = 0.0001; // HBAR per gas unit (approximate)
  const estimatedCost = (gasLimit * gasPrice).toFixed(4);
  
  if (operation === 'selectWinners' && params.numberOfWinners > 10) {
    return (
      <div className="gas-warning">
        ⚠️ Selecting {params.numberOfWinners} winners requires high gas.
        <br />
        Estimated: ~{estimatedCost} HBAR in fees
      </div>
    );
  }
  
  return null;
}
```

---

## Complete Code Examples

### Full Minting Component

```javascript
import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function MintingInterface({ contractAddress, userAddress, signer }) {
  const [phase, setPhase] = useState(0);
  const [mintCount, setMintCount] = useState(0);
  const [maxSupply, setMaxSupply] = useState(0);
  const [collectionInfo, setCollectionInfo] = useState(null);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [wlOnly, setWlOnly] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("HBAR");
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState(null);
  
  const contract = new ethers.Contract(
    contractAddress,
    EditionWithPrizeABI,
    signer
  );
  
  // Load state on mount and interval
  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);
  
  async function loadState() {
    try {
      const [p, mc, info, wl, wlo] = await Promise.all([
        contract.getCurrentPhase(),
        contract.getMintCount(),
        contract.getCollectionInfo(),
        contract.isWhitelisted(userAddress),
        contract.getWLOnlyActive()
      ]);
      
      setPhase(p);
      setMintCount(mc.toNumber());
      setMaxSupply(info.maxSupply.toNumber());
      setCollectionInfo(info);
      setIsWhitelisted(wl);
      setWlOnly(wlo);
    } catch (err) {
      console.error("Failed to load state:", err);
    }
  }
  
  async function handleMint() {
    setMinting(true);
    setError(null);
    
    try {
      let result;
      
      if (paymentMethod === "HBAR") {
        result = await mintWithHBAR(signer, contractAddress);
      } else if (paymentMethod === "LAZY") {
        result = await mintWithLAZY(signer, contractAddress, true);
      } else if (paymentMethod === "USDC") {
        result = await mintWithUSDC(signer, contractAddress, "native");
      }
      
      if (result.success) {
        alert(`Success! Minted NFT #${result.serialNumber}`);
        loadState(); // Refresh state
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setMinting(false);
    }
  }
  
  const canMint = phase === 1 && 
                  mintCount < maxSupply && 
                  (!wlOnly || isWhitelisted);
  
  return (
    <div className="minting-interface">
      <h2>Mint Your NFT</h2>
      
      {/* Phase indicator */}
      <div className="phase-indicator">
        {phase === 0 && "Coming Soon"}
        {phase === 1 && "Minting Active"}
        {phase === 2 && "Sold Out - Awaiting Winners"}
        {phase === 3 && "Winners Selected"}
        {phase === 4 && "Collection Complete"}
      </div>
      
      {/* Supply counter */}
      <div className="supply-counter">
        {mintCount} / {maxSupply} minted
      </div>
      
      {/* Whitelist indicator */}
      {wlOnly && (
        <div className="whitelist-indicator">
          {isWhitelisted 
            ? "✓ You are whitelisted" 
            : "⚠️ Whitelist required"}
        </div>
      )}
      
      {/* Payment selector */}
      {phase === 1 && (
        <PaymentSelector 
          onSelect={(method) => setPaymentMethod(method.method)}
          collectionInfo={collectionInfo}
        />
      )}
      
      {/* Mint button */}
      <button 
        onClick={handleMint}
        disabled={!canMint || minting}
        className="mint-button"
      >
        {minting ? "Minting..." : "Mint NFT"}
      </button>
      
      {/* Error display */}
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
    </div>
  );
}
```

### Full Prize Claiming Component

```javascript
function PrizeClaimingInterface({ contractAddress, userAddress, signer }) {
  const [phase, setPhase] = useState(0);
  const [userNFTs, setUserNFTs] = useState([]);
  const [claiming, setClaiming] = useState(null);
  
  const contract = new ethers.Contract(
    contractAddress,
    EditionWithPrizeABI,
    signer
  );
  
  useEffect(() => {
    loadUserNFTs();
  }, [phase]);
  
  async function loadUserNFTs() {
    const p = await contract.getCurrentPhase();
    setPhase(p);
    
    if (p < 3) return; // Winners not selected yet
    
    // Get user's NFT serials
    const serials = await getUserNFTSerials(userAddress);
    
    // Check winner status for each
    const nftsWithStatus = await Promise.all(
      serials.map(async (serial) => {
        const isWinner = await contract.isWinner(serial);
        const isClaimed = isWinner 
          ? await contract.isPrizeClaimed(serial)
          : false;
        
        return {
          serial,
          isWinner,
          isClaimed,
          canClaim: isWinner && !isClaimed
        };
      })
    );
    
    setUserNFTs(nftsWithStatus);
  }
  
  async function handleClaim(serialNumber) {
    setClaiming(serialNumber);
    
    try {
      const result = await claimPrize(signer, contractAddress, serialNumber);
      
      if (result.success) {
        alert(`Prize claimed! Received ${result.prizeValue} HBAR`);
        loadUserNFTs(); // Refresh
      } else {
        alert(`Claim failed: ${result.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setClaiming(null);
    }
  }
  
  if (phase < 3) {
    return <div>Winners will be announced after minting completes</div>;
  }
  
  const winners = userNFTs.filter(nft => nft.isWinner);
  
  if (winners.length === 0) {
    return <div>You don't own any winning NFTs</div>;
  }
  
  return (
    <div className="prize-claiming">
      <h2>🏆 Your Winning NFTs</h2>
      
      <div className="winner-grid">
        {winners.map(nft => (
          <div key={nft.serial} className="winner-card">
            <div className="nft-image">
              <img src={`ipfs://.../${nft.serial}`} alt={`NFT #${nft.serial}`} />
            </div>
            <div className="nft-serial">#{nft.serial}</div>
            {nft.isClaimed ? (
              <div className="claimed-badge">✓ Prize Claimed</div>
            ) : (
              <button 
                onClick={() => handleClaim(nft.serial)}
                disabled={claiming === nft.serial}
                className="claim-button"
              >
                {claiming === nft.serial ? "Claiming..." : "Claim Prize"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Production Checklist

Before deploying to production:

- [ ] Test all payment methods on testnet
- [ ] Verify token associations for all payment tokens
- [ ] Test whitelist purchase flows
- [ ] Test winner selection with varying counts
- [ ] Test prize claiming flow
- [ ] Verify gas limits are sufficient
- [ ] Implement proper error handling for all operations
- [ ] Add loading states for all async operations
- [ ] Test event listeners for real-time updates
- [ ] Verify network detection works correctly
- [ ] Test with multiple wallets (HashPack, Blade, MetaMask)
- [ ] Add analytics tracking for key events
- [ ] Implement transaction status checking
- [ ] Add proper logging for debugging
- [ ] Test phase transitions
- [ ] Verify bearer asset model (winner NFT trading)

---

## Support & Resources

- **Contract Source**: `contracts/EditionWithPrize.sol`
- **Test Suite**: `test/EditionWithPrize.test.js`
- **Interaction Scripts**: `scripts/interactions/EditionWithPrize/`
- **Part 1 Guide**: `docs/EditionWithPrize-UX-IMPLEMENTATION-PART1.md`

---

**Document Version:** 1.0  
**Last Updated:** October 26, 2025  
**Maintained By:** Burstall Development Team
