const Config = require('../config/config');
const FyxJig = require('../lib/fyx-jig');

/* global caller */
class FyxItem extends FyxJig {
    init(item, owner, metadata = {}, satoshis = Config.defaultSatoshis) {
        this.item = item;
        this.mint = caller;
        this.minter = caller && caller.owner;
        this.metadata = {
            ...metadata,
            ...Config.defaultMetadata
        };
        this.satoshis = satoshis;
        this.owner = owner;
    }
}

FyxItem.metadata = {
    name: 'Fyx Item',
    emoji: '📦'
};

FyxItem.transferrable = true;
FyxItem.asyncDeps = {
    Config: 'config/config.js',
    FyxJig: 'lib/fyx-jig.js'
};

module.exports = FyxItem;