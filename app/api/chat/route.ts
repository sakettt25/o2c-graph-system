import { NextRequest, NextResponse } from 'next/server';
import { classifyAndGenerateSQL, generateNaturalLanguageAnswer, extractHighlightedNodes } from '@/lib/gemini';
import { queryDb, initDb } from '@/lib/db';
import {
  getBillingDocuments,
  getBillingItems,
  getDeliveries,
  getDeliveryItems,
  getSalesOrders,
  getJournalEntries,
  getPayments,
} from '@/lib/data-loader';

export const dynamic = 'force-dynamic';

type DataRow = Record<string, string | null>;

function getValue(row: DataRow, key: string): string | null {
  return row[key] ?? null;
}

function uniqueValues(rows: DataRow[], key: string): string[] {
  const values = rows.map((row) => getValue(row, key)).filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
}

function toTextResponse(
  answer: string,
  sql: string,
  rows: DataRow[],
  highlightedNodes: string[]
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(answer));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-SQL': encodeURIComponent(sql),
      'X-Row-Count': String(rows.length),
      'X-Highlighted-Nodes': encodeURIComponent(JSON.stringify(highlightedNodes)),
      'X-Rows-Preview': encodeURIComponent(JSON.stringify(rows.slice(0, 50))),
    },
  });
}

function extractBillingFlowTraceDocumentId(message: string): string | null {
  const lower = message.toLowerCase();
  if (!lower.includes('billing document')) return null;
  if (!lower.includes('trace') && !lower.includes('flow')) return null;

  const billingTraceRegex = /billing\s+document\s+(\d{5,})/i;
  const match = billingTraceRegex.exec(message);
  return match?.[1] ?? null;
}

