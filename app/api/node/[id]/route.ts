import { NextResponse } from 'next/server';
import { getNodeDetails } from '@/lib/graph-builder';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = decodeURIComponent(params.id);
    const node = getNodeDetails(decoded);
    if (!node) {
      return NextResponse.json({ error: 'Node not found' }, { status: 404 });
    }
    return NextResponse.json(node);
  } catch (err) {
    console.error('Node detail API error:', err);
    return NextResponse.json({ error: 'Failed to fetch node details' }, { status: 500 });
  }
}
