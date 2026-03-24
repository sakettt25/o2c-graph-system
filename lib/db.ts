import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH 
      ? path.resolve(process.env.DB_PATH)
      : path.join(process.cwd(), 'data', 'o2c.db');
    db = new Database(dbPath, { readonly: true });
    db.pragma('cache_size = 10000');
  }
  return db;
}

export function queryDb<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T[] {
  try {
    const database = getDb();
    const stmt = database.prepare(sql);
    return stmt.all(...params) as T[];
  } catch (err) {
    console.error('DB Query Error:', err, '\nSQL:', sql);
    throw err;
  }
}

export function queryDbOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T | undefined {
  const rows = queryDb<T>(sql, params);
  return rows[0];
}