async function buildLocalBillingFlowTraceAsync(
  billingDocumentId: string
): Promise<{ answer: string; sql: string; rows: DataRow[]; highlightedNodes: string[] } | null> {
  try {
    // Load all billing documents and find the one we need
    const allBillingDocs = await getBillingDocuments(10000);
    const billingHeader = allBillingDocs.find((b: any) => b.billingDocument === billingDocumentId);
    
    if (!billingHeader) {
      return null;
    }

    // Load all necessary data
    const [allBillingItems, allDeliveries, allDeliveryItems, allSalesOrders, allJournalEntries, allPayments] = 
      await Promise.all([
        getBillingItems(10000),
        getDeliveries(10000),
        getDeliveryItems(10000),
        getSalesOrders(10000),
        getJournalEntries(10000),
        getPayments(10000),
      ]);

    // Find related records
    const billingItems = allBillingItems.filter((item: any) => item.billingDocument === billingDocumentId);
    const deliveryIds = [...new Set(billingItems.map((item: any) => item.referenceSdDocument).filter(Boolean))];
    
    const deliveryHeaders = allDeliveries.filter((d: any) => deliveryIds.includes(d.deliveryDocument));
    const deliveryItems = allDeliveryItems.filter((item: any) => deliveryIds.includes(item.deliveryDocument));
    
    const salesOrderIds = [...new Set(deliveryItems.map((item: any) => item.referenceSdDocument).filter(Boolean))];
    const salesOrderHeaders = allSalesOrders.filter((so: any) => salesOrderIds.includes(so.salesOrder));
    
    const accountingDocumentId = billingHeader.accountingDocument;
    const journalEntries = accountingDocumentId 
      ? allJournalEntries.filter((je: any) => je.accountingDocument === accountingDocumentId)
      : [];
    const payments = accountingDocumentId 
      ? allPayments.filter((p: any) => p.accountingDocument === accountingDocumentId)
      : [];

    // Build response rows
    const rows: DataRow[] = [];

    for (const so of salesOrderHeaders) {
      rows.push({
        step: 'SalesOrder',
        id: so.salesOrder,
        relatedId: so.soldToParty,
        date: so.creationDate,
        amount: String(so.totalNetAmount ?? ''),
        currency: so.transactionCurrency,
        status: so.overallDeliveryStatus,
      });
    }

    for (const delivery of deliveryHeaders) {
      rows.push({
        step: 'Delivery',
        id: delivery.deliveryDocument,
        relatedId: delivery.shippingPoint,
        date: delivery.creationDate,
        amount: null,
        currency: null,
        status: delivery.overallGoodsMovementStatus,
      });
    }

    rows.push({
      step: 'BillingDocument',
      id: billingHeader.billingDocument,
      relatedId: billingHeader.accountingDocument || 'None',
      date: billingHeader.billingDocumentDate,
      amount: String(billingHeader.totalNetAmount ?? ''),
      currency: billingHeader.transactionCurrency,
      status: billingHeader.billingDocumentIsCancelled === 'true' ? 'Cancelled' : 'Active',
    });

    for (const je of journalEntries) {
      rows.push({
        step: 'JournalEntry',
        id: je.accountingDocument,
        relatedId: je.glAccount,
        date: je.postingDate,
        amount: String(je.amountInTransactionCurrency ?? ''),
        currency: je.transactionCurrency,
        status: je.accountingDocumentType,
      });
    }

    for (const payment of payments) {
      rows.push({
        step: 'Payment',
        id: payment.accountingDocument,
        relatedId: payment.customer,
        date: payment.clearingDate,
        amount: String(payment.amountInTransactionCurrency ?? ''),
        currency: payment.transactionCurrency,
        status: payment.postingDate,
      });
    }

    const highlightedNodes = [
      ...salesOrderIds.map((id) => `so_${id}`),
      ...deliveryIds.map((id) => `del_${id}`),
      `bill_${billingDocumentId}`,
      ...(accountingDocumentId ? [`je_${accountingDocumentId}`, `pay_${accountingDocumentId}`] : []),
    ];

    const salesOrderText = salesOrderIds.length ? `SO ${salesOrderIds.join(', ')}` : 'No sales orders found';
    const deliveryText = deliveryIds.length ? `DEL ${deliveryIds.join(', ')}` : 'No deliveries found';
    const journalText = accountingDocumentId ? `JE ${accountingDocumentId}` : 'No journal entry found';
    const paymentText = payments.length ? ` → PAY ${accountingDocumentId}` : '';

    const answer = [
      `Full O2C flow trace for billing document ${billingDocumentId}:`,
      `Flow: ${salesOrderText} → ${deliveryText} → BILL ${billingDocumentId} → ${journalText}${paymentText}.`,
      billingHeader.totalNetAmount && billingHeader.transactionCurrency
        ? `Billing amount: ${billingHeader.totalNetAmount} ${billingHeader.transactionCurrency}.`
        : 'Billing amount not available.',
    ].join(' ');

    const sql = [
      '-- O2C flow trace from billing document',
      'SELECT ... FROM billing_document_headers WHERE billingDocument = ?;',
      'SELECT ... FROM billing_document_items WHERE billingDocument = ?;',
      'SELECT ... FROM outbound_delivery_headers WHERE deliveryDocument IN (...);',
      'SELECT ... FROM outbound_delivery_items WHERE deliveryDocument IN (...);',
      'SELECT ... FROM sales_order_headers WHERE salesOrder IN (...);',
      'SELECT ... FROM journal_entry_items WHERE accountingDocument = ?;',
      'SELECT ... FROM payments_accounts_receivable WHERE accountingDocument = ?;',
    ].join('\n');

    return { answer, sql, rows, highlightedNodes };
  } catch (err) {
    console.error('[API/chat] Error building billing flow trace:', err);
    return null;
  }
}

function tryLocalBillingTraceFallback(message: string): Response | null {
  // Note: This is now deprecated. Use buildLocalBillingFlowTraceAsync instead
  return null;
}

async function withLocalBillingTraceFallback<T>(
  message: string,
  action: () => Promise<T>
): Promise<T | Response> {
  try {
    return await action();
  } catch (err) {
    // Try to extract billing document ID and trace the flow
    const billingDocId = extractBillingFlowTraceDocumentId(message);
    if (billingDocId) {
      const fallbackResponse = await buildLocalBillingFlowTraceAsync(billingDocId);
      if (fallbackResponse) {
        return toTextResponse(
          fallbackResponse.answer,
          fallbackResponse.sql,
          fallbackResponse.rows,
          fallbackResponse.highlightedNodes
        );
      }
    }
    throw err;
  }
}

