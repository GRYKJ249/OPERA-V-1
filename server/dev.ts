import { createHash } from 'node:crypto';
import type { Database } from './db.ts';
import { verifyPassword } from './password.ts';

export async function requireDeveloper(db: Database, email: string): Promise<void> {
  if (!await db.prepare('SELECT 1 FROM v_developer_access WHERE email = ?').get(email)) {
    throw new Error('developer access denied');
  }
}

export async function logDev(
  db: Database,
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  source: string,
  message: string,
  context: object = {},
  stack?: string,
): Promise<void> {
  await db.prepare('INSERT INTO dev_logs (level, source, message, stack, context) VALUES (?, ?, ?, ?, ?)')
    .run(level, source, message, stack ?? null, JSON.stringify(context));
}

export async function timed<T = any>(
  db: Database,
  email: string,
  sql: string,
  params: any[] = [],
  thresholdMs = 50,
  caller = 'dev.timed',
): Promise<{ rows: T[]; ms: number }> {
  await requireDeveloper(db, email);
  const started = performance.now();
  const rows = await db.prepare(sql).all(...params) as T[];
  const ms = performance.now() - started;
  if (ms >= thresholdMs) {
    await db.prepare('INSERT INTO slow_queries (sql, duration_ms, caller) VALUES (?, ?, ?)')
      .run(sql.slice(0, 2000), ms, caller);
  }
  return { rows, ms };
}

/** Use Replit's managed database backups rather than file-based SQLite snapshots. */
export async function snapshot(_db: Database, _email: string, _file: string, _note?: string): Promise<never> {
  throw new Error('Database snapshots are managed by Replit; use the database pane backup controls.');
}

export async function healthCheck(db: Database, email: string) {
  await requireDeveloper(db, email);
  const missing: string[] = [];
  const features = await db.prepare("SELECT code, object_name FROM db_features WHERE object_name NOT LIKE 'fn:%'").all();
  for (const feature of features) {
    const found = await db.prepare(`SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ? UNION ALL
      SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = ? LIMIT 1`)
      .get(feature.object_name, feature.object_name);
    if (!found) missing.push(feature.code);
  }
  const fkCount = await db.prepare(`SELECT count(*) AS n FROM pg_constraint
    WHERE contype = 'f' AND convalidated = false`).get();
  return { ok: missing.length === 0 && Number(fkCount?.n ?? 0) === 0, fkViolations: Number(fkCount?.n ?? 0), missingFeatures: missing };
}

