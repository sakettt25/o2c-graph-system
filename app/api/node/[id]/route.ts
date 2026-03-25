import { NextResponse } from 'next/server';
import { getNodeDetails } from '@/lib/graph-builder';
import { initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Initialize database
    try {
      await initDb();
      console.log('[API/node] Database initialized');
    } catch (initErr) {
      console.warn('[API/node] Database unavailable for node:', params.id);
      // Return a demo node details if database is unavailable
      const decoded = decodeURIComponent(params.id);
      const parts = decoded.split('_');
      const type = parts[0];
      const id = parts.slice(1).join('_');
      
      const demoNode = {
        id: decoded,
        nodeType: type === 'so' ? 'SalesOrder' : type === 'bill' ? 'BillingDocument' : type === 'del' ? 'Delivery' : type === 'pay' ? 'Payment' : type === 'je' ? 'JournalEntry' : type === 'customer' ? 'Customer' : 'Product',
        label: `${type.toUpperCase()} ${id}`,
        data: { [type === 'customer' || type === 'product' ? 'customer_or_product' : 'id']: id },
      };
      return NextResponse.json(demoNode);
    }

    const decoded = decodeURIComponent(params.id);
    const node = getNodeDetails(decoded);
    if (!node) {
      return NextResponse.json({ error: 'Node not found' }, { status: 404 });
    }
    return NextResponse.json(node);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[API/node] Error:', errorMsg);
    return NextResponse.json({ error: `Failed to fetch node details: ${errorMsg}` }, { status: 500 });
  }
}
