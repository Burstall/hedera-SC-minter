# EditionWithPrize - Business Logic Documentation

## Overview

The **EditionWithPrize** contract enables artists to mint limited edition NFTs (e.g., 5, 10, 50 copies of the same artwork) with an integrated prize mechanism. One randomly selected edition holder wins the opportunity to exchange their edition for a unique 1-of-1 NFT prize.

## Core Concept

### The Artist's Journey
1. **Setup Phase**: Artist creates two tokens:
   - **Edition Token**: Limited supply (e.g., 50 copies) with identical metadata
   - **Prize Token**: One or more unique 1-of-1 NFTs with different metadata
   
2. **Minting Phase**: Collectors purchase editions with HBAR, LAZY, and/or USDC
   
3. **Winner Selection**: After all editions are sold, one or more winners are randomly selected
   
4. **Prize Exchange**: Winners exchange their edition NFTs for unique prize tokens (wiped via wipe key)

---

## Token Architecture

### Edition Token
- **Purpose**: Limited edition artwork distributed to collectors
- **Supply**: Configurable (e.g., 5, 10, 50, 100)
- **Metadata**: Single CID used for all editions (same artwork)
- **Keys Required**:
  - `SUPPLY` key (contract) - for minting editions
  - `WIPE` key (contract) - for removing winner's edition
- **Token ID**: Separate from prize (allows different royalties)
- **Royalties**: Configured during token initialization (can differ from prize token)

### Prize Token  
- **Purpose**: Unique 1-of-1 rewards for the winner(s)
- **Supply**: Configurable (1 or more winners)
- **Metadata**: Unique CID (different from edition)
- **Keys Required**:
  - `SUPPLY` key (contract) - for minting prizes on demand
- **Minting**: Created on-demand during prize claiming (not pre-minted)
- **Storage**: Minted directly to winners (no intermediate storage)
- **Royalties**: Configured during token initialization (can differ from edition token)

---

## Contract Phases

### Phase 1: NOT_INITIALIZED
**State**: No tokens created yet

**Actions Available**:
- Owner can initialize edition token
- Owner can initialize prize token

**Transitions To**: `EDITION_MINTING` (when both tokens initialized)

---

### Phase 2: EDITION_MINTING
**State**: Edition token created, prize minted, sales are open

**Actions Available**:
- Users can mint editions (with hbar/Lazy payment)
- Whitelist users get discounts
- Owner can add/remove whitelist addresses
- Owner can update pricing
- Owner can pause/unpause minting
- Owner can update WL-only status

**Auto-Transition**: When `totalMinted == maxSupply` → `EDITION_SOLD_OUT`

**Validations**:
- Check mint not paused
- Check mint is open (if start time set)
- Validate WL status if WL-only
- Check payment amounts (hbar + Lazy)
- Validate max mint per transaction
- Validate max mint per wallet (if set)

---

### Phase 3: EDITION_SOLD_OUT
**State**: All editions minted, waiting for winner selection

**Actions Available**:
- **Anyone** can call `selectWinner()` (permissionless for decentralization)

**Transitions To**: `WINNER_SELECTED` (when winner picked)

**Winner Selection Logic**:
1. Use PRNG to generate random serial (1 to maxSupply)
2. Store winning serial (NFT is bearer asset - whoever holds it can claim)
3. Emit event with verifiable randomness seed
4. Transition phase

**Important**: Winner is NOT stored by address. The edition NFT serial is a **bearer asset** - whoever owns the winning serial at claim time is the winner.

---

### Phase 4: WINNER_SELECTED
**State**: Winner determined, waiting for prize claim

**Actions Available**:
- **Current owner** of winning serial can call `claimPrize()`
- Anyone can view winning serial

**Transitions To**: `PRIZE_CLAIMED` (when prize claimed)

**Prize Claim Logic**:
1. Query who currently owns the winning serial
2. Verify caller owns the winning serial
3. Verify caller is associated with prize token
4. **Wipe** edition NFT from caller's account
5. Transfer prize NFT to caller
6. Emit swap event
7. Transition phase

