import { NextResponse } from 'next/server';
import { buildGraphData } from '@/lib/graph-builder';
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
    console.error('[API/graph] Critical error - database required:', errorMsg);
    console.error('[API/graph] Stack:', err instanceof Error ? err.stack : 'N/A');
    return NextResponse.json(
      { 
        error: `Database error: ${errorMsg}. The application requires the database file to be deployed.`,
        cwd: process.cwd(),
        env: process.env.DB_PATH ? 'custom DB_PATH set' : 'using default path'
      },
      { status: 500 }
    );
  }
}
