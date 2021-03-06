const cors = require('cors');
const { Address, Tx } = require('bsv');
const { EventEmitter } = require('events');
const express = require('express');
const http = require('http');
const {HttpError} = require('@kronoverse/lib/dist/http-error');
const {Query} = require('mingo')
const Mockchain = require('./mockchain');
const { spawn, Worker } = require('threads');

const Run = require('run-sdk');
const { SignedMessage } = require('@kronoverse/lib/dist/signed-message');

const events = new EventEmitter();
events.setMaxListeners(100);
const jigs = new Map();
const messages = new Map();

const blockchain = new Mockchain();
blockchain.mempoolChainLimit = Number.MAX_VALUE;
const cache = new Run.LocalCache({ maxSizeMB: 100 });
const txns = [];

const channels = new Map();
function publishEvent(channel, event, data) {
    if (!channels.has(channel)) channels.set(channel, new Map());
    const id = Date.now();
    channels.get(channel).set(id, { event, data });
    events.emit(channel, id, event, data);
}

const app = express();
const server = http.createServer(app);

const WebSocket = require('ws');
const wss = new WebSocket.Server({ clientTracking: false, noServer: true });

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

app.enable('trust proxy');
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    if (exp.debug) console.log('REQ:', req.url);
    next();
});

app.get('/', (req, res) => {
    res.json(true);
});

app.get('/_ah/stop', (req, res) => {
    res.json(true);
    events.emit('shutdown');
})

app.get('/_ah/warmup', (req, res) => {
    res.json(true);
});

app.get('/initialize', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
        res.json(exp.initialized);
    } catch (e) {
        next(e);
    }
});

app.post('/broadcast', async (req, res, next) => {
    try {
        const { rawtx } = req.body;
        // console.log('RAWTX:', rawtx);
        const txid = await blockchain.broadcast(rawtx);
        indexWorker.index(rawtx)
            .then((indexed) => {
                (indexed || []).forEach(jigData => {
                    jigs.set(jigData.location, jigData);
                    publishEvent(jigData.owner, 'jig', jigData);
                    publishEvent(jigData.origin, 'jig', jigData);
                    if(jigData.kind) publishEvent(jigData.kind, 'jig', jigData);
                });
            })
            .catch(console.error);
        res.send(txid);
    } catch (e) {
        next(e);
    }
});

app.get('/tx/:txid', async (req, res, next) => {
    try {
        const { txid } = req.params;
        const rawtx = await blockchain.fetch(txid);
        if (!rawtx) throw new HttpError(404, 'Not Found');

        res.send(rawtx);
    } catch (e) {
        next(e);
    }
});

app.get('/utxos/script/:script', async (req, res, next) => {
    try {
        const { script } = req.params;
        res.json(await blockchain.utxos(script));
    } catch (e) {
        next(e);
    }
});

app.get('/utxos/address/:address', async (req, res, next) => {
    try {
        const { address } = req.params;
        const script = Script.fromPubKeyHash(Address.fromString(address).hashBuf).toHex();
        res.json(await blockchain.utxos(script));
    } catch (e) {
        next(e);
    }
});

app.get('/spends/:loc', async (req, res, next) => {
    try {
        const [txid, vout] = req.params.loc.split('_o');
        const spend = await blockchain.spends(txid, parseInt(vout, 10))
        res.send(spend);
    } catch (e) {
        next(e);
    }
});

app.get('/fund/:address', async (req, res, next) => {
    try {
        const { address } = req.params;
        const satoshis = parseInt(req.query.satoshis) || 100000000;
        const txid = await blockchain.fund(address, satoshis);
        res.send(txid);
    } catch (e) {
        next(e);
    }
});

app.get('/agents/:realm/:agentId', (req, res) => {
    const agent = exp.agents[req.params.agentId];
    if (!agent) throw new HttpError(404, 'Not Found');
    res.json(agent);
});

app.get('/jigs', async (req, res, next) => {
    try {
        res.json(Array.from(jigs.values()));
    } catch (e) {
        next(e);
    }
});

app.get('/jigs/:loc', async (req, res, next) => {
    try {
        const { loc } = req.params;
        if(jigs.has(loc)) {
            return res.json(jigs.get(loc));
        }
        res.sendStatus(404);
    } catch (e) {
        next(e);
    }
});


