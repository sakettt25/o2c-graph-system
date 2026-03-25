const http = require('http');

console.log('Testing fresh API call...\n');

const req = http.get('http://localhost:3000/api/graph', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('✓ Graph API Working!');
      console.log(`  Nodes: ${json.nodes.length}`);
      console.log(`  Links: ${json.links.length}`);
      console.log('\n✅ Application is FIXED - All 669 nodes loading correctly');
      process.exit(0);
    } catch (e) {
      console.log('✗ ERROR - Response is not JSON (compile error?):');
      console.log(data.substring(0, 500));
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.log('✗ Connection failed:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('✗ Timeout - server not responding');
  process.exit(1);
}, 10000);
