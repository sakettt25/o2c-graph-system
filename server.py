#!/usr/bin/env python3
"""
O2C Graph Intelligence — Python stdlib server
Run:  python3 server.py
Open: http://localhost:3000
"""

import http.server
import socketserver
import json
import sqlite3
import os
import sys
import re
import urllib.request
import urllib.error
import urllib.parse
import threading
from pathlib import Path
from urllib.parse import urlparse, unquote

# ─── Config ──────────────────────────────────────────────────────────────────

PORT            = int(os.environ.get("PORT", 3000))
DB_PATH         = os.environ.get("DB_PATH", str(Path(__file__).parent / "data" / "o2c.db"))
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL    = "gemini-1.5-flash-latest"
BASE_DIR        = Path(__file__).parent

# ─── Database ────────────────────────────────────────────────────────────────

_db_local = threading.local()

def get_db():
    if not hasattr(_db_local, "conn") or _db_local.conn is None:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        _db_local.conn = conn
    return _db_local.conn

def query(sql, params=()):
    try:
        cur = get_db().execute(sql, params)
        return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        print(f"[DB ERROR] {e}\n  SQL: {sql[:140]}")
        raise

def query_one(sql, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None

# ─── Graph Builder ────────────────────────────────────────────────────────────
#
# Confirmed O2C chain (from actual FK analysis):
#   Customer ──PLACED──────► SalesOrder          (soldToParty)
#   SalesOrder ──CONTAINS──► Product             (sales_order_items.material)
#   SalesOrder ──SHIPS_VIA──► Delivery            (outbound_delivery_items.referenceSdDocument)
#   Delivery ──BILLED_VIA──► BillingDocument      (billing_document_items.referenceSdDocument = deliveryDoc)
#   BillingDocument ──POSTED_TO──► JournalEntry   (journal_entry_items.referenceDocument = billingDocument)
#   BillingDocument ──SETTLED_BY──► Payment       (billing_document_headers.accountingDocument = payments.accountingDocument)
#   Customer ──PAID──────────► Payment            (payments.customer)

NODE_COLORS = {
    "SalesOrder":      "#3b82f6",
    "BillingDocument": "#10b981",
    "Delivery":        "#f59e0b",
    "Payment":         "#8b5cf6",
    "JournalEntry":    "#ec4899",
    "Customer":        "#14b8a6",
    "Product":         "#f97316",
}
NODE_SIZES = {
    "Customer": 14, "SalesOrder": 8, "BillingDocument": 7,
    "Delivery": 7, "Payment": 6, "JournalEntry": 6, "Product": 5,
}

def build_graph(limit=200):
    nodes, links, node_set = [], [], set()

    def add_node(nid, ntype, label, data):
        if nid not in node_set:
            node_set.add(nid)
            nodes.append({
                "id": nid, "nodeType": ntype, "label": label,
                "color": NODE_COLORS.get(ntype, "#64748b"),
                "val":   NODE_SIZES.get(ntype, 5),
                "data":  data,
            })

    def add_link(src, tgt, ltype, label):
        if src in node_set and tgt in node_set:
            links.append({"source": src, "target": tgt, "type": ltype, "label": label})

    # 1. Customers
    for r in query("SELECT * FROM business_partners"):
        nid = f"customer_{r['customer']}"
        name = r.get("businessPartnerFullName") or r.get("businessPartnerName") or f"Customer {r['customer']}"
        add_node(nid, "Customer", name, r)

    # 2. Products
    for r in query("""SELECT p.*, pd.productDescription
                      FROM products p
                      LEFT JOIN product_descriptions pd ON p.product=pd.product AND pd.language='EN'
                      LIMIT 100"""):
        add_node(f"product_{r['product']}", "Product",
                 r.get("productDescription") or r["product"], r)

    # 3. Sales Orders
    for r in query(f"SELECT * FROM sales_order_headers LIMIT {limit}"):
        nid = f"so_{r['salesOrder']}"
        add_node(nid, "SalesOrder", f"SO {r['salesOrder']}", r)
        cid = f"customer_{r.get('soldToParty','')}"
        if cid in node_set:
            links.append({"source": cid, "target": nid, "type": "PLACED", "label": "placed"})

    # 3b. SO → Product (via sales_order_items)
    for r in query("SELECT DISTINCT salesOrder, material FROM sales_order_items WHERE material IS NOT NULL LIMIT 400"):
        s, p = f"so_{r['salesOrder']}", f"product_{r['material']}"
        if s in node_set and p in node_set:
            links.append({"source": s, "target": p, "type": "CONTAINS", "label": "contains"})

    # 4. Deliveries
    for r in query(f"SELECT * FROM outbound_delivery_headers LIMIT {limit}"):
        nid = f"del_{r['deliveryDocument']}"
        add_node(nid, "Delivery", f"DEL {r['deliveryDocument']}", r)

    # 4b. SO → Delivery (via outbound_delivery_items.referenceSdDocument)
    for r in query("SELECT DISTINCT deliveryDocument, referenceSdDocument FROM outbound_delivery_items WHERE referenceSdDocument IS NOT NULL LIMIT 400"):
        d, s = f"del_{r['deliveryDocument']}", f"so_{r['referenceSdDocument']}"
        if d in node_set and s in node_set:
            links.append({"source": s, "target": d, "type": "SHIPS_VIA", "label": "ships via"})

    # 5. Billing Documents
    for r in query(f"SELECT * FROM billing_document_headers WHERE billingDocumentIsCancelled != 'true' LIMIT {limit}"):
        nid = f"bill_{r['billingDocument']}"
        add_node(nid, "BillingDocument", f"BILL {r['billingDocument']}", r)

    # 5b. Delivery → BillingDocument (via billing_document_items.referenceSdDocument = deliveryDocument)
    for r in query("SELECT DISTINCT billingDocument, referenceSdDocument FROM billing_document_items WHERE referenceSdDocument IS NOT NULL LIMIT 500"):
        b, d = f"bill_{r['billingDocument']}", f"del_{r['referenceSdDocument']}"
        if b in node_set and d in node_set:
            links.append({"source": d, "target": b, "type": "BILLED_VIA", "label": "billed via"})

    # 6. Journal Entries  
    seen_je = set()
    for r in query(f"SELECT DISTINCT accountingDocument, referenceDocument, transactionCurrency, amountInTransactionCurrency, postingDate, accountingDocumentType FROM journal_entry_items LIMIT {limit}"):
        nid = f"je_{r['accountingDocument']}"
        if nid not in seen_je:
            seen_je.add(nid)
            add_node(nid, "JournalEntry", f"JE {r['accountingDocument']}", r)
        # JE ← BillingDocument (journal_entry.referenceDocument = billing.billingDocument)
        if r.get("referenceDocument"):
            b = f"bill_{r['referenceDocument']}"
            if b in node_set:
                links.append({"source": b, "target": nid, "type": "POSTED_TO", "label": "posted to"})

    # 7. Payments (billing.accountingDocument = payment.accountingDocument)
    for r in query(f"SELECT pay.* FROM payments_accounts_receivable pay LIMIT {limit}"):
        nid = f"pay_{r['accountingDocument']}_{r['accountingDocumentItem']}"
        add_node(nid, "Payment", f"PAY {r['accountingDocument']}", r)
        # Customer → Payment
        if r.get("customer"):
            cid = f"customer_{r['customer']}"
            if cid in node_set:
                links.append({"source": cid, "target": nid, "type": "PAID", "label": "paid"})

    # Billing → Payment via accountingDocument
    bill_acctg = {r['accountingDocument']: f"bill_{r['billingDocument']}"
                  for r in query("SELECT billingDocument, accountingDocument FROM billing_document_headers WHERE accountingDocument IS NOT NULL")}
    for l in list(links):
        pass  # already built; now add billing→payment
    for r in query("SELECT DISTINCT accountingDocument, accountingDocumentItem FROM payments_accounts_receivable"):
        nid = f"pay_{r['accountingDocument']}_{r['accountingDocumentItem']}"
        if nid in node_set and r['accountingDocument'] in bill_acctg:
            b = bill_acctg[r['accountingDocument']]
            if b in node_set:
                links.append({"source": b, "target": nid, "type": "SETTLED_BY", "label": "settled by"})

    # Deduplicate
    seen, unique = set(), []
    for l in links:
        k = f"{l['source']}->{l['target']}->{l['type']}"
        if k not in seen:
            seen.add(k)
            unique.append(l)

    return {"nodes": nodes, "links": unique}


def get_node_details(node_id):
    parts = node_id.split("_", 1)
    prefix, raw_id = parts[0], (parts[1] if len(parts) > 1 else "")

    if prefix == "so":
        row = query_one("SELECT * FROM sales_order_headers WHERE salesOrder=?", (raw_id,))
        if row:
            row["items"] = query("SELECT salesOrderItem, material, requestedQuantity, netAmount FROM sales_order_items WHERE salesOrder=? LIMIT 10", (raw_id,))
        return row, "SalesOrder", f"SO {raw_id}"

    elif prefix == "bill":
        row = query_one("SELECT * FROM billing_document_headers WHERE billingDocument=?", (raw_id,))
        if row:
            row["items"] = query("SELECT billingDocumentItem, material, billingQuantity, netAmount, referenceSdDocument FROM billing_document_items WHERE billingDocument=? LIMIT 10", (raw_id,))
        return row, "BillingDocument", f"BILL {raw_id}"

    elif prefix == "del":
        row = query_one("SELECT * FROM outbound_delivery_headers WHERE deliveryDocument=?", (raw_id,))
        if row:
            row["items"] = query("SELECT deliveryDocumentItem, plant, actualDeliveryQuantity, referenceSdDocument FROM outbound_delivery_items WHERE deliveryDocument=? LIMIT 10", (raw_id,))
        return row, "Delivery", f"DEL {raw_id}"

    elif prefix == "pay":
        doc_id = raw_id.rsplit("_", 1)[0]
        row = query_one("SELECT * FROM payments_accounts_receivable WHERE accountingDocument=? LIMIT 1", (doc_id,))
        return row, "Payment", f"PAY {doc_id}"

    elif prefix == "je":
        row = query_one("SELECT * FROM journal_entry_items WHERE accountingDocument=? LIMIT 1", (raw_id,))
        return row, "JournalEntry", f"JE {raw_id}"

    elif prefix == "customer":
        row = query_one("SELECT * FROM business_partners WHERE customer=?", (raw_id,))
        if row:
            row["recentOrders"] = query("SELECT salesOrder, totalNetAmount, creationDate FROM sales_order_headers WHERE soldToParty=? LIMIT 5", (raw_id,))
        return row, "Customer", (row.get("businessPartnerFullName") or f"Customer {raw_id}") if row else f"Customer {raw_id}"

    elif prefix == "product":
        row = query_one("""SELECT p.*, pd.productDescription FROM products p
                           LEFT JOIN product_descriptions pd ON p.product=pd.product AND pd.language='EN'
                           WHERE p.product=?""", (raw_id,))
        return row, "Product", (row.get("productDescription") or raw_id) if row else raw_id

    return None, None, None


# ─── Gemini ───────────────────────────────────────────────────────────────────

DB_SCHEMA = """
CONFIRMED O2C FLOW (verified against actual data):
  Customer → SalesOrder → Delivery → BillingDocument → JournalEntry
                                   ↘ Payment (via accountingDocument)

Tables and VERIFIED join conditions:
- sales_order_headers: salesOrder(PK), salesOrderType, soldToParty(→bp.customer), creationDate, totalNetAmount, overallDeliveryStatus(A/B/C), overallOrdReltdBillgStatus(A/B/C), transactionCurrency, requestedDeliveryDate
- sales_order_items: salesOrder(FK→SO), salesOrderItem(PK), material(→products.product), requestedQuantity, netAmount, productionPlant
- billing_document_headers: billingDocument(PK), billingDocumentType, creationDate, billingDocumentDate, totalNetAmount, transactionCurrency, accountingDocument(→payments+JE), soldToParty(→bp.customer), billingDocumentIsCancelled
- billing_document_items: billingDocument(FK), billingDocumentItem(PK), material(→products), billingQuantity, netAmount, referenceSdDocument(=outbound_delivery_headers.deliveryDocument), referenceSdDocumentItem
- outbound_delivery_headers: deliveryDocument(PK), shippingPoint, creationDate, actualGoodsMovementDate, overallGoodsMovementStatus, overallPickingStatus
- outbound_delivery_items: deliveryDocument(FK), deliveryDocumentItem(PK), plant, actualDeliveryQuantity, referenceSdDocument(=sales_order_headers.salesOrder), referenceSdDocumentItem
- payments_accounts_receivable: accountingDocument(PK,=billing_document_headers.accountingDocument), accountingDocumentItem(PK), companyCode, fiscalYear, clearingDate, amountInTransactionCurrency, transactionCurrency, customer(→bp.customer), postingDate, glAccount
- journal_entry_items: accountingDocument(PK,=billing_document_headers.accountingDocument), accountingDocumentItem(PK), glAccount, referenceDocument(=billing_document_headers.billingDocument), transactionCurrency, amountInTransactionCurrency, postingDate, documentDate, accountingDocumentType, customer
- business_partners: businessPartner(PK), customer(unique key), businessPartnerFullName, businessPartnerName, businessPartnerCategory, industry
- products: product(PK), productType, productGroup, baseUnit, grossWeight
- product_descriptions: product(FK), language, productDescription
- plants: plant(PK), plantName, country, cityName
- billing_document_cancellations: billingDocument(PK), cancelledBillingDocument, totalNetAmount, soldToParty

CRITICAL JOIN RULES (verified):
1. SO → Delivery:  outbound_delivery_items.referenceSdDocument = sales_order_headers.salesOrder
2. Delivery → Billing: billing_document_items.referenceSdDocument = outbound_delivery_headers.deliveryDocument  
3. Billing → JournalEntry: journal_entry_items.referenceDocument = billing_document_headers.billingDocument
4. Billing → Payment: billing_document_headers.accountingDocument = payments_accounts_receivable.accountingDocument
5. Customer → SO: sales_order_headers.soldToParty = business_partners.customer
"""

SYSTEM_PROMPT = f"""You are an expert SAP Order-to-Cash (O2C) data analyst assistant. 
ONLY answer questions about the O2C dataset below. Refuse ALL other requests.

{DB_SCHEMA}

GUARDRAILS (CRITICAL):
- Refuse ALL non-O2C requests: general knowledge, coding, weather, recipes, math, news, etc.
- For guardrail cases respond: {{"type":"guardrail","message":"This system is designed to answer questions related to the Order-to-Cash dataset only."}}
- Only generate SELECT/WITH queries. Never INSERT/UPDATE/DELETE/DROP/CREATE.

RESPOND with valid JSON only (no markdown fences, no extra text):

For data questions:
{{"type":"data","sql":"<SQLite SELECT>","explanation":"<brief description>"}}

For off-topic/guardrail:
{{"type":"guardrail","message":"..."}}

SQL RULES:
- SQLite syntax only (no ILIKE, no ::cast, no QUALIFY)
- LIMIT 100 unless counting
- CAST(totalNetAmount AS REAL) for arithmetic
- billingDocumentIsCancelled != 'true' for active billing docs
- Status codes: A=not started, B=partial, C=complete
- Use the VERIFIED join conditions above (not assumptions)
- For full O2C trace: SO → delivery (via odi.referenceSdDocument) → billing (via bdi.referenceSdDocument) → JE (via referenceDocument) → payment (via accountingDocument)
"""


def call_gemini_json(user_msg, history):
    if not GEMINI_API_KEY:
        return {"type": "guardrail", "message": "GEMINI_API_KEY not configured. Set: export GEMINI_API_KEY=your_key"}

    messages = []
    for m in history[-6:]:
        messages.append({
            "role": "model" if m["role"] == "assistant" else "user",
            "parts": [{"text": m["content"]}],
        })
    messages.append({"role": "user", "parts": [{"text": user_msg}]})

    payload = json.dumps({
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": messages,
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 1024,
            "responseMimeType": "application/json",
        },
    }).encode()

    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}")
    req = urllib.request.Request(url, data=payload,
                                  headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
        return json.loads(text)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:300]
        print(f"[Gemini HTTP {e.code}] {err_body}")
        return {"type": "guardrail", "message": f"Gemini API error {e.code}. Check your API key."}
    except Exception as e:
        print(f"[Gemini error] {type(e).__name__}: {e}")
        return {"type": "guardrail", "message": "Failed to reach AI service. Please retry."}