app.post('/jigs/:type/:value', async (req, res, next) => {
    try {
        const { type, value } = req.params;
        const query = req.body;
        let script = type === 'address' ?
            Address.fromString(value).toTxOutScript().toHex() :
            value;
        
        const utxos = await blockchain.utxos(script);
        const locs = utxos.map(u => `${u.txid}_o${u.vout}`);
        const results = locs.map(loc => jigs.get(loc)).filter(jig => jig);

        const filter = new Query(query.criteria || {});
        const cursor = filter.find(results, query.project)
            .skip(query.skip || 0)
            .limit(query.limit || 1000)
            .sort(query.sort || {});
        res.json(cursor.all());
    } catch (e) {
        next(e);
    }
});

app.post('/jigs/search', async (req, res, next) => {
    try {
        res.json([...jigs.values()].filter(jig => {
            for(const [key, value] of Object.entries(req.body)) {
                if(jig[key] !== value) return false;
            }
            return true;
        }));
    } catch (e) {
        next(e);
    }
});

app.post('/jigs/origin/:origin', async (req, res, next) => {
    try {
        const matching = Array.from(jigs.values()).filter(jig => jig.origin === req.params.origin);
        res.json(matching);
    } catch (e) {
        next(e);
    }
});

app.get('/messages/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const message = messges.get(id);
        if (!message) throw new HttpError(404, 'Not Found');
        res.json(message);

    } catch (e) {
        next(e);
    }
});

app.post('/messages', async (req, res, next) => {
    try {
        const message = new SignedMessage(req.body);
        messages.set(message.id, message);
        message.to.forEach((to) => {
            publishEvent(to, 'msg', message);
        });
        message.context.forEach(context => {
            publishEvent(context, 'msg', message);
        })

        publishEvent(message.subject, 'msg', message);
        res.json(true);
    } catch (e) {
        next(e);
    }
});

app.get('/state', async (req, res, next) => {
    try {
        res.json(run.cache.xa);
    } catch (e) {
        next(e);
    }
});

app.get('/state/:key', async (req, res, next) => {
    try {
        const { key } = req.params;
        const value = await cache.get(key);
        if (!value) throw new HttpError(404, 'Not Found');
        res.json(value);
    } catch (e) {
        next(e);
    }
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws, req) => {
    ws.on('message', (message) => {
        const { action, channelId } = JSON.parse(message);

        if (action !== 'subscribe') return;

        events.on(channelId, (id,event,data) => {
            ws.send(JSON.stringify({
                id,
                channel: channelId,
                event,
                data
            }));
        });
    });
});

app.get('/wallet/config', (req, res, next) => {
    console.log(req.headers);
    res.json({
        network: 'testnet',
        // sockets: 'ws://localhost:8082/v1',
        sockets: `${(req.headers['x-forwarded-proto'] || 'http').replace('http', 'ws')}://${req.headers.host}/v1`,
        ephemeral: true,
        emitLogs: true,
        app: 'local',
        errorLog: false
    });
});

app.use('/wallet',express.static(path.join(__dirname, '../client/public')), (req,res,next) => {
    let pathToFile = path.join(__dirname, '../client/public/index.html');

    let data = fs.readFileSync(pathToFile);
    let cType = mime.lookup(pathToFile);

    res.writeHeader(200, { "Content-Type": cType });
    res.write(data);
    res.end();
});

app.get('/txns', async (req, res, next) => {
    res.json(await Promise.all(txns.map(txid => blockchain.fetch(txid))));
});

app.post('/:agentId', async (req, res, next) => {
    const agent = exp.agents[req.params.agentId];
    if(agent && agent.onMessage) {
        const result = await agent.onMessage(req.body);
        res.json(result);
    } else {
        res.sendStatus(204);
    }
})

app.use((err, req, res, next) => {
    console.error(err.message, req.path, err.status !== 404 && err.stack);
    res.status(err.status || 500).send(err.message);
});

let indexWorker;
async function listen(port) {
    indexWorker = await spawn(new Worker('./indexer'));

    return new Promise((resolve, reject) => {
        // const PORT = process.env.PORT || 8082;
        server.listen(port, (err) => {
            if (err) return reject(err);
            console.log(`App listening on port ${port}`);
            console.log('Press Ctrl+C to quit.');
            resolve();
        })
    })
}

async function close() {
    server.close();
}

const exp = module.exports = {
    debug: true,
    agents: {},
    blockchain,
    events,
    listen,
    close,
    initialized: false,
    jigs,
    txns,
    cache,
    publishEvent,
};

blockchain.events.on('txn', async (rawtx) => {
    blockchain.block();
    const tx = Tx.fromHex(rawtx);
    const txid = tx.id();
    txns.push(txid);
});

// // Testing Stuff
// let PORT = process.env.MOCKPORT === undefined ? 8082 : process.env.MOCKPORT;

// (async () => {
//     app.listen(PORT,() => {
//         console.log(`Server listening on port ${PORT}`);
//     })
// })();