**Bearer Asset Model**: The winning serial is a bearer asset. Whoever owns it at claim time receives the prize. This means:
- Winner can transfer/sell the winning serial before claiming
- New owner becomes the prize recipient
- Creates a tradeable "winning ticket" NFT

---

### Phase 5: PRIZE_CLAIMED
**State**: Winner has claimed prize, process complete

**Actions Available**:
- Owner can withdraw hbar proceeds
- Owner can withdraw Lazy proceeds
- View-only functions

**Final State**: No further transitions

---

## Economic Model

### Pricing Structure

```solidity
struct MintEconomics {
    uint256 mintPriceHbar;      // Price in tinybar
    uint256 mintPriceLazy;      // Price in Lazy (decimal 1)
    uint256 wlDiscount;         // Discount % for WL (0-100)
    uint256 maxMint;            // Max per transaction (0 = unlimited)
    uint256 maxMintPerWallet;   // Max per wallet (0 = unlimited)
    uint256 buyWlWithLazy;      // Cost to buy WL spot with Lazy
    uint256 maxWlAddressMint;   // Max mints per WL address
    address wlToken;            // Token to use for WL purchase
}
```

### Payment Options

**Option 1: HBAR Only**
- `mintPriceHbar > 0`, others = 0
- User sends HBAR with transaction

**Option 2: LAZY Only**
- `mintPriceLazy > 0`, others = 0
- User must approve LAZY allowance

**Option 3: USDC Only**
- `mintPriceUsdc > 0`, others = 0
- User must approve USDC allowance (native or bridged)

**Option 4: Multi-Token Hybrid**
- Multiple prices set
- User pays combination (HBAR + LAZY + USDC)
- All non-zero prices must be paid

### Whitelist Discounts
- WL users get `wlDiscount` % off all payment types (HBAR, LAZY, and USDC)
- Example: 20% discount on 100 HBAR = 80 HBAR cost
- Applied uniformly across all three payment methods

### Lazy Token Integration

**Burn Mechanism**:
- Configurable percentage of Lazy is burned per mint
- Burned via Lazy Smart Contract Treasury (LSCT)
- Remaining Lazy stays in contract
- Example: 50% burn means half destroyed, half retained

**Retrieving Lazy**:
- Owner can withdraw Lazy after minting complete
- No cooldown/refund window (simplified vs MinterContract)

### USDC Integration

**Dual Token Support** (Network-Configurable):
- **Mainnet Native USDC**: `0x000000000000000000000000000000000006f89a`
- **Mainnet Bridged USDC**: `0x0000000000000000000000000000000000101Ae3`
- **Testnet**: Custom test tokens (configured via constructor parameters)
- Smart prioritization: Uses native USDC first, then bridged for remainder
- Supports mixed allowances across both tokens

> ⚠️ **Testing Note**: USDC test tokens should be created with **6 decimals** to match production behavior

**Payment Processing**:
- User approves both USDC tokens for flexibility
- Contract automatically optimizes token usage
- All USDC goes to owner (no burn mechanism like LAZY)

**Withdrawal**:
- Owner can withdraw both native and bridged USDC
- Separate balances tracked and withdrawn independently

---

## Whitelist System

### WL Types

**1. Manual Whitelist**
- Owner adds addresses via `addToWhitelist()`
- Each address gets `maxWlAddressMint` spots
- Spots consumed per mint
- Cannot mint more than allocated spots

**2. Buy WL with Lazy**
- Users call `buyWlWithLazy()`
- Pay `buyWlWithLazy` amount of Lazy
- Receive `maxWlAddressMint` spots
- Subject to Lazy burn percentage

**3. Buy WL with Token**
- Users call `buyWlWithTokens(serialNumbers[])`
- Present serials from `wlToken` collection
- Must own the serials
- Each serial grants `maxWlAddressMint` spots
- Serials tracked to prevent double-dipping

### WL-Only Mode
- When enabled, only WL addresses can mint
- Non-WL transactions revert
- Can be toggled by owner at any time

---

## Security Features

### Reentrancy Protection
- All state-changing functions protected with `nonReentrant`
- Prevents reentrancy attacks during payments/transfers

