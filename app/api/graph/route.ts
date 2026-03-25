import { NextResponse } from 'next/server';
import { buildGraphData } from '@/lib/graph-builder';
import { initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Initialize database
    await initDb();

    const graphData = buildGraphData(200);
    return NextResponse.json(graphData);
  } catch (err) {
    console.error('Graph API error:', err);
    return NextResponse.json({ error: 'Failed to build graph data' }, { status: 500 });
  }
}
