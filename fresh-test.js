const http = require('http');
const fs = require('fs');

const testFile = 'fresh-test-output.txt';
fs.writeFileSync(testFile, 'START\n');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/graph',
  method: 'GET',
  timeout: 8000
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    let output = '';
    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(data);
        output = `SUCCESS: ${json.nodes.length} nodes, ${json.links.length} edges\n`;
      } catch (e) {
        output = `PARSE_ERROR:` + e.message + '\n';
      }
    } else {
      output = `HTTP_ERROR: ${res.statusCode}\n`;
    }
    fs.appendFileSync(testFile, output);
    fs.appendFileSync(testFile, 'END\n');
    process.exit(0);
  });
});

req.on('error', (e) => {
  fs.appendFileSync(testFile, `CONNECTION_ERROR: ${e.message}\n`);
  fs.appendFileSync(testFile, 'END\n');
  process.exit(1);
});

setTimeout(() => {
  fs.appendFileSync(testFile, `TIMEOUT\n`);
  fs.appendFileSync(testFile, 'END\n');
  process.exit(1);
}, 10000);

req.end();