### Custom Errors
- Gas-efficient error handling
- Clear error messages for debugging
- No `require()` statements with strings

### Ownership Controls
- Only owner can initialize tokens
- Only owner can withdraw funds
- Only owner can manage whitelist
- Winner selection is permissionless (anyone can trigger)

### Edge Case Handling

**Winning Serial Transferred (Bearer Asset)**:
- Whoever owns the winning serial at claim time gets the prize
- Original owner at selection time does NOT matter
- Creates a tradeable "winning ticket" NFT
- New owner must associate with prize token to claim

**Claimer Not Associated with Prize**:
- `claimPrize()` checks association
- Reverts with clear error if not associated
- Must associate with prize token first

**Paused Minting**:
- Owner can pause at any time
- All mint attempts revert when paused
- Can unpause to resume

---

## Event System

### Initialization Events
```solidity
event EditionTokenCreated(address indexed token, uint256 maxSupply, string cid);
event PrizeTokenCreated(address indexed token, string cid);
```

### Minting Events
```solidity
event EditionMinted(
    address indexed buyer,
    bool indexed isWlMint,
    uint256[] serials,
    uint256 hbarPaid,
    uint256 lazyPaid
);
```

### Whitelist Events
```solidity
event WhitelistAdded(address indexed user, uint256 spots);
event WhitelistRemoved(address indexed user);
event WlPurchasedWithLazy(address indexed user, uint256 spots);
event WlPurchasedWithToken(address indexed user, uint256[] serials, uint256 spots);
```

### Winner Selection Events
```solidity
event WinnerSelectedEvent(uint256[] winningSerials, uint256 timestamp);
```
**Purpose**: Provides verifiable on-chain proof of randomness
**Fields**:
- `winningSerials`: Array of edition serials that can claim prizes (bearer assets)
- `timestamp`: When selection occurred

**Technical Details**:
- Uses EnumerableSet for O(1) winner verification
- Supports multiple winners (configurable prize supply)
- PRNG seed verifiable via transaction record

**Note**: Winner addresses are NOT stored or emitted. The NFT serials are bearer assets.

### Prize Claim Events
```solidity
event PrizeClaimed(
    address indexed claimer,
    uint256 editionSerialWiped,
    uint256 prizeSerial,
    uint256 timestamp
);
```
**Note**: `claimer` is whoever owns the winning serial at claim time, not necessarily the original owner at selection time.

### Economic Events
```solidity
event LazyBurned(uint256 amount);
event PricingUpdated(uint256 hbarPrice, uint256 lazyPrice);
event DiscountUpdated(uint256 discount);
```

---

## PRNG Integration

### On-Chain Verifiable Randomness

**PRNG Contract**: `PrngGenerator.sol` (Hedera native)
- Provided at contract deployment (constructor parameter)
- Uses Hedera's PRNG precompile (0x169)
- Provides cryptographically secure randomness
- Returns 256-bit seed from n-3 transaction record
- Address can be updated by owner if needed

### Winner Selection Process

**⚠️ CRITICAL GAS CONSIDERATION for Multiple Winners:**
When `prizeMaxSupply > 1`, the `selectWinner()` function uses a robust algorithm that may require multiple PRNG calls if duplicate serial numbers are generated. **Gas estimates should be 2-3x normal estimates** to handle worst-case scenarios with many duplicates.

**Algorithm Overview:**
1. **Initialize Parameters**:
   ```solidity
   uint256 targetWinners = prizeMaxSupply;
   uint256 baseSeed = uint256(blockhash(block.number - 1)) + block.timestamp;
   uint256 nonce = 0;
   ```

2. **Iterative Winner Selection**:
   ```solidity
   while (winningSerials.length() < targetWinners) {
       // Generate nonce-evolved seed for uniqueness
       uint256 seed = uint256(keccak256(abi.encodePacked(baseSeed, nonce)));
       
       // Request only remaining winners needed (gas optimization)
       uint256 remaining = targetWinners - winningSerials.length();
       
       // PRNG call with evolved seed
       uint256[] memory randomNumbers = IPrngGenerator(PRNG_GENERATOR)
           .getPseudorandomNumberArray(1, editionMaxSupply, seed, remaining);
       
       // Add unique winners (EnumerableSet automatically handles duplicates)
       for (uint256 i = 0; i < randomNumbers.length; i++) {
           winningSerials.add(randomNumbers[i]);
           if (winningSerials.length() == targetWinners) break;
       }
       nonce++; // Evolve seed for next iteration
   }
   ```

