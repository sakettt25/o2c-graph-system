import { queryDb } from './db';
import { GraphData, GraphNode, GraphEdge, NodeType } from './types';
import {
  getBusinessPartners,
  getSalesOrders,
  getSalesOrderItems,
  getDeliveries,
  getDeliveryItems,
  getBillingDocuments,
  getBillingItems,
  getJournalEntries,
  getPayments,
  getProducts,
  getBusinessPartner,
  getProduct,
  getProductDescription,
} from './data-loader';

type RawRecord = Record<string, string | null>;

function makeNode(
  id: string,
  nodeType: NodeType,
  label: string,
  data: RawRecord
): GraphNode {
  return { id, nodeType, label, data };
}

export async function buildGraphDataRealAsync(limit = 200): Promise<GraphData> {
  const nodes: GraphNode[] = [];
  const links: GraphEdge[] = [];
  const nodeSet = new Set<string>();

  const addNode = (n: GraphNode) => {
    if (!nodeSet.has(n.id)) {
      nodeSet.add(n.id);
      nodes.push(n);
    }
  };

  const addEdge = (source: string, target: string, type: string, label: string) => {
    if (nodeSet.has(source) && nodeSet.has(target)) {
      links.push({ source, target, type, label });
    }
  };

  try {
    // --- Business Partners / Customers ---
    const customers = await getBusinessPartners();
    for (const c of customers.slice(0, 50)) {
      const id = `customer_${c.customer ?? c.businessPartner}`;
      addNode(makeNode(id, 'Customer', c.businessPartnerFullName ?? c.businessPartnerName ?? `Customer ${c.customer}`, c));
    }

    // --- Sales Orders ---
    const salesOrders = await getSalesOrders(limit);
    for (const so of salesOrders) {
      const id = `so_${so.salesOrder}`;
      addNode(makeNode(id, 'SalesOrder', `SO ${so.salesOrder}`, so));
      // Edge to customer
      const custId = `customer_${so.soldToParty}`;
      if (nodeSet.has(custId)) {
        links.push({ source: custId, target: id, type: 'PLACED', label: 'placed' });
      }
    }

    // --- Products ---
    const products = await getProducts(100);
    for (const p of products) {
      if (p.product) {
        const id = `product_${p.product}`;
        const desc = await getProductDescription(p.product);
        const label = desc?.productDescription ?? p.product ?? 'Product';
        const data = { ...p, productDescription: label };
        addNode(makeNode(id, 'Product', label, data));
      }
    }

    // --- Sales Order Items (edges SO→Product) ---
    const soItems = await getSalesOrderItems(300);
    const soItemsMap = new Map<string, Set<string>>();
    for (const item of soItems) {
      if (item.salesOrder && item.material) {
        const key = `${item.salesOrder}_${item.material}`;
        soItemsMap.set(key, new Set());
      }
    }
    for (const [key] of soItemsMap) {
      const [so, mat] = key.split('_');
      const soId = `so_${so}`;
      const prodId = `product_${mat}`;
      if (nodeSet.has(soId) && nodeSet.has(prodId)) {
        links.push({ source: soId, target: prodId, type: 'CONTAINS', label: 'contains' });
      }
    }

    // --- Deliveries ---
    const deliveries = await getDeliveries(limit);
    for (const d of deliveries) {
      const id = `del_${d.deliveryDocument}`;
      addNode(makeNode(id, 'Delivery', `DEL ${d.deliveryDocument}`, d));
    }

    // Delivery items → link to SO
    const delItems = await getDeliveryItems(300);
    for (const di of delItems) {
      const delId = `del_${di.deliveryDocument}`;
      const soId = `so_${di.referenceSdDocument}`;
      if (nodeSet.has(delId) && nodeSet.has(soId)) {
        links.push({ source: soId, target: delId, type: 'FULFILLED_BY', label: 'fulfilled by' });
      }
    }

    // --- Billing Documents ---
    const billings = await getBillingDocuments(limit);
    for (const b of billings) {
      if (b.billingDocumentIsCancelled !== 'true') {
        const id = `bill_${b.billingDocument}`;
        addNode(makeNode(id, 'BillingDocument', `BILL ${b.billingDocument}`, b));
      }
    }

    // Billing items → link to Delivery
    const billItems = await getBillingItems(400);
    for (const bi of billItems) {
      const billId = `bill_${bi.billingDocument}`;
      const delId = `del_${bi.referenceSdDocument}`;
      if (nodeSet.has(billId) && nodeSet.has(delId)) {
        links.push({ source: delId, target: billId, type: 'BILLED_AS', label: 'billed as' });
      }
    }

    // --- Journal Entries ---
    const journals = await getJournalEntries(limit);
    for (const j of journals) {
      const id = `je_${j.accountingDocument}`;
      if (!nodeSet.has(id)) {
        addNode(makeNode(id, 'JournalEntry', `JE ${j.accountingDocument}`, j));
      }
    }

    // --- Payments ---
    const payments = await getPayments(limit);
    const addedPayDocs = new Set<string>();
    for (const p of payments) {
      const payDocId = `pay_${p.accountingDocument}`;
      if (!addedPayDocs.has(payDocId)) {
        addedPayDocs.add(payDocId);
        if (!nodeSet.has(payDocId)) {
          addNode(makeNode(payDocId, 'Payment', `PAY ${p.accountingDocument}`, p));
        }
      }
    }

    console.log(`[buildGraphDataRealAsync] Built graph with ${nodes.length} nodes and ${links.length} edges from real data`);
    return { nodes, links: deduplicateLinks(links) };
  } catch (err) {
    console.error('[buildGraphDataRealAsync] Error building real graph:', err);
    throw err;
  }
}