def stream_gemini_answer(user_msg, sql, rows, history):
    if not GEMINI_API_KEY:
        yield "GEMINI_API_KEY not set — add it to start using AI chat."
        return

    row_txt = (f"{len(rows)} row(s):\n{json.dumps(rows[:25], indent=2, default=str)}"
               if rows else "Query returned 0 rows.")
    prompt = (
        f'User asked: "{user_msg}"\n\n'
        f"SQL: {sql}\n\n"
        f"Results:\n{row_txt}\n\n"
        "Write a concise, data-grounded answer (2-4 sentences, ≤150 words). "
        "Reference specific IDs, amounts, or counts from the results. "
        "If 0 rows, explain business meaning. Do NOT repeat the SQL."
    )

    messages = [{"role": "user", "parts": [{"text": prompt}]}]
    payload = json.dumps({
        "contents": messages,
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 512},
    }).encode()

    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{GEMINI_MODEL}:streamGenerateContent?alt=sse&key={GEMINI_API_KEY}")
    req = urllib.request.Request(url, data=payload,
                                  headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data: "):
                    continue
                json_str = line[6:]
                if json_str == "[DONE]":
                    return
                try:
                    chunk = json.loads(json_str)
                    text  = chunk["candidates"][0]["content"]["parts"][0].get("text", "")
                    if text:
                        yield text
                except Exception:
                    pass
    except Exception as e:
        yield f"Streaming error: {e}"


def extract_highlight_nodes(rows):
    node_ids, seen = [], set()
    for row in rows:
        for k, v in row.items():
            if not v:
                continue
            lk = k.lower()
            nid = None
            if "salesorder" in lk and "item" not in lk and "type" not in lk and "org" not in lk:
                nid = f"so_{v}"
            elif "billingdocument" in lk and "item" not in lk and "type" not in lk and "cancel" not in lk:
                nid = f"bill_{v}"
            elif "deliverydocument" in lk and "item" not in lk:
                nid = f"del_{v}"
            elif lk == "accountingdocument":
                nid = f"je_{v}"
            elif lk in ("customer", "soldtoparty"):
                nid = f"customer_{v}"
            elif lk in ("material", "product"):
                nid = f"product_{v}"
            if nid and nid not in seen:
                seen.add(nid)
                node_ids.append(nid)
    return node_ids[:50]


def get_summary():
    def cnt(sql):
        return (query_one(sql) or {}).get("c", 0)
    return {
        "salesOrders":      cnt("SELECT COUNT(*) as c FROM sales_order_headers"),
        "billingDocuments": cnt("SELECT COUNT(*) as c FROM billing_document_headers WHERE billingDocumentIsCancelled!='true'"),
        "deliveries":       cnt("SELECT COUNT(*) as c FROM outbound_delivery_headers"),
        "payments":         cnt("SELECT COUNT(*) as c FROM payments_accounts_receivable"),
        "customers":        cnt("SELECT COUNT(*) as c FROM business_partners"),
        "products":         cnt("SELECT COUNT(*) as c FROM products"),
        "totalRevenue": round(
            (query_one("SELECT SUM(CAST(totalNetAmount AS REAL)) as t FROM billing_document_headers WHERE billingDocumentIsCancelled!='true'") or {}).get("t") or 0, 2
        ),
        "currency": (query_one("SELECT transactionCurrency as c FROM billing_document_headers LIMIT 1") or {}).get("c", "INR"),
    }


# ─── HTTP Handler ─────────────────────────────────────────────────────────────

class Handler(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"  [{self.address_string()}] {fmt % args}")

    def send_json(self, data, status=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, path: Path, mime: str):
        try:
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_error(404, f"File not found: {path}")

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/") or "/"

        if path in ("/", "/index.html"):
            self.serve_file(BASE_DIR / "static" / "index.html", "text/html; charset=utf-8")

        elif path == "/api/summary":
            self.send_json(get_summary())

        elif path == "/api/graph":
            self.send_json(build_graph(200))

        elif path.startswith("/api/node/"):
            node_id = unquote(path[len("/api/node/"):])
            row, ntype, label = get_node_details(node_id)
            if row:
                self.send_json({"id": node_id, "nodeType": ntype, "label": label, "data": row})
            else:
                self.send_json({"error": "Not found"}, 404)

        else:
            self.send_error(404)

    def do_POST(self):
        if self.path.rstrip("/") == "/api/chat":
            self._handle_chat()
        else:
            self.send_error(404)

    def _handle_chat(self):
        body     = self.read_json_body()
        user_msg = (body.get("message") or "").strip()
        history  = body.get("history") or []

        if not user_msg:
            self.send_json({"error": "empty message"}, 400)
            return

        # Step 1 — Classify + generate SQL via Gemini
        classified = call_gemini_json(user_msg, history)

        if classified.get("type") in ("guardrail", "clarify"):
            self.send_json({
                "type":   classified["type"],
                "answer": classified.get("message", ""),
                "sql": None, "rows": [], "highlightedNodes": [],
            })
            return

        sql = (classified.get("sql") or "").strip()
        if not sql:
            self.send_json({"type": "error",
                            "answer": "Could not generate a query. Please rephrase.",
                            "sql": None, "rows": [], "highlightedNodes": []})
            return

        # Step 2 — Safety gate (SELECT only)
        if not re.match(r"^\s*(SELECT|WITH)\s", sql, re.IGNORECASE):
            self.send_json({"type": "guardrail",
                            "answer": "Only SELECT queries are permitted.",
                            "sql": sql, "rows": [], "highlightedNodes": []})
            return

        # Step 3 — Execute SQL
        try:
            rows = query(sql)
        except Exception as e:
            self.send_json({"type": "error",
                            "answer": f"Query execution error: {e}",
                            "sql": sql, "rows": [], "highlightedNodes": []})
            return

        highlighted = extract_highlight_nodes(rows)

        # Step 4 — Stream NL answer
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-SQL",               urllib.parse.quote(sql))
        self.send_header("X-Highlighted-Nodes", urllib.parse.quote(json.dumps(highlighted)))
        self.send_header("X-Rows-Preview",      urllib.parse.quote(json.dumps(rows[:50], default=str)))
        self.end_headers()

        try:
            for chunk in stream_gemini_answer(user_msg, sql, rows, history):
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except BrokenPipeError:
            pass


class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads    = True
    allow_reuse_address = True


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not Path(DB_PATH).exists():
        print(f"\n[ERROR] Database not found: {DB_PATH}")
        print("Build it first: python3 scripts/build_db.py\n")
        sys.exit(1)

    key_status = "✓ configured" if GEMINI_API_KEY else "✗ NOT SET (chat disabled)"
    print(f"""
╔══════════════════════════════════════════════════════╗
║        O2C Graph Intelligence  ·  v1.0               ║
╚══════════════════════════════════════════════════════╝
  URL  →  http://localhost:{PORT}
  DB   →  {DB_PATH}
  AI   →  Gemini 1.5 Flash  [{key_status}]
{'  ⚠  Set GEMINI_API_KEY for AI chat:' if not GEMINI_API_KEY else ''}
{'     export GEMINI_API_KEY=your_key_here' if not GEMINI_API_KEY else ''}
  Press Ctrl+C to stop
""")

    with ThreadedServer(("", PORT), Handler) as srv:
        srv.serve_forever()
