const http = require('http');

function testBillingQuery() {
  const queryData = JSON.stringify({
    message: 'Trace the full flow of billing document 91150187',
    history: []
  });
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(queryData),
    },
  };

  const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        console.log(`\n✓ Chat API Response (Status: ${res.statusCode}):`);
        console.log('---');
        console.log(data);
        console.log('---');
        
        if (res.statusCode === 200) {
          console.log('\n✓ SUCCESS: Chat API returned billing flow trace');
          
          // Check headers for SQL and highlighted nodes
          const sql = res.headers['x-sql'];
          const nodes = res.headers['x-highlighted-nodes'];
          
          if (sql) {
            console.log(`\n✓ SQL Header: ${decodeURIComponent(sql).substring(0, 50)}...`);
          }
          if (nodes) {
            console.log(`✓ Highlighted Nodes: ${decodeURIComponent(nodes)}`);
          }
        } else {
          console.log(`\n✗ API returned status ${res.statusCode}`);
        }
      } catch (err) {
        console.error('Error parsing response:', err.message);
        console.log('Raw data:', data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('✗ Request error:', err.message);
  });

  req.write(queryData);
  req.end();
}

testBillingQuery();
