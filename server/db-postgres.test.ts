import assert from 'node:assert/strict';
import { openDb, schemaStats } from './db.ts';

const db = openDb();
try {
  const ping = await db.prepare('SELECT ?::integer AS value, ?::text AS label').get(42, 'opera');
  assert.equal(Number(ping.value), 42);
  assert.equal(ping.label, 'opera');

  const schema = await schemaStats(db);
  assert.ok(schema.tables >= 80, `expected Opera schema tables, got ${schema.tables}`);
  assert.ok(schema.views >= 2, `expected authorization views, got ${schema.views}`);

  const authView = await db.prepare(`SELECT count(*) AS n FROM information_schema.views
    WHERE table_schema = 'public' AND table_name IN ('v_user_access', 'v_developer_access')`).get();
  assert.equal(Number(authView.n), 2);

  await assert.rejects(db.transaction(async (tx) => {
    await tx.exec('CREATE TEMP TABLE opera_transaction_test (value integer) ON COMMIT DROP');
    await tx.prepare('INSERT INTO opera_transaction_test (value) VALUES (?)').run(7);
    throw new Error('rollback-check');
  }), /rollback-check/);

  console.log('PostgreSQL connection, parameter binding, schema, views, and transaction rollback passed.');
} finally {
  await db.close();
}