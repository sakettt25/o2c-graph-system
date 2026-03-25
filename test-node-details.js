const http = require('http');

// Test a specific node detail endpoint to ensure sanitization works
function testNodeDetails() {
  // Test with a known sales order ID format
  const testNodeId = encodeURIComponent('so_5100000000');
  
  http.get(`http://localhost:3000/api/node/${testNodeId}`, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const node = JSON.parse(data);
        console.log('✓ Node Details Response:');
        console.log(`  ID: ${node.id}`);
        console.log(`  Type: ${node.nodeType}`);
        console.log(`  Label: ${node.label}`);
        console.log(`  Data keys: ${Object.keys(node.data || {}).slice(0, 5).join(', ')}`);
        
        // Check if all data values are strings or null
        const dataObj = node.data || {};
        let allSafe = true;
        let unsafeFields = [];
        
        for (const [key, value] of Object.entries(dataObj)) {
          if (typeof value !== 'string' && value !== null) {
            allSafe = false;
            unsafeFields.push(`${key}: ${typeof value}`);
          }
        }
        
        if (allSafe) {
          console.log(`\n✓ SUCCESS: All data values are safe strings or null (no objects/arrays)`);
        } else {
          console.log(`\n✗ UNSAFE: Found ${unsafeFields.length} non-string fields:`);
          unsafeFields.forEach(f => console.log(`    - ${f}`));
        }
      } catch (err) {
        console.error('✗ Failed to parse response:', err.message);
      }
    });
  }).on('error', (err) => {
    console.log('✗ Connection error (dev server may not be running yet):', err.message);
  });
}

testNodeDetails();
