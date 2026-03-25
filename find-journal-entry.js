const fs = require('fs');
const path = require('path');

function findBillingDocumentJournalEntry(billingDocId) {
  console.log(`\n🔍 Looking up billing document ${billingDocId}...`);
  
  try {
    // Load billing document headers
    const billFile = path.join(process.cwd(), 'sap-o2c-data', 'billing_document_headers', 'part-20251119-133433-228.jsonl');
    const billFile2 = path.join(process.cwd(), 'sap-o2c-data', 'billing_document_headers', 'part-20251119-133433-936.jsonl');
    
    let billData = null;
    
    // Try first file
    try {
      const content = fs.readFileSync(billFile, 'utf-8');
      const lines = content.trim().split('\n');
      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.billingDocument === billingDocId) {
          billData = record;
          break;
        }
      }
    } catch (e) {}
    
    // Try second file if not found
    if (!billData) {
      try {
        const content = fs.readFileSync(billFile2, 'utf-8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          const record = JSON.parse(line);
          if (record.billingDocument === billingDocId) {
            billData = record;
            break;
          }
        }
      } catch (e) {}
    }
    
    if (!billData) {
      console.log(`✗ Billing document ${billingDocId} not found`);
      return null;
    }
    
    console.log(`✓ Found billing document ${billingDocId}`);
    console.log(`  Type: ${billData.billingDocumentType}`);
    console.log(`  Date: ${billData.billingDocumentDate}`);
    console.log(`  Amount: ${billData.totalNetAmount} ${billData.transactionCurrency}`);
    console.log(`  Accounting Document (Journal Entry): ${billData.accountingDocument}`);
    
    if (!billData.accountingDocument) {
      console.log(`✗ No accounting document linked to this billing document`);
      return null;
    }
    
    return billData.accountingDocument;
  } catch (err) {
    console.error(`✗ Error:`, err.message);
    return null;
  }
}

const result = findBillingDocumentJournalEntry('91150187');
if (result) {
  console.log(`\n✓ SUCCESS: Journal Entry Number is: ${result}`);
} else {
  console.log(`\n✗ Could not find journal entry for billing document 91150187`);
}
