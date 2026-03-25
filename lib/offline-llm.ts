/**
 * Offline LLM for SQL generation
 * Uses simple pattern matching and semantic understanding as a fallback
 * when Gemini API is unavailable
 */


export interface OfflineSQLResponse {
  type: 'data' | 'guardrail' | 'clarify';
  sql?: string;
  explanation?: string;
  message?: string;
}

const TABLE_ID_COLUMNS: Record<string, string[]> = {
  sales_order_headers: ['salesOrder'],
  billing_document_headers: ['billingDocument', 'accountingDocument', 'soldToParty'],
  billing_document_items: ['billingDocument', 'referenceSdDocument'],
  outbound_delivery_headers: ['deliveryDocument'],
  outbound_delivery_items: ['deliveryDocument', 'referenceSdDocument'],
  payments_accounts_receivable: ['accountingDocument', 'salesDocument', 'customer'],
  journal_entry_items: ['accountingDocument', 'customer', 'clearingAccountingDocument'],
  business_partners: ['customer', 'businessPartner'],
  products: ['product'],
};

const SEMANTIC_RULES: Record<string, string> = {
  // Sales Order queries
  'sales order|order|so': 'sales_order_headers',
  'purchase order|po': 'sales_order_headers',
  
  // Billing/Invoice queries
  'billing|invoice|bill|bd': 'billing_document_headers',
  'billing item|invoice item': 'billing_document_items',
  
  // Delivery queries
  'delivery|outbound delivery|shipment|ship': 'outbound_delivery_headers',
  'delivery item': 'outbound_delivery_items',
  
  // Payment queries
  'payment|paid|receive': 'payments_accounts_receivable',
  
  // Accounting queries
  'journal entry|je|accounting': 'journal_entry_items',
  
  // Customer/Partner queries
  'customer|partner|business partner|company': 'business_partners',
  
  // Product queries
  'product|item|material|sku': 'products',
};

const FIELD_MAPPINGS: Record<string, string[]> = {
  'amount|total|revenue|sum': ['totalNetAmount', 'amountInTransactionCurrency'],
  'date|created|posted|billing date': ['creationDate', 'postingDate', 'billingDocumentDate'],
  'id|number|document': ['salesOrder', 'billingDocument', 'deliveryDocument', 'accountingDocument'],
  'customer|partner|company': ['soldToParty', 'customer', 'businessPartner'],
  'status|state': ['overallDeliveryStatus', 'overallOrdReltdBillgStatus', 'billingDocumentIsCancelled'],
};

function getTableFromKeyword(message: string): string | null {
  const lower = message.toLowerCase();
  for (const [keywords, table] of Object.entries(SEMANTIC_RULES)) {
    const keywordList = keywords.split('|');
    if (keywordList.some(kw => lower.includes(kw))) {
      return table;
    }
  }
  return null;
}

function guessFieldsFromQuery(message: string): string[] {
  const lower = message.toLowerCase();
  const fields: string[] = [];
  
  for (const [keywords, fieldList] of Object.entries(FIELD_MAPPINGS)) {
    const keywordList = keywords.split('|');
    if (keywordList.some(kw => lower.includes(kw))) {
      fields.push(...fieldList);
    }
  }
  
  return [...new Set(fields)].slice(0, 5); // Limit to 5 fields
}

function extractNumbers(message: string): string[] {
  return (message.match(/\b\d{5,}\b/g) || []).slice(0, 5);
}

