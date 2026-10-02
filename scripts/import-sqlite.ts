import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

const source = process.env.SQLITE_IMPORT_FILE;
if (!source) throw new Error('Set SQLITE_IMPORT_FILE to the SQLite file to migrate.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the PostgreSQL destination.');

const sqlite = new DatabaseSync(source, { readOnly: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

try {
  const hasData = await pool.query('SELECT EXISTS (SELECT 1 FROM users) AS populated');
  if (hasData.rows[0].populated) {
    throw new Error('The PostgreSQL users table is not empty; refusing to merge into an existing database.');
  }

  const tables = sqlite.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND sql IS NOT NULL AND name <> 'sqlite_sequence'
      AND name NOT LIKE '%_fts' AND name NOT LIKE '%_fts_%'
    ORDER BY name`).all() as { name: string }[];
  const counts: Array<{ table: string; rows: number }> = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    for (const { name } of tables) {
      const columns = sqlite.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string; pk: number }[];
      if (!columns.length) continue;
      const names = columns.map(({ name: column }) => quote(column));
      const rows = sqlite.prepare(`SELECT ${names.join(', ')} FROM ${quote(name)}`).all() as Record<string, unknown>[];
      for (const row of rows) {
        const values = columns.map(({ name: column }) => row[column]);
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        await client.query(
          `INSERT INTO ${quote(name)} (${names.join(', ')}) VALUES (${placeholders})`,
          values,
        );
      }
      counts.push({ table: name, rows: rows.length });
    }

    for (const { name } of tables) {
      const info = sqlite.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string; type: string; pk: number }[];
      const id = info.find((column) => column.pk && /^INTEGER$/i.test(column.type));
      if (!id) continue;
      await client.query(`SELECT setval(pg_get_serial_sequence($1, $2), GREATEST(COALESCE(MAX(${quote(id.name)}), 1), 1), count(*) > 0)
        FROM ${quote(name)}`, [`public.${name}`, id.name]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  console.log(`Imported ${counts.reduce((sum, entry) => sum + entry.rows, 0)} rows from ${counts.length} tables.`);
  for (const entry of counts) if (entry.rows) console.log(`${entry.table}: ${entry.rows}`);
} finally {
  sqlite.close();
  await pool.end();
}