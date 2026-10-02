import { openDb, schemaStats } from './db.ts';

const db = openDb();
try {
  await db.query('SELECT 1');
  const schema = await schemaStats(db);
  if (schema.tables < 80) throw new Error(`PostgreSQL schema is incomplete (${schema.tables} tables found).`);
  console.log(`PostgreSQL is ready: ${schema.tables} tables, ${schema.views} views, ${schema.indexes} indexes.`);
} finally {
  await db.close();
}
