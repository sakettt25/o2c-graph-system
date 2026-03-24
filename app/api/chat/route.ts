import { NextRequest, NextResponse } from 'next/server';
import { classifyAndGenerateSQL, generateNaturalLanguageAnswer, extractHighlightedNodes } from '@/lib/gemini';
import { queryDb } from '@/lib/db';

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

function buildLocalBillingFlowTrace(
  billingDocumentId: string
): { answer: string; sql: string; rows: DataRow[]; highlightedNodes: string[] } | null {
  const billingHeaders = queryDb<DataRow>(
    'SELECT billingDocument, billingDocumentType, billingDocumentDate, totalNetAmount, transactionCurrency, accountingDocument, soldToParty, billingDocumentIsCancelled FROM billing_document_headers WHERE billingDocument = ?',
    [billingDocumentId]
  );

  if (!billingHeaders.length) {
    return null;
  }

  const billingItems = queryDb<DataRow>(
    'SELECT billingDocumentItem, material, billingQuantity, netAmount, referenceSdDocument, referenceSdDocumentItem FROM billing_document_items WHERE billingDocument = ?',
    [billingDocumentId]
  );

  const deliveryIds = uniqueValues(billingItems, 'referenceSdDocument');

  const deliveryHeaders: DataRow[] = [];
  const deliveryItems: DataRow[] = [];

  for (const deliveryId of deliveryIds) {
    deliveryHeaders.push(
      ...queryDb<DataRow>(
        'SELECT deliveryDocument, creationDate, actualGoodsMovementDate, shippingPoint, overallGoodsMovementStatus, overallPickingStatus FROM outbound_delivery_headers WHERE deliveryDocument = ?',
        [deliveryId]
      )
    );

    deliveryItems.push(
      ...queryDb<DataRow>(
        'SELECT deliveryDocument, deliveryDocumentItem, referenceSdDocument, referenceSdDocumentItem, plant, actualDeliveryQuantity FROM outbound_delivery_items WHERE deliveryDocument = ?',
        [deliveryId]
      )
    );
  }

  const salesOrderIds = uniqueValues(deliveryItems, 'referenceSdDocument');

  const salesOrderHeaders: DataRow[] = [];

  for (const salesOrderId of salesOrderIds) {
    salesOrderHeaders.push(
      ...queryDb<DataRow>(
        'SELECT salesOrder, soldToParty, creationDate, totalNetAmount, transactionCurrency, overallDeliveryStatus, overallOrdReltdBillgStatus FROM sales_order_headers WHERE salesOrder = ?',
        [salesOrderId]
      )
    );
  }

  const accountingDocumentIds = uniqueValues(billingHeaders, 'accountingDocument');

  const journalEntries: DataRow[] = [];
  const payments: DataRow[] = [];

  for (const accountingDocumentId of accountingDocumentIds) {
    journalEntries.push(
      ...queryDb<DataRow>(
        'SELECT accountingDocument, accountingDocumentItem, postingDate, accountingDocumentType, glAccount, amountInTransactionCurrency, transactionCurrency, referenceDocument FROM journal_entry_items WHERE accountingDocument = ?',
        [accountingDocumentId]
      )
    );

    payments.push(
      ...queryDb<DataRow>(
        'SELECT accountingDocument, accountingDocumentItem, postingDate, clearingDate, amountInTransactionCurrency, transactionCurrency, customer FROM payments_accounts_receivable WHERE accountingDocument = ?',
        [accountingDocumentId]
      )
    );
  }

  const rows: DataRow[] = [];

  for (const salesOrderHeader of salesOrderHeaders) {
    rows.push({
      step: 'SalesOrder',
      id: getValue(salesOrderHeader, 'salesOrder'),
      relatedId: getValue(salesOrderHeader, 'soldToParty'),
      date: getValue(salesOrderHeader, 'creationDate'),
      amount: getValue(salesOrderHeader, 'totalNetAmount'),
      currency: getValue(salesOrderHeader, 'transactionCurrency'),
      status: getValue(salesOrderHeader, 'overallDeliveryStatus'),
    });
  }

  for (const deliveryHeader of deliveryHeaders) {
    rows.push({
      step: 'Delivery',
      id: getValue(deliveryHeader, 'deliveryDocument'),
      relatedId: getValue(deliveryHeader, 'shippingPoint'),
      date: getValue(deliveryHeader, 'creationDate'),
      amount: null,
      currency: null,
      status: getValue(deliveryHeader, 'overallGoodsMovementStatus'),
    });
  }

  for (const billingHeader of billingHeaders) {
    rows.push({
      step: 'BillingDocument',
      id: getValue(billingHeader, 'billingDocument'),
      relatedId: getValue(billingHeader, 'accountingDocument'),
      date: getValue(billingHeader, 'billingDocumentDate'),
      amount: getValue(billingHeader, 'totalNetAmount'),
      currency: getValue(billingHeader, 'transactionCurrency'),
      status: getValue(billingHeader, 'billingDocumentIsCancelled'),
    });
  }

  for (const journalEntry of journalEntries) {
    rows.push({
      step: 'JournalEntry',
      id: getValue(journalEntry, 'accountingDocument'),
      relatedId: getValue(journalEntry, 'glAccount'),
      date: getValue(journalEntry, 'postingDate'),
      amount: getValue(journalEntry, 'amountInTransactionCurrency'),
      currency: getValue(journalEntry, 'transactionCurrency'),
      status: getValue(journalEntry, 'accountingDocumentType'),
    });
  }

  for (const payment of payments) {
    rows.push({
      step: 'Payment',
      id: getValue(payment, 'accountingDocument'),
      relatedId: getValue(payment, 'customer'),
      date: getValue(payment, 'clearingDate'),
      amount: getValue(payment, 'amountInTransactionCurrency'),
      currency: getValue(payment, 'transactionCurrency'),
      status: getValue(payment, 'postingDate'),
    });
  }

  const highlightedNodes = [
    ...salesOrderIds.map((id) => `so_${id}`),
    ...deliveryIds.map((id) => `del_${id}`),
    `bill_${billingDocumentId}`,
    ...accountingDocumentIds.map((id) => `je_${id}`),
    ...accountingDocumentIds.map((id) => `pay_${id}`),
  ];

  const salesOrderText = salesOrderIds.length ? `SO ${salesOrderIds.join(', ')}` : 'SO not found';
  const deliveryText = deliveryIds.length ? `DEL ${deliveryIds.join(', ')}` : 'Delivery not found';
  const journalText = accountingDocumentIds.length
    ? `JE ${accountingDocumentIds.join(', ')}`
    : 'JE not found';
  const paymentText = payments.length ? ` → PAY ${accountingDocumentIds.join(', ')}` : '';

  const billingAmount = getValue(billingHeaders[0], 'totalNetAmount');
  const billingCurrency = getValue(billingHeaders[0], 'transactionCurrency');

  const answer = [
    `Dodge AI is unavailable, so I used local SQL fallback for billing document ${billingDocumentId}.`,
    `Flow: ${salesOrderText} → ${deliveryText} → BILL ${billingDocumentId} → ${journalText}${paymentText}.`,
    billingAmount && billingCurrency
      ? `Billing amount: ${billingAmount} ${billingCurrency}.`
      : 'Billing amount not available.',
  ].join(' ');

  const sql = [
    '-- local fallback: billing trace',
    'SELECT ... FROM billing_document_headers WHERE billingDocument = ?;',
    'SELECT ... FROM billing_document_items WHERE billingDocument = ?;',
    'SELECT ... FROM outbound_delivery_headers WHERE deliveryDocument = ?;',
    'SELECT ... FROM outbound_delivery_items WHERE deliveryDocument = ?;',
    'SELECT ... FROM sales_order_headers WHERE salesOrder = ?;',
    'SELECT ... FROM journal_entry_items WHERE accountingDocument = ?;',
    'SELECT ... FROM payments_accounts_receivable WHERE accountingDocument = ?;',
  ].join('\n');

  return { answer, sql, rows, highlightedNodes };
}