3. **Duplicate Handling**:
   - **EnumerableSet.add()** silently ignores duplicates, ensuring unique winners
   - **Nonce evolution** ensures different random seeds across iterations
   - **Gas-optimized** by requesting only remaining winners needed
   - **Automatic termination** when exact target count reached

4. **Statistical Analysis** (Example: 3 winners from 10 editions):
   - **Single iteration success**: ~70% probability (no duplicates)
   - **Two iterations**: ~99% total success probability  
   - **Gas overhead**: Minimal for most realistic scenarios
   - **Edge case protection**: Algorithm guarantees success regardless of duplicates

5. **Final Steps**:
   ```solidity
   uint256[] memory finalWinners = winningSerials.values();
   currentPhase = Phase.WINNER_SELECTED;
   emit WinnerSelectedEvent(finalWinners, block.timestamp);
   ```

### Verification by Third Parties

Anyone can verify the selection by:
1. Reading the `WinnerSelected` event
2. Checking the PRNG seed on-chain
3. Verifying the winning serial was in valid range [1, maxSupply]
4. Confirming the randomness was not manipulated
5. Current owner of that serial can claim the prize (bearer asset model)

---

## Wipe Key Strategy

### Why Wipe Instead of Transfer?

**Traditional Approach** (Transfer):
- Winner must `approve()` contract
- Winner calls claim function
- Contract uses `transferFrom()` to take NFT
- Contract burns or holds NFT
- **2 transactions minimum**

**Wipe Approach** (Chosen):
- Contract has WIPE key on edition token
- Winner calls claim function
- Contract directly removes NFT from winner's wallet
- **1 transaction, cleaner UX**

### Implementation Details

```solidity
// During edition token creation
keys[1] = getSingleKey(KeyType.WIPE, KeyValueType.CONTRACT_ID, address(this));

// During prize claim
int64[] memory serialsToWipe = new int64[](1);
serialsToWipe[0] = int64(uint64(_editionSerial));
int256 wipeResponse = wipeTokenAccountNFT(editionToken, msg.sender, serialsToWipe);
if (wipeResponse != HederaResponseCodes.SUCCESS) revert WipeFailed();

// Mint prize on-demand using shared helper
bytes[] memory prizeMetadataArray = new bytes[](1);
prizeMetadataArray[0] = bytes(prizeMetadata);
_mintAndTransfer(prizeToken, prizeMetadataArray, msg.sender);
```

### Security Implications

**Pros**:
- Simpler UX (no approval needed)
- Single transaction claim
- Lower gas costs
- Familiar pattern from HIP-564 (burn)

**Considerations**:
- Contract has powerful WIPE capability
- Only used in prize claim function
- Winner must still own the serial
- Transparent on-chain verification

---

## Comparison with MinterContract

| Feature | MinterContract | EditionWithPrize |
|---------|---------------|------------------|
| **Tokens** | Single token, unique metadata | Two tokens (edition + prize) |
| **Metadata** | Multiple unique CIDs | Single edition CID + unique prize CID |
| **Winners** | N/A | PRNG-selected winner(s) - configurable |
| **Exchange** | N/A | Wipe edition → receive prize |
| **Wipe Key** | Not used | Used for prize claim |
| **Payment Methods** | HBAR + LAZY | HBAR + LAZY + USDC (dual) |
| **Winner Tracking** | N/A | EnumerableSet (O(1) verification) |
| **Prize Minting** | N/A | On-demand via shared helper |
| **Cooldown** | Yes (refund window) | No (simplified) |
| **Refund** | Yes (burn for refund) | No |
| **WL Economics** | ✅ Full support | ✅ Full support |
| **Lazy Burn** | ✅ Full support | ✅ Full support |
| **Max Mint** | ✅ Per wallet tracking | ✅ Per wallet tracking |
| **Phase System** | Implicit (paused/open) | Explicit (5 phases) |
| **Gas Optimization** | Standard | Enhanced (O(1) lookups, DRY helpers) |

