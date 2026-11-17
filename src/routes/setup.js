import { HttpError, json, nowIso, stripExt, timingSafeEqual, clampStr } from '../util.js';
import * as G from '../google.js';
import {
  getSheetId,
  ensureSchema,
  listRows,
  appendRow,
  appendRows,
  updateRow,
  getUsers,
  saveSetting,
  DEFAULT_DOC_TYPES,
  logHistory,
} from '../db.js';
import { runSync } from '../sync.js';
import { hashPassword, passwordProblem } from '../auth.js';

// นำโฟลเดอร์และไฟล์ที่มีอยู่ใน Google Drive เข้ามาในตาราง (ไฟล์ที่ยังไม่มีรายละเอียดจะเว้นว่างไว้ให้กรอกภายหลัง)
export async function syncFromDrive(c) {
  const { env } = c;
  const sheetId = await getSheetId(c);
  const folderRows = await listRows(c, 'folders');
  const docRows = await listRows(c, 'docs');
  const knownFolders = new Map(folderRows.map((r) => [r.id, r]));
  const knownDocs = new Set(docRows.map((r) => r.id));
  const newFolders = [];
  const newDocs = [];
  let reactivated = 0;

  const root = await G.driveGet(env, env.ROOT_FOLDER_ID);
  if (!knownFolders.has(root.id)) {
    newFolders.push({ id: root.id, name: root.name, parent_id: '', created_by: 'บัญชีส่วนกลาง', created_at: root.createdTime || nowIso(), status: 'active' });
  }

  const queue = [env.ROOT_FOLDER_ID];
  const seen = new Set(queue);
  while (queue.length) {
    const folderId = queue.shift();
    const children = await G.driveList(env, `'${folderId}' in parents and trashed=false`);
    for (const f of children) {
      if (f.mimeType === G.FOLDER_MIME) {
        const known = knownFolders.get(f.id);
        if (!known) {
          newFolders.push({ id: f.id, name: f.name, parent_id: folderId, created_by: 'บัญชีส่วนกลาง', created_at: f.createdTime || nowIso(), status: 'active' });
        } else if (known.status === 'deleted') {
          await updateRow(c, 'folders', known, { status: 'active', name: f.name, parent_id: folderId });
          reactivated++;
        }
        if (!seen.has(f.id)) {
          seen.add(f.id);
          queue.push(f.id);
        }
      } else if (f.id !== sheetId && !knownDocs.has(f.id)) {
        newDocs.push({
          id: f.id,
          title: stripExt(f.name),
          doc_no: '',
          doc_date: '',
          doc_type: '',
          fiscal_year: '',
          folder_id: folderId,
          tags: '',
          note: '',
          extra: '{}',
          file_name: f.name,
          mime: f.mimeType,
          size: String(f.size || 0),
          drive_url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          uploader: 'บัญชีส่วนกลาง',
          uploaded_at: f.createdTime || nowIso(),
          updated_at: f.modifiedTime || nowIso(),
          status: 'active',
        });
      }
    }
  }
  await appendRows(c, 'folders', newFolders);
  await appendRows(c, 'docs', newDocs);
  return { folders_added: newFolders.length, documents_added: newDocs.length, folders_reactivated: reactivated };
}

export async function adminSync(c) {
  const result = await syncFromDrive(c);
  logHistory(c, 'ซิงก์ไฟล์จากที่เก็บไฟล์', '', '', `เพิ่มโฟลเดอร์ ${result.folders_added}, เอกสาร ${result.documents_added}`);
  return json(result);
}

// เรียกครั้งแรกหลังติดตั้ง: สร้างชีต/ตาราง สร้างผู้ดูแลคนแรก และนำของเดิมใน Drive เข้าระบบ (เรียกซ้ำได้ ไม่ทำซ้ำของเดิม)
export async function setup(c, _p, request) {
  const key = request.headers.get('x-setup-key') || '';
  if (!c.env.SETUP_KEY || !timingSafeEqual(key, c.env.SETUP_KEY)) throw new HttpError(403, 'รหัสตั้งค่าไม่ถูกต้อง');
  const body = await request.json().catch(() => ({}));

  const sheetId = await getSheetId(c, { create: true });
  await ensureSchema(c, sheetId);
  await runSync(c.env, { init: true }); // นำข้อมูลที่มีอยู่ในชีตเข้า D1 ก่อน (เรียกซ้ำได้)
  c.cache.clear();

  const settings = await listRows(c, 'settings');
  if (!settings.some((r) => r.key === 'doc_types')) await saveSetting(c, 'doc_types', DEFAULT_DOC_TYPES);
  if (!settings.some((r) => r.key === 'fields')) await saveSetting(c, 'fields', []);

  let adminCreated = false;
  c.cache.clear();
  const users = await getUsers(c);
  if (!users.length) {
    const username = clampStr(body.admin_username, 30).toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new HttpError(400, 'ต้องระบุ admin_username (a-z 0-9 . _ - ยาว 3-30 ตัว)');
    const problem = passwordProblem(body.admin_password);
    if (problem) throw new HttpError(400, problem);
    await appendRow(c, 'users', {
      username,
      display_name: clampStr(body.admin_name, 80) || 'ผู้ดูแลระบบ',
      role: 'admin',
      password_hash: await hashPassword(body.admin_password),
      active: 'true',
      created_at: nowIso(),
    });
    adminCreated = true;
  }

  c.cache.clear();
  const synced = await syncFromDrive(c);
  return json({
    ok: true,
    sheet_id: sheetId,
    sheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    admin_created: adminCreated,
    synced,
  });
}
