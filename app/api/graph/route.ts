import { NextResponse } from 'next/server';
import { buildGraphDataSafeAsync } from '@/lib/graph-builder';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('[API/graph] Request received');
    console.log('[API/graph] Loading graph from JSONL data files');
    
    // Build graph data from real JSONL files
    const graphData = await buildGraphDataSafeAsync(200);
    console.log(`[API/graph] Returning graph with ${graphData.nodes.length} nodes and ${graphData.links.length} edges`);
    return NextResponse.json(graphData);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[API/graph] Failed to load graph:', errorMsg);
    console.error('[API/graph] Stack:', err instanceof Error ? err.stack : 'N/A');
    
    // Return error response
    return NextResponse.json(
      { error: 'Failed to load graph data', details: errorMsg },
      { status: 500 }
    );
  }
}
