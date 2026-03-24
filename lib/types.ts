export type NodeType =
  | 'SalesOrder'
  | 'BillingDocument'
  | 'Delivery'
  | 'Payment'
  | 'JournalEntry'
  | 'Customer'
  | 'Product';

export interface GraphNode {
  id: string;
  nodeType: NodeType;
  label: string;
  data: Record<string, string | null>;
  // 3d-force-graph runtime fields
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  __highlighted?: boolean;
  __dimmed?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  rows?: Record<string, string | null>[];
  highlightedNodes?: string[];
  timestamp: number;
  isStreaming?: boolean;
}

export const NODE_COLORS: Record<NodeType, string> = {
  SalesOrder:      '#3b82f6', // blue
  BillingDocument: '#10b981', // emerald
  Delivery:        '#f59e0b', // amber
  Payment:         '#8b5cf6', // violet
  JournalEntry:    '#ec4899', // pink
  Customer:        '#14b8a6', // teal
  Product:         '#f97316', // orange
};

export const NODE_SIZES: Record<NodeType, number> = {
  Customer:        14,
  SalesOrder:      8,
  BillingDocument: 7,
  Delivery:        7,
  Payment:         6,
  JournalEntry:    6,
  Product:         5,
};

export const DB_SCHEMA = `
Tables and columns:
- sales_order_headers: salesOrder(PK), salesOrderType, soldToParty(→business_partners.customer), creationDate, totalNetAmount, overallDeliveryStatus, overallOrdReltdBillgStatus, transactionCurrency, requestedDeliveryDate
- sales_order_items: salesOrder(FK→sales_order_headers), salesOrderItem, material(FK→products), requestedQuantity, netAmount, productionPlant, storageLocation, materialGroup
- billing_document_headers: billingDocument(PK), billingDocumentType, creationDate, billingDocumentDate, totalNetAmount, transactionCurrency, companyCode, fiscalYear, accountingDocument(→journal_entry_items.accountingDocument), soldToParty(→business_partners.customer), billingDocumentIsCancelled
- billing_document_items: billingDocument(FK→billing_document_headers), billingDocumentItem, material(FK→products), billingQuantity, netAmount, referenceSdDocument(FK→outbound_delivery_headers.deliveryDocument), referenceSdDocumentItem
- outbound_delivery_headers: deliveryDocument(PK), shippingPoint, creationDate, actualGoodsMovementDate, overallGoodsMovementStatus, overallPickingStatus
- outbound_delivery_items: deliveryDocument(FK→outbound_delivery_headers), deliveryDocumentItem, plant, actualDeliveryQuantity, storageLocation, referenceSdDocument(FK→sales_order_headers.salesOrder), referenceSdDocumentItem
- payments_accounts_receivable: accountingDocument, accountingDocumentItem, companyCode, fiscalYear, clearingDate, amountInTransactionCurrency, transactionCurrency, amountInCompanyCodeCurrency, companyCodeCurrency, customer(FK→business_partners.customer), salesDocument(FK→sales_order_headers.salesOrder), postingDate, glAccount
- journal_entry_items: accountingDocument, accountingDocumentItem, companyCode, fiscalYear, glAccount, transactionCurrency, amountInTransactionCurrency, amountInCompanyCodeCurrency, companyCodeCurrency, postingDate, documentDate, accountingDocumentType, customer, clearingDate, clearingAccountingDocument
- business_partners: businessPartner(PK), customer(unique), businessPartnerFullName, businessPartnerName, businessPartnerCategory, industry, organizationBpName1
- products: product(PK), productType, productGroup, baseUnit, grossWeight, weightUnit, division
- product_descriptions: product(FK→products), language, productDescription
- plants: plant(PK), plantName, country, cityName, postalCode, region
- billing_document_cancellations: billingDocument(PK), billingDocumentType, cancelledBillingDocument, creationDate, totalNetAmount, soldToParty

ACTUAL O2C FLOW (CRITICAL - use these exact JOINs):
1. SalesOrder → Delivery:
   outbound_delivery_items.referenceSdDocument = sales_order_headers.salesOrder

2. Delivery → BillingDocument:
   billing_document_items.referenceSdDocument = outbound_delivery_headers.deliveryDocument

3. BillingDocument → JournalEntry:
   billing_document_headers.accountingDocument = journal_entry_items.accountingDocument

4. To trace a full flow (SO → DEL → BILL → JE), use this pattern:
   FROM sales_order_headers soh
   JOIN outbound_delivery_items odi ON odi.referenceSdDocument = soh.salesOrder
   JOIN outbound_delivery_headers odh ON odh.deliveryDocument = odi.deliveryDocument
   JOIN billing_document_items bdi ON bdi.referenceSdDocument = odh.deliveryDocument
   JOIN billing_document_headers bdh ON bdh.billingDocument = bdi.billingDocument
   JOIN journal_entry_items je ON je.accountingDocument = bdh.accountingDocument

5. Customer links:
   sales_order_headers.soldToParty = business_partners.customer
   billing_document_headers.soldToParty = business_partners.customer

6. Product links:
   sales_order_items.material = products.product
   billing_document_items.material = products.product

7. For "broken flow" queries:
   - Delivered but not billed: overallDeliveryStatus = 'C' AND (overallOrdReltdBillgStatus IS NULL OR overallOrdReltdBillgStatus = '')
   - Has billing but delivery is missing: LEFT JOIN outbound_delivery_items returns NULL
`;
