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
    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(data);
        console.log('SUCCESS');
        process.exit(0);
      } catch (e) {
        console.log('JSON_ERROR');
        process.exit(1);
      }
    } else {
      console.log('HTTP_' + res.statusCode);
      process.exit(1);
    }
  });
});

req.on('error', () => {
  console.log('CONNECTION_FAILED');
  process.exit(1);
});

setTimeout(() => {
  console.log('TIMEOUT');
  process.exit(1);
}, 5000);

req.end();
