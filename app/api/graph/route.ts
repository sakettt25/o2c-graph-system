import { NextResponse } from 'next/server';
import { buildGraphData } from '@/lib/graph-builder';
import { initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
    return NextResponse.json(
      { error: `Database error: ${errorMsg}. The application requires the database file to be deployed.` },
      { status: 500 }
    );
  }
}
