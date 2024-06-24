#Hedera SC Minter Scripts
Will mint test $LAZY when needed.

Refactored post Hedera Solidity Security Change

## on-click mint
Need to assess gas post refactor 

## on gas
$0.000,000,0569 per gwei
Documentation suggests a 20% uplift on gas cost vs native calls.
e.g. a 5c token create needs 5c/cost*1.2 = 1,054,481.55 to be safe. 
Hedera refunds max 20% of gas offerred to encourage dApps to gas appropriately