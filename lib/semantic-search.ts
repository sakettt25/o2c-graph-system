/**
 * Semantic search utilities for entity matching and query expansion
 */

export interface SemanticEntity {
  type: 'SalesOrder' | 'BillingDocument' | 'Delivery' | 'Payment' | 'JournalEntry' | 'Customer' | 'Product';
  id: string;
  aliases: string[];
}

/**
 * Semantic entity catalog for hybrid search matching
 */
const SEMANTIC_CATALOG: Record<string, SemanticEntity[]> = {
  SalesOrder: [
    { type: 'SalesOrder', id: 'SO', aliases: ['sales order', 'so', 'order', 'sales doc', 'quotation'] },
  ],
  BillingDocument: [
    { type: 'BillingDocument', id: 'BD', aliases: ['billing document', 'bill', 'invoice', 'bd', 'billing'] },
  ],
  Delivery: [
    { type: 'Delivery', id: 'DEL', aliases: ['delivery', 'outbound delivery', 'shipment', 'od', 'del'] },
  ],
  Payment: [
    { type: 'Payment', id: 'PAY', aliases: ['payment', 'paid', 'cash receipt', 'ar', 'pa'] },
  ],
  JournalEntry: [
    { type: 'JournalEntry', id: 'JE', aliases: ['journal entry', 'accounting entry', 'je', 'ledger'] },
  ],
  Customer: [
    { type: 'Customer', id: 'CUST', aliases: ['customer', 'partner', 'buyer', 'account', 'sold-to'] },
  ],
  Product: [
    { type: 'Product', id: 'PROD', aliases: ['product', 'material', 'item', 'sku', 'good'] },
  ],
};

/**
 * Parse semantic context from user query
 * Identifies entity types and synonyms mentioned in the query
 */
export function parseSemanticContext(query: string): {
  detectedTypes: Array<'SalesOrder' | 'BillingDocument' | 'Delivery' | 'Payment' | 'JournalEntry' | 'Customer' | 'Product'>;
  expandedQuery: string;
} {
  const lower = query.toLowerCase();
  const detectedTypes: Array<'SalesOrder' | 'BillingDocument' | 'Delivery' | 'Payment' | 'JournalEntry' | 'Customer' | 'Product'> = [];
  const mentionedAliases: string[] = [];

  // Check each entity type
  for (const [type, entities] of Object.entries(SEMANTIC_CATALOG)) {
    for (const entity of entities) {
      for (const alias of entity.aliases) {
        if (lower.includes(alias)) {
          const typeName = type as 'SalesOrder' | 'BillingDocument' | 'Delivery' | 'Payment' | 'JournalEntry' | 'Customer' | 'Product';
          if (!detectedTypes.includes(typeName)) {
            detectedTypes.push(typeName);
          }
          mentionedAliases.push(alias);
          break;
        }
      }
    }
  }

  // Build expanded query with synonyms
  let expandedQuery = query;
  for (const alias of mentionedAliases) {
    const relatedAliases = SEMANTIC_CATALOG[
      Object.entries(SEMANTIC_CATALOG).find(([_, entities]) =>
        entities.some(e => e.aliases.includes(alias))
      )?.[0] || ''
    ]?.[0]?.aliases || [];

    if (relatedAliases.length > 0) {
      expandedQuery += ` (also known as: ${relatedAliases.slice(0, 3).join(', ')})`;
    }
  }

  return { detectedTypes, expandedQuery };
}

/**
 * Perform semantic entity disambiguation
 * Helps resolve ambiguous references to entities
 */
export function disambiguateEntity(
  reference: string,
  detectedTypes: Array<'SalesOrder' | 'BillingDocument' | 'Delivery' | 'Payment' | 'JournalEntry' | 'Customer' | 'Product'>
): string {
  // If a specific type was detected, add context
  if (detectedTypes.length === 1) {
    const type = detectedTypes[0];
    return `${reference} (${type})`;
  }

  // If ambiguous, return with alternatives
  if (detectedTypes.length > 1) {
    return `${reference} (could refer to: ${detectedTypes.join(', ')})`;
  }

  return reference;
}

/**
 * Generate semantic SQL hints based on detected entity types
 * Returns SQL fragments that expand the search scope
 */
export function generateSemanticSQLHints(
  detectedTypes: Array<'SalesOrder' | 'BillingDocument' | 'Delivery' | 'Payment' | 'JournalEntry' | 'Customer' | 'Product'>
): string {
  if (detectedTypes.length === 0) return '';

  const hints = [];

  if (detectedTypes.includes('SalesOrder')) {
    hints.push('-- Consider: sales_order_headers, sales_order_items, sales_order_schedule_lines');
  }
  if (detectedTypes.includes('BillingDocument')) {
    hints.push('-- Consider: billing_document_headers, billing_document_items');
  }
  if (detectedTypes.includes('Delivery')) {
    hints.push('-- Consider: outbound_delivery_headers, outbound_delivery_items');
  }
  if (detectedTypes.includes('Payment')) {
    hints.push('-- Consider: payments_accounts_receivable');
  }
  if (detectedTypes.includes('JournalEntry')) {
    hints.push('-- Consider: journal_entry_items_accounts_receivable');
  }
  if (detectedTypes.includes('Customer')) {
    hints.push('-- Consider: business_partners, business_partner_addresses, customer_company_assignments');
  }
  if (detectedTypes.includes('Product')) {
    hints.push('-- Consider: products, product_descriptions, product_plants, product_storage_locations');
  }

  return hints.join('\n');
}

/**
 * Expand query with semantic relationships
 * For example: if user asks about "customers with orders", expand to include payment/delivery context
 */
export function expandSemanticRelationships(
  query: string,
  detectedTypes: Array<'SalesOrder' | 'BillingDocument' | 'Delivery' | 'Payment' | 'JournalEntry' | 'Customer' | 'Product'>
): string {
  let expanded = query;

  // If both SalesOrder and BillingDocument detected, expand with invoice flow context
  if (detectedTypes.includes('SalesOrder') && detectedTypes.includes('BillingDocument')) {
    expanded += ' (Relationship: SO → Bill via billing_document_items.referenceSdDocument)';
  }

  // If Delivery detected with SalesOrder, expand with delivery lineage
  if (detectedTypes.includes('Delivery') && detectedTypes.includes('SalesOrder')) {
    expanded += ' (Relationship: SO → Delivery via outbound_delivery_items.referenceSdDocument)';
  }

  // If JournalEntry detected with BillingDocument, expand with accounting flow
  if (detectedTypes.includes('JournalEntry') && detectedTypes.includes('BillingDocument')) {
    expanded += ' (Relationship: Bill → JE via billing_document_headers.accountingDocument)';
  }

  // If Payment detected, note it comes from JournalEntry
  if (detectedTypes.includes('Payment') && detectedTypes.includes('JournalEntry')) {
    expanded += ' (Relationship: JE → Payment via same accountingDocument)';
  }

  return expanded;
}
