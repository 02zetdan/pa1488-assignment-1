// Readiness: are MongoDB and Redis reachable right now? Each check is bounded
// because mongoose connects lazily and only gives up after 30 seconds.
const mongoose = require('mongoose');
const RSMQPromise = require('rsmq-promise-native');
const rsmq = new RSMQPromise({host: process.env.REDIS_HOST });

const CHECKTIMEOUT = 2000;

function bounded(promise, name) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(name + ' timed out')), CHECKTIMEOUT);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function checkDependencies(textManager) {
    const mongo = () => (1 === mongoose.connection.readyState
                         ? Promise.resolve()
                         : textManager.connect())
          // listCollections needs an authenticated user when MongoDB runs with --auth; ping does not.
          .then( () => mongoose.connection.db.listCollections({}, {nameOnly: true}).toArray() );
    return Promise.all([ bounded(mongo(), 'MongoDB'),
                         bounded(rsmq.listQueues(), 'Redis') ]);
}

module.exports = checkDependencies;
