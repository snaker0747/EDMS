import { HttpError, clampStr } from './util.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^\d{4}$/;

export function normalizeTags(v) {
  const list = (Array.isArray(v) ? v : String(v ?? '').split(/[,،;\n]/))
    .map((t) => clampStr(t, 40))
    .filter(Boolean);
  return [...new Set(list)].slice(0, 20).join(', ');
}

// ตรวจและทำความสะอาดรายละเอียดเอกสารจากผู้ใช้
// requireAll = true ตอนสร้างใหม่ (ชื่อ ประเภท ปีงบประมาณ และช่องบังคับกรอกต้องมี)
export function cleanMeta(input, settings, { requireAll }) {
  const m = input && typeof input === 'object' ? input : {};
  const out = {};
  if ('title' in m || requireAll) {
    out.title = clampStr(m.title, 200);
    if (!out.title) throw new HttpError(400, 'กรุณากรอกชื่อเอกสาร');
  }
  if ('doc_no' in m) out.doc_no = clampStr(m.doc_no, 100);
  if ('doc_date' in m) {
    const d = clampStr(m.doc_date, 10);
    if (d && !DATE_RE.test(d)) throw new HttpError(400, 'รูปแบบวันที่ไม่ถูกต้อง');
    out.doc_date = d;
  }
  if ('doc_type' in m || requireAll) {
    const t = clampStr(m.doc_type, 60);
    if (!t && requireAll) throw new HttpError(400, 'กรุณาเลือกประเภทเอกสาร');
    if (t && !settings.doc_types.includes(t)) throw new HttpError(400, 'ประเภทเอกสารไม่อยู่ในรายการ');
    out.doc_type = t;
  }
  if ('fiscal_year' in m || requireAll) {
    const y = clampStr(m.fiscal_year, 4);
    if (!y && requireAll) throw new HttpError(400, 'กรุณาเลือกปีงบประมาณ');
    if (y && !YEAR_RE.test(y)) throw new HttpError(400, 'ปีงบประมาณไม่ถูกต้อง');
    out.fiscal_year = y;
  }
  if ('tags' in m) out.tags = normalizeTags(m.tags);
  if ('note' in m) out.note = clampStr(m.note, 2000);

  if ('extra' in m || requireAll) {
    const src = m.extra && typeof m.extra === 'object' ? m.extra : {};
    const extra = {};
    for (const f of settings.fields) {
      const v = clampStr(src[f.key], 500);
      if (f.required && !v && requireAll) throw new HttpError(400, `กรุณากรอก "${f.label}"`);
      if (v && f.kind === 'select' && Array.isArray(f.options) && f.options.length && !f.options.includes(v)) {
        throw new HttpError(400, `ค่าของ "${f.label}" ไม่อยู่ในตัวเลือก`);
      }
      if (v && f.kind === 'date' && !DATE_RE.test(v)) throw new HttpError(400, `วันที่ใน "${f.label}" ไม่ถูกต้อง`);
      if (v && f.kind === 'number' && !Number.isFinite(Number(v))) throw new HttpError(400, `"${f.label}" ต้องเป็นตัวเลข`);
      if (v) extra[f.key] = v;
    }
    out.extra = JSON.stringify(extra);
  }
  return out;
}

export function cleanFields(list) {
  if (!Array.isArray(list) || list.length > 30) throw new HttpError(400, 'รายการช่องรายละเอียดไม่ถูกต้อง');
  const kinds = ['text', 'date', 'select', 'number'];
  const seen = new Set();
  return list.map((f) => {
    const label = clampStr(f?.label, 60);
    if (!label) throw new HttpError(400, 'ช่องรายละเอียดต้องมีชื่อ');
    const kind = kinds.includes(f.kind) ? f.kind : 'text';
    let key = /^f_[a-z0-9]{4,12}$/.test(f.key || '') ? f.key : 'f_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    if (seen.has(key)) key = 'f_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    seen.add(key);
    const options =
      kind === 'select'
        ? [...new Set((Array.isArray(f.options) ? f.options : []).map((o) => clampStr(o, 60)).filter(Boolean))].slice(0, 50)
        : [];
    if (kind === 'select' && !options.length) throw new HttpError(400, `ช่อง "${label}" ต้องมีตัวเลือกอย่างน้อย 1 ค่า`);
    return { key, label, kind, required: !!f.required, options };
  });
}

export function cleanDocTypes(list) {
  if (!Array.isArray(list) || !list.length || list.length > 60) throw new HttpError(400, 'ต้องมีประเภทเอกสารอย่างน้อย 1 รายการ');
  return [...new Set(list.map((t) => clampStr(t, 60)).filter(Boolean))];
}
