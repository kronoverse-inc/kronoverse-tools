import { IUTXO, IAction } from '../interfaces';
import { Blockchain } from '.';
import { LRUCache } from '../lru-cache';
import fetch from 'node-fetch';

const { Transaction } = require('bsv');

export class RestBlockchain extends Blockchain {
    private inflight = new Map<string, Promise<any>>();
    constructor(private apiUrl: string, network: string, public cache = new LRUCache(10000000)) {
        super(network);
    }

    async broadcast(tx) {
        console.time(`Broadcast: ${tx.hash}`);
        const resp = await fetch(`${this.apiUrl}/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({rawtx: tx.toString()})
        });
        if (!resp.ok) throw new Error(await resp.text());
        console.timeEnd(`Broadcast: ${tx.hash}`);
        return this.saveTx(tx, true);
    }

    async saveTx(tx, saveUtxos?: boolean): Promise<IUTXO[]> {
        const txid = tx.hash;
        return tx.outputs.map((o, vout) => o.script.isPublicKeyHashOut() && {
            _id: `${txid}_o${vout}`,
            address: o.script.toAddress(this.bsvNetwork).toString(),
            script: o.script.toString(),
            satoshis: o.satoshis,
            txid,
            ts: Date.now(),
            vout,
            lockUntil: 0
        }).filter(utxo => utxo);
    }

    async fetch(txid: string, force?: boolean) {
        try {
            const resp = await fetch(`${this.apiUrl}/tx/${txid}`);
            const rawtx = await resp.json();
            const tx = new Transaction(rawtx);
            const spent: any[] = await Promise.all(tx.outputs.map(async (o, i) => {
                const resp = await fetch(`${this.apiUrl}/utxos/${txid}_o${i}/spent`);
                if(resp.status === 404) return {};
                if (!resp.ok) throw new Error(resp.statusText);
                return resp.json();
            }));

            tx.outputs.forEach((o: any, i) => {
                o.spentTxId = spent[i].spent_txid || null;
                o.spentIndex = spent[i].spent_index || null;
            });
            // console.log('TX:', tx)
            return tx;
        } catch (e) {
            console.log(`Fetch error: ${txid} - ${e.message}`);
            throw e;
        }
    };

    async utxos(address, start?: number): Promise<IUTXO[]> {
        if (typeof address !== 'string') {
            address = address.toAddress(this.bsvNetwork).toString();
        }
        const resp = await fetch(`${this.apiUrl}/utxos/${address}`);
        if (!resp.ok) throw new Error(await resp.text());
        return resp.json();
    };


    async isSpent(loc: string) {
        const resp = await fetch(`${this.apiUrl}/utxos/${loc}/spent`);
        if (!resp.ok) throw new Error(await resp.text());
        return await resp.json();
    }

    async utxosByLoc(locs: string[]): Promise<IUTXO[]> {
        const resp = await fetch(`${this.apiUrl}/utxos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locs }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        return resp.json();
    }

    async lockUtxo(address: string, expires: number, satoshis: number): Promise<IUTXO> {
        throw new Error('lockUtxo not implemented');
    };

    async getChannel(loc: string, seq?: number): Promise<any> {
        const resp = await fetch(`${this.apiUrl}/channel/${loc}`);
        if (!resp.ok) throw new Error(await resp.text());
        return await resp.json();
    }

    async submitAction(agentId: string, action: IAction) {
        console.log('submitting action:', agentId, JSON.stringify(action));
        const resp = await fetch(`${this.apiUrl}/${agentId}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action),
        });
        if (!resp.ok) throw new Error(await resp.text());
        return resp.json();
    }

    async fund(address) {
        const resp = await fetch(`${this.apiUrl}/fund/${address}`);
        if (!resp.ok) throw new Error(await resp.text());
        return await resp.json();
    }
}