---

## Use Cases

### Scenario 1: Small Edition (10 copies)
- Artist creates 10 editions at 50 hbar each (5% royalty)
- Prize is a physical artwork redemption NFT (10% royalty)
- Sales complete in hours
- Winning serial selected via PRNG
- Current owner of winning serial claims prize

### Scenario 2: Large Edition (100 copies) with Trading
- Artist creates 100 editions at 10 hbar + 100 Lazy
- Prize is exclusive 1-of-1 animated artwork (15% royalty split)
- Whitelist for early supporters (20% discount)
- 50% Lazy burned per mint
- Winning serial becomes valuable - holders trade it
- Final owner claims the prize

### Scenario 3: Hybrid Payment with Different Royalties
- Edition: 20 hbar + 500 Lazy (both required), 7% royalty to artist
- Prize: Exclusive collaboration piece, 12% royalty split 2 ways
- WL discount: 25% off both
- WL spots purchasable with 1000 Lazy
- Max 5 per wallet
- Bearer asset model allows winner to sell/trade winning ticket

### Scenario 4: Multiple Winners Edition (NEW - v1.0 COMPLETE)
- Artist creates 50 editions at 15 hbar each
- **3 prize tokens** for multiple winners (prizeMaxSupply = 3)
- **⚠️ Gas Consideration**: selectWinner() call requires 2-3x gas estimate
- Algorithm guarantees exactly 3 unique winners via nonce-based seed evolution
- **Trading Market**: Winning serials become tradeable "golden tickets"
- Each winning serial holder can claim their individual prize
- Statistical analysis: ~70% chance of single iteration, ~99% within two iterations

---

## Future Enhancements (Out of Scope v1)

### Multiple Prize Tiers
- 1st place: Grand prize
- 2nd place: Runner-up
- 3rd place: Honorable mention

### Timed Claim Window
- Winner must claim within X days
- If expired, select new winner
- Prevents abandoned prizes

### Partial Burn Economics
- Burn X% of hbar proceeds to Lazy
- Create deflationary pressure
- Support ecosystem

### Royalty Splitting (Already Supported in v1!)
- Edition royalties can be set independently (e.g., 5% to artist)
- Prize royalties can be different (e.g., 10% split between artist + collaborator)
- Each token configured with its own `NFTFeeObject[]` array during initialization
- Supports up to 10 royalty recipients per token

### ~~Metadata Reveals~~ (Not Applicable)
- ❌ Hedera HTS tokens have **permanent, immutable metadata** (currently)
- ❌ Cannot hide/reveal metadata on-chain
- All metadata is visible immediately upon minting
- *Note: Future Hedera precompile updates may enable mutable metadata*

---

## Technical Constraints

### Hedera-Specific
- Token creation costs ~$1-2 per token
- Association costs 0.001 hbar per token
- Wipe requires explicit key during creation
- PRNG uses transaction record (3 tx delay)

### Gas Optimization
- Batch minting not needed (edition is single metadata)
- Serial tracking uses EnumerableMap
- Events used for off-chain indexing
- View functions for UI data

### Contract Size
- Target: <24KB (EVM limit)
- Inherit from ExpiryHelper (lightweight)
- Use HederaTokenServiceStakerLite (not full HTS)
- Custom errors (smaller than require strings)

---

## Summary

The EditionWithPrize contract provides a complete solution for artists to:
1. ✅ Mint limited edition artworks
2. ✅ Offer a unique prize to collectors
3. ✅ Use verifiable on-chain randomness
4. ✅ Provide seamless prize claiming
5. ✅ Integrate Lazy token economics
6. ✅ Support whitelist mechanisms
7. ✅ Maintain transparency and security

The wipe key approach provides the cleanest UX while maintaining security through explicit validation checks and event logging.
