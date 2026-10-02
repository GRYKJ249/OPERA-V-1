import { Pool, type PoolClient, type QueryResult } from 'pg';

export type Row = Record<string, any>;
type Executor = Pick<Pool | PoolClient, 'query'>;

const PG_NOW = `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Convert the remaining qmark placeholders without touching quoted SQL strings. */
function postgresSql(input: string): string {
  const sql = input
    .replace(/strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/gi, PG_NOW)
    .replace(/strftime\('%Y-%m-%dT%H:%M:%fZ','now','([+-]\d+)\s+(second|minute|hour|day|month|year)s?'\)/gi,
      (_, amount: string, unit: string) =>
        `to_char(((CURRENT_TIMESTAMP + INTERVAL '${amount} ${unit}') AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
  let out = '';
  let index = 0;
  let quote: "'" | '"' | '`' | null = null;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      out += char;
      if (char === quote) {
        if (sql[i + 1] === quote) out += sql[++i];
        else quote = null;
      } else if (char === '\\' && sql[i + 1]) {
        out += sql[++i];
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char === '`' ? '"' : char;
    } else if (char === '?') {
      out += `$${++index}`;
    } else {
      out += char;
    }
  }
  return out;
}

export class Database {
  private readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) {
      throw new Error('DATABASE_URL is missing. Connect the Replit PostgreSQL database before starting Opera.');
    }
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    this.pool.on('error', (error) => console.error('[database] idle client error', error.message));
  }

  async query<T extends Row = Row>(sql: string, values: unknown[] = [], executor: Executor = this.pool): Promise<QueryResult<T>> {
    return executor.query<T>(postgresSql(sql), values as any[]);
  }

  prepare(sql: string) {
    return {
      get: async (...values: unknown[]) => (await this.query(sql, values)).rows[0],
      all: async (...values: unknown[]) => (await this.query(sql, values)).rows,
      run: async (...values: unknown[]) => {
        const result = await this.query(sql, values);
        return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows[0]?.id };
      },
    };
  }

  async exec(sql: string, executor: Executor = this.pool): Promise<void> {
    await executor.query(postgresSql(sql));
  }

  async transaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new DatabaseTransaction(client);
    try {
      await client.query('BEGIN');
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class DatabaseTransaction {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  query<T extends Row = Row>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    return this.client.query<T>(postgresSql(sql), values as any[]);
  }

  prepare(sql: string) {
    return {
      get: async (...values: unknown[]) => (await this.query(sql, values)).rows[0],
      all: async (...values: unknown[]) => (await this.query(sql, values)).rows,
      run: async (...values: unknown[]) => {
        const result = await this.query(sql, values);
        return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows[0]?.id };
      },
    };
  }

  exec(sql: string): Promise<void> {
    return this.client.query(postgresSql(sql)).then(() => undefined);
  }
}

export const openDb = () => new Database();

export async function purgeExpired(db: Database, keepAttemptsDays = 30): Promise<Record<string, number>> {
  const now = new Date().toISOString();
  const cutoff30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const cutoff1 = new Date(Date.now() - 86_400_000).toISOString();
  const attemptsCutoff = new Date(Date.now() - Math.floor(keepAttemptsDays) * 86_400_000).toISOString();
  const queries: Record<string, { sql: string; values: unknown[] }> = {
    sessions: { sql: 'DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?', values: [now, cutoff30] },
    password_resets: { sql: 'DELETE FROM password_resets WHERE expires_at < ?', values: [now] },
    email_verifications: { sql: 'DELETE FROM email_verifications WHERE expires_at < ?', values: [now] },
    trusted_devices: { sql: 'DELETE FROM trusted_devices WHERE expires_at < ?', values: [now] },
    ip_blocklist: { sql: 'DELETE FROM ip_blocklist WHERE expires_at IS NOT NULL AND expires_at < ?', values: [now] },
    rate_limits: { sql: 'DELETE FROM rate_limits WHERE window_start < ?', values: [cutoff1] },
    login_attempts: { sql: 'DELETE FROM login_attempts WHERE created_at < ?', values: [attemptsCutoff] },
  };
  const out: Record<string, number> = {};
  for (const [table, { sql, values }] of Object.entries(queries)) {
    const result = await db.prepare(sql).run(...values);
    out[table] = result.changes;
  }
  return out;
}

export async function schemaStats(db: Database) {
  const result = await db.query<{ tables: string; views: string; indexes: string }>(`
    SELECT
      (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')::text AS tables,
      (SELECT count(*) FROM information_schema.views WHERE table_schema = 'public')::text AS views,
      (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')::text AS indexes
  `);
  const row = result.rows[0];
  return { tables: Number(row.tables), views: Number(row.views), indexes: Number(row.indexes) };
}

const RETENTION_TABLES = new Set(['page_views', 'search_log', 'dev_logs', 'slow_queries', 'email_outbox']);
export async function applyRetention(db: Database): Promise<Record<string, number>> {
  const rows = await db.prepare('SELECT table_name, days FROM data_retention_policies WHERE enabled = 1').all() as { table_name: string; days: number }[];
  const out: Record<string, number> = {};
  for (const { table_name, days } of rows) {
    if (!RETENTION_TABLES.has(table_name)) continue;
    const cutoff = new Date(Date.now() - Math.floor(days) * 86_400_000).toISOString();
    const result = await db.prepare(`DELETE FROM "${table_name}" WHERE created_at < ?`).run(cutoff);
    out[table_name] = result.changes;
  }
  return out;
}