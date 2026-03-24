import { queryDb } from './db';
import { GraphData, GraphNode, GraphEdge, NodeType } from './types';

type RawRecord = Record<string, string | null>;

function makeNode(
  id: string,
  nodeType: NodeType,
  label: string,
  data: RawRecord
): GraphNode {
  return { id, nodeType, label, data };
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
