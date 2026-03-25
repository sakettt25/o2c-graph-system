# Offline LLM Quick Reference

## For Developers

### How It Works
```
User Message → Try Gemini API → If fails → Use Offline LLM → Return Results
```

### Key Files
```
/lib/offline-llm.ts          - SQL generation logic
/app/api/chat/route.ts       - Fallback integration
/OFFLINE_LLM_INTEGRATION.md  - Full documentation
```

### Main Functions

#### 1. Generate SQL (Offline LLM)
```typescript
import { generateOfflineSQLFallback } from '@/lib/offline-llm';

const response = generateOfflineSQLFallback("Show sales orders");
// Returns: {
//   type: 'data',
//   sql: 'SELECT * FROM sales_order_headers LIMIT 50',
//   explanation: 'Retrieving data from sales_order_headers'
// }
```

#### 2. Detect API Errors
```typescript
import { isOfflineLLMApplicable } from '@/lib/offline-llm';

try {
  // Call Gemini API
} catch (error) {
  if (isOfflineLLMApplicable(error)) {
    // Use offline LLM
  }
}
```

### Supported Queries

| Intent | Example | Generated SQL |
|--------|---------|----------------|
| List | "Show sales orders" | `SELECT * FROM sales_order_headers LIMIT 50` |
| Count | "How many customers?" | `SELECT COUNT(*) FROM business_partners` |
| Trace | "Show flow 123456" | O2C flow trace with JOINs |
| Lookup | "Get document 789" | `SELECT * FROM [table] WHERE id = '789'` |

### Keywords Recognized

```
Sales Orders:   order, SO, sales order, purchase order, PO
Billing:        bill, invoice, BD, billing document
Delivery:       delivery, shipment, ship, outbound delivery
Payments:       payment, paid, receive, AR
Accounting:     JE, journal entry, accounting document
Customers:      customer, partner, company, business partner
Products:       product, item, material, SKU
```

### Response Format

All responses follow this format:
```typescript
{
  type: 'data' | 'clarify' | 'guardrail',
  sql?: string,           // The SQL query (if applicable)
  explanation?: string,   // Brief explanation of the query
  message?: string,       // Guardrail or clarification message
}
```

### Testing Offline Mode

**Force offline (remove API key from env):**
```bash
unset GEMINI_API_KEY
npm run dev
```

**Test with curl:**
```bash
curl -X POST http://localhost:9001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "List all products",
    "history": []
  }'
```

### Server Logs

Check for these log messages:
```
# Gemini API active
[API/chat] Generating SQL with Gemini...

# Offline LLM fallback
[API/chat] Gemini API failed, using offline LLM fallback: <error>

# Streaming fallback
[API/chat] Gemini streaming failed, using simple fallback response
```

### Common Scenarios

**Scenario 1: API Working**
```
Input:  "How many billing documents?"
Output: Uses Gemini API → Better natural language results
```

**Scenario 2: API Down**
```
Input:  "How many billing documents?"
Output: Uses Offline LLM → "SELECT COUNT(*) FROM billing_document_headers"
```

**Scenario 3: Rate Limited**
```
Input:  "Show me 10 customers"
Output: Detects 429 error → Activates Offline LLM → Returns results
```

### Performance

| Operation | Gemini API | Offline LLM |
|-----------|-----------|------------|
| SQL Generation | 500-2000ms | <5ms |
| Network Latency | Yes | No |
| API Calls | Yes | No |
| Cost | Yes | No |
| Complexity Support | High | Medium |

### Limitations of Offline LLM

❌ Cannot understand complex business rules
❌ No learning from past queries
❌ Limited to keyword matching
❌ No natural language generation
❌ Single-turn only

✅ Perfect for:
- Basic data retrieval
- System recovery
- Offline operation
- Rate limit handling

### Monitoring

**Enable debug logging in route.ts:**
```typescript
console.log('[API/chat] Offline LLM response:', JSON.stringify(classified, null, 2));
```

### Error Codes

| Error | Meaning | Fallback |
|-------|---------|----------|
| 400 | Invalid request | No fallback |
| 429 | Rate limited | Use Offline LLM ✅ |
| 500 | Server error | Use Offline LLM ✅ |
| Network | No connectivity | Use Offline LLM ✅ |

### Adding New Patterns

Edit `/lib/offline-llm.ts`:

```typescript
const SEMANTIC_RULES = {
  'your keyword|alias': 'table_name',
};
```

### Extending Offline LLM

To add support for more complex queries:

1. Add pattern to `SEMANTIC_RULES`
2. Add logic in `generateOfflineSQLFallback()`
3. Test with example queries
4. Document in this file

### Troubleshooting

**Q: Offline LLM not activating?**
A: Check error detection in `isOfflineLLMApplicable()`. Add more error patterns if needed.

**Q: SQL queries failing?**
A: Verify table names in schema. Check column names are exact case match.

**Q: Want to force offline mode?**
A: Set `GEMINI_API_KEY=invalid` in .env.local

**Q: How to disable offline LLM?**
A: Remove offline-llm import and fallback code from chat/route.ts

### Example Implementation

```typescript
// In chat API route
import { generateOfflineSQLFallback, isOfflineLLMApplicable } from '@/lib/offline-llm';

try {
  const response = await classifyAndGenerateSQL(message, history);
  return response;
} catch (error) {
  if (isOfflineLLMApplicable(error)) {
    return generateOfflineSQLFallback(message);
  }
  throw error;
}
```

---

**Last Updated:** March 25, 2026
**Status:** Active and monitoring
**Fallback Rate:** Monitor in production logs
