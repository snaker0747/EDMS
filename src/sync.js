// ซิงก์สองทางระหว่างฐานข้อมูล D1 (ที่เว็บใช้อ่านเขียน) กับ Google Sheet (ที่ AppSheet ใช้)
//
// หลักการ: แต่ละแถวจำ "แฮชของแถวตอนซิงก์ครั้งล่าสุด" (_h) ไว้ แล้วเทียบ 3 ฝ่าย (D1 / ชีต / ครั้งล่าสุด)
//  - ชีตเปลี่ยนอย่างเดียว  → รับค่าจากชีตเข้า D1
//  - เว็บเปลี่ยนอย่างเดียว → ส่งค่าจาก D1 ไปชีต
//  - เปลี่ยนทั้งคู่        → ใช้ค่าจากเว็บ (เว็บชนะ) แล้วเขียนทับชีต
//  - แถวใหม่ที่ฝั่งใดฝั่งหนึ่ง → คัดลอกไปอีกฝั่ง
//  - เอกสารที่ถูกลบแถวในชีต   → ลบจาก D1 (โฟลเดอร์/ผู้ใช้/ตั้งค่า เขียนกลับคืนเพราะต้องจัดการผ่านเว็บ)
// ประวัติการใช้งาน (history) ส่งไปชีตทางเดียว
import { HttpError } from './util.js';
import * as G from './google.js';
import { SCHEMA, PK, SYNC_KEYS, ddl, migrateColumns, makeCtx, getMeta, setMeta, getSheetId, colLetter } from './db.js';

const q = (s) => `"${s}"`;
const LOCK_MS = 50_000;
const STALE_MS = 30_000;

// แฮชข้อความแบบเร็ว (cyrb53) ใช้ตรวจว่าแถวเปลี่ยนหรือไม่
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const colsOf = (key) => SCHEMA[key].cols.map(([k]) => k);
const hashRow = (key, obj) => cyrb53(colsOf(key).map((k) => String(obj[k] ?? '')).join('\u0001'));

function headerMap(key, header) {
  const idx = {};
  for (const [k, label] of SCHEMA[key].cols) idx[k] = header.indexOf(label);
  return idx;
}

function buildRaw(key, header, idx, obj, base = []) {
  const width = Math.max(header.length, ...Object.values(idx).map((i) => i + 1), base.length);
  const arr = Array.from({ length: width }, (_, i) => (base[i] !== undefined ? base[i] : ''));
  for (const k of colsOf(key)) if (idx[k] >= 0) arr[idx[k]] = String(obj[k] ?? '');
  return arr;
}

function parseSheet(key, values) {
  const header = (values[0] || []).map(String);
  const idx = headerMap(key, header);
  const pk = PK[key];
  const rows = new Map();
  for (let i = 1; i < values.length; i++) {
    const raw = values[i] || [];
    const obj = {};
    for (const k of colsOf(key)) obj[k] = idx[k] >= 0 ? String(raw[idx[k]] ?? '') : '';
    const id = obj[pk] ? obj[pk].trim() : '';
    if (!id || rows.has(id)) continue; // ข้ามแถวไม่มีรหัสและแถวซ้ำ
    rows.set(id, { row: i + 1, raw, obj, hash: hashRow(key, obj) });
  }
  return { header, idx, rows };
}

// ---------- เตรียม D1 ----------
const readyDbs = new WeakSet(); // D1 ที่เตรียมพร้อมแล้ว (ต่อ Worker หนึ่งตัว)

export async function ensureReady(c, { lenient = false } = {}) {
  const { env } = c;
  if (!env.DB) throw new HttpError(500, 'ยังไม่ได้ผูกฐานข้อมูล D1 (binding ชื่อ DB) ใน wrangler.toml');
  if (readyDbs.has(env.DB)) return;
  let init;
  try {
    init = await getMeta(c, 'initialized');
  } catch {
    await env.DB.batch(ddl().map((s) => env.DB.prepare(s)));
    init = null;
  }
  if (init === '1') {
    await migrateColumns(env);
    readyDbs.add(env.DB);
    return;
  }
  if (lenient) return; // ขั้นตอน setup จะนำเข้าข้อมูลเองทีหลัง
  // ครั้งแรกหลังย้ายมาใช้ D1: นำข้อมูลเดิมในชีตเข้ามา (ถ้ายังไม่เคยตั้งค่าระบบ จะได้ 503)
  for (let i = 0; i < 20; i++) {
    const r = await runSync(env, { init: true });
    if (!r.skipped) {
      readyDbs.add(env.DB);
      return;
    }
    await new Promise((res) => setTimeout(res, 500));
    if ((await getMeta(c, 'initialized')) === '1') {
      readyDbs.add(env.DB);
      return;
    }
  }
  throw new HttpError(503, 'กำลังนำข้อมูลเข้าฐานข้อมูล กรุณาลองใหม่อีกครั้ง');
}

// ---------- ตัวซิงก์ ----------
async function acquire(c) {
  const now = Date.now();
  const r = await c.env.DB.prepare("UPDATE meta SET v = ? WHERE k = 'lock_until' AND CAST(v AS INTEGER) < ?").bind(String(now + LOCK_MS), now).run();
  return r.meta?.changes === 1;
}

