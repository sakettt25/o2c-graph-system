# O2C Graph Intelligence

A graph-based data modeling and AI query system for SAP Order-to-Cash (O2C) data.
Interactive 3D knowledge graph + natural language query interface powered by Gemini.

---

## Quick Start

```bash
# 1. Enter project directory
cd o2c-graph-system

# 2. Set your free Gemini API key (https://ai.google.dev)
export GEMINI_API_KEY=your_key_here

# 3. (Optional) Rebuild the database from raw JSONL data
python3 scripts/build_db.py /path/to/sap-o2c-data

# 4. Start the server
python3 server.py

# 5. Open http://localhost:3000
```

**Requirements:** Python 3.8+ only. Zero npm. Zero pip installs.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Browser (SPA)                          │
│  ┌──────────────────┐   ┌──────────────────────────┐    │
│  │  3D Force Graph  │   │   Streaming Chat Panel   │    │
│  │  Three.js +      │   │   · NL input             │    │
│  │  3d-force-graph  │   │   · SQL display          │    │
│  │                  │   │   · Data tables          │    │
│  │  Click → panel   │   │   · Node highlighting    │    │
│  │  Filter by type  │   │   · Conversation memory  │    │
│  └──────────────────┘   └──────────────────────────┘    │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼───────────────────────────────┐
│          Python stdlib HTTP Server  (server.py)          │
│  GET  /api/graph       →  build_graph()                  │
│  GET  /api/summary     →  dataset stats                  │
│  GET  /api/node/{id}   →  node detail lookup             │
│  POST /api/chat        →  NL→SQL + Gemini SSE stream     │
└────────────────┬─────────────────────┬────────────────────┘
          ┌──────▼──────┐    ┌──────────▼──────────┐
          │  SQLite DB  │    │  Gemini 1.5 Flash   │
          │  13 tables  │    │  · SQL generation   │
          │  ~1.4K rows │    │  · NL answers       │
          └─────────────┘    │  · SSE streaming    │
                             └─────────────────────┘
```

---

## Data Model & Graph Schema

### Node Types

| Type | Color | Source | Key |
|------|-------|--------|-----|
| Customer | Teal | business_partners | customer |
| SalesOrder | Blue | sales_order_headers | salesOrder |
| Delivery | Amber | outbound_delivery_headers | deliveryDocument |
| BillingDocument | Emerald | billing_document_headers | billingDocument |
| JournalEntry | Pink | journal_entry_items | accountingDocument |
| Payment | Violet | payments_accounts_receivable | accountingDocument |
| Product | Orange | products + product_descriptions | product |

### Edge Types

```
Customer ──PLACED──────────► SalesOrder
SalesOrder ──CONTAINS──────► Product
SalesOrder ──FULFILLED_BY──► Delivery
SalesOrder ──BILLED_AS─────► BillingDocument
BillingDocument ──POSTED_TO──► JournalEntry
BillingDocument ──SETTLED_BY──► Payment
```

---

## Features

### Graph Visualization
- 3D force-directed graph with Three.js + 3d-force-graph (CDN)
- Click any node → full metadata side panel (formatted dates, amounts, status badges)
- Hover tooltip with key attributes
- Filter nodes by type via toggle pills
- Highlighted nodes glow with animated rings + particle flows on edges

### Conversational AI
- Natural language → Gemini Flash → SQLite SQL → streamed NL answer
- Schema-aware prompt with all 13 tables and join patterns
- **Guardrails**: off-topic questions refused with polite message
- SQL-only gate: only SELECT/WITH queries execute (no mutations)
- Collapsible SQL display with copy button
- Inline data tables with row counts
- **Conversation memory**: last 6 turns as Gemini context
- **Node highlighting**: query result IDs mapped to graph nodes automatically

### Example Queries
```
Which products have the most billing documents?
Trace the full flow of billing document 91150187
Sales orders delivered but not yet billed
Top 5 customers by total order value
Deliveries with no billing document
Journal entries posted after April 2025
```

---

## LLM Prompting Strategy

### Overview
Two-stage pipeline ensures accurate, safe, and grounded responses:

### Stage 1 — Query Classification & SQL Generation
**Prompt:** Full O2C schema with all 13 tables, columns, PK/FK relationships, and example joins

**Configuration:**
- Model: Gemini 1.5 Flash
- Temperature: 0.1 (deterministic)
- Output: `responseMimeType: "application/json"`
- Max tokens: 2048

**Output format:**
```json
{
  "type": "data",
  "sql": "SELECT ... FROM ... WHERE ...",
  "explanation": "This query finds...",
  "nodeHighlight": ["id1", "id2"] 
}
```
or
```json
{
  "type": "guardrail",
  "message": "This system is designed to answer questions related to the Order-to-Cash dataset only."
}
```

**Why JSON mode?** Parsing is deterministic; no edge cases with markdown fences or implicit formatting.

### Stage 2 — Answer Generation (Streaming)
**Prompt:** Minimal instruction + user question + executed SQL + first 25 result rows

**Configuration:**
- Temperature: 0.3 (balanced creativity + accuracy)
- Max tokens: 512 (keep responses concise)
- Streaming: Server-Sent Events (SSE) for progressive text delivery

**Output:** 2-5 sentence natural language answer grounded in the data.

**Why two stages?**
1. **Classification stage** ensures safety—once SQL is validated, there's no injection risk
2. **Answer stage** focuses LLM on synthesis—it sees the actual data, not hypothetical descriptions
3. **Result:** Fewer hallucinations, faster latency (no large prompts for answers)

### Guardrails Implementation

**Semantic guardrails (in system prompt):**
```
Reject:
  • General knowledge queries ("What is photosynthesis?")
  • Creative requests ("Write a poem", "Tell a joke")
  • Real-world news/opinions ("Why is X trending?")
  • Off-domain topics ("How do I cook pasta?")

