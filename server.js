var http = require('http'),
    https = require('https'),
    url = require('url'),
    minimist = require('minimist'),
    _ = require('underscore');

////////////////////////////////////////////////////////////////////////////////
// SETUP

// parse the command line
var argv = minimist(process.argv.slice(2));
var destination = argv.destination;
var port = parseInt(argv.port) || 6377;

// enforce required command line arguments
if (typeof destination !== 'string') {
  console.error('Usage: ');
  console.error('   ', process.argv[0], process.argv[1], '--destination=PROXY_TO_URL [--port=PORT]');
  console.error('');
  console.error('Example: ');
  console.error('   ', process.argv[0], process.argv[1], '--destination=https://api.example.com');
  console.error('');
  process.exit(1);
}

////////////////////////////////////////////////////////////////////////////////
// DATA CLEANSING

// strip the trailing / off the destination, if present, to prevent sending the 
// destination `GET //path/to/content` instead of `GET /path/to/content`
if (/\/$/.test(destination)) destination = destination.substring(0,destination.length-1);

////////////////////////////////////////////////////////////////////////////////
// FUNCTIONS

// All of the HTTP headers that come from Node's http module are lower-case. We 
// want to convert them back to their correct case before sending them to the 
// destination when making the request or to the client when returning the 
// response; e.g., 'content-length' should be 'Content-Length'.
var capitalizeHeaders = function(headers) {
  var capitalized = {};

  var headerKVPs = _.pairs(headers);
  _.each(headerKVPs, function(kvp) {
    var header = kvp[0];
    var value  = kvp[1];
    
    // most headers can be fixed just by capitalizing the first letter of each 
    // part; e.g., 'content-type' becomes 'Content-Type'
    var name = header.replace(/\b[a-z]/g, function(match) { return match.toUpperCase(); });
    
    // some headers do not follow that pattern and must be handled specially
    if (header ==='content-md5') {
      name = 'Content-MD5';
    } else if (header === 'dnt') {
      name = 'DNT';
    } else if (header === 'p3p') {
      name = 'P3P'
    } else if (header === 'te') {
      name = 'TE';
    } else if (header === 'www-authenticate') {
      name = 'WWW-Authenticate';
    } else if (header === 'x-att-deviceid') {
      name = 'X-ATT-DeviceId';
    } else if (header === 'x-ua-compatible') {
      name = 'X-UA-Compatible';
    } else if (header === 'x-webkit-csp') {
      name = 'X-WebKit-CSP';
    } else if (header === 'x-xss-protection') {
      name = 'X-XSS-Protection';
    }
    
    capitalized[name] = value;
  });
  
  return capitalized;
};

// Log the request method, path, query parameters, HTTP version, and headers.
// Example:
// 36> GET /service/1.0/locales/en-CA/products/RT/markets/statistics HTTP/1.1
// 36> host: 192.168.0.42:6377
// 36> referer: http://192.168.0.42:6377/smartphone/market-top-ten.html
// 36> accept-encoding: gzip, deflate
// 36> accept: application/json, text/plain, */*
// 36> accept-language: en-us
// 36> connection: keep-alive
// 36> user-agent: Morningstar for iPhone/3.0.0 (iPod touch, iPhone OS, 7.1)
var logRequest = function(reqID, req) {
  console.log('' + reqID + '>', req.method + ' ' + req.url + ' HTTP/' + req.httpVersion);
  var headerNames = _.keys(req.headers).sort();
  _.each(headerNames, function(name) {
    console.log('' + reqID + '>', name + ': ' + req.headers[name]);
  });
};

// Log the response status code and headers.
// Example:
// 36< 200
// 36< date: Thu, 13 Mar 2014 00:18:39 GMT
// 36< server: Apache-Coyote/1.1
// 36< cache-control: public, max-age=60
// 36< vary: Accept-Encoding
// 36< transid: e0b41f6e-5bbd-4191-af73-f787dbb0f011
// 36< content-encoding: gzip
// 36< content-type: application/json;charset=utf-8
// 36< content-length: 4740
// 36< accept-ranges: bytes
// 36< x-varnish: 2654529556
// 36< age: 0
// 36< via: 1.1 varnish
// 36< x-cache: MISS
// 36< keep-alive: timeout=5, max=100
// 36< connection: Keep-Alive
var logResponse = function(reqID, res) {
  console.log('' + reqID + '<', res.statusCode);
  
  var headerNames = _.keys(res.headers).sort();
  _.each(headerNames, function(name) {
    console.log('' + reqID + '<', name + ': ' + res.headers[name]);
  });
};

// Request and response headers like Host, Referer, Origin, and 
// Access-Control-Allow-Origin include the hostname (and possibly port) in 
// their values, which need to be updated appropriately. On requests, the 
// values are updated from specifying this server to specifying the 
// destination. On responses, it is reversed: the destination's name is updated 
// to be this server's name.
var translateHostInHeaders = function(headers, options) {
  var fromHostOnly = (options.from.indexOf(':') >= 0) ? options.from.split(':')[0] : options.from;
  var fromHostPort = options.from;
  
  var toHostOnly = (options.to.indexOf(':') >= 0) ? options.to.split(':')[0] : options.to;
  var toHostPort = options.to;
  
  var headerKVPs = _.pairs(headers);
  _.each(headerKVPs, function(kvp) {
    var header = kvp[0];
    var fromValue  = kvp[1];
    
    if (typeof fromValue === 'string') {
      var toValue = fromValue.replace(fromHostPort, toHostPort).replace(fromHostOnly, toHostOnly);
      if (fromValue !== toValue) headers[header] = toValue;
    }
  });
};

////////////////////////////////////////////////////////////////////////////////
// RUN THE SERVER

// each client request gets uniquely identified so that request/response pairs 
// can be matched up later, in case multiple requests were made before any 
// responses returned, or responses were returned out of order, etc.
var nextRequestID = 1;

// configure the server
var server = http.createServer(function(req, res) {
  // grab the current request ID and increment the counter for the next ID
  var reqID = nextRequestID;
  nextRequestID += 1;
  
  // log the request from the client
  logRequest(reqID , req);
  
  // extract the information required to make the request to the destination
  var destinationURL = url.parse(destination + req.url);
  var destinationHeaders = capitalizeHeaders(req.headers);
  var destinationMethod = req.method;
  var destinationProtocol = (destinationURL.protocol === 'https:') ? https : http;
  
  // extract the original and destination host and port for header 
  // substitutions
  var origHostPort = req.headers.host;
  var destHostPort = destinationURL.host || destinationURL.hostname;
  
  // update the request headers that may contain references to this server 
  // instead of the destination
  translateHostInHeaders(destinationHeaders, { from: origHostPort, to: destHostPort });
  
  // prepare and make the request
  var options = _.clone(destinationURL);
  options.headers = destinationHeaders;
  options.method = destinationMethod;
  var destinationReq = destinationProtocol.request(options, function(destinationRes) {
    // log the response from the destination
    logResponse(reqID, destinationRes);
    
    // extract and cleanup the response headers so that they can be passed 
    // through to the client
    var resHeaders = capitalizeHeaders(destinationRes.headers);
    translateHostInHeaders(resHeaders, { from: destHostPort, to: origHostPort });
    
    // send the response status code, headers, and body to the client
    res.writeHead(destinationRes.statusCode, resHeaders);
    destinationRes.pipe(res);
  });
  
  // send any request body along to the destination
  req.pipe(destinationReq);
});

// start the server!
console.error('Listening on port ' + port);
server.listen(port);
