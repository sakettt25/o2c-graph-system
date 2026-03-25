import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

let db: SqlJsDatabase | null = null;
let initPromise: Promise<SqlJsDatabase> | null = null;
let initError: Error | null = null;

async function initDb(): Promise<SqlJsDatabase> {
  if (db) return db;
  if (initError) throw initError;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('[DB] Initializing SQL.js...');
      // For Next.js compatibility, use a slightly different initialization
      const SQL = await initSqlJs({
        locateFile: (filename: string) => {
          // Handle both Node.js and browser environments
          if (typeof window === 'undefined') {
            // Node.js environment
            return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', filename);
          } else {
            // Browser environment
            return `/sql.js/${filename}`;
          }
        }
      });
      console.log('[DB] SQL.js initialized successfully');
      
      const dbPath = process.env.DB_PATH 
        ? path.resolve(process.env.DB_PATH)
        : path.join(process.cwd(), 'data', 'o2c.db');
      
      console.log('[DB] Initializing database from:', dbPath);
      console.log('[DB] CWD:', process.cwd());
      console.log('[DB] File exists:', existsSync(dbPath));
      
      const fileBuffer = await readFile(dbPath);
      console.log('[DB] File read successfully, size:', fileBuffer.length, 'bytes');
      
      db = new SQL.Database(fileBuffer);
      const tableCount = db.exec('SELECT COUNT(*) as count FROM sqlite_master WHERE type="table"')[0]?.values[0]?.[0] || 0;
      console.log('[DB] Database initialized successfully with', tableCount, 'tables');
      return db;
    } catch (err) {
      console.error('[DB] Database initialization failed:', err instanceof Error ? err.message : String(err));
      if (err instanceof Error) console.error('[DB] Stack:', err.stack);
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
