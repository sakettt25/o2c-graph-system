import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { readFile } from 'fs/promises';

let db: SqlJsDatabase | null = null;
let initPromise: Promise<SqlJsDatabase> | null = null;
let initError: Error | null = null;

async function initDb(): Promise<SqlJsDatabase> {
  if (db) return db;
  if (initError) throw initError;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const SQL = await initSqlJs();
      const dbPath = process.env.DB_PATH 
        ? path.resolve(process.env.DB_PATH)
        : path.join(process.cwd(), 'data', 'o2c.db');
      
      console.log('[DB] Initializing database from:', dbPath);
      
      try {
        const fileBuffer = await readFile(dbPath);
        db = new SQL.Database(fileBuffer);
        console.log('[DB] Database initialized successfully');
        return db;
      } catch (fileErr) {
        console.error('[DB] Failed to read database file:', fileErr);
        // Create an empty database if file doesn't exist
        db = new SQL.Database();
        console.log('[DB] Created empty database');
        return db;
      }
    } catch (err) {
      console.error('[DB] Database initialization failed:', err);
      initError = err as Error;
      throw err;
    }
  })();

  return initPromise;
}

export function queryDb<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T[] {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  
  try {
    const stmt = db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params as Parameters<typeof stmt.bind>[0]);
    }
    
    const results: T[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as T;
      results.push(row);
    }
    stmt.free();
    
    return results;
  } catch (err) {
    console.error('DB Query Error:', err, '\nSQL:', sql);
    throw err;
  }
}

// Export initDb for initialization
export { initDb };

export function queryDbOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T | undefined {
  const rows = queryDb<T>(sql, params);
  return rows[0];
}
