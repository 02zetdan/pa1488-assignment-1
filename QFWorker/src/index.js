const RSMQPromise = require('rsmq-promise-native');
const rsmq = new RSMQPromise({host: process.env.REDIS_HOST });
var RSMQWorker = require('rsmq-worker');
const TextManager = require('./textManager');
const ActiveSearchStrategy = require('./searchStrategyBuilder')();
const startHealthServer = require('./health');

const SEARCHQUEUE = 'searchJob';
var MAXTHREADS = 10;

// Setup
// --------------------
if (process.env.MAXTHREADS) {
    MAXTHREADS = process.env.MAXTHREADS;
}

if (!process.env.REDIS_HOST) {
    console.log('WARNING: the environment variable REDIS_HOST is not set');
}

// The default back-off ([0,1,5,10] s) can sleep through most of the 20 s search timeout.
var worker = new RSMQWorker(SEARCHQUEUE, {host: process.env.REDIS_HOST, interval: [0, 0.1, 0.5, 1]});

// Timeout watchdog
// --------------------
const HBINTERVAL = 60000;
function keepAlive() {
    console.log('Connected to queue', SEARCHQUEUE, ':', worker.queue.connected);
    setTimeout(keepAlive, HBINTERVAL);
}
keepAlive() // Comment this line to remove these status messages.

// Start listening for jobs on SEARCHQUEUE
// ========================================
var busy = 0;
worker.on('message', (msg, next, id) => {
    busy++;
    let job = JSON.parse(msg);
    console.log(SEARCHQUEUE,job.searchString, 'in Text', job.textTitle);
    let textManager = new TextManager();
    let textSearcher = new ActiveSearchStrategy();
    // textSearcher.testSearch();

    return textManager.connect()
        .then( () => rsmq.sendMessage( {qname: job.returnQueue, message: 'STARTED'}))
        .then( () => textManager.startSearch(job, MAXTHREADS, textSearcher))
        .then( result => result.flat() )
        .then ( result => {
            console.log('Number of results:', result.length);
            result.forEach(r => {
                let cleanedResult = r.replace(/[\n\r]/g, ' ').trim();
                rsmq.sendMessage( {qname: job.returnQueue, message: JSON.stringify({ textTitle: job.textTitle,
                                                                                     contents: cleanedResult })})
                    .catch(err => console.log('Could not return result:', err.message))})}) // This is starting to look a lot like lisp, don't you think?
        .then( () => rsmq.sendMessage( {qname: job.returnQueue, message: 'DONE'}))
        .catch( err => console.log('Failed during search. Continuing...'))
        .then( () => { busy--; next(); });
});

worker.on('error', (err, msg) => {
    console.log('Error', err, msg);
});

// Shutdown
// --------------------
// Node running as PID 1 ignores SIGTERM unless there is a handler. Stop taking jobs,
// finish the current one (searches are abandoned after 20 s anyway), then exit.
const DRAIN_LIMIT = 20000;
process.on('SIGTERM', () => {
    console.log('SIGTERM received, finishing the current job');
    worker.stop();
    const deadline = Date.now() + DRAIN_LIMIT;
    (function waitForJob() {
        if (0 < busy && Date.now() < deadline) {
            return setTimeout(waitForJob, 200);
        }
        console.log('Exiting,', busy, 'jobs still running');
        process.exit(0);
    })();
});

worker.start();
console.log('Worker started...');
console.log('Version:', process.env.APP_VERSION || require('../package.json').version);
startHealthServer();
