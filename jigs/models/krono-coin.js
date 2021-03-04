const axios = require('axios');
const { Token20 } = require('run-sdk').extra;
const {Transaction} = require('run-sdk');

const {SignedMessage} = require('@kronoverse/lib/dist/signed-message');


/* global KronoClass */
class KronoCoin extends Token20 {
    setPaymentId(paymentId) {
        this.paymentId = paymentId;
    }

    toObject(skipKeys = [], visited = new Set()) {
        if(visited.has(this)) return;
        visited.add(this);
        return KronoClass.cloneChildren(this, skipKeys, visited);
    }
}

KronoCoin.postDeploy = async (deployer) => {
    const { data: [coin]} = await axios.post(`${deployer.apiUrl}/jigs/cashier`, new SignedMessage({
        payload: JSON.stringify({
            criteria: {kind: KronoCoin.origin},
            project: {value: false}
        })
    }, deployer.userId, deployer.keyPair));

    if(!coin) {
        const { data: {address} } = await axios.post(`${deployer.apiUrl}/accounts`, new SignedMessage({
            subject: 'RequestPaymentAddress',
            context: ['fyx'],
            payload: JSON.stringify({
                fyxId: 'fyx',
                userId: 'cashier'
            })
        }, deployer.userId, deployer.keyPair));
        const t = new Transaction();
        t.update(() => {
            console.log('Minting Coins');
            for(let i = 0; i < 10; i++) {
                KronoCoin.mint(1000000000000, address);
            }
        });
        await t.publish();
    }
};

KronoCoin.decimals = 6;
KronoCoin.asyncDeps = {
    KronoClass: 'lib/krono-class.js'
};

module.exports = KronoCoin;