export function buildGraphData(limit = 200): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphEdge[] = [];
  const nodeSet = new Set<string>();

  const addNode = (n: GraphNode) => {
    if (!nodeSet.has(n.id)) {
      nodeSet.add(n.id);
      nodes.push(n);
    }
  };

  const addEdge = (source: string, target: string, type: string, label: string) => {
    if (nodeSet.has(source) && nodeSet.has(target)) {
      links.push({ source, target, type, label });
    }
  };

  // --- Business Partners / Customers ---
  const customers = queryDb<RawRecord>('SELECT * FROM business_partners LIMIT 50');
  for (const c of customers) {
    const id = `customer_${c.customer ?? c.businessPartner}`;
    addNode(makeNode(id, 'Customer', c.businessPartnerFullName ?? c.businessPartnerName ?? `Customer ${c.customer}`, c));
  }

  // --- Sales Orders ---
  const salesOrders = queryDb<RawRecord>(`SELECT * FROM sales_order_headers LIMIT ${limit}`);
  for (const so of salesOrders) {
    const id = `so_${so.salesOrder}`;
    addNode(makeNode(id, 'SalesOrder', `SO ${so.salesOrder}`, so));
    // Edge to customer
    const custId = `customer_${so.soldToParty}`;
    if (nodeSet.has(custId)) {
      links.push({ source: custId, target: id, type: 'PLACED', label: 'placed' });
    }
  }

  // --- Products ---
  const products = queryDb<RawRecord>('SELECT p.*, pd.productDescription FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = \'EN\' LIMIT 100');
  for (const p of products) {
    const id = `product_${p.product}`;
    addNode(makeNode(id, 'Product', p.productDescription ?? p.product ?? 'Product', p));
  }

  // --- Sales Order Items (edges SO→Product) ---
  const soItems = queryDb<RawRecord>('SELECT DISTINCT salesOrder, material FROM sales_order_items WHERE material IS NOT NULL LIMIT 300');
  for (const item of soItems) {
    const soId = `so_${item.salesOrder}`;
    const prodId = `product_${item.material}`;
    if (nodeSet.has(soId) && nodeSet.has(prodId)) {
      links.push({ source: soId, target: prodId, type: 'CONTAINS', label: 'contains' });
    }
  }

  // --- Deliveries ---
  const deliveries = queryDb<RawRecord>(`SELECT * FROM outbound_delivery_headers LIMIT ${limit}`);
  for (const d of deliveries) {
    const id = `del_${d.deliveryDocument}`;
    addNode(makeNode(id, 'Delivery', `DEL ${d.deliveryDocument}`, d));
  }

  // Delivery items → link to SO
  const delItems = queryDb<RawRecord>('SELECT DISTINCT deliveryDocument, referenceSdDocument FROM outbound_delivery_items WHERE referenceSdDocument IS NOT NULL LIMIT 300');
  for (const di of delItems) {
    const delId = `del_${di.deliveryDocument}`;
    const soId = `so_${di.referenceSdDocument}`;
    if (nodeSet.has(delId) && nodeSet.has(soId)) {
      links.push({ source: soId, target: delId, type: 'FULFILLED_BY', label: 'fulfilled by' });
    }
  }

  // --- Billing Documents ---
  // Real chain: SO → Delivery → Billing (billing_items.referenceSdDocument = deliveryDocument)
  const billings = queryDb<RawRecord>(`SELECT * FROM billing_document_headers WHERE billingDocumentIsCancelled != 'true' LIMIT ${limit}`);
  for (const b of billings) {
    const id = `bill_${b.billingDocument}`;
    addNode(makeNode(id, 'BillingDocument', `BILL ${b.billingDocument}`, b));
  }

  // Billing items → link to Delivery (referenceSdDocument = deliveryDocument)
  const billItems = queryDb<RawRecord>('SELECT DISTINCT billingDocument, referenceSdDocument FROM billing_document_items WHERE referenceSdDocument IS NOT NULL LIMIT 400');
  for (const bi of billItems) {
    const billId = `bill_${bi.billingDocument}`;
    const delId = `del_${bi.referenceSdDocument}`;
    if (nodeSet.has(billId) && nodeSet.has(delId)) {
      links.push({ source: delId, target: billId, type: 'BILLED_AS', label: 'billed as' });
    }
  }

  // --- Journal Entries ---
  // Billing.accountingDocument = JE.accountingDocument
  const journals = queryDb<RawRecord>(`
    SELECT DISTINCT je.accountingDocument, je.glAccount, je.transactionCurrency,
      je.amountInTransactionCurrency, je.postingDate, je.companyCode, je.fiscalYear,
      je.accountingDocumentType, bdh.billingDocument as linkedBillingDoc
    FROM journal_entry_items je
    JOIN billing_document_headers bdh ON je.accountingDocument = bdh.accountingDocument
    LIMIT ${limit}
  `);
  for (const j of journals) {
    const id = `je_${j.accountingDocument}`;
    if (!nodeSet.has(id)) {
      addNode(makeNode(id, 'JournalEntry', `JE ${j.accountingDocument}`, j));
    }
    // Link Billing → JE
    if (j.linkedBillingDoc) {
      const billId = `bill_${j.linkedBillingDoc}`;
      if (nodeSet.has(billId) && !links.find(l => l.source === billId && l.target === id)) {
        links.push({ source: billId, target: id, type: 'POSTED_TO', label: 'posted to' });
      }
    }
  }

  // --- Payments ---
  // payments.accountingDocument is its own FI document (AR clearing)
  const payments = queryDb<RawRecord>(`SELECT * FROM payments_accounts_receivable LIMIT ${limit}`);
  const addedPayDocs = new Set<string>();
  for (const p of payments) {
    // Deduplicate by accountingDocument
    const payDocId = `pay_${p.accountingDocument}`;
    if (!addedPayDocs.has(payDocId)) {
      addedPayDocs.add(payDocId);
      const id = payDocId;
      if (!nodeSet.has(id)) {
        addNode(makeNode(id, 'Payment', `PAY ${p.accountingDocument}`, p));
      }
      // Link Payment → JE (AR clearing documents appear in journal_entry_items too)
      const jeId = `je_${p.accountingDocument}`;
      if (nodeSet.has(jeId)) {
        links.push({ source: jeId, target: id, type: 'CLEARED_BY', label: 'cleared by' });
      }
      // Link Payment → SO if salesDocument present
      if (p.salesDocument) {
        const soId = `so_${p.salesDocument}`;
        if (nodeSet.has(soId)) {
          links.push({ source: soId, target: id, type: 'PAID_VIA', label: 'paid via' });
        }
      }
    }
  }

  // Final: add delayed edges for nodes that were added after initial edge attempts
  // Re-run delivery→SO and billing→SO for completeness
  const finalLinks = deduplicateLinks(links);

  return { nodes, links: finalLinks };
}

