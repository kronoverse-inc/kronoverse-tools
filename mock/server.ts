#!/usr/bin/env node

import cors from 'cors';
import { EventEmitter } from 'events';
import express from 'express';
import http from 'http';
import { HttpError, NotFound } from 'http-errors';
import { Request, Response, NextFunction } from 'express';
import { MockBlockchain } from '../lib/blockchain/mock-blockchain'
import { MapStorage } from '../lib/storage/map-storage';

const { Transaction } = require('bsv');
const Run = require('../run/dist/run.node.min');

const network = 'mock';

export const agents: any[] = [];
export const blockchain = new MockBlockchain(network);

const state = new MapStorage<any>();
const run = new Run({
    network,
    blockchain,
    state
});
run.owner.next = () => run.owner.pubkey;

blockchain.setMaxListeners(100);
export const events = new EventEmitter();
const jigs = [];
const channels = [];

blockchain.on('txn', async (tx) => {
    if (!tx.outputs[0].script.isSafeDataOut()) {
        return;
    }

    await Promise.all(tx.outputs.map(async (o, vout) => {
        if (!o.script.isPublicKeyHashOut()) return;
        const loc = `${tx.hash}_o${vout}`;
        const jig = await run.load(loc).catch((e) => {
            if (e.message.includes('not a run tx') ||
                e.message.includes('not a jig output') ||
                e.message.includes('Not a token')
            ) return;
            console.error('Load error:', e.message);
        });
        if (!jig) return;
        console.log('JIG:', jig.constructor.name, jig.location);
        const index = jigs.push({
            location: jig.location,
            kind: jig.constructor.origin || '',
            type: jig.constructor.name,
            origin: jig.origin,
            owner: jig.owner,
            ts: Date.now(),
            isOrigin: jig.location === jig.origin
        });
        events.emit('jig', index - 1);
    }));
});

let initialized;
export async function setInitializer(initializer) {
    initialized = await initializer;
}

export const app = express();
const server = http.createServer(app);
const io = require('socket.io').listen(server);
app.enable('trust proxy');
app.use(cors());
app.use(express.json());

io.on('connection', (socket) => {
    console.log('SOCKET CONNECTION');
    socket.on('listen', (address) => {
        console.log('SOCKET:', address);
        blockchain.on(address, (utxo) => {
            socket.emit('utxo', utxo._id);
        });
        blockchain.on('channel', (channel) => {
            if(!channel.recipients.includes(address)) return;
            socket.emit('channel', channel.loc);
        });
    });
})

// app.use(async (req: Request, res: Response, next: NextFunction) => {
//     try {
//         console.log('Req:', req.path);
//         next();
//     } catch (e) {
//         next(e);
//     }
// });

app.get('/', (req: Request, res: Response) => {
    res.json(true);
});

app.get('/_ah/warmup', (req, res) => {
    res.json(true);
});

app.get('/_ah/stop', (req: Request, res: Response) => {
    process.exit(0);
});

app.get('/initialize', async (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store')
    try {
        await initialized;
        res.json(true);
        next();
    } catch (e) {
        next(e);
    }
});

app.post('/broadcast', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tx = new Transaction(req.body);
        await blockchain.broadcast(tx);

        res.json(true);
    } catch (e) {
        next(e);
    }
});

app.get('/tx/:txid', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const txData = await blockchain.fetch(req.params.txid, true, true);
        res.json(txData);
    } catch (e) {
        next(e);
    }
});

app.get('/utxos/:address', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const utxos = await blockchain.utxos(req.params.address);
        res.json(utxos);
    } catch (e) {
        next(e);
    }
});

app.get('/utxos/:loc/spent', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { loc } = req.params;
        const isSpent = await blockchain.isSpent(loc);
        res.json(isSpent);
    } catch (e) {
        next(e);
    }
});

app.get('/fund/:address', async (req: Request, res: Response, next: NextFunction) => {
    try {
        blockchain.fund(req.params.address, 100000000);
        res.json(true);
    } catch (e) {
        next(e);
    }
});

