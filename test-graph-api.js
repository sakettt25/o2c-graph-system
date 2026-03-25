// Test script to check graph API response
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/graph',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const graph = JSON.parse(data);
      console.log('✓ Graph API Response:');
      console.log(`  Nodes: ${graph.nodes?.length || 0}`);
      console.log(`  Edges: ${graph.links?.length || 0}`);
      console.log(`  Node Types:`);
      
      const types = {};
      for (const node of (graph.nodes || [])) {
        types[node.nodeType] = (types[node.nodeType] || 0) + 1;
      }
      Object.entries(types).forEach(([type, count]) => {
        console.log(`    ${type}: ${count}`);
      });
      
      if (graph._warning) {
        console.log(`\n  ⚠ Warning: ${graph._warning}`);
      }
      
      if (graph.nodes?.length > 20) {
        console.log('\n✓ SUCCESS: Graph is using REAL data (more than 20 nodes!)');
      } else {
        console.log('\n✗ ISSUE: Graph might be using demo data (18 nodes or less)');
      }
    } catch (e) {
      console.error('Failed to parse response:', e.message);
      console.log('Response:', data.substring(0, 200));
    }
  });
});

req.on('error', (error) => {
  console.error('Request failed:', error.message);
  console.error('Is the dev server running on port 3000?');
});

console.log('Testing graph API...');
req.end();
