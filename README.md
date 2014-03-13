node-http-forwarding
====================

An HTTP server that forwards requests to HTTP or HTTPS endpoints, logging 
requests and responses.


Getting Started
---------------

    npm install
    node server.js --destination=https://api.example.com:5726 --port=8080

This will run the HTTP forwarding server on port 8080 and forward all requests 
to `api.example.com` port `5726`.


Log Format
----------

The method, path, query string, HTTP version, and headers of the request _to 
the forwarding service_ are logged, as are the status code and headers _from 
the destination service._ Following the cURL convention, requests are 
designated with `>` and responses are designated with `<`. Each line is 
prefixed with an identifier for the transaction so that request-response pairs 
can be identified even when other requests or responses interleave in the log. 
For example:

    2> GET /api/articles.json HTTP/1.1
    2> accept: application/json
    2> host: localhost:6377
    2> referer: http://localhost:6377/articles.html
    2> user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_2) <snip>
    2< 200
    2< accept-ranges: bytes
    2< connection: Keep-Alive
    2< content-length: 8249
    2< content-type: application/json
    2< date: Thu, 13 Mar 2014 14:57:37 GMT
    2< etag: "725c0cec-cad6-41a2-9ae5-79d40790673a"
    2< keep-alive: timeout=5, max=100
    2< last-modified: Wed, 12 Mar 2014 13:11:20 GMT
    2< server: Apache-Coyote/1.1
    
