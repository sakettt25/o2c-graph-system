#!/usr/bin/env python3
"""
Build the SQLite database from SAP O2C JSONL data files.
Usage: python3 scripts/build_db.py [path-to-sap-o2c-data-dir]
"""
import json
import glob
import sqlite3
import os
import sys
from pathlib import Path

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).parent.parent / "sap-o2c-data")
DB_PATH  = str(Path(__file__).parent.parent / "data" / "o2c.db")

def load_jsonl(entity):
    records = []
    for fp in glob.glob(f"{DATA_DIR}/{entity}/part-*.jsonl"):
        with open(fp, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
    return records

ENTITIES = [
    "sales_order_headers",
    "sales_order_items",
    "billing_document_headers",
    "billing_document_items",
    "outbound_delivery_headers",
    "outbound_delivery_items",
    "payments_accounts_receivable",
    "journal_entry_items_accounts_receivable",
    "business_partners",
    "business_partner_addresses",
    "products",
    "product_descriptions",
    "plants",
    "billing_document_cancellations",
    "customer_company_assignments",
    "customer_sales_area_assignments",
    "sales_order_schedule_lines",
]

TABLE_ALIASES = {
    "journal_entry_items_accounts_receivable": "journal_entry_items",
}

def build():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    total = 0
    for entity in ENTITIES:
        rows = load_jsonl(entity)
        if not rows:
            print(f"  [skip] {entity} – no data found")
            continue

        tbl = TABLE_ALIASES.get(entity, entity)
        cols = list(rows[0].keys())
        col_defs = ", ".join(f'"{k}" TEXT' for k in cols)
        c.execute(f'CREATE TABLE IF NOT EXISTS "{tbl}" ({col_defs})')

        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(f'"{k}"' for k in cols)
        sql = f'INSERT OR REPLACE INTO "{tbl}" ({col_names}) VALUES ({placeholders})'

        inserted = 0
        for row in rows:
            vals = [str(row[k]) if row[k] is not None else None for k in cols]
            try:
                c.execute(sql, vals)
                inserted += 1
            except Exception as e:
                print(f"  [warn] row skip in {tbl}: {e}")

        conn.commit()
        total += inserted
        print(f"  ✓ {tbl}: {inserted} rows")

    # Verify
    print(f"\n  Total rows inserted: {total}")
    print(f"  DB size: {os.path.getsize(DB_PATH) / 1024:.0f} KB")
    conn.close()
    print(f"\n  Database written to: {DB_PATH}\n")

if __name__ == "__main__":
    print(f"\nBuilding O2C database from: {DATA_DIR}\n")
    if not os.path.isdir(DATA_DIR):
        print(f"[ERROR] Data directory not found: {DATA_DIR}")
        sys.exit(1)
    build()
    print("Done! Run: python3 server.py")
