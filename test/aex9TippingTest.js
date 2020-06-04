/*
 * ISC License (ISC)
 * Copyright (c) 2018 aeternity developers
 *
 *  Permission to use, copy, modify, and/or distribute this software for any
 *  purpose with or without fee is hereby granted, provided that the above
 *  copyright notice and this permission notice appear in all copies.
 *
 *  THE SOFTWARE IS PROVIDED 'AS IS' AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 *  REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 *  AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 *  INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 *  LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 *  OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 *  PERFORMANCE OF THIS SOFTWARE.
 */
const {Universal, MemoryAccount, Node} = require('@aeternity/aepp-sdk');

const TIPPING_CONTRACT = utils.readFileRelative('./contracts/Tipping.aes', 'utf-8');
const FUNGIBLE_TOKEN_CONTRACT = utils.readFileRelative('./contracts/FungibleToken.aes', 'utf-8');
const MOCK_ORACLE_SERVICE_CONTRACT = utils.readFileRelative('./contracts/MockOracleService.aes', 'utf-8');

const config = {
    url: 'http://localhost:3001/',
    internalUrl: 'http://localhost:3001/',
    compilerUrl: 'http://localhost:3080'
};

describe('AEX9 Tipping Contract', () => {
    let client, contract, oracleServiceContract, tokenContract1, tippingAddress;

    before(async () => {
        client = await Universal({
            nodes: [{
                name: 'devnetNode',
                instance: await Node(config)
            }],
            accounts: [MemoryAccount({
                keypair: wallets[0]
            })],
            networkId: 'ae_devnet',
            compilerUrl: config.compilerUrl
        });
    });

    it('Deploying Token Contract', async () => {
        tokenContract1 = await client.getContractInstance(FUNGIBLE_TOKEN_CONTRACT);
        const init = await tokenContract1.methods.init('AE Test Token 1', 0, 'AET1', 1000);
        assert.equal(init.result.returnType, 'ok');

        tokenContract2 = await client.getContractInstance(FUNGIBLE_TOKEN_CONTRACT);
        await tokenContract2.methods.init('AE Test Token 2', 0, 'AET2', 1000000);
    });

    it('Deploying MockOracleService Contract', async () => {
        oracleServiceContract = await client.getContractInstance(MOCK_ORACLE_SERVICE_CONTRACT);
        const init = await oracleServiceContract.methods.init();
        assert.equal(init.result.returnType, 'ok');
    });

    it('Deploying Tipping Contract', async () => {
        contract = await client.getContractInstance(TIPPING_CONTRACT);
        const init = await contract.methods.init(oracleServiceContract.deployInfo.address, wallets[0].publicKey);
        assert.equal(init.result.returnType, 'ok');

        tippingAddress = contract.deployInfo.address.replace('ct_', 'ak_');
    });

    // 1. create allowance for tipping contract
    // 2. call tip with aex 9 function, passing token contract reference
    // 3. transfer allowance within tip function
    // 4. transfer contract tokens when claiming
    // 5. save token contract and balance, sender as tip in tipping contract claims
    // 6. enable retip with tokens

    // TODO what are implications of removing NO_ZERO_PAYOUT
    // TODO how to migrate to new contract
    // TODO gas measurement with linear gas usage increase of claiming token tips
    // TODO adjustments for tipping contract util
    // TODO best practice for reuse amount field, optional token field
    // TODO check allowance compatibility of AEX-9 token
    // TODO more tests with different tips and same token
    // TODO consider better error checks if allowance is not matching tip token amount

    it('Tip with Token Contract', async () => {
        await tokenContract1.methods.create_allowance(tippingAddress, 333);
        await contract.methods.tip_token('domain.test', 'Hello World', tokenContract1.deployInfo.address, 333);

        const balanceTipping = await tokenContract1.methods.balance(tippingAddress)
        assert.equal(balanceTipping.decodedResult, 333);

        const balanceAdmin = await tokenContract1.methods.balance(await client.address())
        assert.equal(balanceAdmin.decodedResult, 1000 - 333);

        assert.equal((await contract.methods.unclaimed_for_url('domain.test')).decodedResult[0], 0);
        assert.deepEqual((await contract.methods.unclaimed_for_url('domain.test')).decodedResult[1], [[tokenContract1.deployInfo.address, 333]]);
    });

    it('Claim Tip with Token Contract', async () => {
        const claim = await contract.methods.claim('domain.test', wallets[1].publicKey, false);
        assert.equal(claim.result.returnType, 'ok');

        const balanceTipping = await tokenContract1.methods.balance(tippingAddress)
        assert.equal(balanceTipping.decodedResult, 0);

        const balanceClaimed = await tokenContract1.methods.balance(wallets[1].publicKey)
        assert.equal(balanceClaimed.decodedResult, 333);
    });

    it('Claim Tip with Token Contract', async () => {
        // Prepare Data
        await tokenContract1.methods.change_allowance(tippingAddress, 333);
        await contract.methods.tip_token('domain.test', 'Hello World', tokenContract1.deployInfo.address, 333);

        await tokenContract2.methods.create_allowance(tippingAddress, 333333);
        await contract.methods.tip_token('domain.test', 'Hello World 2', tokenContract2.deployInfo.address, 333333);

        await tokenContract2.methods.change_allowance(tippingAddress, 333333);
        await contract.methods.retip_token(1, tokenContract2.deployInfo.address, 333333);

        const balanceTipping = await tokenContract2.methods.balance(tippingAddress)
        assert.equal(balanceTipping.decodedResult, 333333 + 333333);

        const balanceAdmin = await tokenContract2.methods.balance(await client.address())
        assert.equal(balanceAdmin.decodedResult, 1000000 - 333333 - 333333);

        assert.equal((await contract.methods.unclaimed_for_url('domain.test')).decodedResult[0], 0);
        assert.deepEqual((await contract.methods.unclaimed_for_url('domain.test')).decodedResult[1].sort(), [[tokenContract1.deployInfo.address, 333], [tokenContract2.deployInfo.address, 333333 + 333333]].sort());

        // Claim both tokens at once
        const claim = await contract.methods.claim('domain.test', wallets[2].publicKey, false);
        assert.equal(claim.result.returnType, 'ok');

        assert.equal((await tokenContract1.methods.balance(tippingAddress)).decodedResult, 0);
        assert.equal((await tokenContract1.methods.balance(wallets[2].publicKey)).decodedResult, 333);

        assert.equal((await tokenContract2.methods.balance(tippingAddress)).decodedResult, 0);
        assert.equal((await tokenContract2.methods.balance(wallets[2].publicKey)).decodedResult, 333333 + 333333);
    });
});