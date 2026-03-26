import { NextRequest, NextResponse } from 'next/server';
import { classifyAndGenerateSQL, generateNaturalLanguageAnswer, extractHighlightedNodes } from '@/lib/gemini';
import { queryDb, initDb } from '@/lib/db';
import { generateOfflineSQLFallback } from '@/lib/offline-llm';
import {
  getBusinessPartners,
  getBillingDocuments,
  getBillingItems,
  getDeliveries,
  getDeliveryItems,
  getPayments,
  getProductDescription,
  getProducts,
  getSalesOrders,
  getJournalEntries,
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

async function buildRowsWithoutDb(message: string, sql: string): Promise<DataRow[] | null> {
  const lowerMessage = message.toLowerCase();
  const lowerSql = sql.toLowerCase();

  const isCountQuery = lowerMessage.includes('how many') || lowerMessage.includes('count');
  const asksSalesOrders = lowerMessage.includes('sales order') || lowerMessage.includes('order');
  const asksBilling = lowerMessage.includes('billing') || lowerMessage.includes('invoice') || lowerMessage.includes('bill');
  const asksDeliveries = lowerMessage.includes('deliver') || lowerMessage.includes('shipment');
  const asksPayments = lowerMessage.includes('payment') || lowerMessage.includes('paid');
  const asksCustomers = lowerMessage.includes('customer') || lowerMessage.includes('business partner');
  const asksProducts = lowerMessage.includes('product') || lowerMessage.includes('material') || lowerMessage.includes('sku');

  if (isCountQuery) {
    if (asksSalesOrders) {
      const salesOrders = await getSalesOrders(10000);
      return [{ metric: 'salesOrders', count: String(salesOrders.length) }];
    }
    if (asksBilling) {
      const billingDocs = await getBillingDocuments(10000);
      return [{ metric: 'billingDocuments', count: String(billingDocs.length) }];
    }
    if (asksDeliveries) {
      const deliveries = await getDeliveries(10000);
      return [{ metric: 'deliveries', count: String(deliveries.length) }];
    }
    if (asksPayments) {
      const payments = await getPayments(10000);
      return [{ metric: 'payments', count: String(payments.length) }];
    }
    if (asksCustomers) {
      const customers = await getBusinessPartners();
      return [{ metric: 'customers', count: String(customers.length) }];
    }
    if (asksProducts) {
      const products = await getProducts(10000);
      return [{ metric: 'products', count: String(products.length) }];
    }
  }

  const isListQuery =
    lowerMessage.includes('list') ||
    lowerMessage.includes('show') ||
    lowerMessage.includes('top') ||
    lowerMessage.includes('latest');

  if (isListQuery && asksSalesOrders) {
    const salesOrders = await getSalesOrders(100);
    return salesOrders.map((so: any) => ({
      salesOrder: so.salesOrder ?? null,
      soldToParty: so.soldToParty ?? null,
      creationDate: so.creationDate ?? null,
      totalNetAmount: so.totalNetAmount ?? null,
      transactionCurrency: so.transactionCurrency ?? null,
    }));
  }

  if (isListQuery && asksBilling) {
    const billingDocs = await getBillingDocuments(100);
    return billingDocs.map((bd: any) => ({
      billingDocument: bd.billingDocument ?? null,
      billingDocumentDate: bd.billingDocumentDate ?? null,
      accountingDocument: bd.accountingDocument ?? null,
      totalNetAmount: bd.totalNetAmount ?? null,
      transactionCurrency: bd.transactionCurrency ?? null,
    }));
  }

  if (isListQuery && asksDeliveries) {
    const deliveries = await getDeliveries(100);
    return deliveries.map((d: any) => ({
      deliveryDocument: d.deliveryDocument ?? null,
      creationDate: d.creationDate ?? null,
      actualGoodsMovementDate: d.actualGoodsMovementDate ?? null,
      shippingPoint: d.shippingPoint ?? null,
      overallGoodsMovementStatus: d.overallGoodsMovementStatus ?? null,
    }));
  }

  const deliveriesWithoutBillingQuery =
    ((lowerMessage.includes('deliver') || lowerMessage.includes('delivery')) &&
      lowerMessage.includes('no billing')) ||
    ((lowerMessage.includes('deliver') || lowerMessage.includes('delivery')) &&
      (lowerMessage.includes('not billed') || lowerMessage.includes('without billing'))) ||
    (lowerSql.includes('outbound_delivery') && lowerSql.includes('billing') && lowerSql.includes('is null'));

  if (deliveriesWithoutBillingQuery) {
    const [deliveries, billingItems] = await Promise.all([
      getDeliveries(10000),
      getBillingItems(10000),
    ]);

    const billedDeliveryIds = new Set<string>();
    for (const item of billingItems) {
      const referenceDelivery = item.referenceSdDocument;
      if (referenceDelivery) billedDeliveryIds.add(referenceDelivery);
    }

    const rows: DataRow[] = [];
    for (const delivery of deliveries) {
      const deliveryId = delivery.deliveryDocument;
      if (!deliveryId) continue;
      if (billedDeliveryIds.has(deliveryId)) continue;

      rows.push({
        deliveryDocument: deliveryId,
        creationDate: delivery.creationDate ?? null,
        actualGoodsMovementDate: delivery.actualGoodsMovementDate ?? null,
        shippingPoint: delivery.shippingPoint ?? null,
        overallGoodsMovementStatus: delivery.overallGoodsMovementStatus ?? null,
        overallPickingStatus: delivery.overallPickingStatus ?? null,
      });
    }

    rows.sort((a, b) => {
      const aDate = a.creationDate ?? '';
      const bDate = b.creationDate ?? '';
      return String(bDate).localeCompare(String(aDate));
    });

    return rows.slice(0, 100);
  }

  const isProductBillingRanking =
    (lowerMessage.includes('product') && lowerMessage.includes('billing') &&
      (lowerMessage.includes('most') || lowerMessage.includes('top') || lowerMessage.includes('highest'))) ||
    (lowerSql.includes('billing_document_items') && lowerSql.includes('group by') && lowerSql.includes('material'));

  if (isProductBillingRanking) {
    const billingItems = await getBillingItems(10000);
    const productToBillDocs = new Map<string, Set<string>>();

    for (const item of billingItems) {
      const productId = item.material;
      const billingDocId = item.billingDocument;
      if (!productId || !billingDocId) continue;

      if (!productToBillDocs.has(productId)) {
        productToBillDocs.set(productId, new Set());
      }
      productToBillDocs.get(productId)?.add(billingDocId);
    }

    const rows: DataRow[] = [];
    for (const [product, billDocs] of productToBillDocs.entries()) {
      const desc = await getProductDescription(product);
      rows.push({
        product,
        productDescription: desc?.productDescription ?? product,
        billingDocumentCount: String(billDocs.size),
      });
    }

    rows.sort((a, b) => {
      const aCount = Number(a.billingDocumentCount ?? '0');
      const bCount = Number(b.billingDocumentCount ?? '0');
      return bCount - aCount;
    });

    return rows.slice(0, 10);
  }

  const linkedJournalLookup =
    (lowerMessage.includes('journal') || lowerMessage.includes('accounting')) &&
    (lowerMessage.includes('linked') || lowerMessage.includes('link') || lowerMessage.includes('find'));

  if (linkedJournalLookup || (lowerSql.includes('journalnumber') && lowerSql.includes('billing_document_headers'))) {
    const idMatch = message.match(/\b(\d{5,})\b/);
    if (!idMatch) return [];

    const targetId = idMatch[1];
    const [billingHeaders, billingItems, deliveryItems, journalEntries] = await Promise.all([
      getBillingDocuments(10000),
      getBillingItems(10000),
      getDeliveryItems(10000),
      getJournalEntries(10000),
    ]);

    const candidateBillingIds = new Set<string>();

    for (const bh of billingHeaders) {
      if (bh.billingDocument === targetId || bh.accountingDocument === targetId) {
        candidateBillingIds.add(bh.billingDocument);
      }
    }

    for (const bi of billingItems) {
      if (bi.referenceSdDocument === targetId || bi.billingDocument === targetId) {
        candidateBillingIds.add(bi.billingDocument);
      }
    }

    for (const di of deliveryItems) {
      if (di.referenceSdDocument === targetId) {
        for (const bi of billingItems) {
          if (bi.referenceSdDocument === di.deliveryDocument) {
            candidateBillingIds.add(bi.billingDocument);
          }
        }
      }
    }

    const journalByAccounting = new Map<string, any>();
    for (const je of journalEntries) {
      if (je.accountingDocument && !journalByAccounting.has(je.accountingDocument)) {
        journalByAccounting.set(je.accountingDocument, je);
      }
    }

    const rows: DataRow[] = [];
    for (const bh of billingHeaders) {
      if (!candidateBillingIds.has(bh.billingDocument)) continue;
      const je = bh.accountingDocument ? journalByAccounting.get(bh.accountingDocument) : null;
      rows.push({
        billingDocument: bh.billingDocument ?? null,
        journalNumber: bh.accountingDocument ?? null,
        postingDate: je?.postingDate ?? null,
        accountingDocumentType: je?.accountingDocumentType ?? null,
      });
    }

    return rows.slice(0, 20);
  }

  return null;
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Initialize database (best effort; fallback path uses JSONL data loader)
    let dbAvailable = true;
    try {
      await initDb();
    } catch (dbErr) {
      dbAvailable = false;
      console.error('[API/chat] DB initialization failed, continuing with JSONL fallback:', dbErr);
    }

    const { message, history = [] } = await req.json() as {
      message: string;
      history: Array<{ role: string; content: string }>;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }

    // Step 1: Classify query and generate SQL
    let classified;
    try {
      const classifiedOrResponse = await withTimeout(
        withLocalBillingTraceFallback(message, () => classifyAndGenerateSQL(message, history)),
        10000,
        'SQL generation'
      );
      if (classifiedOrResponse instanceof Response) return classifiedOrResponse;
      classified = classifiedOrResponse;
    } catch (geminiError) {
      // Always fallback to offline SQL generation to avoid 500 responses
      console.log('[API/chat] Model-based SQL generation failed, using offline LLM fallback:',
        geminiError instanceof Error ? geminiError.message : String(geminiError));
      classified = generateOfflineSQLFallback(message);
    }

    // Handle guardrail / clarify responses
    if (classified.type === 'guardrail' || classified.type === 'clarify') {
      const offlineFallback = generateOfflineSQLFallback(message);
      if (offlineFallback.type === 'data' && offlineFallback.sql) {
        classified = offlineFallback;
      } else {
        return NextResponse.json({
          type: classified.type,
          answer: classified.message,
          sql: null,
          rows: [],
          highlightedNodes: [],
        });
      }
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
      if (dbAvailable) {
        rows = queryDb<Record<string, string | null>>(classified.sql);
      } else {
        const fallbackRows = await buildRowsWithoutDb(message, classified.sql);
        if (fallbackRows) {
          rows = fallbackRows;
        } else {
          return NextResponse.json({
            type: 'error',
            answer:
              'Database engine is temporarily unavailable. I can still answer common O2C list/count/link questions in offline mode—please try rephrasing with explicit entities (sales orders, billing documents, deliveries, payments, customers, or products).',
            sql: classified.sql,
            rows: [],
            highlightedNodes: [],
          });
        }
      }
    } catch (err) {
      const fallbackRows = await buildRowsWithoutDb(message, classified.sql);
      if (fallbackRows) {
        rows = fallbackRows;
      } else {
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
    }

    // Step 3: Extract node IDs to highlight
    const highlightedNodes = extractHighlightedNodes(rows);

    // Step 4: Stream natural language answer
    const sql = classified.sql || '';
    let stream;
    try {
      const streamOrResponse = await withTimeout(
        withLocalBillingTraceFallback(message, () => generateNaturalLanguageAnswer(message, sql, rows, history)),
        10000,
        'Answer generation'
      );
      if (streamOrResponse instanceof Response) return streamOrResponse;
      stream = streamOrResponse;
    } catch (geminiError) {
      // Always fallback: create a simple text response with query results
      console.log('[API/chat] Model-based answer generation failed, using simple fallback response:',
        geminiError instanceof Error ? geminiError.message : String(geminiError));
      const encoder = new TextEncoder();
      const summary = rows.length === 0
        ? 'No results found for your query.'
        : `Found ${rows.length} result(s). Here are the top rows:\n${JSON.stringify(rows.slice(0, 10), null, 2)}`;
      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(summary));
          controller.close();
        },
      });
    }

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
