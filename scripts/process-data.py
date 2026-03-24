#!/usr/bin/env python3
"""
SAP O2C Data Processing Script
Converts JSONL files into a SQLite database for the graph system.

Usage:
    python3 scripts/process-data.py \
        --input ./sap-o2c-data \
        --output ./data/o2c.db

Or just run: python3 scripts/process-data.py
(uses defaults: ../sap-o2c-data → ./data/o2c.db)
"""

import json
import glob
import sqlite3
import os
import sys
import argparse
from pathlib import Path

def load_jsonl(directory: str) -> list[dict]:
    records = []
    for filepath in glob.glob(f"{directory}/part-*.jsonl"):
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError as e:
                        print(f"  ⚠ Skipping malformed line in {filepath}: {e}")
    return records

def create_table(conn: sqlite3.Connection, table_name: str, rows: list[dict]) -> int:
    if not rows:
        print(f"  ⚠ No data found for {table_name}")
        return 0

    cursor = conn.cursor()
    cols = list(rows[0].keys())

    # Drop + recreate
    cursor.execute(f'DROP TABLE IF EXISTS "{table_name}"')
    col_defs = ", ".join([f'"{k}" TEXT' for k in cols])
    cursor.execute(f'CREATE TABLE "{table_name}" ({col_defs})')

    # Batch insert
    placeholders = ", ".join(["?" for _ in cols])
    col_names = ", ".join([f'"{k}"' for k in cols])
    sql = f'INSERT OR REPLACE INTO "{table_name}" ({col_names}) VALUES ({placeholders})'

    inserted = 0
    for row in rows:
        vals = [str(row[k]) if row.get(k) is not None else None for k in cols]
        try:
            cursor.execute(sql, vals)
            inserted += 1
        except sqlite3.Error as e:
            print(f"  ⚠ Insert error in {table_name}: {e}")

    return inserted

ENTITY_MAP = {
    "sales_order_headers":                      "sales_order_headers",
    "sales_order_items":                        "sales_order_items",
    "sales_order_schedule_lines":               "sales_order_schedule_lines",
    "billing_document_headers":                 "billing_document_headers",
    "billing_document_items":                   "billing_document_items",
    "billing_document_cancellations":           "billing_document_cancellations",
    "outbound_delivery_headers":                "outbound_delivery_headers",
    "outbound_delivery_items":                  "outbound_delivery_items",
    "payments_accounts_receivable":             "payments_accounts_receivable",
    "journal_entry_items_accounts_receivable":  "journal_entry_items",
    "business_partners":                        "business_partners",
    "business_partner_addresses":               "business_partner_addresses",
    "customer_company_assignments":             "customer_company_assignments",
    "customer_sales_area_assignments":          "customer_sales_area_assignments",
    "products":                                 "products",
    "product_descriptions":                     "product_descriptions",
    "product_plants":                           "product_plants",
    "plants":                                   "plants",
}

def main():
    parser = argparse.ArgumentParser(description="Process SAP O2C JSONL data into SQLite")
    parser.add_argument("--input", default="./sap-o2c-data", help="Path to sap-o2c-data directory")
    parser.add_argument("--output", default="./data/o2c.db", help="Output SQLite database path")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_path = Path(args.output)

    if not input_dir.exists():
        # Try parent directory
        alt = Path("../sap-o2c-data")
        if alt.exists():
            input_dir = alt
        else:
            print(f"❌ Input directory not found: {input_dir}")
            print("   Please pass --input /path/to/sap-o2c-data")
            sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()
        print(f"♻  Removed existing database: {output_path}")

    print(f"📂 Input:  {input_dir.resolve()}")
    print(f"🗄  Output: {output_path.resolve()}")
    print()

    conn = sqlite3.connect(str(output_path))
    total_rows = 0

    for folder_name, table_name in ENTITY_MAP.items():
        entity_dir = input_dir / folder_name
        if not entity_dir.exists():
            print(f"  – {folder_name} (not found, skipping)")
            continue

        rows = load_jsonl(str(entity_dir))
        count = create_table(conn, table_name, rows)
        total_rows += count
        print(f"  ✓ {table_name:<45} {count:>5} rows")

    conn.commit()

    # Create indexes for common JOIN columns
    print("\n📇 Creating indexes...")
    indexes = [
        ("billing_document_items", "referenceSdDocument"),
        ("outbound_delivery_items", "referenceSdDocument"),
        ("payments_accounts_receivable", "invoiceReference"),
        ("payments_accounts_receivable", "salesDocument"),
        ("journal_entry_items", "referenceDocument"),
        ("sales_order_headers", "soldToParty"),
        ("billing_document_headers", "soldToParty"),
        ("sales_order_items", "material"),
    ]
    for table, col in indexes:
        try:
            idx_name = f"idx_{table}_{col}"
            conn.execute(f'CREATE INDEX IF NOT EXISTS "{idx_name}" ON "{table}" ("{col}")')
            print(f"  ✓ {idx_name}")
        except sqlite3.Error as e:
            print(f"  ⚠ Index failed for {table}.{col}: {e}")

    conn.commit()
    conn.close()

    db_size = output_path.stat().st_size / 1024
    print(f"\n✅ Database created: {output_path}")
    print(f"   Size:       {db_size:.1f} KB")
    print(f"   Total rows: {total_rows:,}")
    print("\nYou can now run: npm run dev")

if __name__ == "__main__":
    main()
