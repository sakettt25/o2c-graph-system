const http = require('http');

function testGraphData() {
  http.get(`http://localhost:3000/api/graph`, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const graphData = JSON.parse(data);
        console.log('✓ Graph API Response verified.');
        console.log(`  Total Nodes: ${graphData.nodes.length}`);
        console.log(`  Total Edges: ${graphData.links.length}`);
        
        // Check if all node data values are strings or null (React-safe)
        console.log('\nChecking data type safety...');
        let safeCount = 0;
        let unsafeNodes = [];
        
        for (const node of graphData.nodes) {
          let nodeHasUnsafeData = false;
          
          for (const [key, value] of Object.entries(node.data || {})) {
            if (typeof value !== 'string' && value !== null && typeof value !== 'undefined') {
              nodeHasUnsafeData = true;
              unsafeNodes.push({
                nodeId: node.id,
                field: key,
                type: typeof value,
                value: String(value).substring(0, 50)
              });
            }
          }
          
          if (!nodeHasUnsafeData) {
            safeCount++;
          }
        }
        
        if (unsafeNodes.length === 0) {
          console.log(`\n✓ SUCCESS: All ${safeCount} nodes have React-safe data (strings/nulls only!)`);
          console.log('  [React Error #31 is FIXED - no objects will be rendered]');
        } else {
          console.log(`\n✗ UNSAFE: Found ${unsafeNodes.length} nodes with non-string data:`);
          unsafeNodes.slice(0, 3).forEach(n => {
            console.log(`    - Node ${n.nodeId}, field ${n.field}: ${n.type} = ${n.value}`);
          });
        }
      } catch (err) {
        console.error('✗ Failed to parse response:', err.message);
      }
    });
  }).on('error', (err) => {
    console.log('✗ API error:', err.message);
  });
}

testGraphData();
