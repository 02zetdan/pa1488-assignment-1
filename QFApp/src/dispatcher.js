const RSMQPromise = require('rsmq-promise-native');
const rsmq = new RSMQPromise({host: process.env.REDIS_HOST });
const RSMQWorker = require('rsmq-worker');

const SEARCHQUEUE = 'searchJob';
const DEFAULTTIMEOUT = 20000;

// Dispatcher manages the job queues
// - Splits a search query into one job per text.
// - dispatch the jobs to the job queue so that workers might pick them up
// - wait for an answer
// - pass the answer on to the web client on the other end of the socket.
//
// For one particular job, there are a couple of message queues:
// - SearchJob :: This is where all jobs are announced
// - ReturnQueue :: Answers are returned to this queue. 
//                  One queue is created for each client, so I am
//                  using 'socket.id' for this queue.

class Dispatcher {
    constructor() {
        if (!process.env.REDIS_HOST) {
            console.log('WARNING: the environment variable REDIS_HOST is not set');
        }

        if (process.env.TIMEOUT) {
            this.TIMEOUT = 1000 * process.env.TIMEOUT;
        } else {
            this.TIMEOUT = DEFAULTTIMEOUT;
        }            
    
        // Resolved when every job has reported DONE, or when the search times out.
        this.finished = new Promise(resolve => this._finish = resolve);

        // A Dispatcher is created per search, so this queue must not be deleted here:
        // that would discard the jobs of every other user.
        rsmq.createQueue({qname: SEARCHQUEUE}).catch(err => {} );
    }

    formatJobs(searchString, texts, queueName) {
        let jobs = [];
        texts.forEach( j => jobs.push({searchString: searchString,
                                       textTitle: j,
                                       returnQueue: queueName}));
        return jobs;
    }

    dispatchSearch(searchString, jobs, socket) {
        console.log('Searching for : ' + searchString);
        this.remaining = jobs.length;
        return this._createQueue(socket.id)
            .then(() => this._startListeners(socket.id, socket))
            .then(() => this._sendJobs(jobs));
    }

    _createQueue(queueName) {
        return rsmq.deleteQueue({qname: queueName})
            .catch(err => {} )
            .then( () => rsmq.createQueue({qname: queueName}))
            .then(done => console.log('Created Message Queue', queueName))
            .catch(err => console.log(err));    
    }

    _startListeners(queueName, socket) {
        console.log('Listening for results on message queue', queueName);
        // The default back-off ([0,1,5,10] s) can sleep through most of the 20 s search timeout.
        let worker = new RSMQWorker(queueName, {host: process.env.REDIS_HOST, interval: [0, 0.1, 0.5, 1] });
        worker.on('message', (msg, next, id) => {
            if ('STARTED' === msg) {
                console.log('someone started working...');
                socket.emit('addWorker');
            } else if ('DONE' === msg) {
                console.log('someone stopped working...');
                socket.emit('removeWorker');
                if (0 === --this.remaining) {
                    socket.emit('complete');
                    this._finish();
                }
            } else {
                socket.emit('answer', msg);
            }
            next();
        });

        worker.start();
        setTimeout( () => { this._cleanup(queueName, socket, worker, 'timeout'); }, this.TIMEOUT);
    }

    _sendJobs(jobs) {
        // Cave! As the number of texts/jobs grow, it will become painful to allocate memory for so many promises.
        let prom = [];
        jobs.forEach( j => prom.push(new Promise( () => {
            // console.log('Creating message for job', j);
            rsmq.sendMessage( {qname: SEARCHQUEUE, message: JSON.stringify(j)} )
                .catch(err => console.log('Could not send job:', err.message));
        })));
        return Promise.all(prom);
    }

    _cleanup(queueName, socket, worker, reason) {
        console.log('cleaning up for reason', reason);
        worker.quit();
        // A later search on the same socket may already have replaced or removed this queue.
        rsmq.deleteQueue({qname: queueName}).catch(err => {} );
        socket.emit('done', {msg: reason} );
        this._finish();
    }

}
module.exports = Dispatcher;
