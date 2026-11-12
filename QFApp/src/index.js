const express = require('express');
const app = express();
const port = 3000;
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const os = require('os');
var path = require('path');

// TextManager manages all the texts in the database
// Dispatcher manages the job queue
const TextManager = require('./textManager');
const Dispatcher = require('./dispatcher');
const checkDependencies = require('./readiness');

const serverIDMessage = ('true' === process.env.SHOW_SERVER_ID)
    ? { message: 'Server id: ' + os.hostname() }
    : {}; // No message

const appVersion = process.env.APP_VERSION || require('../package.json').version;

var activeSearches = 0;
var shuttingDown = false;

// Set up Page Renderer
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
app.use(express.static(path.join(__dirname, 'public')));
app.locals.appVersion = appVersion;

// Define the routes
// --------------------
var router = express.Router();
router.get('/', startPage);
router.get('/add', addTextPage);
router.get('/list', listTextsPage);
router.get('/healthz', (req, res) => res.status(200).send('ok'));
router.get('/readyz', readyCheck);
app.use('/', router);

function startPage(req, res) {
    console.log('Loading start page from: ' + req.hostname);
    return res.render('index', serverIDMessage);
}

function addTextPage(req, res) {
    console.log('Serving the "Add New Text" page...');
    return res.render('addText', serverIDMessage);
}

function listTextsPage(req, res) {
    console.log('Listing available texts.');
    let tm = new TextManager();
    return tm.connect()
        .then( tm.listTexts )
        .then(texts => res.render('index', {textList: texts,
                                                ...serverIDMessage}) );
}

function readyCheck(req, res) {
    if (shuttingDown) {
        return res.status(503).send('not ready: shutting down');
    }
    return checkDependencies(new TextManager())
        .then( () => res.status(200).send('ready') )
        .catch( err => res.status(503).send('not ready: ' + err.message) );
}

// Listen for a client, set up what to do on specific messages on the socket
// --------------------
io.on('connection', socket => {
    console.log('user connected', socket.id);
    socket.emit('clientConnect', {message: 'Welcome, new client'});

    socket.on('search', searchTexts );
    socket.on('addText', addText)    
    socket.on('disconnect', () => { console.log('user disconnected'); });

    // Functions to handle messages from the (web) client
    // And yeah, it is ugly to define these inside another function,
    // but that closures for you. And my inexperience with JavaScript.
    // I suppose I could curry up the socket variable into the method
    // call, but that sounds lime work.
    // --------------------
    function searchTexts(message) {
        // Fetch the available texts from TextManager
        // Let the Dispatcher format them as "jobs"
        // Then dispatch the search
        let tm = new TextManager();
        let dispatcher = new Dispatcher();
        activeSearches++;
        dispatcher.finished.then( () => activeSearches-- );
        return tm.connect()
            .then( tm.listTexts )
            .then( texts => dispatcher.formatJobs(message.search, texts, socket.id) )
            .then( jobs => dispatcher.dispatchSearch(message.search, jobs, socket) );
    }

    function addText(message) {
        let url = message.url || 'https://gutenberg.org/cache/epub/2600/pg2600.txt'
        let title = message.title || 'War and Peace'
        console.log('Adding Text', title, 'from', url);
        return fetch(url)
            .then(res => res.text())
            .then(text => {
                console.log('Fetched text: ', text.substring(1,80))
                let tm = new TextManager();
                return tm.connect()
                    .then( () => tm.addText(title, text) )
            })
            .then( () => socket.emit('textAdded', title) )
            .then(() => console.log('Text added.'))
            .catch( (err) => {
                console.log('Could not add text. Error', err);
                socket.emit('abort', 'Could not add text.');
            });
    }
});

// Simple error handling
// --------------------
// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    console.log('Page not found: ' + req.url);
    err.status = 404;
    next(err);
});

// error handler
app.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    if ('/favicon.ico' != req.url) {        
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        console.log('Error %d, remoteAddress: %s', err.status, ip);
        console.log('If running inside Vagrant, this may give some clues to the callers identity:');
        console.log(req.ip);
        console.log(req.ips);
        console.log(req.hostname);
        console.log(req.headers);   
    }     
    
    // render the error page
    res.status(err.status || 500);
    res.render('error');
});


// Shutdown
// --------------------
// Kubernetes sends SIGTERM when it stops a pod. Node running as PID 1 ignores SIGTERM
// unless there is a handler, and the pod is then killed when the grace period (30 s) runs out.
const SHUTDOWN_DELAY = 5000;  // keep serving while the Service stops sending new requests here
const DRAIN_LIMIT = 20000;    // searches are abandoned after 20 s anyway
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down');
    shuttingDown = true;
    const deadline = Date.now() + SHUTDOWN_DELAY + DRAIN_LIMIT;
    setTimeout(function waitForSearches() {
        if (0 < activeSearches && Date.now() < deadline) {
            return setTimeout(waitForSearches, 200);
        }
        console.log('Exiting,', activeSearches, 'searches still running');
        process.exit(0);
    }, SHUTDOWN_DELAY);
});

// All done, start listening
server.listen(port, () => {
    console.log(`QuoteFinder app listening on port ${port}`);
    console.log('Server id:', os.hostname());
    console.log('Version:', appVersion);
});

