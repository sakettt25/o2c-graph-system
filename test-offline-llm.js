const http = require('http');

const postData = JSON.stringify({
  message: 'Show me all sales orders',
  history: []
});

const options = {
  hostname: 'localhost',
  port: 9001,
  path: '/api/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('\n=== RESPONSE ===');
    try {
      const parsed = JSON.parse(data);
      console.log('Type:', parsed.type);
      console.log('SQL:', parsed.sql);
      console.log('Message:', parsed.message || parsed.answer);
      console.log('Has rows:', !!parsed.rows);
    } catch (e) {
      console.log(data.substring(0, 500));
    }
  });
});

req.on('error', (e) => {
  console.error(`Error: ${e.message}`);
});

req.write(postData);
req.end();
