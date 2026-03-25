#!/usr/bin/env node
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/graph',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const report = {
        timestamp: new Date().toISOString(),
        status: 'SUCCESS',
        statusCode: res.statusCode,
        nodeCount: json.nodes.length,
        edgeCount: json.links.length,
        nodeTypes: json.nodeTypes || {}
      };
      console.log(JSON.stringify(report, null, 2));
    } catch (e) {
      const report = { 
        timestamp: new Date().toISOString(),
        status: 'PARSE_ERROR',
        statusCode: res.statusCode,
        error: e.message
      };
      console.log(JSON.stringify(report, null, 2));
    }
  });
});

req.on('error', (e) => {
  const report = {
    timestamp: new Date().toISOString(),
    status: 'CONNECTION_ERROR',
    error: e.message
  };
  console.log(JSON.stringify(report, null, 2));
});

setTimeout(() => {
  const report = {
    timestamp: new Date().toISOString(),
    status: 'TIMEOUT'
  };
  console.log(JSON.stringify(report, null, 2));
}, 10000);

req.end();
