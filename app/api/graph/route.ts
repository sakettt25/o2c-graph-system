import { NextResponse } from 'next/server';
import { buildGraphData, buildGraphDataSafe } from '@/lib/graph-builder';
import { initDb } from '@/lib/db';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('[API/graph] Request received');
    console.log('[API/graph] CWD:', process.cwd());
    console.log('[API/graph] Expected DB path:', join(process.cwd(), 'data', 'o2c.db'));
    
    // Initialize database - required for real data
    await initDb();
    console.log('[API/graph] Database initialized successfully');

    // Build graph data from real database
    const graphData = buildGraphData(200);
    console.log(`[API/graph] Returning graph with ${graphData.nodes.length} nodes and ${graphData.links.length} edges (real data)`);
    return NextResponse.json(graphData);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[API/graph] Real database failed, using demo fallback:', errorMsg);
    console.error('[API/graph] Stack:', err instanceof Error ? err.stack : 'N/A');
    
    // Fallback to demo data with warning
    const graphData = buildGraphDataSafe(200);
    return NextResponse.json({
      ...graphData,
      _warning: 'Using demo data - real database file not accessible. Expected 200+ nodes but showing 18 demo nodes.'
    });
  }
}
