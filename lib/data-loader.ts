/**
 * Load SAP O2C JSONL data from files directly (serverless-compatible)
 * Avoids database initialization issues in Vercel by loading JSONL files instead
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface DataCache {
  business_partners: Record<string, any>;
  sales_order_headers: any[];
  sales_order_items: any[];
  outbound_delivery_headers: any[];
  outbound_delivery_items: any[];
  billing_document_headers: any[];
  billing_document_items: any[];
  journal_entry_items: any[];
  payments_accounts_receivable: any[];
  product_descriptions: Record<string, any>;
  products: Record<string, any>;
}

let dataCache: DataCache | null = null;
let loadingPromise: Promise<DataCache> | null = null;
let loadError: Error | null = null;

function loadJsonlFile(filePath: string, maxRecords = Infinity): any[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const records: any[] = [];

    for (let i = 0; i < Math.min(lines.length, maxRecords); i++) {
      const line = lines[i].trim();
      if (line) {
        try {
          records.push(JSON.parse(line));
        } catch (parseErr) {
          console.warn(
            `[DataLoader] Skipping malformed JSON in ${filePath} line ${i + 1}:`,
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          );
        }
      }
    }

    return records;
  } catch (err) {
    console.warn(
      `[DataLoader] Failed to load ${filePath}:`,
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

function loadJsonlFiles(entityDir: string, maxRecords = Infinity): any[] {
  try {
    const dirPath = join(process.cwd(), 'sap-o2c-data', entityDir);
    const files = readdirSync(dirPath);
    const records: any[] = [];

    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        const filePath = join(dirPath, file);
        const fileRecords = loadJsonlFile(filePath, maxRecords);
        records.push(...fileRecords);
      }
    }

    return records;
  } catch (err) {
    console.warn(
      `[DataLoader] Failed to load directory ${entityDir}:`,
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

async function initializeData(): Promise<DataCache> {
  if (dataCache) return dataCache;
  if (loadError) throw loadError;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      console.log('[DataLoader] Loading SAP O2C data from JSONL files...');

      // Load all data with limiting to avoid memory issues
      const partners = loadJsonlFiles('business_partners', 500);
      const soHeaders = loadJsonlFiles('sales_order_headers', 500);
      const soItems = loadJsonlFiles('sales_order_items', 2000);
      const delivHeaders = loadJsonlFiles('outbound_delivery_headers', 500);
      const delivItems = loadJsonlFiles('outbound_delivery_items', 2000);
      const billHeaders = loadJsonlFiles('billing_document_headers', 500);
      const billItems = loadJsonlFiles('billing_document_items', 2000);
      const journals = loadJsonlFiles('journal_entry_items_accounts_receivable', 2000);
      const payments = loadJsonlFiles('payments_accounts_receivable', 500);
      const products = loadJsonlFiles('products', 500);
      const prodDescs = loadJsonlFiles('product_descriptions', 500);

      // Index partners by customer ID
      const partnersMap: Record<string, any> = {};
      for (const p of partners) {
        const key = p.customer || p.businessPartner;
        if (key) partnersMap[key] = p;
      }

      // Index products
      const productsMap: Record<string, any> = {};
      for (const p of products) {
        if (p.product) productsMap[p.product] = p;
      }

      // Index product descriptions
      const prodDescsMap: Record<string, any> = {};
      for (const pd of prodDescs) {
        if (pd.product && pd.language === 'EN') {
          prodDescsMap[pd.product] = pd;
        }
      }

      dataCache = {
        business_partners: partnersMap,
        sales_order_headers: soHeaders,
        sales_order_items: soItems,
        outbound_delivery_headers: delivHeaders,
        outbound_delivery_items: delivItems,
        billing_document_headers: billHeaders,
        billing_document_items: billItems,
        journal_entry_items: journals,
        payments_accounts_receivable: payments,
        product_descriptions: prodDescsMap,
        products: productsMap,
      };

      console.log('[DataLoader] Data loaded successfully');
      console.log(`  - Partners: ${Object.keys(partnersMap).length}`);
      console.log(`  - Sales Orders: ${soHeaders.length}`);
      console.log(`  - Deliveries: ${delivHeaders.length}`);
      console.log(`  - Billing Docs: ${billHeaders.length}`);
      console.log(`  - Payments: ${payments.length}`);
      console.log(`  - Products: ${Object.keys(productsMap).length}`);

      return dataCache;
    } catch (err) {
      console.error('[DataLoader] Failed to initialize data:', err);
      loadError = err as Error;
      throw err;
    }
  })();

  return loadingPromise;
}

export async function getData(): Promise<DataCache> {
  return initializeData();
}

export async function getBusinessPartners() {
  const data = await getData();
  return Object.values(data.business_partners);
}

export async function getSalesOrders(limit = 200) {
  const data = await getData();
  return data.sales_order_headers.slice(0, limit);
}

export async function getSalesOrderItems(limit = 300) {
  const data = await getData();
  return data.sales_order_items.slice(0, limit);
}

export async function getDeliveries(limit = 200) {
  const data = await getData();
  return data.outbound_delivery_headers.slice(0, limit);
}

export async function getDeliveryItems(limit = 300) {
  const data = await getData();
  return data.outbound_delivery_items.slice(0, limit);
}

export async function getBillingDocuments(limit = 200) {
  const data = await getData();
  return data.billing_document_headers.slice(0, limit);
}

export async function getBillingItems(limit = 400) {
  const data = await getData();
  return data.billing_document_items.slice(0, limit);
}

export async function getJournalEntries(limit = 200) {
  const data = await getData();
  return data.journal_entry_items.slice(0, limit);
}

export async function getPayments(limit = 200) {
  const data = await getData();
  return data.payments_accounts_receivable.slice(0, limit);
}

export async function getProducts(limit = 100) {
  const data = await getData();
  return Object.values(data.products).slice(0, limit);
}

export async function getProductDescription(productId: string) {
  const data = await getData();
  return data.product_descriptions[productId];
}

export async function getBusinessPartner(customerId: string) {
  const data = await getData();
  return data.business_partners[customerId];
}

export async function getProduct(productId: string) {
  const data = await getData();
  return data.products[productId];
}
