const { getTokenBalancesForAccount, getTokenDetails } = require("../../utils/hederaMirrorHelpers");
const { getArgFlag } = require("../../utils/nodeHelpers");

const envToCheck = 'test';
const tokenToTreasuryMap = new Map();

// check arguments expecting 1 then extract 1st argument
if (process.argv.length < 3 || getArgFlag('h') || getArgFlag('help')) {
    console.log('Usage: node validateUserMintedToken.js <account_id1,account_id2...>');
    console.log('           where <account_id> is the account IDs to check for minted tokens separated by commas');
    process.exit(1);
}

const accountIdList = [...new Set(process.argv[2].split(','))];

const validatedUserList = [];
const invalidUserList = [];

async function main() {
    

    for (const accountId of accountIdList) {
        console.log('Validating minted tokens for account:', accountId);
        // get associated tokens for the account form the mirror node in envToCheck
        const usersTokens = await getTokenBalancesForAccount(envToCheck, accountId);

        let userMintedAToken = false;
        for (const token of usersTokens) {
            const tokenId = token.token_id;
            if (!tokenToTreasuryMap.has(tokenId)) {
                // get the treasury account for the token
                const tokenInfo = await getTokenDetails(envToCheck, tokenId);
                tokenToTreasuryMap.set(tokenId, tokenInfo.treasury_account_id);
            }
            if (tokenToTreasuryMap.get(tokenId) === accountId) {
                userMintedAToken = true;
                console.log('Token:', tokenId, 'is minted by account:', accountId);
                break;
            }
        }

        if (userMintedAToken) {
            validatedUserList.push(accountId);
        } else {
            invalidUserList.push(accountId);
        }
    }
}

main().then(() => {
    console.log('Validated users:', validatedUserList);
    console.log('Invalid users:', invalidUserList);
    process.exit(0);
}).catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});