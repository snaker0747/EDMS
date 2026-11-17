import { HttpError, json, nowIso, safeName, extOf, ALLOWED_TYPES, INLINE_MIME, contentDisposition } from '../util.js';
import * as G from '../google.js';
import { listRows, appendRow, updateRow, setOrders, ord, getSettings, getFolders, logHistory } from '../db.js';
import { cleanMeta } from '../validate.js';

const parseExtra = (s) => {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

export const publicDoc = (r) => ({
  id: r.id,
  title: r.title,
  doc_no: r.doc_no,
  doc_date: r.doc_date,
  doc_type: r.doc_type,
  fiscal_year: r.fiscal_year,
  folder_id: r.folder_id,
  tags: r.tags,
  note: r.note,
  extra: parseExtra(r.extra),
  file_name: r.file_name,
  mime: r.mime,
  size: Number(r.size) || 0,
  drive_url: r.drive_url,
  uploader: r.uploader,
  uploaded_at: r.uploaded_at,
  updated_at: r.updated_at,
  sort_order: ord(r.sort_order),
});

async function activeDoc(c, id) {
  const row = (await listRows(c, 'docs')).find((r) => r.id === id && r.status !== 'trashed');
  if (!row) throw new HttpError(404, 'ไม่พบเอกสาร');
  return row;
}

async function activeFolder(c, id) {
  const f = (await getFolders(c)).find((x) => x.id === id);
  if (!f) throw new HttpError(400, 'ไม่พบโฟลเดอร์ปลายทาง');
  return f;
}

function canEdit(c, doc) {
  return c.user.role === 'admin' || doc.uploader === c.user.display_name;
}

function maxBytes(c) {
  return (parseInt(c.env.MAX_UPLOAD_MB, 10) || 40) * 1024 * 1024;
}

async function readUpload(c, form) {
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'ไม่พบไฟล์ที่อัปโหลด');
  if (file.size === 0) throw new HttpError(400, 'ไฟล์ว่างเปล่า');
  if (file.size > maxBytes(c)) throw new HttpError(413, `ไฟล์ใหญ่เกิน ${Math.round(maxBytes(c) / 1048576)} MB`);
  const ext = extOf(file.name);
  if (!ALLOWED_TYPES[ext]) throw new HttpError(415, `ไม่รองรับไฟล์ชนิด .${ext || '?'}`);
  return { file, ext, mime: ALLOWED_TYPES[ext], bytes: await file.arrayBuffer() };
}

export async function listDocs(c) {
  const rows = (await listRows(c, 'docs')).filter((r) => r.status !== 'trashed' && r.id);
  rows.sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
  return json({ documents: rows.map(publicDoc) });
}

export async function getDoc(c, { id }) {
  const doc = await activeDoc(c, id);
  return json({ document: publicDoc(doc), can_edit: canEdit(c, doc) });
}

export async function createDoc(c, _p, request) {
  const form = await request.formData();
  const settings = await getSettings(c);
  let meta;
  try {
    meta = JSON.parse(form.get('meta') || '{}');
  } catch {
    throw new HttpError(400, 'รายละเอียดเอกสารไม่ถูกต้อง');
  }
  const clean = cleanMeta(meta, settings, { requireAll: true });
  const folder = await activeFolder(c, String(meta.folder_id || ''));
  const up = await readUpload(c, form);

  const name = safeName(clean.title) + '.' + up.ext;
  const created = await G.driveUploadNew(c.env, { name, parentId: folder.id, mime: up.mime, bytes: up.bytes });
  const now = nowIso();
  const row = {
    id: created.id,
    ...clean,
    doc_no: clean.doc_no ?? '',
    doc_date: clean.doc_date ?? '',
    tags: clean.tags ?? '',
    note: clean.note ?? '',
    folder_id: folder.id,
    file_name: created.name || name,
    mime: up.mime,
    size: String(created.size || up.bytes.byteLength),
    drive_url: created.webViewLink || `https://drive.google.com/file/d/${created.id}/view`,
    uploader: c.user.display_name,
    uploaded_at: now,
    updated_at: now,
    status: 'active',
  };
  await appendRow(c, 'docs', row);
  logHistory(c, 'อัปโหลดเอกสาร', row.id, row.title, `โฟลเดอร์ ${folder.path}`);
  return json({ document: publicDoc(row) }, 201);
}

export async function updateDoc(c, { id }, request) {
  const doc = await activeDoc(c, id);
  if (!canEdit(c, doc)) throw new HttpError(403, 'แก้ไขได้เฉพาะเอกสารที่ตนเองอัปโหลด');
  const body = await request.json().catch(() => ({}));
  const settings = await getSettings(c);
  const clean = cleanMeta(body, settings, { requireAll: false });
  const patch = { ...clean, updated_at: nowIso() };
  if (clean.title && clean.title !== doc.title) {
    const ext = extOf(doc.file_name);
    const newName = safeName(clean.title) + (ext ? '.' + ext : '');
    await G.drivePatch(c.env, id, { name: newName });
    patch.file_name = newName;
  }
  const merged = await updateRow(c, 'docs', doc, patch);
  logHistory(c, 'แก้ไขรายละเอียด', id, merged.title);
  return json({ document: publicDoc(merged) });
}

