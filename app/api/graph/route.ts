import { NextResponse } from 'next/server';
import { buildGraphDataSafe } from '@/lib/graph-builder';
import { initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Initialize database (but don't fail if it doesn't exist)
    try {
      await initDb();
      console.log('[API/graph] Database initialized');
    } catch (initErr) {
      console.warn('[API/graph] Database initialization failed, will use demo data:', initErr instanceof Error ? initErr.message : String(initErr));
    }

    // Build graph data with fallback to demo data
    const graphData = buildGraphDataSafe(200);
    console.log(`[API/graph] Returning graph with ${graphData.nodes.length} nodes and ${graphData.links.length} edges`);
    return NextResponse.json(graphData);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[API/graph] Critical error:', errorMsg);
    return NextResponse.json(
      { error: `Failed to build graph data: ${errorMsg}` },
      { status: 500 }
    );
  }
}