Accept:
  • Queries about sales orders, deliveries, billing, payments, customers, products
  • Historical analysis of the O2C dataset
  • Traces and flows through the business process
  • Anomalies and incomplete flows
```

**Syntactic guardrails (server-side):**
```python
# Only SELECT and WITH allowed
if not re.match(r'^\s*(SELECT|WITH)\s', sql, IGNORECASE):
    return {"error": "Only SELECT and WITH queries allowed"}

# Reject mutations
if re.search(r'(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)', sql, IGNORECASE):
    return {"error": "Mutations not allowed"}
```

**Result:** Off-topic queries return: `{"type": "guardrail", "message": "..."}`

---

## Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `GEMINI_API_KEY` | — | **Required**. Free key at https://ai.google.dev |
| `PORT` | `3000` | HTTP port (set via environment or hardcoded in server.py) |
| `DB_PATH` | `./data/o2c.db` | SQLite database path |

### Environment Setup
```bash
# macOS / Linux / WSL
export GEMINI_API_KEY="your-key-here"

# Windows (PowerShell)
$env:GEMINI_API_KEY="your-key-here"

# Windows (Command Prompt)
set GEMINI_API_KEY=your-key-here
```

---

## Advanced Features

### Semantic/Hybrid Search
- Entity synonym matching ("orders" → SalesOrder, "bills" → BillingDocument)
- Query expansion with related entities and relationship context
- O2C flow awareness (SO→Bill→JE→Payment chains)
- File: `lib/semantic-search.ts`

### Graph Clustering & Analytics
- Greedy community detection algorithm
- Degree centrality calculations
- Real-time cluster visualization with unique colors
- Display metrics: cluster count, avg connectivity, isolated nodes
- File: `lib/graph-clustering.ts`

### Persistent Conversation Memory
- Browser localStorage with auto-save
- Conversation session metadata (title, timestamps)
- Last 6 turns passed as Gemini context
- Clear history with confirmation
- File: `lib/conversation-memory.ts`

---

## Deployment

### Local Development
```bash
# 1. Quick start (built-in database)
cd o2c-graph-system
export GEMINI_API_KEY=your_key_here
python3 server.py
# Open http://localhost:3000

# 2. Rebuild from raw JSONL (optional)
python3 scripts/build_db.py /path/to/sap-o2c-data
```

### Docker
```bash
# Build image
docker build -t o2c-graph .

