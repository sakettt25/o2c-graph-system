import { DB_SCHEMA } from './types';
import { parseSemanticContext, generateSemanticSQLHints, expandSemanticRelationships } from './semantic-search';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';

function normalizeModel(model?: string): string | undefined {
  if (!model) return undefined;
  const trimmed = model.trim();
  if (!trimmed) return undefined;

  if (trimmed === 'gemini-2.0-flash') {
    return 'gemini-2.5-flash';
  }

  return trimmed;
}

const MODEL_CANDIDATES = Array.from(new Set([
  normalizeModel(process.env.GEMINI_MODEL),
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
].filter((model): model is string => Boolean(model))));

const SYSTEM_PROMPT = `You are an expert SAP Order-to-Cash (O2C) data analyst with semantic understanding. Your purpose is to answer questions and confirm facts about the provided SAP O2C dataset using both exact keyword matching and semantic understanding. You must refuse ALL other requests.

${DB_SCHEMA}

SEMANTIC UNDERSTANDING:
- Recognize synonyms: "order" = "sales order", "bill" = "billing document", "delivery" = "outbound delivery", "je" = "journal entry"
- Understand relationships: SO → Bill → JE → Payment (the O2C flow)
- Expand queries: if user mentions "order and invoice", search across both sales_order_headers and billing_document_headers
- Handle ambiguity: if user mentions "document", consider all document types and ask for clarification

GUARDRAILS - CRITICAL:
1. If the user asks anything NOT related to the O2C dataset (e.g., general knowledge, creative writing, coding help, weather, recipes, current events, anything outside this dataset), respond ONLY with:
   {"type":"guardrail","message":"This system is designed to answer questions related to the Order-to-Cash dataset only. Please ask questions about sales orders, billing documents, deliveries, payments, customers, or products in the dataset."}
2. Never generate SQL that modifies data (INSERT, UPDATE, DELETE, DROP, CREATE, ALTER).
3. Always ground your answers in actual data from the database.

RESPONSE FORMAT:
You must respond with a JSON object (no markdown, no code fences) in one of these formats:

For data questions or statements to verify:
{"type":"data","sql":"<single valid SQLite SQL query>","explanation":"<brief explanation of what the SQL does>"}

For guardrail violations:
{"type":"guardrail","message":"<polite refusal explaining this system only answers O2C dataset questions>"}

For ambiguous/unclear questions:
{"type":"clarify","message":"<ask for clarification or list possible interpretations>"}

HANDLING STATEMENTS:
- If the user provides a statement (e.g., "The journal entry 1234 is linked to billing document 5678"), extract the referenced documents and generate a SQL query to verify and confirm this relationship.
- Always respond with a query that validates the stated relationship.

IMPORTANT SQL RULES:
- Use only SQLite-compatible syntax
- Always use table aliases for clarity  
- Limit results to max 100 rows unless asked for specific counts
- For "trace" queries involving a full O2C flow, use multiple JOINs and show the flow: SO → Delivery → Bill → JE → Payment
- Column names are case-sensitive and must match the schema exactly
- For "broken flow" queries: check overallDeliveryStatus, overallOrdReltdBillgStatus fields
- Use CAST(totalNetAmount AS REAL) for numeric comparisons
- When referencing billing documents linked to sales orders, use billing_document_items.referenceSdDocument
- When referencing deliveries linked to sales orders, use outbound_delivery_items.referenceSdDocument
- When joining customer data, use business_partners table and match on customer/partner IDs
- For product searches, include product_descriptions table to enable semantic matching on product names`;

export interface GeminiResponse {
  type: 'data' | 'guardrail' | 'clarify';
  sql?: string;
  explanation?: string;
  message?: string;
}

function isModelNotFound(status: number, body: string): boolean {
  if (status !== 404) return false;
  const text = body.toLowerCase();
  return text.includes('not found') || text.includes('listmodels') || text.includes('model');
}

function isQuotaOrCapacityIssue(status: number, body: string): boolean {
  if (status !== 429) return false;
  const text = body.toLowerCase();
  return (
    text.includes('resource_exhausted') ||
    text.includes('quota') ||
    text.includes('rate') ||
    text.includes('too many requests')
  );
}