export async function rowCounts(db: Database, email: string): Promise<Record<string, number>> {
  await requireDeveloper(db, email);
  const tables = await db.prepare(`SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`).all() as { name: string }[];
  const out: Record<string, number> = {};
  for (const { name } of tables) {
    out[name] = Number((await db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`).get())?.n ?? 0);
  }
  return out;
}

export async function explain(db: Database, email: string, sql: string): Promise<string[]> {
  await requireDeveloper(db, email);
  const plan = await db.prepare(`EXPLAIN ${sql}`).all();
  return plan.map((row: any) => Object.values(row).join(' '));
}

export async function seedDemo(db: Database, email: string): Promise<{ projects: number }> {
  await requireDeveloper(db, email);
  if (process.env.NODE_ENV === 'production') throw new Error('seedDemo is disabled in production');
  await db.prepare(`INSERT INTO tags (slug, name_ar, name_en) VALUES
    ('web','ويب','Web'),('design','تصميم','Design'),('3d','ثلاثي الأبعاد','3D') ON CONFLICT DO NOTHING`).run();
  await db.prepare(`INSERT INTO projects (slug, status, featured)
    VALUES ('demo-opera','published',1),('demo-store','draft',0) ON CONFLICT DO NOTHING`).run();
  await db.prepare(`INSERT INTO project_translations (project_id, locale, title, summary)
    SELECT id, 'ar', CASE slug WHEN 'demo-opera' THEN 'أوبرا التجريبي' ELSE 'متجر تجريبي' END, 'مشروع تجريبي'
    FROM projects WHERE slug LIKE 'demo-%' ON CONFLICT DO NOTHING`).run();
  await db.prepare(`INSERT INTO project_translations (project_id, locale, title, summary)
    SELECT id, 'en', CASE slug WHEN 'demo-opera' THEN 'Opera Demo' ELSE 'Demo Store' END, 'Demo project'
    FROM projects WHERE slug LIKE 'demo-%' ON CONFLICT DO NOTHING`).run();
  await db.prepare(`INSERT INTO project_tags (project_id, tag_id)
    SELECT p.id, t.id FROM projects p, tags t WHERE p.slug = 'demo-opera' AND t.slug IN ('web','3d')
    ON CONFLICT DO NOTHING`).run();
  await db.prepare(`INSERT INTO skills (slug, name_ar, name_en, category, level)
    VALUES ('typescript','تايبسكريبت','TypeScript','frontend',90),('postgresql','بوستجريس','PostgreSQL','database',85)
    ON CONFLICT DO NOTHING`).run();
  const row = await db.prepare("SELECT count(*) AS c FROM projects WHERE slug LIKE 'demo-%'").get();
  return { projects: Number(row?.c ?? 0) };
}

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
export interface RecoveryResult { userId: number; ownerEmail: string; restored: 'none' | 'reactivated' | 'recreated' }

export async function recoverOwner(db: Database, email: string, password: string, ip?: string): Promise<RecoveryResult | null> {
  email = String(email ?? '').trim();
  password = String(password ?? '');
  const account = await db.prepare('SELECT id, email, password_hash, owner_email FROM recovery_accounts WHERE email = ?').get(email);
  const recent = Number((await db.prepare(`SELECT count(*) AS c FROM login_attempts
    WHERE email = ? AND success = 0 AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')`).get(email))?.c ?? 0);
  const good = verifyPassword(password, account?.password_hash ?? DUMMY_HASH) && !!account;
  if (!account || !good || recent >= 5) {
    if (account || email) {
      try { await db.prepare('INSERT INTO login_attempts (email, ip, success, reason) VALUES (?, ?, 0, ?)').run(email.slice(0, 254), ip ?? null, 'recovery'); }
      catch { /* blocked IP */ }
    }
    return null;
  }

  try {
    return await db.transaction(async (tx) => {
      let restored: RecoveryResult['restored'] = 'none';
      let user = await tx.prepare('SELECT id, status, deleted_at, locked_until, failed_login_count FROM users WHERE email = ?').get(account.owner_email);
      if (!user) {
        const created = await tx.prepare(`INSERT INTO users
          (email, username, display_name, password_hash, status, email_verified_at, terms_accepted_at, password_changed_at, must_change_password)
          VALUES (?, 'grykj', 'GRYKJ', ?, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1) RETURNING id`)
          .get(account.owner_email, account.password_hash);
        user = { id: created.id };
        restored = 'recreated';
      } else if (user.status !== 'active' || user.deleted_at || user.locked_until || Number(user.failed_login_count)) {
        await tx.prepare(`UPDATE users SET status = 'active', deleted_at = NULL, locked_until = NULL,
          failed_login_count = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(user.id);
        restored = user.status !== 'active' ? 'reactivated' : 'none';
      }
      for (const role of ['admin', 'developer']) {
        await tx.prepare(`INSERT INTO user_roles (user_id, role_id, granted_by)
          SELECT ?, id, ? FROM roles WHERE name = ? ON CONFLICT DO NOTHING`).run(user.id, user.id, role);
      }
      await tx.prepare(`UPDATE recovery_accounts SET uses = uses + 1,
        last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(account.id);
      await tx.prepare(`INSERT INTO audit_log
        (actor_user_id, actor_email, action, entity_type, entity_id, ip, metadata)
        VALUES (?, ?, 'recovery.login', 'recovery_account', ?, ?, ?)`)
        .run(user.id, account.owner_email, String(account.id), ip ?? null, JSON.stringify({ restored }));
      return { userId: Number(user.id), ownerEmail: account.owner_email, restored };
    });
  } catch (error) {
    try { await logDev(db, 'error', 'dev.recoverOwner', (error as Error).message, {}, (error as Error).stack); } catch { /* preserve recovery failure */ }
    return null;
  }
}

export const snapshotHash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');