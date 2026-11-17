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

export async function deleteFolder(c, { id }) {
  if (id === c.env.ROOT_FOLDER_ID) throw new HttpError(400, 'ไม่สามารถลบโฟลเดอร์หลักได้');
  const folders = await getFolders(c);
  const cur = folders.find((f) => f.id === id);
  if (!cur) throw new HttpError(404, 'ไม่พบโฟลเดอร์');
  if (folders.some((f) => f.parent_id === id)) throw new HttpError(409, 'ลบไม่ได้ เพราะยังมีโฟลเดอร์ย่อยอยู่ข้างใน');
  const docs = (await listRows(c, 'docs')).filter((d) => d.folder_id === id && d.status !== 'trashed');
  if (docs.length) throw new HttpError(409, `ลบไม่ได้ เพราะยังมีเอกสาร ${docs.length} รายการอยู่ข้างใน`);
  await G.drivePatch(c.env, id, { trashed: true });
  const row = (await listRows(c, 'folders')).find((r) => r.id === id);
  await updateRow(c, 'folders', row, { status: 'deleted' });
  logHistory(c, 'ลบโฟลเดอร์', id, cur.name);
  return json({ ok: true });
}