function mapGeminiErrorToResponse(message: string): NextResponse | null {
  const lower = message.toLowerCase();

  if (lower.includes('429') || lower.includes('too many requests') || lower.includes('resource_exhausted')) {
    return NextResponse.json(
      {
        error:
          'Dodge AI API rate limit/quota exceeded. Please wait a minute and retry, or use a different API key/project quota.',
      },
      { status: 429 }
    );
  }

  if (lower.includes('no compatible gemini model found') || lower.includes('not_found') || lower.includes('model')) {
    return NextResponse.json(
      {
        error:
          'Dodge AI model is not available. Please check your API configuration and try again.',
      },
      { status: 502 }
    );
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    // Initialize database
    await initDb();

    const { message, history = [] } = await req.json() as {
      message: string;
      history: Array<{ role: string; content: string }>;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }

    // Step 1: Classify query and generate SQL
    const classifiedOrResponse = await withLocalBillingTraceFallback(message, () =>
      classifyAndGenerateSQL(message, history)
    );
    if (classifiedOrResponse instanceof Response) return classifiedOrResponse;
    const classified = classifiedOrResponse;

    // Handle guardrail / clarify responses
    if (classified.type === 'guardrail' || classified.type === 'clarify') {
      return NextResponse.json({
        type: classified.type,
        answer: classified.message,
        sql: null,
        rows: [],
        highlightedNodes: [],
      });
    }

    if (!classified.sql) {
      const billingDocId = extractBillingFlowTraceDocumentId(message);
      if (billingDocId) {
        const fallbackResponse = await buildLocalBillingFlowTraceAsync(billingDocId);
        if (fallbackResponse) {
          return toTextResponse(
            fallbackResponse.answer,
            fallbackResponse.sql,
            fallbackResponse.rows,
            fallbackResponse.highlightedNodes
          );
        }
      }
      return NextResponse.json({
        type: 'error',
        answer: 'Could not generate a query for this question. Please rephrase.',
        sql: null,
        rows: [],
        highlightedNodes: [],
      });
    }

    // Step 2: Execute SQL safely
    let rows: Record<string, string | null>[] = [];
    let sqlError: string | null = null;

    // Safety check - only allow SELECT
    const cleanSql = classified.sql.trim().toUpperCase();
    if (!cleanSql.startsWith('SELECT') && !cleanSql.startsWith('WITH')) {
      return NextResponse.json({
        type: 'guardrail',
        answer: 'Only SELECT queries are permitted.',
        sql: classified.sql,
        rows: [],
        highlightedNodes: [],
      });
    }

    try {
      rows = queryDb<Record<string, string | null>>(classified.sql);
    } catch (err) {
      // Try billing flow trace as fallback
      const billingDocId = extractBillingFlowTraceDocumentId(message);
      if (billingDocId) {
        const fallbackResponse = await buildLocalBillingFlowTraceAsync(billingDocId);
        if (fallbackResponse) {
          return toTextResponse(
            fallbackResponse.answer,
            fallbackResponse.sql,
            fallbackResponse.rows,
            fallbackResponse.highlightedNodes
          );
        }
      }
      sqlError = err instanceof Error ? err.message : String(err);
      // Try to fix simple errors and retry with a fallback
      return NextResponse.json({
        type: 'error',
        answer: `Query execution error: ${sqlError}. Please try rephrasing your question.`,
        sql: classified.sql,
        rows: [],
        highlightedNodes: [],
      });
    }

    // Step 3: Extract node IDs to highlight
    const highlightedNodes = extractHighlightedNodes(rows);

    // Step 4: Stream natural language answer
    const sql = classified.sql || '';
    const streamOrResponse = await withLocalBillingTraceFallback(message, () =>
      generateNaturalLanguageAnswer(message, sql, rows, history)
    );
    if (streamOrResponse instanceof Response) return streamOrResponse;
    const stream = streamOrResponse;

    // Return streaming response with metadata in headers
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-SQL': encodeURIComponent(classified.sql),
        'X-Row-Count': String(rows.length),
        'X-Highlighted-Nodes': encodeURIComponent(JSON.stringify(highlightedNodes)),
        'X-Rows-Preview': encodeURIComponent(JSON.stringify(rows.slice(0, 50))),
      },
    });
  } catch (err) {
    console.error('Chat API error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';

    const mappedResponse = mapGeminiErrorToResponse(message);
    if (mappedResponse) return mappedResponse;

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
