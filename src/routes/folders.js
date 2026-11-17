import { HttpError, json, nowIso, safeName } from '../util.js';
import * as G from '../google.js';
import { listRows, appendRow, updateRow, getFolders, logHistory } from '../db.js';

export async function folderPayload(c) {
  const folders = await getFolders(c);
  const docs = (await listRows(c, 'docs')).filter((d) => d.status !== 'trashed');
  const counts = {};
  for (const d of docs) counts[d.folder_id] = (counts[d.folder_id] || 0) + 1;
  return {
    root_id: c.env.ROOT_FOLDER_ID,
    folders: folders.map((f) => ({ ...f, doc_count: counts[f.id] || 0 })),
  };
}

export async function listFolders(c) {
  return json(await folderPayload(c));
}

function checkName(raw) {
  const name = safeName(raw);
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อโฟลเดอร์');
  if (name === '.' || name === '..') throw new HttpError(400, 'ชื่อโฟลเดอร์ไม่ถูกต้อง');
  return name;
}

function requireSiblingFree(folders, parentId, name, exceptId) {
  const clash = folders.find((f) => f.parent_id === parentId && f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new HttpError(409, 'มีโฟลเดอร์ชื่อนี้อยู่แล้วในตำแหน่งเดียวกัน');
}

export async function createFolder(c, _p, request) {
  const body = await request.json().catch(() => ({}));
  const name = checkName(body.name);
  const folders = await getFolders(c);
  const parent = folders.find((f) => f.id === body.parent_id);
  if (!parent) throw new HttpError(400, 'ไม่พบโฟลเดอร์ที่จะสร้างภายใต้');
  requireSiblingFree(folders, parent.id, name);
  const created = await G.driveCreateFolder(c.env, name, parent.id);
  const row = {
    id: created.id,
    name,
    parent_id: parent.id,
    created_by: c.user.display_name,
    created_at: nowIso(),
    status: 'active',
  };
  await appendRow(c, 'folders', row);
  logHistory(c, 'สร้างโฟลเดอร์', row.id, name, `ภายใต้ ${parent.path}`);
  return json({ folder: { ...row, path: `${parent.path} › ${name}`, doc_count: 0 } }, 201);
}

export async function updateFolder(c, { id }, request) {
  if (id === c.env.ROOT_FOLDER_ID) throw new HttpError(400, 'ไม่สามารถแก้ไขโฟลเดอร์หลักได้');
  const body = await request.json().catch(() => ({}));
  const folders = await getFolders(c);
  const cur = folders.find((f) => f.id === id);
  if (!cur) throw new HttpError(404, 'ไม่พบโฟลเดอร์');
  const row = (await listRows(c, 'folders')).find((r) => r.id === id);

  let name = cur.name;
  let parentId = cur.parent_id;
  if ('name' in body) name = checkName(body.name);
  if ('parent_id' in body && body.parent_id !== cur.parent_id) {
    const target = folders.find((f) => f.id === body.parent_id);
    if (!target) throw new HttpError(400, 'ไม่พบโฟลเดอร์ปลายทาง');
    // ห้ามย้ายเข้าไปอยู่ใต้ตัวเอง
    for (let p = target; p; p = folders.find((f) => f.id === p.parent_id)) {
      if (p.id === id) throw new HttpError(400, 'ย้ายโฟลเดอร์เข้าไปอยู่ภายในตัวเองไม่ได้');
    }
    parentId = target.id;
  }
  requireSiblingFree(folders, parentId, name, id);

  const driveBody = name !== cur.name ? { name } : {};
  const moveOpts = parentId !== cur.parent_id ? { addParents: parentId, removeParents: cur.parent_id } : {};
  if (Object.keys(driveBody).length || moveOpts.addParents) await G.drivePatch(c.env, id, driveBody, moveOpts);
  await updateRow(c, 'folders', row, { name, parent_id: parentId });
  const what = [name !== cur.name ? `เปลี่ยนชื่อเป็น ${name}` : '', parentId !== cur.parent_id ? 'ย้ายตำแหน่ง' : ''].filter(Boolean).join(', ');
  logHistory(c, 'แก้ไขโฟลเดอร์', id, cur.name, what);
  return json({ ok: true });
}

// ลบโฟลเดอร์: ค่าเริ่มต้นลบได้เฉพาะโฟลเดอร์ว่าง; ใส่ ?force=1 เพื่อลบพร้อมโฟลเดอร์ย่อยและเอกสารทั้งหมดข้างใน
// (ทั้งหมดไปอยู่ในถังขยะของที่เก็บไฟล์ ผู้ดูแลกู้คืนได้ภายใน 30 วัน)
export async function deleteFolder(c, { id }, request) {
  if (id === c.env.ROOT_FOLDER_ID) throw new HttpError(400, 'ไม่สามารถลบโฟลเดอร์หลักได้');
  const force = new URL(request.url).searchParams.get('force') === '1';
  const folders = await getFolders(c);
  const cur = folders.find((f) => f.id === id);
  if (!cur) throw new HttpError(404, 'ไม่พบโฟลเดอร์');
  // รวมโฟลเดอร์นี้และโฟลเดอร์ย่อยทุกชั้น
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) if (!ids.has(f.id) && ids.has(f.parent_id)) { ids.add(f.id); grew = true; }
  }
  const docs = (await listRows(c, 'docs')).filter((d) => ids.has(d.folder_id) && d.status !== 'trashed');
  if (!force) {
    if (ids.size > 1) throw new HttpError(409, 'ลบไม่ได้ เพราะยังมีโฟลเดอร์ย่อยอยู่ข้างใน');
    if (docs.length) throw new HttpError(409, `ลบไม่ได้ เพราะยังมีเอกสาร ${docs.length} รายการอยู่ข้างใน`);
  }
  await G.drivePatch(c.env, id, { trashed: true }); // ไฟล์และโฟลเดอร์ย่อยไปอยู่ในถังขยะพร้อมกัน
  const now = nowIso();
  for (const d of docs) await updateRow(c, 'docs', d, { status: 'trashed', updated_at: now });
  const rows = await listRows(c, 'folders');
  for (const r of rows) if (ids.has(r.id)) await updateRow(c, 'folders', r, { status: 'deleted' });
  logHistory(c, 'ลบโฟลเดอร์', id, cur.name, ids.size > 1 || docs.length ? `พร้อมโฟลเดอร์ย่อย ${ids.size - 1} และเอกสาร ${docs.length} รายการ` : '');
  return json({ ok: true, folders_deleted: ids.size, documents_deleted: docs.length });
}
