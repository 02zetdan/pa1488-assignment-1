// Minimal HTTP server for Kubernetes probes. The worker has no other HTTP interface.
const http = require('http');
const TextManager = require('./textManager');
const checkDependencies = require('./readiness');

const HEALTHPORT = 8081;

function startHealthServer() {
    http.createServer((req, res) => {
        if ('/healthz' === req.url) {
            res.writeHead(200);
            return res.end('ok');
        }
        if ('/readyz' === req.url) {
            return checkDependencies(new TextManager())
                .then( () => { res.writeHead(200); res.end('ready'); })
                .catch( err => { res.writeHead(503); res.end('not ready: ' + err.message); });
        }
        res.writeHead(404);
        res.end('not found');
    }).listen(HEALTHPORT, () => console.log('Health endpoints on port', HEALTHPORT));
}

module.exports = startHealthServer;