export async function runSync(env, { init = false } = {}) {
  const c = makeCtx(env, null);
  if (!(await acquire(c))) {
    await setMeta(c, 'sync_pending', '1');
    return { skipped: 'busy' };
  }
  try {
    let result = null;
    for (let i = 0; i < 3; i++) {
      await setMeta(c, 'sync_pending', '0');
      const part = await syncOnce(c, { init: init && i === 0 });
      result = result ? { ...part, inbound: result.inbound + part.inbound, outbound: result.outbound + part.outbound } : part;
      if ((await getMeta(c, 'sync_pending')) !== '1') break;
    }
    await setMeta(c, 'last_sync_at', Date.now());
    await setMeta(c, 'last_error', result.warning || '');
    if (init) await setMeta(c, 'initialized', '1');
    return result;
  } catch (e) {
    await setMeta(c, 'last_error', String(e?.message || e).slice(0, 300)).catch(() => {});
    throw e;
  } finally {
    await setMeta(c, 'lock_until', '0').catch(() => {});
  }
}

async function syncOnce(c, { init }) {
  const { env } = c;
  const DB = env.DB;
  const sheetId = await getSheetId(c);
  const histTitle = SCHEMA.history.title;
  const ranges = [...SYNC_KEYS.map((k) => `'${SCHEMA[k].title}'`), init ? `'${histTitle}'` : `'${histTitle}'!1:1`];
  const res = await G.sheetsBatchGet(env, sheetId, ranges);
  const vr = res.valueRanges || [];

  const A = []; // คำสั่ง D1: รับค่าจากชีต/ลบ
  const B = []; // คำสั่ง D1: ทำเครื่องหมายว่าส่งไปชีตแล้ว
  const sheetWrites = { updates: [], appends: new Map() };
  let inbound = 0;
  let outbound = 0;
  let warning = '';

  for (let t = 0; t < SYNC_KEYS.length; t++) {
    const key = SYNC_KEYS[t];
    const pk = PK[key];
    const cols = colsOf(key);
    const sheet = parseSheet(key, vr[t]?.values || []);
    if (!sheet.header.length) throw new HttpError(502, `ไม่พบหัวตารางในแท็บ "${SCHEMA[key].title}" ของชีต`);
    // เติมหัวคอลัมน์ที่ขาด (กันไม่ให้ค่าบางช่องหายไปตอนเทียบแถว)
    const missing = SCHEMA[key].cols.filter(([k]) => sheet.idx[k] < 0).map(([, label]) => label);
    if (missing.length) {
      await G.sheetsUpdate(env, sheetId, `'${SCHEMA[key].title}'!${colLetter(sheet.header.length + 1)}1:${colLetter(sheet.header.length + missing.length)}1`, [missing]);
      sheet.header.push(...missing);
      sheet.idx = headerMap(key, sheet.header);
      for (const s of sheet.rows.values()) s.hash = hashRow(key, s.obj);
    }
    const { results: d1rows } = await DB.prepare(`SELECT * FROM ${q(key)}`).all();
    const d1 = new Map(d1rows.map((r) => [r[pk], r]));

    const sets = cols.filter((k) => k !== pk);
    const insertFromSheet = (s) =>
      DB.prepare(`INSERT INTO ${q(key)} (${[...cols.map(q), '_h', '_d', '_v'].join(', ')}) VALUES (${[...cols.map(() => '?'), '?', '0', '0'].join(', ')})`).bind(...cols.map((k) => s.obj[k]), s.hash);
    const updateFromSheet = (r, s) =>
      DB.prepare(`UPDATE ${q(key)} SET ${[...sets.map((k) => `${q(k)} = ?`), '_h = ?', '_d = 0', '_v = _v + 1'].join(', ')} WHERE ${q(pk)} = ? AND _v = ?`).bind(...sets.map((k) => s.obj[k]), s.hash, r[pk], r._v);
    const queueOut = (r, s) => {
      const h = hashRow(key, r);
      outbound++;
      if (s) sheetWrites.updates.push({ range: `'${SCHEMA[key].title}'!A${s.row}:${colLetter(Math.max(sheet.header.length, s.raw.length, ...Object.values(sheet.idx).map((i) => i + 1)))}${s.row}`, values: [buildRaw(key, sheet.header, sheet.idx, r, s.raw)] });
      else {
        if (!sheetWrites.appends.has(key)) sheetWrites.appends.set(key, { header: sheet.header, idx: sheet.idx, rows: [] });
        sheetWrites.appends.get(key).rows.push(buildRaw(key, sheet.header, sheet.idx, r));
      }
      B.push(DB.prepare(`UPDATE ${q(key)} SET _h = ?, _d = 0 WHERE ${q(pk)} = ? AND _v = ?`).bind(h, r[pk], r._v));
    };

    for (const [id, s] of sheet.rows) {
      const r = d1.get(id);
      if (!r) {
        A.push(insertFromSheet(s));
        inbound++;
      } else if (s.hash === r._h) {
        if (r._d) queueOut(r, s); // ชีตไม่เปลี่ยน เว็บแก้ → ส่งไปชีต
      } else if (!r._d) {
        // เว็บไม่ได้แก้ ชีตเปลี่ยน → รับค่าจากชีต
        if (hashRow(key, r) !== s.hash) {
          A.push(updateFromSheet(r, s));
          inbound++;
        } else {
          A.push(DB.prepare(`UPDATE ${q(key)} SET _h = ? WHERE ${q(pk)} = ? AND _v = ?`).bind(s.hash, id, r._v));
        }
      } else {
        queueOut(r, s); // เปลี่ยนทั้งสองฝั่ง: เว็บชนะ
      }
    }

    const gone = [];
    for (const [id, r] of d1) {
      if (sheet.rows.has(id)) continue;
      if (r._h === '' || r._d) queueOut(r, null); // แถวใหม่จากเว็บ
      else if (key === 'docs') gone.push(r);
      else queueOut(r, null); // โฟลเดอร์/ผู้ใช้/ตั้งค่า ต้องจัดการผ่านเว็บ จึงเขียนคืนชีต
    }
    if (gone.length) {
      if (gone.length > Math.max(5, d1.size * 0.5)) {
        warning = `พบเอกสารหายจากชีตผิดปกติ ${gone.length} รายการ จึงไม่ลบออกจากระบบ (ตรวจสอบชีต ${SCHEMA.docs.title})`;
      } else {
        for (const r of gone) A.push(DB.prepare(`DELETE FROM ${q(key)} WHERE ${q(pk)} = ? AND _v = ?`).bind(r[pk], r._v));
        inbound += gone.length;
      }
    }
  }

  // ประวัติ: ครั้งแรกนำเข้าจากชีต แล้วส่ง D1 → ชีตทางเดียว
  const hist = parseSheet('history', vr[SYNC_KEYS.length]?.values || []);
  let histHeader = hist.header;
  if (init) {
    const hv = vr[SYNC_KEYS.length]?.values || [];
    const hcols = colsOf('history');
    for (let i = 1; i < hv.length; i++) {
      const raw = hv[i] || [];
      if (!raw.some((v) => String(v ?? '').trim() !== '')) continue;
      A.push(DB.prepare(`INSERT INTO "history" (${[...hcols.map(q), '_h', '_d', '_v'].join(', ')}) VALUES (${[...hcols.map(() => '?'), "'s'", '0', '0'].join(', ')})`).bind(...hcols.map((k) => String(raw[hist.idx[k]] ?? ''))));
    }
  }
  const { results: newHist } = await DB.prepare("SELECT * FROM history WHERE _h = '' ORDER BY _id LIMIT 2000").all();
  if (newHist.length && histHeader.length) {
    sheetWrites.appends.set('history', { header: histHeader, idx: hist.idx, rows: newHist.map((r) => buildRaw('history', histHeader, hist.idx, r)) });
    B.push(DB.prepare("UPDATE history SET _h = 's' WHERE _h = '' AND _id <= ?").bind(newHist[newHist.length - 1]._id));
  }

  // 1) รับค่าจากชีตเข้า D1  2) เขียนไปชีต  3) ทำเครื่องหมายว่าส่งแล้ว
  if (A.length) {
    for (let i = 0; i < A.length; i += 50) await DB.batch(A.slice(i, i + 50));
    await DB.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'data_version'").run();
  }
  for (let i = 0; i < sheetWrites.updates.length; i += 200) await G.sheetsBatchUpdateValues(env, sheetId, sheetWrites.updates.slice(i, i + 200));
  for (const [key, w] of sheetWrites.appends) {
    for (let i = 0; i < w.rows.length; i += 500) await G.sheetsAppend(env, sheetId, `'${SCHEMA[key].title}'!A1`, w.rows.slice(i, i + 500));
  }
  for (let i = 0; i < B.length; i += 50) await DB.batch(B.slice(i, i + 50));
  return { inbound, outbound, history_pushed: newHist.length, warning };
}

// ---------- ใช้จากเส้นทาง API ----------
export async function syncState(c) {
  const [v, at, err] = await Promise.all([getMeta(c, 'data_version'), getMeta(c, 'last_sync_at'), getMeta(c, 'last_error')]);
  return { data_version: Number(v) || 0, last_sync_at: Number(at) || 0, last_error: err || '' };
}

// ถ้าไม่ได้ซิงก์มาเกิน 30 วินาที ให้ซิงก์เบื้องหลัง (ดึงสิ่งที่แก้จาก AppSheet เข้ามา)
export function backgroundSyncIfStale(c, state) {
  if (Date.now() - state.last_sync_at < STALE_MS) return;
  c.ctx?.waitUntil?.(runSync(c.env).catch((e) => console.error('background sync failed', e?.message || e)));
}

// หลังมีการเขียนข้อมูล: รอเขียนประวัติให้เสร็จก่อน แล้วส่งไปชีต
export function syncAfterWrite(c) {
  c.ctx?.waitUntil?.(
    (async () => {
      await Promise.allSettled(c.pending);
      await runSync(c.env);
    })().catch((e) => console.error('sheet sync failed', e?.message || e))
  );
}
