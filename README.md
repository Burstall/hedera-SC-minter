#Hedera SC Minter Scripts

You will need access to some $LAZY to test

## on-click mint
Gas @ 1,850,000 for first mint (single mint) to allow for potential association [1,789,846]
Gas @ 4,500,00 for first mint (20 mint) to allow for association [4,250,538]
Gas @ 950,000 for additional mints [885,015] when no association attempt
Gas @ 1,300,000 for 5 mints (after first time) [1,250,731]
Gas @ 1,750,000 for 10 mints (after first time) [1,708,027]
Gas @ 3,500,000 for 20 mints (after first time) [3,340,612]

## on gas
$0.000,000,0569 per gwei
Documentation suggests a 20% uplift on gas cost vs native calls.
e.g. a 5c token create needs 5c/cost*1.2 = 1,054,481.55 to be safe. 
Hedera refunds max 20% of gas offerred to encourage dApps to gas appropriately