// ชั้นข้อมูล: ใช้ Google Sheet เป็นฐานข้อมูล (AppSheet อ่านไฟล์เดียวกันนี้ได้)
import { HttpError, nowIso } from './util.js';
import * as G from './google.js';

export const SHEET_NAME = 'EDMS ข้อมูลระบบ';

// [คีย์ในโค้ด, หัวคอลัมน์ภาษาไทยในชีต]
export const SCHEMA = {
  docs: {
    title: 'เอกสาร',
    cols: [
      ['id', 'รหัสไฟล์ Drive'],
      ['title', 'ชื่อเอกสาร'],
      ['doc_no', 'เลขที่หนังสือ'],
      ['doc_date', 'ลงวันที่'],
      ['doc_type', 'ประเภทเอกสาร'],
      ['fiscal_year', 'ปีงบประมาณ'],
      ['folder_id', 'รหัสโฟลเดอร์'],
      ['tags', 'คำค้น'],
      ['note', 'รายละเอียด'],
      ['extra', 'ช่องเพิ่มเติม (JSON)'],
      ['file_name', 'ชื่อไฟล์'],
      ['mime', 'ชนิดไฟล์'],
      ['size', 'ขนาด (ไบต์)'],
      ['drive_url', 'ลิงก์ Google Drive'],
      ['uploader', 'ผู้อัปโหลด'],
      ['uploaded_at', 'วันที่อัปโหลด'],
      ['updated_at', 'แก้ไขล่าสุด'],
      ['status', 'สถานะ'],
    ],
  },
  folders: {
    title: 'โฟลเดอร์',
    cols: [
      ['id', 'รหัสโฟลเดอร์ Drive'],
      ['name', 'ชื่อโฟลเดอร์'],
      ['parent_id', 'อยู่ภายใต้ (รหัส)'],
      ['created_by', 'ผู้สร้าง'],
      ['created_at', 'วันที่สร้าง'],
      ['status', 'สถานะ'],
    ],
  },
  settings: {
    title: 'ตั้งค่า',
    cols: [
      ['key', 'หัวข้อ'],
      ['value', 'ค่า (JSON)'],
    ],
  },
  users: {
    title: 'ผู้ใช้',
    cols: [
      ['username', 'ชื่อผู้ใช้'],
      ['display_name', 'ชื่อที่แสดง'],
      ['role', 'สิทธิ์'],
      ['password_hash', 'รหัสผ่าน (เข้ารหัส)'],
      ['active', 'ใช้งาน'],
      ['created_at', 'วันที่สร้าง'],
    ],
  },
  history: {
    title: 'ประวัติ',
    cols: [
      ['time', 'เวลา'],
      ['user', 'ผู้ใช้'],
      ['action', 'การกระทำ'],
      ['target_id', 'รหัสอ้างอิง'],
      ['target_name', 'ชื่อรายการ'],
      ['detail', 'รายละเอียด'],
    ],
  },
};

export const DEFAULT_DOC_TYPES = ['หนังสือรับ', 'หนังสือส่ง', 'แบบแปลน', 'ประมาณราคา', 'สัญญา', 'รายงาน'];