async function fetchWithModelFallback(
  method: 'generateContent' | 'streamGenerateContent',
  payload: unknown,
  stream = false
): Promise<Response> {
  let lastError = '';

  for (const model of MODEL_CANDIDATES) {
    const queryString = stream
      ? `?alt=sse&key=${GEMINI_API_KEY}`
      : `?key=${GEMINI_API_KEY}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}${queryString}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      return res;
    }

    const errText = await res.text();
    lastError = `Gemini API error ${res.status}: ${errText}`;

    if (isModelNotFound(res.status, errText) || isQuotaOrCapacityIssue(res.status, errText)) {
      console.warn(`Gemini model unavailable: ${model}. Trying next fallback model...`);
      continue;
    }

    throw new Error(lastError);
  }

  throw new Error(
    `No compatible Gemini model found. Tried: ${MODEL_CANDIDATES.join(', ')}. Last error: ${lastError}`
  );
}

export async function classifyAndGenerateSQL(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<GeminiResponse> {
  if (!GEMINI_API_KEY) {
    return {
      type: 'guardrail',
      message: 'GEMINI_API_KEY is not configured. Please set your API key in the .env file.',
    };
  }

  // Enhance message with semantic context
  const { detectedTypes } = parseSemanticContext(userMessage);
  const semanticHints = generateSemanticSQLHints(detectedTypes);
  const relationshipContext = expandSemanticRelationships(userMessage, detectedTypes);

  // Build enriched message
  let enrichedMessage = userMessage;
  if (semanticHints) {
    enrichedMessage += `\n\nSEMIC QUERY HINTS:\n${semanticHints}`;
  }
  if (relationshipContext !== userMessage) {
    enrichedMessage += `\n\nDBContext: ${relationshipContext}`;
  }

  const messages = [
    ...conversationHistory.slice(-6).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: enrichedMessage }] },
  ];

  const res = await fetchWithModelFallback('generateContent', {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: messages,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  if (!text || text.trim().length === 0) {
    return { type: 'guardrail', message: 'Unable to parse response. Please rephrase your question.' };
  }

  try {
    const parsed = JSON.parse(text) as GeminiResponse;
    return parsed;
  } catch {
    // Fallback 1: try to extract JSON from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const extracted = JSON.parse(match[0]) as GeminiResponse;
        return extracted;
      } catch {
        // ignore and continue to fallback 2
      }
    }

    // Fallback 2: if it looks like a statement with numbers, extract document IDs and generate a trace query
    const numberMatches = text.match(/\d{5,}/g) || [];
    if (numberMatches.length >= 2) {
      const [docId1, docId2] = numberMatches;
      return {
        type: 'data',
        sql: `SELECT j.accountingDocument, j.accountingDocumentItem, j.postingDate, j.glAccount, b.billingDocument, b.billingDocumentDate 
              FROM journal_entry_items j 
              LEFT JOIN billing_document_headers b ON b.accountingDocument = j.accountingDocument 
              WHERE j.accountingDocument = '${docId2}' OR b.billingDocument = '${docId1}'
              LIMIT 20`,
        explanation: 'Verifying relationship between journal entry and billing document',
      };
    }

    // Fallback 3: return error
    return { type: 'guardrail', message: 'Unable to parse response. Please rephrase your question.' };
  }
}

export async function generateNaturalLanguageAnswer(
  userMessage: string,
  sql: string,
  rows: Record<string, string | null>[],
  conversationHistory: Array<{ role: string; content: string }>
): Promise<ReadableStream<Uint8Array>> {
  if (!GEMINI_API_KEY) {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('API key not configured.'));
        controller.close();
      },
    });
  }

  const rowSummary = rows.length === 0
    ? 'No results found.'
    : `${rows.length} row(s) returned:\n${JSON.stringify(rows.slice(0, 30), null, 2)}`;

  const answerPrompt = `The user asked: "${userMessage}"

SQL executed: ${sql}

Query results:
${rowSummary}

Based on these exact results, provide a clear, concise, data-grounded answer in 2-4 sentences. 
- Mention specific IDs, amounts, counts from the data.
- If there are no results, explain what that means in business context.
- Do not invent data not present in results.
- Format numbers with commas and currency symbols where appropriate.
- Do NOT repeat the SQL query in your answer.
- Keep response under 150 words.`;

  const res = await fetchWithModelFallback(
    'streamGenerateContent',
    {
      contents: [
        ...conversationHistory.slice(-4).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: answerPrompt }] },
      ],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    },
    true
  );

  if (!res.ok || !res.body) {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`Error generating answer: ${res.status}`));
        controller.close();
      },
    });
  }

  // Transform SSE stream → raw text stream
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = res.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(jsonStr);
                const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                if (text) controller.enqueue(encoder.encode(text));
              } catch {
                // Skip malformed chunks
              }
            }
          }
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });
}

// Extract entity IDs from SQL query result rows to highlight in graph
export function extractHighlightedNodes(
  rows: Record<string, string | null>[]
): string[] {
  const nodeIds: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const [key, val] of Object.entries(row)) {
      if (!val) continue;
      const lk = key.toLowerCase();
      let id: string | null = null;

      if (lk.includes('salesorder') && !lk.includes('item')) id = `so_${val}`;
      else if (lk.includes('billingdocument') && !lk.includes('item') && !lk.includes('type')) id = `bill_${val}`;
      else if (lk.includes('deliverydocument') && !lk.includes('item')) id = `del_${val}`;
      else if (lk.includes('accountingdocument') && !lk.includes('item') && !lk.includes('type')) id = `je_${val}`;
      else if (lk === 'customer' || lk === 'soldtoparty') id = `customer_${val}`;
      else if (lk === 'material' || lk === 'product') id = `product_${val}`;

      if (id && !seen.has(id)) {
        seen.add(id);
        nodeIds.push(id);
      }
    }
  }

  return nodeIds.slice(0, 50);
}