# Run container
docker run -p 3000:3000 \n  -e GEMINI_API_KEY=your_key_here \n  o2c-graph
```

### Cloud Deployment (Choose one)

**Railway.app** (recommended)
```bash
railway login
railway init
railway add
railway up
```
Set `GEMINI_API_KEY` in Railway dashboard.

**Render.com**
1. Connect GitHub repo
2. Create new service → Docker
3. Set `GEMINI_API_KEY` env var
4. Deploy

**Fly.io**
```bash
fly launch  # Interactive setup
fly secrets set GEMINI_API_KEY=your_key
fly deploy
```

---

## AI-Assisted Development

This project was built using AI tools (Claude, GitHub Copilot) as force multipliers for development speed. Full session logs document the iterative process, problem-solving approach, and architectural decisions.

### AI Session Logs
Location: `ai-sessions/` folder

| Session | Focus | Key Takeaway |
|---------|-------|--------------|
| **[Claude Session](./ai-sessions/claude-session.md)** | Architecture & strategy | Why SQLite over Neo4j, two-stage LLM pipeline |
| **[Copilot Session](./ai-sessions/github-copilot-session.md)** | Implementation & code generation | 700 lines generated, 90% accuracy on first draft |
| **[Debugging Session](./ai-sessions/debugging-session.md)** | Problem-solving | Root cause analysis, incremental fixes (6 issues/70 min) |
| **[Architecture Decisions](./ai-sessions/architecture-decisions.md)** | Design rationale | Tech stack trade-offs, cost analysis |
| **[Session Index](./ai-sessions/INDEX.md)** | Overview & analysis | Time saved: ~3 hours (57% efficiency gain) |

### How AI Was Used Effectively
- **Claude** for high-level strategy and architecture review
- **Copilot** for standard patterns, boilerplate, and code generation
- **Manual review** for all AI-generated code before merging
- **Testing** after every change to catch edge cases
- **Domain knowledge** provided by the developer (SAP schema, O2C processes)

### Time Investment
| Activity | Time | Notes |
|----------|------|-------|
| Architecture design | 45 min | AI-assisted planning |
| Core implementation | 120 min | ~700 lines via AI, refined to 99% accuracy |
| Feature debugging | 70 min | Root cause analysis + fixes |
| Testing & validation | 60 min | Manual verification of AI-generated code |
| Documentation | 30 min | README, comments, session logs |
| **Total** | **~325 min** | ~5.5 hours (high productivity) |

---

## Evaluation Criteria Coverage

| Criterion | Implementation | Evidence |
|-----------|----------------|----------|
| **Code quality** | Clean architecture, proper error handling, type safety | 0 compilation errors, documented patterns |
| **Graph modeling** | 7 entity types, 6 relationship types, proper normalization | `lib/graph-builder.ts`, data model diagram in README |
| **Database choice** | SQLite selected for right reasons (scale, ops cost, portability) | [Architecture Decisions](./ai-sessions/architecture-decisions.md) session |
| **LLM integration** | Two-stage pipeline, JSON mode, streaming, fallbacks | `app/api/chat/route.ts`, documented prompting strategy |
| **Guardrails** | Semantic + syntactic restrictions, effective filtering | System prompt + regex validation, tested with off-topic queries |
| **AI usage** | Active collaboration, iterative refinement, documented process | 5 comprehensive session logs in `ai-sessions/` |

---

## Troubleshooting

### Port Already in Use
```bash
# Change PORT in server.py or use environment
PORT=3001 python3 server.py
```

### Database File Missing
```bash
# Rebuild from JSONL
python3 scripts/build_db.py ./sap-o2c-data/
```

### API Key Issues
```bash
# Verify key is set correctly
echo $GEMINI_API_KEY  # macOS/Linux
echo %GEMINI_API_KEY%  # Windows
```

### Graph Visualization Not Loading
- Ensure Three.js is loading from CDN (network access)
- Check browser console for WebGL errors
- Try a different browser

---

## Resources

- **Google Gemini API:** https://ai.google.dev
- **3d-force-graph:** https://github.com/vasturiano/3d-force-graph
- **Three.js:** https://threejs.org
- **SQLite:** https://www.sqlite.org

---

## License

This project is provided as-is for educational purposes.

---

## Contact & Feedback

This is a Forward Deployed Engineer assignment submission.

For questions about the approach, architecture, or implementation, see:
- **Architecture decisions:** `ai-sessions/architecture-decisions.md`
- **Implementation details:** `ai-sessions/github-copilot-session.md`
- **How to extend:** `FEATURE_IMPLEMENTATION.md`
- **Submission guide:** `SUBMISSION_GUIDE.md`