function deduplicateLinks(links: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return links.filter(l => {
    const src = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
    const tgt = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
    const key = `${src}->${tgt}->${l.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getNodeDetails(nodeId: string): GraphNode | null {
  const parts = nodeId.split('_');
  const prefix = parts[0];
  const id = parts.slice(1).join('_');

  let row: RawRecord | undefined;
  let nodeType: NodeType;
  let label: string;

  if (prefix === 'so') {
    const rows = queryDb<RawRecord>('SELECT soh.*, COUNT(soi.salesOrderItem) as itemCount FROM sales_order_headers soh LEFT JOIN sales_order_items soi ON soh.salesOrder = soi.salesOrder WHERE soh.salesOrder = ? GROUP BY soh.salesOrder', [id]);
    row = rows[0];
    nodeType = 'SalesOrder';
    label = `SO ${id}`;
  } else if (prefix === 'bill') {
    const rows = queryDb<RawRecord>('SELECT * FROM billing_document_headers WHERE billingDocument = ?', [id]);
    row = rows[0];
    nodeType = 'BillingDocument';
    label = `BILL ${id}`;
  } else if (prefix === 'del') {
    const rows = queryDb<RawRecord>('SELECT * FROM outbound_delivery_headers WHERE deliveryDocument = ?', [id]);
    row = rows[0];
    nodeType = 'Delivery';
    label = `DEL ${id}`;
  } else if (prefix === 'pay') {
    const rows = queryDb<RawRecord>('SELECT * FROM payments_accounts_receivable WHERE accountingDocument = ? LIMIT 1', [id]);
    row = rows[0];
    nodeType = 'Payment';
    label = `PAY ${id}`;
  } else if (prefix === 'je') {
    const rows = queryDb<RawRecord>('SELECT * FROM journal_entry_items WHERE accountingDocument = ? LIMIT 1', [id]);
    row = rows[0];
    nodeType = 'JournalEntry';
    label = `JE ${id}`;
  } else if (prefix === 'customer') {
    const rows = queryDb<RawRecord>('SELECT * FROM business_partners WHERE customer = ?', [id]);
    row = rows[0];
    nodeType = 'Customer';
    label = row?.businessPartnerFullName ?? `Customer ${id}`;
  } else if (prefix === 'product') {
    const rows = queryDb<RawRecord>('SELECT p.*, pd.productDescription FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = \'EN\' WHERE p.product = ?', [id]);
    row = rows[0];
    nodeType = 'Product';
    label = row?.productDescription ?? id;
  } else {
    return null;
  }

  if (!row) return null;
  return { id: nodeId, nodeType, label, data: row };
}

export async function getNodeDetailsAsync(nodeId: string): Promise<GraphNode | null> {
  const parts = nodeId.split('_');
  const prefix = parts[0];
  const id = parts.slice(1).join('_');

  let row: RawRecord | undefined;
  let nodeType: NodeType;
  let label: string;

  if (prefix === 'so') {
    const salesOrders = await getSalesOrders(10000);
    row = salesOrders.find((so: any) => so.salesOrder === id) as RawRecord | undefined;
    nodeType = 'SalesOrder';
    label = `SO ${id}`;
  } else if (prefix === 'bill') {
    const billings = await getBillingDocuments(10000);
    row = billings.find((b: any) => b.billingDocument === id) as RawRecord | undefined;
    nodeType = 'BillingDocument';
    label = `BILL ${id}`;
  } else if (prefix === 'del') {
    const deliveries = await getDeliveries(10000);
    row = deliveries.find((d: any) => d.deliveryDocument === id) as RawRecord | undefined;
    nodeType = 'Delivery';
    label = `DEL ${id}`;
  } else if (prefix === 'pay') {
    const payments = await getPayments(10000);
    row = payments.find((p: any) => p.accountingDocument === id) as RawRecord | undefined;
    nodeType = 'Payment';
    label = `PAY ${id}`;
  } else if (prefix === 'je') {
    const journals = await getJournalEntries(10000);
    row = journals.find((j: any) => j.accountingDocument === id) as RawRecord | undefined;
    nodeType = 'JournalEntry';
    label = `JE ${id}`;
  } else if (prefix === 'customer') {
    row = (await getBusinessPartner(id)) as RawRecord | undefined;
    nodeType = 'Customer';
    label = row?.businessPartnerFullName ?? `Customer ${id}`;
  } else if (prefix === 'product') {
    row = (await getProduct(id)) as RawRecord | undefined;
    const desc = await getProductDescription(id);
    nodeType = 'Product';
    label = desc?.productDescription ?? row?.product ?? id;
  } else {
    return null;
  }

  if (!row) return null;
  return { id: nodeId, nodeType, label, data: row };
}

/**
 * Generate demo/fallback graph data when database is unavailable
 * O2C Flow: Customer → SO → Delivery → Billing → JE → Payment
 */
export function buildDemoGraphData(): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphEdge[] = [];

  // Customers
  const customers = [
    { id: 'customer_CUST001', name: 'Acme Corporation', data: { customer: 'CUST001', businessPartnerFullName: 'Acme Corporation' } },
    { id: 'customer_CUST002', name: 'Global Tech Industries', data: { customer: 'CUST002', businessPartnerFullName: 'Global Tech Industries' } },
    { id: 'customer_CUST003', name: 'Future Systems Ltd', data: { customer: 'CUST003', businessPartnerFullName: 'Future Systems Ltd' } },
  ];
  customers.forEach(c => nodes.push({ id: c.id, nodeType: 'Customer', label: c.name, data: c.data }));

  // Products
  const products = [
    { id: 'product_P001', name: 'Premium Widget A', data: { product: 'P001', productDescription: 'Premium Widget A' } },
    { id: 'product_P002', name: 'Standard Widget B', data: { product: 'P002', productDescription: 'Standard Widget B' } },
    { id: 'product_P003', name: 'Component X Pro', data: { product: 'P003', productDescription: 'Component X Pro' } },
  ];
  products.forEach(p => nodes.push({ id: p.id, nodeType: 'Product', label: p.name, data: p.data }));

  // Complete O2C flow for Customer 1
  // SO001 → DEL001 → BILL001 → JE001 → PAY001
  nodes.push(
    { id: 'so_SO001', nodeType: 'SalesOrder', label: 'SO SO001', data: { salesOrder: 'SO001', soldToParty: 'CUST001', creationDate: '2026-03-20' } },
    { id: 'del_DEL001', nodeType: 'Delivery', label: 'DEL DEL001', data: { deliveryDocument: 'DEL001', referenceSdDocument: 'SO001' } },
    { id: 'bill_BILL001', nodeType: 'BillingDocument', label: 'BILL BILL001', data: { billingDocument: 'BILL001', referenceSdDocument: 'DEL001', totalNetAmount: '45000' } },
    { id: 'je_JE001', nodeType: 'JournalEntry', label: 'JE JE001', data: { accountingDocument: 'JE001', linkedBillingDoc: 'BILL001', amountInTransactionCurrency: '45000' } },
    { id: 'pay_PAY001', nodeType: 'Payment', label: 'PAY PAY001', data: { accountingDocument: 'PAY001', salesDocument: 'SO001' } }
  );

  // Links for flow 1
  links.push(
    { source: 'customer_CUST001', target: 'so_SO001', type: 'PLACED', label: 'placed' },
    { source: 'so_SO001', target: 'product_P001', type: 'CONTAINS', label: 'contains' },
    { source: 'so_SO001', target: 'del_DEL001', type: 'FULFILLED_BY', label: 'fulfilled by' },
    { source: 'del_DEL001', target: 'bill_BILL001', type: 'BILLED_AS', label: 'billed as' },
    { source: 'bill_BILL001', target: 'je_JE001', type: 'POSTED_TO', label: 'posted to' },
    { source: 'je_JE001', target: 'pay_PAY001', type: 'CLEARED_BY', label: 'cleared by' },
    { source: 'so_SO001', target: 'pay_PAY001', type: 'PAID_VIA', label: 'paid via' }
  );

  // Complete O2C flow for Customer 2
  // SO002 → DEL002 → BILL002 → JE002 → PAY002
  nodes.push(
    { id: 'so_SO002', nodeType: 'SalesOrder', label: 'SO SO002', data: { salesOrder: 'SO002', soldToParty: 'CUST002', creationDate: '2026-03-21' } },
    { id: 'del_DEL002', nodeType: 'Delivery', label: 'DEL DEL002', data: { deliveryDocument: 'DEL002', referenceSdDocument: 'SO002' } },
    { id: 'bill_BILL002', nodeType: 'BillingDocument', label: 'BILL BILL002', data: { billingDocument: 'BILL002', referenceSdDocument: 'DEL002', totalNetAmount: '32500' } },
    { id: 'je_JE002', nodeType: 'JournalEntry', label: 'JE JE002', data: { accountingDocument: 'JE002', linkedBillingDoc: 'BILL002', amountInTransactionCurrency: '32500' } },
    { id: 'pay_PAY002', nodeType: 'Payment', label: 'PAY PAY002', data: { accountingDocument: 'PAY002', salesDocument: 'SO002' } }
  );

  links.push(
    { source: 'customer_CUST002', target: 'so_SO002', type: 'PLACED', label: 'placed' },
    { source: 'so_SO002', target: 'product_P002', type: 'CONTAINS', label: 'contains' },
    { source: 'so_SO002', target: 'del_DEL002', type: 'FULFILLED_BY', label: 'fulfilled by' },
    { source: 'del_DEL002', target: 'bill_BILL002', type: 'BILLED_AS', label: 'billed as' },
    { source: 'bill_BILL002', target: 'je_JE002', type: 'POSTED_TO', label: 'posted to' },
    { source: 'je_JE002', target: 'pay_PAY002', type: 'CLEARED_BY', label: 'cleared by' },
    { source: 'so_SO002', target: 'pay_PAY002', type: 'PAID_VIA', label: 'paid via' }
  );

  // Partial O2C flow for Customer 3 (SO with multiple products, still in delivery)
  // SO003 → DEL003 (not yet billed)
  nodes.push(
    { id: 'so_SO003', nodeType: 'SalesOrder', label: 'SO SO003', data: { salesOrder: 'SO003', soldToParty: 'CUST003', creationDate: '2026-03-22' } },
    { id: 'del_DEL003', nodeType: 'Delivery', label: 'DEL DEL003', data: { deliveryDocument: 'DEL003', referenceSdDocument: 'SO003' } }
  );

  links.push(
    { source: 'customer_CUST003', target: 'so_SO003', type: 'PLACED', label: 'placed' },
    { source: 'so_SO003', target: 'product_P001', type: 'CONTAINS', label: 'contains' },
    { source: 'so_SO003', target: 'product_P003', type: 'CONTAINS', label: 'contains' },
    { source: 'so_SO003', target: 'del_DEL003', type: 'FULFILLED_BY', label: 'fulfilled by' }
  );

  return { nodes, links };
}

/**
 * Safely build graph data with fallback to demo data if database unavailable
 */
export async function buildGraphDataSafeAsync(limit = 200): Promise<GraphData> {
  try {
    // Try to load real data from JSONL files
    return await buildGraphDataRealAsync(limit);
  } catch (err) {
    console.warn('[buildGraphDataSafeAsync] Real data loading failed, using demo data:', err);
    return buildDemoGraphData();
  }
}

export function buildGraphDataSafe(limit = 200): GraphData {
  try {
    return buildGraphData(limit);
  } catch (err) {
    console.warn('[buildGraphDataSafe] Database unavailable, using demo data:', err);
    return buildDemoGraphData();
  }
}
