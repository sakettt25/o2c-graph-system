const http = require('http');
const fs = require('fs');

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
    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(data);
        fs.writeFileSync('test-result.txt', `SUCCESS: ${json.nodes.length} nodes loaded\n`);
        process.exit(0);
      } catch (e) {
        fs.writeFileSync('test-result.txt', `JSON_ERROR: Compile failed\n`);
        process.exit(1);
      }
    } else {
      fs.writeFileSync('test-result.txt', `ERROR: HTTP ${res.statusCode}\n`);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  fs.writeFileSync('test-result.txt', `CONNECTION_ERROR: ${e.message}\n`);
  process.exit(1);
});

setTimeout(() => {
  fs.writeFileSync('test-result.txt', `TIMEOUT\n`);
  process.exit(1);
}, 10000);

req.end();
