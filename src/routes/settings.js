import { json } from '../util.js';
import { getSettings, saveSetting, logHistory } from '../db.js';
import { cleanFields, cleanDocTypes } from '../validate.js';

export async function putSettings(c, _p, request) {
  const body = await request.json().catch(() => ({}));
  if ('doc_types' in body) await saveSetting(c, 'doc_types', cleanDocTypes(body.doc_types));
  if ('fields' in body) await saveSetting(c, 'fields', cleanFields(body.fields));
  logHistory(c, 'แก้ไขการตั้งค่า', '', 'ประเภทเอกสาร/ช่องรายละเอียด');
  c.cache.clear();
  return json({ settings: await getSettings(c) });
}