function tryLocalBillingTraceFallback(message: string): Response | null {
  const billingDocumentId = extractBillingFlowTraceDocumentId(message);
  if (!billingDocumentId) return null;

  const traceResult = buildLocalBillingFlowTrace(billingDocumentId);
  if (!traceResult) {
    return NextResponse.json(
      {
        type: 'error',
        answer: `Could not find billing document ${billingDocumentId} in local data.`,
        sql: null,
        rows: [],
        highlightedNodes: [],
      },
      { status: 404 }
    );
  }

  return toTextResponse(
    traceResult.answer,
    traceResult.sql,
    traceResult.rows,
    traceResult.highlightedNodes
  );
}

async function withLocalBillingTraceFallback<T>(
  message: string,
  action: () => Promise<T>
): Promise<T | Response> {
  try {
    return await action();
  } catch (err) {
    const fallbackResponse = tryLocalBillingTraceFallback(message);
    if (fallbackResponse) return fallbackResponse;
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
      const fallbackResponse = tryLocalBillingTraceFallback(message);
      if (fallbackResponse) return fallbackResponse;
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
      const fallbackResponse = tryLocalBillingTraceFallback(message);
      if (fallbackResponse) return fallbackResponse;
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
    const streamOrResponse = await withLocalBillingTraceFallback(message, () =>
      generateNaturalLanguageAnswer(message, classified.sql, rows, history)
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