function notify(res: Response, eventName: string, id: string | number, data: string) {
    res.write(`id: ${id}\n`);
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${data}\n\n`);
}

app.post('/utxos', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { locs } = req.body;
        const utxos = await blockchain.utxosByLoc(locs);
        res.json(utxos);
    } catch (e) {
        next(e);
    }
});

app.get('/utxos/:loc/spent', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { loc } = req.params;
        const isSpent = await blockchain.isSpent(loc);
        res.json(isSpent);
    } catch (e) {
        next(e);
    }
});

app.get('/channel/:loc', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { loc } = req.params;
        const channel = await blockchain.getChannel(loc);
        if(!channel) throw new NotFound();
        res.json(channel);
    } catch (e) {
        next(e);
    }
});

app.get('/jig/:loc', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // const jig = await run.load(req.params.loc)
        res.json(jigs.find(jig => jig.location === req.params.loc));
    } catch (e) {
        next(e);
    }
});

app.get('/state/:key', async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.json(await state.get(req.params.key));
    } catch (e) {
        next(e);
    }
});

app.get('/agents/:agentId', async (req: Request, res: Response, next: NextFunction) => {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    try {
        const { agentId } = req.params;
        const agent = agents.find(agent => agent.agentId === agentId);
        res.json(agent);
    } catch (e) {
        next(e);
    }
});

app.put('/agents/:realm/:agentId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { loc, address } = req.body;
        const { agentId } = req.params;
        let agent = agents.find(agent => agent.agentId === agentId);
        if (!agent) {
            agent = {
                agentId,
                location: loc,
                address
            }
            agents.push(agent);
        }

        agent.location = loc;
        res.json(true);
    } catch (e) {
        next(e);
    }
});

app.post('/:agentId/submit', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { agentId } = req.params;
        const { address } = agents.find(agent => agent.agentId === agentId);
        if (!address) throw new NotFound();

        const action = {
            ...req.body,
            address,
            ts: Date.now()
        };
        events.emit('act', action);
        res.json(true);
    } catch (e) {
        next(e);
    }
});

app.get('/jigs/:address', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { address } = req.params;
        const utxos: any[] = await blockchain.utxos(address);
        res.json(jigs.filter(jig => utxos.find(utxo => utxo._id == jig.location)));
    } catch (e) {
        next(e);
    }
});

app.post('/jigs/kind/:kind', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const locs = jigs.filter(jig => jig.kind === req.params.kind)
            .map(jig => jig.location);
        res.json(locs);
    } catch (e) {
        next(e);
    }
});

app.post('/jigs/origin/:origin', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const locs = jigs.filter(jig => jig.origin === req.params.origin)
            .map(jig => jig.location);
        res.json(locs);
    } catch (e) {
        next(e);
    }
});

app.get('/notify/:address', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const address = req.params.address;
        const lastTs = parseInt(req.get('Last-Event_ID') || '0', 10);
        console.log('NOTIFY:', address);

        const headers = {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
        };
        res.writeHead(200, headers);

        function writeUtxo(utxo) {
            notify(res, 'utxo', utxo.ts, utxo._id);
        }
        blockchain.on(address, writeUtxo);
        // const utxos = await blockchain.utxos(address, lastTs);
        // utxos.forEach(writeUtxo);

        function writeAct(action) {
            if (action.address !== address) return;
            notify(res, 'act', action.ts, JSON.stringify(action));
        }
        // actions.forEach((action) => action.ts > lastTs && writeAct(action));
        events.on('act', writeAct);

        function writeChannel(channel) {
            console.log('CHANNEL:', address, JSON.stringify(channel));
            if (!channel.recipients.includes(address) || channel.address === address) return;
            notify(res, 'channel', channel.ts, channel.loc);
        }
        channels.forEach((channel) => channel.ts > lastTs && writeChannel(channel));
        blockchain.on('channel', writeChannel);

        res.on('close', () => {
            console.log('CLOSING STREAM:', address);
            blockchain.off(address, writeUtxo);
            events.off('act', writeAct);
            blockchain.off('channel', writeChannel);
        });
    }
    catch (e) {
        next(e);
    }
});

app.get('/notify/jigs/:ts?', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { kind, origin } = req.query;
        const lastTs = parseInt(req.get('Last-Event_ID') || req.params.ts, 10) || 0;
        const kinds = Array.isArray(kind) ? kind : (kind ? [kind] : []);
        const origins = Array.isArray(origin) ? origin : (origin ? [origin] : []);

        const headers = {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
        };
        res.writeHead(200, headers);

        function handleJig(jig) {
            if (kinds.includes(jig.kind)) {
                notify(res, 'kind', jig.ts, jig.location);
            }
            if (origins.includes(jig.origin)) {
                notify(res, 'origin', jig.ts, jig.location);
            }
        }
        events.on('jig', handleJig);
        for (let i = lastTs; i < jigs.length; i++) {
            handleJig(jigs[i]);
        }

        res.on('close', () => {
            events.off('jig', handleJig);
        });
    }
    catch (e) {
        next(e);
    }
});

app.get('/notify/channels/:ts?', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { channel } = req.query;
        const lastTs = parseInt(req.get('Last-Event_ID') || req.params.ts, 10) || 0;
        const channels: any[] = Array.isArray(channel) ? channel : (channel ? [channel] : []);

        const headers = {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
        };
        res.writeHead(200, headers);

        function writeChannel(channel) {
            if (!channels.includes(channel.loc)) return;
            notify(res, 'channel', channel.ts, channel.loc);
        }
        channels.forEach((channel) => channel.ts > lastTs && writeChannel(channel));
        blockchain.on('channel', writeChannel);

        res.on('close', () => {
            blockchain.off('channel', writeChannel);
        });
    }
    catch (e) {
        next(e);
    }
});

app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
    console.error(err.message, err.statusCode !== 404 && err.stack);
    res.status(err.statusCode || 500).send(err.message);
});

const PORT = process.env.PORT || 8082;

server.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});