export function generateOfflineSQLFallback(
  userMessage: string
): OfflineSQLResponse {
  const lower = userMessage.toLowerCase();

  // Linked journal/accounting lookup from a referenced document ID
  const linkedJournalMatch = userMessage.match(/\b(\d{5,})\b/);
  if (
    linkedJournalMatch &&
    (lower.includes('journal') || lower.includes('accounting')) &&
    (lower.includes('linked') || lower.includes('link') || lower.includes('find'))
  ) {
    const docId = linkedJournalMatch[1];
    return {
      type: 'data',
      sql: `
        SELECT DISTINCT
          bdh.billingDocument,
          bdh.accountingDocument AS journalNumber,
          je.postingDate,
          je.accountingDocumentType
        FROM billing_document_headers bdh
        LEFT JOIN journal_entry_items je
          ON je.accountingDocument = bdh.accountingDocument
        LEFT JOIN billing_document_items bdi
          ON bdi.billingDocument = bdh.billingDocument
        LEFT JOIN outbound_delivery_items odi
          ON odi.deliveryDocument = bdi.referenceSdDocument
        WHERE bdh.billingDocument = '${docId}'
           OR bdh.accountingDocument = '${docId}'
           OR bdi.referenceSdDocument = '${docId}'
           OR odi.referenceSdDocument = '${docId}'
        LIMIT 20
      `.trim(),
      explanation: `Finding linked journal number for document ${docId}`,
    };
  }

  // High-priority business query: products with most billing documents
  if (
    lower.includes('product') &&
    lower.includes('billing') &&
    (lower.includes('most') || lower.includes('top') || lower.includes('highest'))
  ) {
    return {
      type: 'data',
      sql: `
        SELECT
          bdi.material AS product,
          COALESCE(MAX(pd.productDescription), bdi.material) AS productDescription,
          COUNT(DISTINCT bdi.billingDocument) AS billingDocumentCount
        FROM billing_document_items bdi
        LEFT JOIN product_descriptions pd
          ON pd.product = bdi.material
        GROUP BY bdi.material
        ORDER BY billingDocumentCount DESC
        LIMIT 10
      `.trim(),
      explanation: 'Top products ranked by number of billing documents',
    };
  }
  
  // Check for non-dataset questions
  if (
    lower.includes('who are you') ||
    lower.includes('what are you') ||
    lower.includes('weather') ||
    lower.includes('recipe') ||
    lower.includes('tell me a joke') ||
    lower.includes('code') ||
    lower.includes('programming') ||
    (lower.includes('help') && !lower.includes('help me understand'))
  ) {
    return {
      type: 'guardrail',
      message: 'This system is designed to answer questions related to the Order-to-Cash dataset only. Please ask questions about sales orders, billing documents, deliveries, payments, customers, or products in the dataset.',
    };
  }
  
  // Extract semantic context
  // Try to determine the primary table
  const table = getTableFromKeyword(userMessage);
  
  if (!table) {
    return {
      type: 'clarify',
      message: 'I need clarification. Are you asking about: sales orders, billing documents, deliveries, payments, customers, or products? Please specify what you\'d like to know.',
    };
  }
  
  // Extract document IDs if present
  const docIds = extractNumbers(userMessage);
  
  // Build basic SQL
  let sql = '';
  
  // Handle specific query patterns
  if (lower.includes('trace') || lower.includes('flow')) {
    // O2C flow trace
    if (docIds.length > 0) {
      const docId = docIds[0];
      sql = `
        WITH doc_data AS (
          SELECT 'SalesOrder' as step, salesOrder as id FROM sales_order_headers WHERE salesOrder = '${docId}'
          UNION ALL
          SELECT 'BillingDoc' as step, billingDocument as id FROM billing_document_headers WHERE billingDocument = '${docId}'
          UNION ALL
          SELECT 'Delivery' as step, deliveryDocument as id FROM outbound_delivery_headers WHERE deliveryDocument = '${docId}'
          UNION ALL
          SELECT 'JournalEntry' as step, accountingDocument as id FROM journal_entry_items WHERE accountingDocument = '${docId}'
        )
        SELECT * FROM doc_data LIMIT 100
      `;
      return {
        type: 'data',
        sql: sql.trim(),
        explanation: 'Finding O2C flow trace for document ' + docId,
      };
    }
  }
  
  // Handle count queries
  if (lower.includes('how many') || lower.includes('count')) {
    sql = `SELECT COUNT(*) as count FROM ${table} LIMIT 100`;
    return {
      type: 'data',
      sql,
      explanation: 'Counting records in ' + table,
    };
  }
  
  // Handle specific document lookup
  if (docIds.length > 0) {
    const docId = docIds[0];
    const idColumns = TABLE_ID_COLUMNS[table] ?? ['accountingDocument'];
    
    // Try common ID columns
    const conditions = idColumns.map(col => `${col} = '${docId}'`).join(' OR ');
    sql = `SELECT * FROM ${table} WHERE ${conditions} LIMIT 50`;
    
    return {
      type: 'data',
      sql,
      explanation: `Searching for document ${docId} in ${table}`,
    };
  }
  
  // Check for relationship/linking queries
  if (lower.includes('link') || lower.includes('related') || lower.includes('connected')) {
    // This is a verification query
    sql = `
      SELECT sh.salesOrder, bh.billingDocument, oh.deliveryDocument, je.accountingDocument
      FROM sales_order_headers sh
      LEFT JOIN billing_document_items bi ON bi.referenceSdDocument = sh.salesOrder
      LEFT JOIN billing_document_headers bh ON bh.billingDocument = bi.billingDocument
      LEFT JOIN outbound_delivery_items di ON di.referenceSdDocument = sh.salesOrder
      LEFT JOIN outbound_delivery_headers oh ON oh.deliveryDocument = di.deliveryDocument
      LEFT JOIN journal_entry_items je ON je.accountingDocument = bh.accountingDocument
      LIMIT 50
    `;
    return {
      type: 'data',
      sql: sql.trim(),
      explanation: 'Showing O2C relationships between documents',
    };
  }
  
  // Default: SELECT * with LIMIT
  sql = `SELECT * FROM ${table} LIMIT 50`;
  
  return {
    type: 'data',
    sql,
    explanation: `Retrieving data from ${table}`,
  };
}

export function isOfflineLLMApplicable(error: unknown): boolean {
  if (!error) return false;
  
  const message = error instanceof Error ? error.message : String(error);
  
  // Check if it's a Gemini API error
  return (
    message.includes('Gemini API') ||
    message.includes('GEMINI_API_KEY') ||
    message.includes('No compatible Gemini model') ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('Cannot reach') ||
    message.includes('Connection refused') ||
    message.includes('Cannot set properties of undefined') ||
    message.includes('exports')
  );
}
