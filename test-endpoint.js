const https = require('https');

https.get('https://o2c-graph.vercel.app/api/graph', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
}).on('error', err => {
  console.error('Error:', err.message);
});