export async function moveDoc(c, { id }, request) {
  const doc = await activeDoc(c, id);
  if (!canEdit(c, doc)) throw new HttpError(403, 'ย้ายได้เฉพาะเอกสารที่ตนเองอัปโหลด');
  const body = await request.json().catch(() => ({}));
  const folder = await activeFolder(c, String(body.folder_id || ''));
  if (folder.id === doc.folder_id) return json({ document: publicDoc(doc) });
  await G.drivePatch(c.env, id, {}, { addParents: folder.id, removeParents: doc.folder_id });
  const merged = await updateRow(c, 'docs', doc, { folder_id: folder.id, updated_at: nowIso() });
  logHistory(c, 'ย้ายโฟลเดอร์', id, doc.title, `ไปที่ ${folder.path}`);
  return json({ document: publicDoc(merged) });
}

export async function replaceDoc(c, { id }, request) {
  const doc = await activeDoc(c, id);
  if (!canEdit(c, doc)) throw new HttpError(403, 'แก้ไขได้เฉพาะเอกสารที่ตนเองอัปโหลด');
  const form = await request.formData();
  const up = await readUpload(c, form);
  const name = safeName(doc.title) + '.' + up.ext;
  const updated = await G.driveUploadReplace(c.env, id, { name, mime: up.mime, bytes: up.bytes });
  const merged = await updateRow(c, 'docs', doc, {
    file_name: updated.name || name,
    mime: up.mime,
    size: String(updated.size || up.bytes.byteLength),
    updated_at: nowIso(),
  });
  logHistory(c, 'อัปโหลดฉบับแก้ไข', id, doc.title);
  return json({ document: publicDoc(merged) });
}

export async function trashDoc(c, { id }) {
  const doc = await activeDoc(c, id);
  if (!canEdit(c, doc)) throw new HttpError(403, 'ลบได้เฉพาะเอกสารที่ตนเองอัปโหลด');
  await G.drivePatch(c.env, id, { trashed: true });
  await updateRow(c, 'docs', doc, { status: 'trashed', updated_at: nowIso() });
  logHistory(c, 'ย้ายไปถังขยะ', id, doc.title);
  return json({ ok: true });
}

export async function docHistory(c, { id }) {
  await activeDoc(c, id);
  const rows = (await listRows(c, 'history'))
    .filter((h) => h.target_id === id)
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .slice(0, 50)
    .map((h) => ({ time: h.time, user: h.user, action: h.action, detail: h.detail }));
  return json({ history: rows });
}

// ส่งไฟล์ให้เบราว์เซอร์ผ่าน Worker (ผู้ใช้ไม่ต้องมีสิทธิ์ใน Google Drive)
export async function fileDoc(c, { id }, request) {
  const doc = await activeDoc(c, id);
  if (doc.mime.startsWith('application/vnd.google-apps')) {
    throw new HttpError(415, 'ไฟล์ชนิดนี้ไม่รองรับการเปิดดูในระบบ');
  }
  const url = new URL(request.url);
  const download = url.searchParams.get('download') === '1';
  const res = await G.driveDownload(c.env, id, request.headers.get('range'));
  if (!res.ok && res.status !== 206) throw new HttpError(res.status === 404 ? 404 : 502, 'เปิดไฟล์ไม่ได้');
  const mime = doc.mime || res.headers.get('content-type') || 'application/octet-stream';
  const inline = !download && INLINE_MIME.has(mime);
  const headers = new Headers({
    'content-type': mime,
    'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', doc.file_name || doc.title),
    'cache-control': 'private, max-age=60',
    'x-content-type-options': 'nosniff',
  });
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

// จัดลำดับเอกสารในโฟลเดอร์เดียวกัน (ผู้ดูแลระบบ): ส่งรหัสเอกสารทั้งหมดในโฟลเดอร์ตามลำดับที่ต้องการ
export async function reorderDocs(c, _p, request) {
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const folder = await activeFolder(c, String(body.folder_id || ''));
  const inFolder = (await listRows(c, 'docs')).filter((r) => r.status !== 'trashed' && r.id && r.folder_id === folder.id).map((r) => r.id);
  if (!ids.length || new Set(ids).size !== ids.length || ids.length !== inFolder.length || !ids.every((id) => inFolder.includes(id))) {
    throw new HttpError(400, 'รายการเอกสารไม่ตรงกับโฟลเดอร์ กรุณารีเฟรชหน้าแล้วลองใหม่');
  }
  const changed = await setOrders(c, 'docs', ids);
  if (changed) logHistory(c, 'จัดลำดับเอกสาร', folder.id, folder.name, `${ids.length} รายการ`);
  return json({ ok: true, changed });
}
