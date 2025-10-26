# ForeverMinter - UX Implementation Guide (Part 2: Transaction Flows & Integration)

**Version:** 1.0.5  
**Last Updated:** October 26, 2025  
**Contract:** ForeverMinter.sol v1.0.5  

---

## Table of Contents

1. [Minting Workflows](#minting-workflows)
2. [Whitelist Purchase Methods](#whitelist-purchase-methods)
3. [Refund System Flow](#refund-system-flow)
4. [Cost Calculation Deep Dive](#cost-calculation-deep-dive)
5. [Admin Operations](#admin-operations)
6. [Event Handling](#event-handling)
7. [Gas Optimization](#gas-optimization)
8. [Complete Code Examples](#complete-code-examples)

---

## Minting Workflows

### Overview

ForeverMinter supports multiple minting workflows based on payment method and discount type:

1. **Simple Mint** - Pay full price (HBAR and/or LAZY)
2. **Whitelist Mint** - Use WL discount
3. **Holder Discount Mint** - Use owned NFTs for discounts
4. **Stacked Discount Mint** - Combine WL + Holder discounts
5. **Sacrifice Mint** - Burn existing NFTs for bigger discount

### Pre-Mint Validation Checklist

Before allowing users to mint, verify:

```javascript
async function canUserMint(userAddress, quantity) {
  // 1. Check pool supply
  const available = await contract.getRemainingSupply();
  if (available === 0) {
    return { canMint: false, reason: "Sold out" };
  }
  if (quantity > available) {
    return { canMint: false, reason: `Only ${available} available` };
  }
  
  // 2. Check timing
  const timing = await contract.getTiming();
  const now = Math.floor(Date.now() / 1000);
  
  if (timing.paused) {
    return { canMint: false, reason: "Minting is paused" };
  }
  
  if (now < timing.mintStart) {
    const countdown = timing.mintStart - now;
    return { 
      canMint: false, 
      reason: `Starts in ${formatDuration(countdown)}` 
    };
  }
  
  // 3. Check whitelist (if WL-only mode)
  if (timing.wlOnly) {
    const wlSlots = await contract.whitelistSlots(userAddress);
    if (wlSlots === 0) {
      return { 
        canMint: false, 
        reason: "Whitelist required",
        action: "buy_wl"
      };
    }
    if (quantity > wlSlots) {
      return {
        canMint: false,
        reason: `You only have ${wlSlots} WL mints`
      };
    }
  }
  
  // 4. Check wallet limit
  const economics = await contract.getEconomics();
  if (economics.maxMintPerWallet > 0) {
    const minted = await contract.getWalletMintCount(userAddress);
    const remaining = economics.maxMintPerWallet - minted;
    
    if (remaining === 0) {
      return { canMint: false, reason: "Mint limit reached" };
    }
    if (quantity > remaining) {
      return { 
        canMint: false, 
        reason: `Can only mint ${remaining} more` 
      };
    }
  }
  
  // 5. Check NFT token association
  const nftToken = await contract.NFT_TOKEN();
  const isAssociated = await checkTokenAssociation(userAddress, nftToken);
  if (!isAssociated) {
    return {
      canMint: false,
      reason: "NFT token not associated",
      action: "associate",
      tokenId: nftToken
    };
  }
  
  return { canMint: true };
}
```

### Workflow 1: Simple Mint (HBAR Only)

**Use Case:** Pay full price with HBAR, no discounts.

```javascript
async function mintWithHBAR(signer, contractAddress, quantity) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ForeverMinterABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Validate user can mint
    const validation = await canUserMint(userAddress, quantity);
    if (!validation.canMint) {
      throw new Error(validation.reason);
    }
    
    // 2. Calculate cost
    const [hbarCost, lazyCost, discount, holderSlots, wlSlots] = 
      await contract.calculateMintCost(
        userAddress,
        quantity,
        [],  // no discount tokens
        [],  // no discount serials
        0    // no sacrifice
      );
    
    console.log(`Minting ${quantity} NFTs for ${formatHbar(hbarCost)}`);
    console.log(`Discount applied: ${discount}%`);
    console.log(`Will consume ${wlSlots} WL slots`);
    
    // 3. Check if LAZY payment required
    if (lazyCost > 0) {
      const economics = await contract.getEconomics();
      if (!economics.lazyFromContract) {
        throw new Error("LAZY payment required. Use mintWithLazy() instead.");
      }
    }
    
    // 4. Submit mint transaction
    const tx = await contract.mintNFT(
      quantity,
      [],    // discountTokens
      [],    // serialsByToken
      [],    // sacrificeSerials
      {
        value: hbarCost,
        gasLimit: 800000 + (quantity * 50000)  // Dynamic gas
      }
    );
    
    console.log("Transaction submitted:", tx.hash);
    
    // 5. Wait for confirmation
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt.transactionHash);
    
    // 6. Extract minted serials from events
    const mintEvents = receipt.events?.filter(e => e.event === "NFTMinted");
    const serialsMinted = mintEvents?.map(e => e.args.serial.toString());
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      serials: serialsMinted,
      hbarPaid: formatHbar(hbarCost),
      discountApplied: discount
    };
    
  } catch (error) {
    console.error("Mint with HBAR failed:", error);
    return handleMintError(error);
  }
}
```

**UI Flow:**
1. User enters quantity
2. Show preview: "5 NFTs for 5,000 HBAR"
3. User clicks "Mint"
4. Show loading: "Preparing transaction..."
5. Wallet prompts for approval
6. Show pending: "Minting in progress..."
7. On success: "Minted! You received NFTs: #12, #45, #88, #90, #101"
8. Refresh pool count and user balance

### Workflow 2: Mint with LAZY

**Use Case:** Pay with LAZY tokens (with automatic burn).

```javascript
async function mintWithLAZY(signer, contractAddress, quantity) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ForeverMinterABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Validate user can mint
    const validation = await canUserMint(userAddress, quantity);
    if (!validation.canMint) {
      throw new Error(validation.reason);
    }
    
    // 2. Get LAZY configuration
    const lazyDetails = await contract.getLazyDetails();
    const lazyToken = new ethers.Contract(
      lazyDetails.lazyToken,
      ERC20_ABI,
      signer
    );
    
    // 3. Calculate cost
    const [hbarCost, lazyCost, discount] = 
      await contract.calculateMintCost(userAddress, quantity, [], [], 0);
    
    if (hbarCost > 0) {
      throw new Error("This mint requires HBAR payment too. Use hybrid payment.");
    }
    
    // 4. Check LAZY token association
    const hasLazy = await checkTokenAssociation(userAddress, lazyDetails.lazyToken);
    if (!hasLazy) {
      throw new Error("LAZY token not associated. Please associate first.");
    }
    
    // 5. Check LAZY balance
    const lazyBalance = await lazyToken.balanceOf(userAddress);
    if (BigInt(lazyBalance) < BigInt(lazyCost)) {
      throw new Error(
        `Insufficient LAZY. Need ${formatLazy(lazyCost)}, have ${formatLazy(lazyBalance)}`
      );
    }
    
    // 6. Approve LazyGasStation (NOT ForeverMinter!)
    const currentAllowance = await lazyToken.allowance(
      userAddress,
      lazyDetails.lazyGasStation
    );
    
    if (BigInt(currentAllowance) < BigInt(lazyCost)) {
      console.log("Approving LAZY spending...");
      const approveTx = await lazyToken.approve(
        lazyDetails.lazyGasStation,
        lazyCost,
        { gasLimit: 300000 }
      );
      await approveTx.wait();
      console.log("LAZY approved");
    }
    
    // 7. Calculate burn amount
    const burnPercentage = lazyDetails.lazyBurnPercentage;
    const burnAmount = (BigInt(lazyCost) * BigInt(burnPercentage)) / 10000n;
    const toContract = BigInt(lazyCost) - burnAmount;
    
    console.log(`Paying ${formatLazy(lazyCost)} LAZY`);
    console.log(`  Burned: ${formatLazy(burnAmount)} (${burnPercentage/100}%)`);
    console.log(`  To contract: ${formatLazy(toContract)}`);
    
    // 8. Submit mint transaction
    const tx = await contract.mintNFT(
      quantity,
      [],
      [],
      [],
      {
        gasLimit: 1000000 + (quantity * 50000)
      }
    );
    
    console.log("Transaction submitted:", tx.hash);
    
    const receipt = await tx.wait();
    
    const mintEvents = receipt.events?.filter(e => e.event === "NFTMinted");
    const serialsMinted = mintEvents?.map(e => e.args.serial.toString());
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      serials: serialsMinted,
      lazyPaid: formatLazy(lazyCost),
      lazyBurned: formatLazy(burnAmount),
      discountApplied: discount
    };
    
  } catch (error) {
    console.error("Mint with LAZY failed:", error);
    return handleMintError(error);
  }
}
```

**UI Flow:**
1. User selects "Pay with LAZY"
2. Show cost: "50,000 LAZY (10,000 burned, 40,000 to contract)"
3. Check balance and show warning if insufficient
4. On mint click:
   - Step 1: "Approving LAZY..." (if needed)
   - Step 2: "Minting NFTs..."
5. On success: "Minted! 10,000 LAZY burned"

### Workflow 3: Mint with Holder Discounts

**Use Case:** Use owned discount NFTs to reduce price.

```javascript
async function mintWithHolderDiscounts(
  signer, 
  contractAddress, 
  quantity,
  discountNFTs  // e.g., [{ token: lshGen1, serials: [100, 200] }, { token: lshGen2, serials: [300] }]
) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ForeverMinterABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Validate user can mint
    const validation = await canUserMint(userAddress, quantity);
    if (!validation.canMint) {
      throw new Error(validation.reason);
    }
    
    // 2. Verify ownership of discount NFTs
    for (const nft of discountNFTs) {
      for (const serial of nft.serials) {
        const owned = await verifyOwnership(userAddress, nft.token, serial);
        if (!owned) {
          throw new Error(`You don't own ${nft.token}#${serial}`);
        }
      }
    }
    
    // 3. Check discount capacity
    const tokens = discountNFTs.map(n => n.token);
    const allSerials = discountNFTs.map(n => n.serials).flat();
    
    const discountInfo = await contract.getBatchSerialDiscountInfo(
      tokens.flatMap(t => allSerials.map(() => t)),
      allSerials
    );
    
    // Validate each serial has capacity
    for (let i = 0; i < allSerials.length; i++) {
      const info = discountInfo[i];
      if (!info.isEligible) {
        throw new Error(`Serial ${allSerials[i]} is not eligible for discount`);
      }
      if (info.usesRemaining === 0) {
        throw new Error(`Serial ${allSerials[i]} has no discount uses left`);
      }
    }
    
    // 4. Calculate cost with discounts
    const discountTokens = discountNFTs.map(n => n.token);
    const serialsByToken = discountNFTs.map(n => n.serials);
    
    const [hbarCost, lazyCost, discount, holderSlots, wlSlots] = 
      await contract.calculateMintCost(
        userAddress,
        quantity,
        discountTokens,
        serialsByToken,
        0  // no sacrifice
      );
    
    console.log(`Cost with ${discount}% discount: ${formatHbar(hbarCost)}`);
    console.log(`Will consume ${holderSlots} holder discount uses`);
    console.log(`Will consume ${wlSlots} WL slots`);
    
    // Show detailed breakdown
    const breakdown = calculateDiscountBreakdown(
      quantity,
      discountInfo,
      wlSlots > 0
    );
    console.log("Discount breakdown:", breakdown);
    
    // 5. Handle LAZY if required
    if (lazyCost > 0) {
      const economics = await contract.getEconomics();
      if (!economics.lazyFromContract) {
        // Need to approve LAZY
        const lazyDetails = await contract.getLazyDetails();
        await approveLazy(signer, lazyDetails, lazyCost);
      }
    }
    
    // 6. Submit mint transaction
    const tx = await contract.mintNFT(
      quantity,
      discountTokens,
      serialsByToken,
      [],  // no sacrifice
      {
        value: hbarCost,
        gasLimit: 1000000 + (quantity * 50000)
      }
    );
    
    console.log("Transaction submitted:", tx.hash);
    
    const receipt = await tx.wait();
    
    const mintEvents = receipt.events?.filter(e => e.event === "NFTMinted");
    const serialsMinted = mintEvents?.map(e => e.args.serial.toString());
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      serials: serialsMinted,
      hbarPaid: formatHbar(hbarCost),
      discountApplied: discount,
      holderSlotsUsed: holderSlots,
      wlSlotsUsed: wlSlots,
      breakdown
    };
    
  } catch (error) {
    console.error("Mint with holder discounts failed:", error);
    return handleMintError(error);
  }
}

// Helper: Calculate discount breakdown for UI display
function calculateDiscountBreakdown(quantity, discountInfo, hasWL) {
  const breakdown = [];
  let remaining = quantity;
  let currentIdx = 0;
  
  // Sort by discount % (highest first)
  const sorted = discountInfo
    .map((info, idx) => ({ ...info, idx }))
    .sort((a, b) => b.discountPercentage - a.discountPercentage);
  
  for (const info of sorted) {
    if (remaining === 0) break;
    
    const usable = Math.min(remaining, info.usesRemaining);
    if (usable > 0) {
      const totalDiscount = hasWL 
        ? info.discountPercentage + 10  // Assuming 10% WL
        : info.discountPercentage;
      
      breakdown.push({
        count: usable,
        holderDiscount: info.discountPercentage,
        wlDiscount: hasWL ? 10 : 0,
        totalDiscount: Math.min(totalDiscount, 100),
        serial: discountInfo[info.idx].serial
      });
      
      remaining -= usable;
    }
  }
  
  // Remaining at base price (or WL only)
  if (remaining > 0) {
    breakdown.push({
      count: remaining,
      holderDiscount: 0,
      wlDiscount: hasWL ? 10 : 0,
      totalDiscount: hasWL ? 10 : 0,
      serial: null
    });
  }
  
  return breakdown;
}
```

**UI Display Example:**

```
Minting 10 NFTs with discounts:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  5 NFTs: 35% off (25% holder + 10% WL)
         Using Gen1 #100
  3 NFTs: 20% off (10% holder + 10% WL)
         Using Gen2 #300
  2 NFTs: 10% off (WL only)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Cost: 7,500 HBAR (was 10,000 HBAR)
You Save: 2,500 HBAR

[Confirm Mint]
```

### Workflow 4: Sacrifice Mint

**Use Case:** Burn existing NFTs for bigger discount.

```javascript
async function mintWithSacrifice(
  signer,
  contractAddress,
  quantity,
  sacrificeSerials  // e.g., [11, 22, 33, 44, 55]
) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ForeverMinterABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Validate basic minting rules
    const validation = await canUserMint(userAddress, quantity);
    if (!validation.canMint) {
      throw new Error(validation.reason);
    }
    
    // 2. Validate sacrifice count matches mint count
    if (sacrificeSerials.length !== quantity) {
      throw new Error(
        `Must sacrifice exactly ${quantity} NFTs (you provided ${sacrificeSerials.length})`
      );
    }
    
    // 3. Check max sacrifice limit
    const economics = await contract.getEconomics();
    if (sacrificeSerials.length > economics.maxSacrifice) {
      throw new Error(`Max ${economics.maxSacrifice} NFTs can be sacrificed per transaction`);
    }
    
    // 4. Verify ownership of all sacrifice NFTs
    const nftToken = await contract.NFT_TOKEN();
    
    for (const serial of sacrificeSerials) {
      const owned = await verifyOwnership(userAddress, nftToken, serial);
      if (!owned) {
        throw new Error(`You don't own NFT #${serial}`);
      }
    }
    
    // 5. Check NFT approval
    const nftContract = new ethers.Contract(nftToken, ERC721_ABI, signer);
    const isApproved = await nftContract.isApprovedForAll(
      userAddress,
      contractAddress
    );
    
    if (!isApproved) {
      console.log("Approving ForeverMinter to transfer NFTs...");
      const approveTx = await nftContract.setApprovalForAll(
        contractAddress,
        true,
        { gasLimit: 300000 }
      );
      await approveTx.wait();
      console.log("Approval granted");
    }
    
    // 6. Calculate cost with sacrifice discount
    const [hbarCost, lazyCost, discount] = 
      await contract.calculateMintCost(
        userAddress,
        quantity,
        [],  // no holder discounts with sacrifice
        [],
        sacrificeSerials.length  // sacrifice count
      );
    
    console.log(`Sacrificing ${sacrificeSerials.length} NFTs for ${discount}% discount`);
    console.log(`Cost: ${formatHbar(hbarCost)} HBAR`);
    
    // 7. Get sacrifice destination
    const destination = await contract.sacrificeDestination();
    const willReturnToPool = destination.toLowerCase() === contractAddress.toLowerCase();
    
    console.log(
      willReturnToPool 
        ? "Sacrificed NFTs will return to pool (you might get them back!)"
        : `Sacrificed NFTs will be sent to ${destination}`
    );
    
    // 8. Handle LAZY if required
    if (lazyCost > 0) {
      const lazyConfig = await contract.getEconomics();
      if (!lazyConfig.lazyFromContract) {
        const lazyDetails = await contract.getLazyDetails();
        await approveLazy(signer, lazyDetails, lazyCost);
      }
    }
    
    // 9. Submit sacrifice mint transaction
    const tx = await contract.mintNFT(
      quantity,
      [],  // no discount tokens
      [],  // no discount serials
      sacrificeSerials,
      {
        value: hbarCost,
        gasLimit: 1200000 + (quantity * 50000)  // Higher gas for sacrifice
      }
    );
    
    console.log("Transaction submitted:", tx.hash);
    
    const receipt = await tx.wait();
    
    const mintEvents = receipt.events?.filter(e => e.event === "NFTMinted");
    const newSerials = mintEvents?.map(e => e.args.serial.toString());
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      sacrificedSerials: sacrificeSerials,
      newSerials: newSerials,
      hbarPaid: formatHbar(hbarCost),
      discountApplied: discount,
      sacrificeDestination: destination
    };
    
  } catch (error) {
    console.error("Sacrifice mint failed:", error);
    return handleMintError(error);
  }
}
```

**UI Flow:**

```
┌─────────────────────────────────────────┐
│ Sacrifice Mint: Re-roll Your NFTs      │
├─────────────────────────────────────────┤
│                                         │
│ Select NFTs to sacrifice:               │
│ ☑ #11  ☑ #22  ☑ #33  ☑ #44  ☑ #55     │
│                                         │
│ You will receive: 5 random new NFTs    │
│                                         │
│ Sacrifice Discount: 50% off            │
│ Cost: 2,500 HBAR (was 5,000 HBAR)      │
│                                         │
│ ⚠️ Your sacrificed NFTs will be sent    │
│    to: 0xdead... (burn address)        │
│                                         │
│ [Cancel]              [Confirm Sacrifice]│
└─────────────────────────────────────────┘
```

---

## Whitelist Purchase Methods

### Method 1: Buy WL with LAZY

Users can purchase whitelist access by burning LAZY tokens.

```javascript
async function buyWhitelistWithLazy(signer, contractAddress, quantity = 1) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ForeverMinterABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Check current WL status
    const currentSlots = await contract.whitelistSlots(userAddress);
    console.log(`Current WL slots: ${currentSlots}`);
    
    // 2. Get WL purchase cost
    const economics = await contract.getEconomics();
    const costPerGroup = economics.buyWlWithLazy;
    
    if (costPerGroup === 0) {
      throw new Error("WL purchase with LAZY is not enabled");
    }
    
    const totalCost = BigInt(costPerGroup) * BigInt(quantity);
    console.log(`Cost: ${formatLazy(totalCost)} LAZY for ${quantity} WL groups`);
    
    // 3. Get LAZY configuration
    const lazyDetails = await contract.getLazyDetails();
    const lazyToken = new ethers.Contract(
      lazyDetails.lazyToken,
      ERC20_ABI,
      signer
    );
    
    // 4. Check LAZY balance
    const balance = await lazyToken.balanceOf(userAddress);
    if (BigInt(balance) < totalCost) {
      throw new Error(
        `Insufficient LAZY. Need ${formatLazy(totalCost)}, have ${formatLazy(balance)}`
      );
    }
    
    // 5. Approve LazyGasStation
    const allowance = await lazyToken.allowance(
      userAddress,
      lazyDetails.lazyGasStation
    );
    
    if (BigInt(allowance) < totalCost) {
      console.log("Approving LAZY for WL purchase...");
      const approveTx = await lazyToken.approve(
        lazyDetails.lazyGasStation,
        totalCost,
        { gasLimit: 300000 }
      );
      await approveTx.wait();
      console.log("LAZY approved");
    }
    
    // 6. Purchase whitelist
    const tx = await contract.buyWhitelistWithLazy(
      quantity,
      { gasLimit: 600000 }
    );
    
    console.log("WL purchase submitted:", tx.hash);
    
    const receipt = await tx.wait();
    
    // 7. Check new WL slot count
    const newSlots = await contract.whitelistSlots(userAddress);
    const slotsAdded = newSlots - currentSlots;
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      lazyBurned: formatLazy(totalCost),
      slotsAdded: slotsAdded,
      totalSlots: newSlots
    };
    
  } catch (error) {
    console.error("WL purchase failed:", error);
    return {
      success: false,
      error: error.message || "Purchase failed"
    };
  }
}
```

**UI Implementation:**

```javascript
function WhitelistPurchaseCard({ contractAddress, userAddress }) {
  const [quantity, setQuantity] = useState(1);
  const [purchasing, setPurchasing] = useState(false);
  const [economics, setEconomics] = useState(null);
  const [wlSlots, setWlSlots] = useState(0);
  
  useEffect(() => {
    loadWLStatus();
  }, []);
  
  async function loadWLStatus() {
    const econ = await contract.getEconomics();
    const slots = await contract.whitelistSlots(userAddress);
    setEconomics(econ);
    setWlSlots(slots);
  }
  
  async function handlePurchase() {
    setPurchasing(true);
    
    try {
      const result = await buyWhitelistWithLazy(
        signer,
        contractAddress,
        quantity
      );
      
      if (result.success) {
        alert(`Success! Added ${result.slotsAdded} WL slots. ${result.lazyBurned} LAZY burned.`);
        await loadWLStatus();
      } else {
        alert(`Purchase failed: ${result.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setPurchasing(false);
    }
  }
  
  if (!economics || economics.buyWlWithLazy === 0) {
    return <div>WL purchase not available</div>;
  }
  
  const costPerGroup = formatLazy(economics.buyWlWithLazy);
  const totalCost = formatLazy(
    BigInt(economics.buyWlWithLazy) * BigInt(quantity)
  );
  
  return (
    <div className="wl-purchase-card">
      <h3>Purchase Whitelist Access</h3>
      
      <div className="current-status">
        You have: <strong>{wlSlots} WL mints</strong>
      </div>
      
      <div className="purchase-options">
        <label>
          Quantity:
          <input
            type="number"
            min="1"
            max="10"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        
        <div className="cost-display">
          Cost: {totalCost} LAZY
          <br />
          ({costPerGroup} LAZY per group)
        </div>
      </div>
      
      <button
        onClick={handlePurchase}
        disabled={purchasing}
        className="purchase-button"
      >
        {purchasing ? "Purchasing..." : "Buy Whitelist"}
      </button>
      
      <div className="info">
        💡 LAZY will be burned (removed from supply)
      </div>
    </div>
  );
}
```

---

## Refund System Flow

### Refund Eligibility

Users can refund NFTs within a time window (e.g., 60 minutes) after minting.

```javascript
async function checkRefundEligibility(contractAddress, serialNumber) {
  const contract = new ethers.Contract(
    contractAddress,
    ForeverMinterABI,
    provider
  );
  
  // 1. Get mint time
  const mintTime = await contract.getSerialMintTime(serialNumber);
  
  if (mintTime === 0) {
    return {
      eligible: false,
      reason: "Serial not minted via this contract"
    };
  }
  
  // 2. Get refund window
  const timing = await contract.getTiming();
  const refundDeadline = mintTime + timing.refundWindow;
  const now = Math.floor(Date.now() / 1000);
  
  if (now > refundDeadline) {
    return {
      eligible: false,
      reason: "Refund window expired",
      expiredAt: new Date(refundDeadline * 1000)
    };
  }
  
  // 3. Get payment details
  const payment = await contract.getSerialPayment(serialNumber);
  
  // 4. Calculate refund amount
  const refundHbar = (BigInt(payment.hbarPaid) * BigInt(timing.refundPercentage)) / 10000n;
  const refundLazy = (BigInt(payment.lazyPaid) * BigInt(timing.refundPercentage)) / 10000n;
  
  const timeRemaining = refundDeadline - now;
  
  return {
    eligible: true,
    timeRemaining,
    deadline: new Date(refundDeadline * 1000),
    refund: {
      hbar: refundHbar,
      lazy: refundLazy,
      percentage: timing.refundPercentage / 100
    },
    originalPayment: {
      hbar: payment.hbarPaid,
      lazy: payment.lazyPaid
    }
  };
}
```

### Executing Refund

```javascript
async function refundNFTs(signer, contractAddress, serialNumbers) {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ForeverMinterABI,
      signer
    );
    
    const userAddress = await signer.getAddress();
    
    // 1. Verify ownership of all serials
    const nftToken = await contract.NFT_TOKEN();
    
    for (const serial of serialNumbers) {
      const owned = await verifyOwnership(userAddress, nftToken, serial);
      if (!owned) {
        throw new Error(`You don't own NFT #${serial}`);
      }
    }
    
    // 2. Check eligibility and calculate total refund
    let totalRefundHbar = 0n;
    let totalRefundLazy = 0n;
    const eligibilityResults = [];
    
    for (const serial of serialNumbers) {
      const eligibility = await checkRefundEligibility(contractAddress, serial);
      
      if (!eligibility.eligible) {
        throw new Error(`NFT #${serial} not eligible: ${eligibility.reason}`);
      }
      
      totalRefundHbar += BigInt(eligibility.refund.hbar);
      totalRefundLazy += BigInt(eligibility.refund.lazy);
      eligibilityResults.push(eligibility);
    }
    
    console.log(`Refunding ${serialNumbers.length} NFTs`);
    console.log(`  HBAR refund: ${formatHbar(totalRefundHbar)}`);
    console.log(`  LAZY refund: ${formatLazy(totalRefundLazy)}`);
    
    // 3. Approve contract to take NFTs back
    const nftContract = new ethers.Contract(nftToken, ERC721_ABI, signer);
    const isApproved = await nftContract.isApprovedForAll(
      userAddress,
      contractAddress
    );
    
    if (!isApproved) {
      console.log("Approving contract to receive NFTs...");
      const approveTx = await nftContract.setApprovalForAll(
        contractAddress,
        true,
        { gasLimit: 300000 }
      );
      await approveTx.wait();
      console.log("Approval granted");
    }
    
    // 4. Submit refund transaction
    const tx = await contract.refundNFT(
      serialNumbers,
      {
        gasLimit: 800000 + (serialNumbers.length * 200000)
      }
    );
    
    console.log("Refund submitted:", tx.hash);
    
    const receipt = await tx.wait();
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      refunded: {
        serials: serialNumbers,
        hbar: formatHbar(totalRefundHbar),
        lazy: formatLazy(totalRefundLazy)
      }
    };
    
  } catch (error) {
    console.error("Refund failed:", error);
    return {
      success: false,
      error: error.message || "Refund failed"
    };
  }
}
```

### UI Implementation

```javascript
function RefundInterface({ contractAddress, userNFTs }) {
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [eligibility, setEligibility] = useState({});
  const [refunding, setRefunding] = useState(false);
  
  useEffect(() => {
    checkAllEligibility();
  }, [userNFTs]);
  
  async function checkAllEligibility() {
    const results = {};
    
    for (const serial of userNFTs) {
      const eligibility = await checkRefundEligibility(
        contractAddress,
        serial
      );
      results[serial] = eligibility;
    }
    
    setEligibility(results);
  }
  
  function toggleSerial(serial) {
    setSelectedSerials(prev =>
      prev.includes(serial)
        ? prev.filter(s => s !== serial)
        : [...prev, serial]
    );
  }
  
  async function handleRefund() {
    setRefunding(true);
    
    try {
      const result = await refundNFTs(
        signer,
        contractAddress,
        selectedSerials
      );
      
      if (result.success) {
        alert(`Refunded ${selectedSerials.length} NFTs!\nReceived: ${result.refunded.hbar} HBAR`);
        setSelectedSerials([]);
        await checkAllEligibility();
      } else {
        alert(`Refund failed: ${result.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setRefunding(false);
    }
  }
  
  const eligibleNFTs = userNFTs.filter(
    serial => eligibility[serial]?.eligible
  );
  
  const totalRefund = selectedSerials.reduce((sum, serial) => {
    const e = eligibility[serial];
    return sum + (e?.refund?.hbar || 0n);
  }, 0n);
  
  return (
    <div className="refund-interface">
      <h2>Refund Your NFTs</h2>
      
      {eligibleNFTs.length === 0 ? (
        <div className="no-eligible">
          No NFTs eligible for refund
        </div>
      ) : (
        <>
          <div className="nft-grid">
            {eligibleNFTs.map(serial => {
              const e = eligibility[serial];
              const selected = selectedSerials.includes(serial);
              
              return (
                <div
                  key={serial}
                  className={`nft-card ${selected ? 'selected' : ''}`}
                  onClick={() => toggleSerial(serial)}
                >
                  <div className="nft-image">
                    <img src={`ipfs://.../${serial}`} alt={`NFT #${serial}`} />
                  </div>
                  
                  <div className="nft-info">
                    <div className="serial">#{serial}</div>
                    
                    <div className="refund-amount">
                      Refund: {formatHbar(e.refund.hbar)} HBAR
                    </div>
                    
                    <div className="time-remaining">
                      {formatTimeRemaining(e.timeRemaining)}
                    </div>
                  </div>
                  
                  {selected && <div className="selected-badge">✓</div>}
                </div>
              );
            })}
          </div>
          
          {selectedSerials.length > 0 && (
            <div className="refund-summary">
              <div className="summary-row">
                Selected: {selectedSerials.length} NFTs
              </div>
              <div className="summary-row total">
                Total Refund: {formatHbar(totalRefund)} HBAR
              </div>
              
              <button
                onClick={handleRefund}
                disabled={refunding}
                className="refund-button"
              >
                {refunding ? "Processing..." : "Refund Selected NFTs"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

---

## Cost Calculation Deep Dive

### Understanding v1.0.5 Changes

In v1.0.5, `calculateMintCost()` was enhanced to return slot consumption details:

```javascript
// v1.0.4 (old)
const [hbarCost, lazyCost, discount] = await contract.calculateMintCost(...);

// v1.0.5 (new)
const [hbarCost, lazyCost, discount, holderSlots, wlSlots] = 
  await contract.calculateMintCost(...);
```

### Detailed Cost Calculation Example

```javascript
async function calculateDetailedCost(
  userAddress,
  quantity,
  discountNFTs,
  sacrifice
) {
  const contract = new ethers.Contract(
    contractAddress,
    ForeverMinterABI,
    provider
  );
  
  // 1. Get base economics
  const economics = await contract.getEconomics();
  const baseHbar = economics.mintPriceHbar;
  const baseLazy = economics.mintPriceLazy;
  
  // 2. Prepare discount parameters
  const discountTokens = discountNFTs.map(n => n.token);
  const serialsByToken = discountNFTs.map(n => n.serials);
  const sacrificeCount = sacrifice.length;
  
  // 3. Calculate actual cost
  const [hbarCost, lazyCost, avgDiscount, holderSlots, wlSlots] = 
    await contract.calculateMintCost(
      userAddress,
      quantity,
      discountTokens,
      serialsByToken,
      sacrificeCount
    );
  
  // 4. Calculate savings
  const baseHbarTotal = BigInt(baseHbar) * BigInt(quantity);
  const baseLazyTotal = BigInt(baseLazy) * BigInt(quantity);
  const hbarSavings = baseHbarTotal - BigInt(hbarCost);
  const lazySavings = baseLazyTotal - BigInt(lazyCost);
  
  // 5. Get LAZY burn info
  const lazyDetails = await contract.getLazyDetails();
  const burnPerc = lazyDetails.lazyBurnPercentage;
  const lazyBurned = (BigInt(lazyCost) * BigInt(burnPerc)) / 10000n;
  const lazyToContract = BigInt(lazyCost) - lazyBurned;
  
  return {
    base: {
      hbarPerNFT: formatHbar(baseHbar),
      lazyPerNFT: formatLazy(baseLazy),
      hbarTotal: formatHbar(baseHbarTotal),
      lazyTotal: formatLazy(baseLazyTotal)
    },
    actual: {
      hbar: formatHbar(hbarCost),
      lazy: formatLazy(lazyCost),
      discount: avgDiscount
    },
    savings: {
      hbar: formatHbar(hbarSavings),
      lazy: formatLazy(lazySavings),
      percentage: avgDiscount
    },
    lazy: {
      burned: formatLazy(lazyBurned),
      toContract: formatLazy(lazyToContract),
      burnPercentage: burnPerc / 100
    },
    slots: {
      holderUsed: holderSlots,
      wlUsed: wlSlots
    }
  };
}
```

### UI Cost Preview Component

```javascript
function CostPreview({ 
  quantity, 
  discountNFTs, 
  sacrifice, 
  userAddress 
}) {
  const [cost, setCost] = useState(null);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    calculateCost();
  }, [quantity, discountNFTs, sacrifice]);
  
  async function calculateCost() {
    setLoading(true);
    try {
      const result = await calculateDetailedCost(
        userAddress,
        quantity,
        discountNFTs,
        sacrifice
      );
      setCost(result);
    } catch (err) {
      console.error("Cost calculation failed:", err);
    } finally {
      setLoading(false);
    }
  }
  
  if (loading || !cost) {
    return <div>Calculating cost...</div>;
  }
  
  return (
    <div className="cost-preview">
      <h3>Cost Breakdown</h3>
      
      <div className="cost-section">
        <div className="label">Base Price:</div>
        <div className="value">
          {cost.base.hbarPerNFT} HBAR × {quantity}
          {cost.base.lazyPerNFT !== "0" && (
            <> + {cost.base.lazyPerNFT} LAZY × {quantity}</>
          )}
        </div>
      </div>
      
      {cost.actual.discount > 0 && (
        <div className="cost-section discount">
          <div className="label">Discount Applied:</div>
          <div className="value">{cost.actual.discount}% off</div>
        </div>
      )}
      
      <div className="cost-section total">
        <div className="label">Your Cost:</div>
        <div className="value">
          {cost.actual.hbar} HBAR
          {cost.actual.lazy !== "0" && (
            <> + {cost.actual.lazy} LAZY</>
          )}
        </div>
      </div>
      
      {cost.actual.discount > 0 && (
        <div className="cost-section savings">
          <div className="label">You Save:</div>
          <div className="value">
            {cost.savings.hbar} HBAR
            {cost.savings.lazy !== "0" && (
              <> + {cost.savings.lazy} LAZY</>
            )}
          </div>
        </div>
      )}
      
      {cost.lazy.burned !== "0" && (
        <div className="cost-section lazy-burn">
          <div className="label">LAZY Breakdown:</div>
          <div className="value">
            🔥 {cost.lazy.burned} burned ({cost.lazy.burnPercentage}%)
            <br />
            📦 {cost.lazy.toContract} to contract
          </div>
        </div>
      )}
      
      {(cost.slots.holderUsed > 0 || cost.slots.wlUsed > 0) && (
        <div className="cost-section slots">
          <div className="label">Slot Usage:</div>
          <div className="value">
            {cost.slots.holderUsed > 0 && (
              <div>{cost.slots.holderUsed} holder discount uses</div>
            )}
            {cost.slots.wlUsed > 0 && (
              <div>{cost.slots.wlUsed} whitelist slots</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Admin Operations

### Initialize Pool

```javascript
async function registerNFTsToPool(adminSigner, contractAddress, serials) {
  const contract = new ethers.Contract(
    contractAddress,
    ForeverMinterABI,
    adminSigner
  );
  
  // Note: NFTs must already be in contract custody
  const tx = await contract.registerNFTs(
    serials,
    { gasLimit: 300000 + (serials.length * 50000) }
  );
  
  await tx.wait();
  
  console.log(`Registered ${serials.length} NFTs to pool`);
}
```

### Configure Economics

```javascript
async function updateEconomics(adminSigner, contractAddress, config) {
  const contract = new ethers.Contract(
    contractAddress,
    ForeverMinterABI,
    adminSigner
  );
  
  const tx = await contract.updateEconomics(
    config.mintPriceHbar,              // e.g., parseUnits("1000", 8)
    config.mintPriceLazy,              // e.g., parseUnits("50000", 8)
    config.wlDiscountPercentage,       // e.g., 10
    config.sacrificeDiscountPercentage,// e.g., 50
    config.maxMint,                    // e.g., 50
    config.maxMintPerWallet,           // e.g., 0 (unlimited)
    config.buyWlWithLazy,              // e.g., parseUnits("50000", 8)
    config.maxWlAddressMint,           // e.g., 20
    config.maxSacrifice,               // e.g., 20
    config.lazyFromContract,           // e.g., false
    { gasLimit: 500000 }
  );
  
  await tx.wait();
  console.log("Economics updated");
}
```

### Add Discount Tiers

```javascript
async function addDiscountTier(
  adminSigner,
  contractAddress,
  tokenAddress,
  discountPerc,
  maxUses
) {
  const contract = new ethers.Contract(
    contractAddress,
    ForeverMinterABI,
    adminSigner
  );
  
  const tx = await contract.addDiscountTier(
    tokenAddress,     // e.g., LSH Gen1 token address
    discountPerc,     // e.g., 25 (25%)
    maxUses,          // e.g., 8 (8 uses per serial)
    { gasLimit: 400000 }
  );
  
  await tx.wait();
  console.log(`Added discount tier: ${discountPerc}%, ${maxUses} uses`);
}
```

### Manage Whitelist

```javascript
async function batchAddWhitelist(
  adminSigner,
  contractAddress,
  addresses,
  slotCounts
) {
  const contract = new ethers.Contract(
    contractAddress,
    ForeverMinterABI,
    adminSigner
  );
  
  const tx = await contract.batchAddToWhitelist(
    addresses,
    slotCounts,
    { gasLimit: 300000 + (addresses.length * 100000) }
  );
  
  await tx.wait();
  console.log(`Added ${addresses.length} addresses to whitelist`);
}
```

---

## Event Handling

### Event Listeners

```javascript
function setupForeverMinterEvents(contract, callbacks) {
  // NFT Minted
  contract.on("NFTMinted", (
    minter,
    serial,
    hbarPaid,
    lazyPaid,
    timestamp
  ) => {
    console.log(`NFT #${serial} minted by ${minter}`);
    callbacks.onMinted?.({
      minter,
      serial: serial.toString(),
      hbarPaid: hbarPaid.toString(),
      lazyPaid: lazyPaid.toString(),
      timestamp: timestamp.toNumber()
    });
  });
  
  // NFT Refunded
  contract.on("NFTRefunded", (
    user,
    serial,
    hbarRefunded,
    lazyRefunded
  ) => {
    console.log(`NFT #${serial} refunded`);
    callbacks.onRefunded?.({
      user,
      serial: serial.toString(),
      hbarRefunded: hbarRefunded.toString(),
      lazyRefunded: lazyRefunded.toString()
    });
  });
  
  // NFTs Added to Pool
  contract.on("NFTsAddedToPool", (
    addedBy,
    serials,
    newPoolSize
  ) => {
    console.log(`${serials.length} NFTs added to pool`);
    callbacks.onPoolChanged?.({
      action: "added",
      serials: serials.map(s => s.toString()),
      newSize: newPoolSize.toNumber()
    });
  });
  
  // NFTs Removed from Pool
  contract.on("NFTsRemovedFromPool", (serials, newPoolSize) => {
    console.log(`${serials.length} NFTs removed from pool`);
    callbacks.onPoolChanged?.({
      action: "removed",
      serials: serials.map(s => s.toString()),
      newSize: newPoolSize.toNumber()
    });
  });
  
  // Whitelist Updated
  contract.on("WhitelistUpdated", (account, added) => {
    console.log(`Whitelist: ${account} ${added ? 'added' : 'removed'}`);
    callbacks.onWhitelistChanged?.({ account, added });
  });
}

// Usage
setupForeverMinterEvents(contract, {
  onMinted: (data) => {
    updatePoolCount();
    showNotification(`NFT #${data.serial} minted!`);
  },
  onRefunded: (data) => {
    updatePoolCount();
    showNotification(`NFT #${data.serial} refunded`);
  },
  onPoolChanged: (data) => {
    refreshPoolDisplay(data.newSize);
  },
  onWhitelistChanged: (data) => {
    if (data.account === currentUser) {
      refreshWhitelistStatus();
    }
  }
});
```

---

## Gas Optimization

### Recommended Gas Limits

| Operation | Base Gas | Per-Item Gas | Formula | Example |
|-----------|----------|--------------|---------|---------|
| `mintNFT()` HBAR | 800,000 | 50,000/NFT | 800K + (N * 50K) | 1.05M for 5 NFTs |
| `mintNFT()` LAZY | 1,000,000 | 50,000/NFT | 1M + (N * 50K) | 1.25M for 5 NFTs |
| `mintNFT()` with holder discount | 1,000,000 | 50,000/NFT | 1M + (N * 50K) | 1.5M for 10 NFTs |
| `mintNFT()` sacrifice | 1,200,000 | 50,000/NFT | 1.2M + (N * 50K) | 1.45M for 5 NFTs |
| `refundNFT()` | 800,000 | 200,000/NFT | 800K + (N * 200K) | 1.2M for 2 NFTs |
| `buyWhitelistWithLazy()` | 600,000 | - | 600K | 600K |
| `registerNFTs()` | 300,000 | 50,000/NFT | 300K + (N * 50K) | 800K for 10 NFTs |

### Dynamic Gas Calculator

```javascript
function calculateGasLimit(operation, quantity = 1, hasDiscounts = false) {
  const gasLimits = {
    mint_hbar: { base: 800000, perItem: 50000 },
    mint_lazy: { base: 1000000, perItem: 50000 },
    mint_discount: { base: 1000000, perItem: 50000 },
    mint_sacrifice: { base: 1200000, perItem: 50000 },
    refund: { base: 800000, perItem: 200000 },
    buy_wl: { base: 600000, perItem: 0 }
  };
  
  const config = gasLimits[operation];
  if (!config) return 1000000; // Default
  
  const gasLimit = config.base + (quantity * config.perItem);
  
  // Add 10% buffer
  return Math.floor(gasLimit * 1.1);
}

// Usage
const gasLimit = calculateGasLimit('mint_discount', 10);
await contract.mintNFT(...params, { gasLimit });
```

---

## Complete Code Examples

### Full Minting Component

```javascript
import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function ForeverMinterInterface({ contractAddress, userAddress, signer }) {
  const [poolSize, setPoolSize] = useState(0);
  const [economics, setEconomics] = useState(null);
  const [timing, setTiming] = useState(null);
  const [wlSlots, setWlSlots] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("HBAR");
  const [discountNFTs, setDiscountNFTs] = useState([]);
  const [minting, setMinting] = useState(false);
  
  const contract = new ethers.Contract(
    contractAddress,
    ForeverMinterABI,
    signer
  );
  
  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 10000);
    return () => clearInterval(interval);
  }, []);
  
  async function loadState() {
    try {
      const [pool, econ, time, wl] = await Promise.all([
        contract.getRemainingSupply(),
        contract.getEconomics(),
        contract.getTiming(),
        contract.whitelistSlots(userAddress)
      ]);
      
      setPoolSize(pool.toNumber());
      setEconomics(econ);
      setTiming(time);
      setWlSlots(wl.toNumber());
    } catch (err) {
      console.error("Failed to load state:", err);
    }
  }
  
  async function handleMint() {
    setMinting(true);
    
    try {
      let result;
      
      if (discountNFTs.length > 0) {
        result = await mintWithHolderDiscounts(
          signer,
          contractAddress,
          quantity,
          discountNFTs
        );
      } else if (paymentMethod === "HBAR") {
        result = await mintWithHBAR(signer, contractAddress, quantity);
      } else {
        result = await mintWithLAZY(signer, contractAddress, quantity);
      }
      
      if (result.success) {
        alert(`Success! Minted NFTs: ${result.serials.join(', ')}`);
        await loadState();
      } else {
        alert(`Mint failed: ${result.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setMinting(false);
    }
  }
  
  const canMint = poolSize > 0 && 
                  !timing?.paused && 
                  quantity <= poolSize;
  
  return (
    <div className="forever-minter-interface">
      <h2>ForeverMinter: Random NFT Distribution</h2>
      
      <div className="pool-status">
        {poolSize} NFTs Available
        {poolSize === 0 && <span className="sold-out">SOLD OUT</span>}
      </div>
      
      {timing?.paused && (
        <div className="alert">Minting is currently paused</div>
      )}
      
      {wlSlots > 0 && (
        <div className="wl-status">
          ✓ You have {wlSlots} whitelist mints
        </div>
      )}
      
      <div className="quantity-selector">
        <label>
          Quantity:
          <input
            type="number"
            min="1"
            max={Math.min(50, poolSize)}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
      </div>
      
      <PaymentMethodSelector
        economics={economics}
        selected={paymentMethod}
        onSelect={setPaymentMethod}
      />
      
      <DiscountNFTSelector
        userAddress={userAddress}
        selected={discountNFTs}
        onSelect={setDiscountNFTs}
      />
      
      <CostPreview
        quantity={quantity}
        discountNFTs={discountNFTs}
        sacrifice={[]}
        userAddress={userAddress}
      />
      
      <button
        onClick={handleMint}
        disabled={!canMint || minting}
        className="mint-button"
      >
        {minting ? "Minting..." : "Mint Random NFTs"}
      </button>
    </div>
  );
}
```

---

## Production Checklist

Before deploying to production:

- [ ] Test all payment methods (HBAR, LAZY, hybrid)
- [ ] Test all discount types (WL, holder, sacrifice)
- [ ] Test discount stacking (WL + holder)
- [ ] Test refund system within and after window
- [ ] Verify gas limits are sufficient for max quantities
- [ ] Test whitelist purchase with LAZY
- [ ] Verify LAZY approval goes to LazyGasStation
- [ ] Test sacrifice with pool return vs burn address
- [ ] Verify random selection is fair
- [ ] Test pool management (register, add, withdraw)
- [ ] Implement proper error handling
- [ ] Add loading states for all async operations
- [ ] Test event listeners for real-time updates
- [ ] Verify network detection works correctly
- [ ] Test with multiple wallets
- [ ] Add analytics tracking
- [ ] Implement transaction status checking
- [ ] Test edge cases (empty pool, max limits, etc.)
- [ ] Verify v1.0.5 calculateMintCost() returns 5 values

---

## Support & Resources

- **Contract Source**: `contracts/ForeverMinter.sol`
- **Business Logic**: `docs/ForeverMinter-BUSINESS-LOGIC.md`
- **Design Spec**: `docs/ForeverMinter-DESIGN.md`
- **Testing Guide**: `docs/ForeverMinter-TESTING.md`
- **v1.0.5 Migration**: `docs/ForeverMinter-V1.0.5-MIGRATION.md`
- **Part 1 Guide**: `docs/ForeverMinter-UX-IMPLEMENTATION-PART1.md`
- **Interaction Scripts**: `scripts/interactions/ForeverMinter/`

---

**Document Version:** 1.0.5  
**Last Updated:** October 26, 2025  
**Maintained By:** Burstall Development Team