function colLetter(n) {
  // n เริ่มที่ 1
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------- ตัวช่วยระดับคำขอ ----------
// c = { env, ctx, cache: Map, user }
export function makeCtx(env, ctx) {
  return { env, ctx, cache: new Map(), user: null };
}

let sheetIdCache = null;
const usersCache = { at: 0, rows: null };
const USERS_TTL = 30_000;

export function resetCaches() {
  sheetIdCache = null;
  usersCache.at = 0;
  usersCache.rows = null;
}

export async function getSheetId(c, { create = false } = {}) {
  const { env } = c;
  if (env.SHEET_ID) return env.SHEET_ID;
  if (sheetIdCache) return sheetIdCache;
  const q = `name='${SHEET_NAME}' and '${env.ROOT_FOLDER_ID}' in parents and mimeType='${G.SHEET_MIME}' and trashed=false`;
  const found = await G.driveList(env, q);
  if (found.length) {
    sheetIdCache = found[0].id;
    return sheetIdCache;
  }
  if (!create) throw new HttpError(503, 'ระบบยังไม่ได้ตั้งค่าเริ่มต้น (ผู้ดูแลต้องเรียก /api/setup ก่อน)');
  const created = await G.sheetsCreate(env, SHEET_NAME);
  // ย้ายชีตจากหน้าแรกของ Drive เข้าไปไว้ในโฟลเดอร์หลัก
  const cur = await G.driveGet(env, created.spreadsheetId, 'id,parents');
  await G.drivePatch(env, created.spreadsheetId, {}, { addParents: env.ROOT_FOLDER_ID, removeParents: (cur.parents || []).join(',') || undefined });
  sheetIdCache = created.spreadsheetId;
  return sheetIdCache;
}

// สร้างแท็บและหัวตารางที่ยังไม่มี
export async function ensureSchema(c, sheetId) {
  const meta = await G.sheetsMeta(c.env, sheetId);
  const existing = new Map(meta.sheets.map((s) => [s.properties.title, s.properties]));
  const adds = [];
  for (const t of Object.values(SCHEMA)) {
    if (!existing.has(t.title)) {
      adds.push({ addSheet: { properties: { title: t.title, gridProperties: { frozenRowCount: 1, columnCount: Math.max(t.cols.length, 6) } } } });
    }
  }
  if (adds.length) await G.sheetsBatch(c.env, sheetId, adds);
  for (const t of Object.values(SCHEMA)) {
    const head = await G.sheetsGet(c.env, sheetId, `'${t.title}'!1:1`);
    const row = head.values?.[0] || [];
    if (!row.length) {
      await G.sheetsUpdate(c.env, sheetId, `'${t.title}'!A1:${colLetter(t.cols.length)}1`, [t.cols.map((x) => x[1])]);
    } else {
      // เพิ่มหัวคอลัมน์ที่ขาดไว้ท้ายตาราง (กรณีอัปเดตระบบเพิ่มช่องใหม่)
      const missing = t.cols.filter((x) => !row.includes(x[1])).map((x) => x[1]);
      if (missing.length) {
        await G.sheetsUpdate(c.env, sheetId, `'${t.title}'!${colLetter(row.length + 1)}1:${colLetter(row.length + missing.length)}1`, [missing]);
      }
    }
  }
  // ลบแท็บ "Sheet1" เริ่มต้นถ้ามี
  const def = meta.sheets.find((s) => ['Sheet1', 'ชีต1'].includes(s.properties.title));
  if (def) {
    await G.sheetsBatch(c.env, sheetId, [{ deleteSheet: { sheetId: def.properties.sheetId } }]).catch(() => {});
  }
}

// ---------- อ่าน/เขียนตาราง ----------
function headerMap(table, headerRow) {
  const idx = {};
  for (const [key, label] of table.cols) idx[key] = headerRow.indexOf(label);
  return idx;
}

export async function readTable(c, key) {
  if (c.cache.has(key)) return c.cache.get(key);
  const table = SCHEMA[key];
  const sheetId = await getSheetId(c);
  const res = await G.sheetsGet(c.env, sheetId, `'${table.title}'`);
  const values = res.values || [];
  const header = values[0] || [];
  const idx = headerMap(table, header);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i] || [];
    if (!raw.some((v) => String(v ?? '').trim() !== '')) continue;
    const obj = { _row: i + 1, _raw: raw };
    for (const [k] of table.cols) obj[k] = idx[k] >= 0 ? String(raw[idx[k]] ?? '') : '';
    rows.push(obj);
  }
  const out = { rows, header, idx };
  c.cache.set(key, out);
  return out;
}

// อ่านเฉพาะแถวหัวตาราง (เร็วกว่าอ่านทั้งตาราง ใช้ตอนเพิ่ม/แก้แถว)
async function getHeader(c, key) {
  const ck = `header:${key}`;
  if (c.cache.has(ck)) return c.cache.get(ck);
  const table = SCHEMA[key];
  const sheetId = await getSheetId(c);
  const res = await G.sheetsGet(c.env, sheetId, `'${table.title}'!1:1`);
  const header = res.values?.[0] || [];
  const out = { header, idx: headerMap(table, header) };
  c.cache.set(ck, out);
  return out;
}

export async function listRows(c, key) {
  return (await readTable(c, key)).rows;
}

