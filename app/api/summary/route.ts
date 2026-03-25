import { NextResponse } from 'next/server';
import { queryDb, initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Initialize database
    await initDb();

    const stats = {
      salesOrders: queryDb<{ cnt: number }>('SELECT COUNT(*) as cnt FROM sales_order_headers')[0]?.cnt ?? 0,
      billingDocuments: queryDb<{ cnt: number }>('SELECT COUNT(*) as cnt FROM billing_document_headers WHERE billingDocumentIsCancelled != \'true\'')[0]?.cnt ?? 0,
      deliveries: queryDb<{ cnt: number }>('SELECT COUNT(*) as cnt FROM outbound_delivery_headers')[0]?.cnt ?? 0,
      payments: queryDb<{ cnt: number }>('SELECT COUNT(*) as cnt FROM payments_accounts_receivable')[0]?.cnt ?? 0,
      customers: queryDb<{ cnt: number }>('SELECT COUNT(*) as cnt FROM business_partners')[0]?.cnt ?? 0,
      products: queryDb<{ cnt: number }>('SELECT COUNT(*) as cnt FROM products')[0]?.cnt ?? 0,
      totalRevenue: queryDb<{ total: number }>('SELECT ROUND(SUM(CAST(totalNetAmount AS REAL)),2) as total FROM billing_document_headers WHERE billingDocumentIsCancelled != \'true\'')[0]?.total ?? 0,
      currency: queryDb<{ cur: string }>('SELECT transactionCurrency as cur FROM billing_document_headers LIMIT 1')[0]?.cur ?? 'INR',
    };
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
