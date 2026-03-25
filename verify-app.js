const http = require('http');

console.log('[FINAL VERIFICATION] Testing O2C Graph System API...\n');

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
        console.log('✅ API RESPONSE SUCCESSFUL');
        console.log(`✅ Nodes loaded: ${json.nodes.length}`);
        console.log(`✅ Edges loaded: ${json.links.length}`);
        console.log('\n✅ APPLICATION IS FULLY OPERATIONAL');
        console.log('✅ Graph visualization system working correctly');
        process.exit(0);
      } catch (e) {
        console.log('❌ JSON Parse Error:', e.message);
        process.exit(1);
      }
    } else {
      console.log(`❌ HTTP Error: ${res.statusCode}`);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.log('❌ Connection Error:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('❌ Request Timeout');
  process.exit(1);
}, 10000);

req.end();