function buildRaw(table, header, idx, obj, base = []) {
  const width = Math.max(header.length, ...Object.values(idx).map((i) => i + 1), base.length);
  const arr = Array.from({ length: width }, (_, i) => (base[i] !== undefined ? base[i] : ''));
  for (const [k] of table.cols) if (idx[k] >= 0 && obj[k] !== undefined) arr[idx[k]] = obj[k] ?? '';
  return arr;
}

export async function appendRow(c, key, obj) {
  const table = SCHEMA[key];
  const { header, idx } = await getHeader(c, key);
  const arr = buildRaw(table, header, idx, obj);
  const sheetId = await getSheetId(c);
  await G.sheetsAppend(c.env, sheetId, `'${table.title}'!A1`, [arr]);
  c.cache.delete(key);
  if (key === 'users') usersCache.at = 0;
  return obj;
}

// เพิ่มหลายแถวในคำขอเดียว (ใช้ตอนซิงก์จาก Drive)
export async function appendRows(c, key, objs) {
  if (!objs.length) return;
  const table = SCHEMA[key];
  const { header, idx } = await getHeader(c, key);
  const sheetId = await getSheetId(c);
  const arrs = objs.map((o) => buildRaw(table, header, idx, o));
  for (let i = 0; i < arrs.length; i += 500) {
    await G.sheetsAppend(c.env, sheetId, `'${table.title}'!A1`, arrs.slice(i, i + 500));
  }
  c.cache.delete(key);
  if (key === 'users') usersCache.at = 0;
}

export async function updateRow(c, key, row, patch) {
  const table = SCHEMA[key];
  const { header, idx } = await getHeader(c, key);
  const merged = { ...row, ...patch };
  const arr = buildRaw(table, header, idx, merged, row._raw);
  const sheetId = await getSheetId(c);
  await G.sheetsUpdate(c.env, sheetId, `'${table.title}'!A${row._row}:${colLetter(arr.length)}${row._row}`, [arr]);
  c.cache.delete(key);
  if (key === 'users') usersCache.at = 0;
  return merged;
}

// ---------- ผู้ใช้ (แคช 30 วินาทีเพื่อลดการเรียก Sheets) ----------
export async function getUsers(c) {
  if (usersCache.rows && Date.now() - usersCache.at < USERS_TTL) return usersCache.rows;
  const rows = await listRows(c, 'users');
  usersCache.rows = rows;
  usersCache.at = Date.now();
  return rows;
}

export async function findUser(c, username) {
  const u = String(username || '').trim().toLowerCase();
  return (await getUsers(c)).find((r) => r.username.toLowerCase() === u) || null;
}

export const isActive = (u) => !['false', 'no', '0', 'ไม่'].includes(String(u.active).trim().toLowerCase());

// ---------- ตั้งค่า ----------
export async function getSettings(c) {
  const rows = await listRows(c, 'settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parse = (k, d) => {
    try {
      const v = JSON.parse(map[k]);
      return Array.isArray(v) ? v : d;
    } catch {
      return d;
    }
  };
  return { doc_types: parse('doc_types', DEFAULT_DOC_TYPES), fields: parse('fields', []) };
}

export async function saveSetting(c, key, value) {
  const rows = await listRows(c, 'settings');
  const found = rows.find((r) => r.key === key);
  const text = JSON.stringify(value);
  if (found) await updateRow(c, 'settings', found, { value: text });
  else await appendRow(c, 'settings', { key, value: text });
}

// ---------- โฟลเดอร์ ----------
export async function getFolders(c) {
  const rows = (await listRows(c, 'folders')).filter((r) => r.status !== 'deleted');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = (f) => {
    const names = [];
    const seen = new Set();
    let cur = f;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = byId.get(cur.parent_id);
    }
    return names.join(' › ');
  };
  return rows.map((r) => ({ id: r.id, name: r.name, parent_id: r.parent_id, created_by: r.created_by, created_at: r.created_at, path: pathOf(r) }));
}

// ---------- ประวัติ ----------
export function logHistory(c, action, targetId, targetName, detail = '') {
  const p = appendRow(c, 'history', {
    time: nowIso(),
    user: c.user?.display_name || c.user?.username || 'ระบบ',
    action,
    target_id: targetId || '',
    target_name: targetName || '',
    detail,
  }).catch((e) => console.error('history failed', e));
  c.ctx?.waitUntil?.(p);
  return p;
}
