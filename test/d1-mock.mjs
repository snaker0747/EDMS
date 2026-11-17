// จำลอง Cloudflare D1 ด้วย SQLite ในหน่วยความจำของ Node (node:sqlite) เพื่อใช้ทดสอบ
import { DatabaseSync } from 'node:sqlite';

export function createD1() {
  const db = new DatabaseSync(':memory:');
  const isSelect = (sql) => /^\s*(select|pragma)/i.test(sql);
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (isSelect(sql)) return { success: true, results: st.all(...args).map((r) => ({ ...r })), meta: {} };
    const r = st.run(...args);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    async all() { return exec(sql, args); },
    async first() { return exec(sql, args).results[0] ?? null; },
    async run() { return exec(sql, args); },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => exec(s.sql, s.args));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    _raw: db,
  };
}
