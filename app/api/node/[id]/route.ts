import { NextResponse } from 'next/server';
import { getNodeDetailsAsync } from '@/lib/graph-builder';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = decodeURIComponent(params.id);
    console.log('[API/node] Fetching node details for:', decoded);
    
    const node = await getNodeDetailsAsync(decoded);
    if (!node) {
      console.warn('[API/node] Node not found:', decoded);
      return NextResponse.json({ error: 'Node not found' }, { status: 404 });
    }
    
    return NextResponse.json(node);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[API/node] Error:', errorMsg);
    return NextResponse.json({ error: `Failed to fetch node details: ${errorMsg}` }, { status: 500 });
  }
}
