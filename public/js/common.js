// ตัวช่วยร่วมของทุกหน้า: เรียก API, หัวเว็บ/แบนเนอร์, ฟอร์มรายละเอียด, กล่องโต้ตอบ
export const SYSTEM_NAME = 'ระบบบริหารจัดการเอกสารอิเล็กทรอนิกส์';
export const SYSTEM_EN = 'E-Document Management System';
export const UNIT_NAME = 'ส่วนการโยธา สำนักช่าง เทศบาลนครระยอง';

// สร้างองค์ประกอบ DOM (ไม่ใช้ innerHTML เพื่อกัน XSS)
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form' && k !== 'style') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function svgIcon(path, size = 18, extra = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  for (const [k, v] of Object.entries(extra)) s.setAttribute(k, v);
  for (const d of [].concat(path)) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}
export const ICON = {
  plus: 'M12 5v14M5 12h14',
  upload: ['M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5', 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2'],
  x: 'M6 6l12 12M18 6 6 18',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5'],
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: ['M12 8v5', 'M12 16.5h.01', 'M10.3 4.2 2.7 17.5A2 2 0 0 0 4.4 20.5h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  drive: ['M4 15h16v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M4 15l3-9h10l3 9', 'M8 17.5h.01'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v5', 'M14 11v5'],
  files: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
};

// ---------- API ----------
export async function api(method, path, body) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) {
    // หน้าแรก (/) ไม่ต้องจำ เพื่อให้ล็อกอินแล้วเข้าแดชบอร์ด
    const back = location.pathname + location.search;
    location.href = back === '/' ? '/login.html' : '/login.html?next=' + encodeURIComponent(back);
    return new Promise(() => {}); // รอหน้าเปลี่ยนไปหน้าล็อกอิน
  }
  if (!res.ok) throw new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

// ---------- รูปแบบแสดงผล ----------
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function fmtDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${Number(g('day'))} ${MONTHS[Number(g('month')) - 1]} ${Number(g('year')) + 543} ${g('hour')}:${g('minute')} น.`;
}
export function fmtUploadDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d); // YYYY-MM-DD
  return fmtDate(p);
}
export function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n ? `${n} B` : '–';
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
export const extLabel = (name) => (/\.([A-Za-z0-9]{1,5})$/.exec(name || '')?.[1] || 'file').toLowerCase();
export const stripExt = (name) => String(name || '').replace(/\.[A-Za-z0-9]{1,8}$/, '');

// ป้ายชนิดไฟล์ (สีตามชนิด)
const EXT_KIND = { pdf: 'pdf', jpg: 'img', jpeg: 'img', png: 'img', gif: 'img', webp: 'img', tif: 'img', tiff: 'img', doc: 'doc', docx: 'doc', xls: 'xls', xlsx: 'xls', csv: 'xls', ppt: 'ppt', pptx: 'ppt', dwg: 'cad', dxf: 'cad' };
export function extBadge(name) {
  const e = extLabel(name);
  return h('span', { class: 'ext', 'data-k': EXT_KIND[e] || 'other', text: e });
}

// ไฮไลต์คำค้นในข้อความ (สร้างโหนดเอง ไม่ใช้ innerHTML)
export function highlight(text, query) {
  const words = String(query || '').trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return [String(text)];
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  return String(text).split(re).map((part, i) => (i % 2 ? h('mark', { text: part }) : part));
}

// ปีงบประมาณ (พ.ศ.) เริ่ม 1 ตุลาคม
export function fiscalYearOf(isoDate) {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate || '');
  const d = m ? { y: Number(m[1]), mo: Number(m[2]) } : (() => { const n = new Date(); return { y: n.getFullYear(), mo: n.getMonth() + 1 }; })();
  return String(d.y + 543 + (d.mo >= 10 ? 1 : 0));
}
export function fiscalYearOptions(extra = []) {
  const cur = Number(fiscalYearOf());
  const list = new Set([...extra.filter(Boolean).map(String)]);
  for (let y = cur + 1; y >= cur - 9; y--) list.add(String(y));
  return [...list].sort((a, b) => b - a);
}

// ---------- แจ้งเตือน / กล่องโต้ตอบ ----------
export function toast(msg, isErr = false) {
  const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), role: isErr ? 'alert' : 'status' }, svgIcon(isErr ? ICON.alert : ICON.check, 20), h('span', { text: msg }));
  document.body.append(t);
  const life = isErr ? 6000 : 3000;
  setTimeout(() => t.classList.add('out'), life - 220);
  setTimeout(() => t.remove(), life);
}

export function openDialog(title, bodyEls, { okText = 'ตกลง', cancelText = 'ยกเลิก', danger = false, onOk, wide = false } = {}) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'st-err', role: 'alert', hidden: true });
    const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'submit', text: okText });
    const cancel = h('button', { class: 'btn', type: 'button', text: cancelText });
    const form = h('form', { method: 'dialog' }, h('h2', { text: title }), ...[].concat(bodyEls), err, h('div', { class: 'acts' }, cancel, ok));
    const dlg = h('dialog', {}, form);
    if (wide) dlg.style.maxWidth = 'min(720px,94vw)';
    let result = null;
    cancel.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      ok.disabled = true;
      err.hidden = true;
      try {
        result = onOk ? await onOk() : true;
        dlg.close();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        ok.disabled = false;
      }
    });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('input,select,textarea')?.focus();
  });
}

export const confirmBox = (message, okText = 'ตกลง', danger = false, onOk) =>
  openDialog('ยืนยัน', [h('p', { text: message, style: undefined })], { okText, danger, onOk });

export function askText({ title, label, value = '', okText = 'บันทึก', onOk, placeholder = '' }) {
  const input = h('input', { type: 'text', id: 'ask-in', value, placeholder, maxLength: 150, required: true });
  return openDialog(title, [h('div', { class: 'field' }, h('label', { for: 'ask-in', text: label }), input)], {
    okText,
    onOk: () => onOk(input.value.trim()),
  });
}

// ---------- โฟลเดอร์ ----------
// คืนรายการโฟลเดอร์เรียงเป็นต้นไม้ (depth-first) พร้อมความลึก
export function folderTree(folders) {
  const kids = new Map();
  for (const f of folders) {
    const k = kids.get(f.parent_id) || [];
    k.push(f);
    kids.set(f.parent_id, k);
  }
  const ids = new Set(folders.map((f) => f.id));
  const out = [];
  const walk = (parent, depth) => {
    const list = (kids.get(parent) || []).sort((a, b) => a.name.localeCompare(b.name, 'th'));
    for (const f of list) {
      out.push({ ...f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk('', 0);
  for (const f of folders) if (f.parent_id && !ids.has(f.parent_id) && !out.some((o) => o.id === f.id)) out.push({ ...f, depth: 0 });
  return out;
}

export function descendantIds(folders, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (!out.has(f.id) && out.has(f.parent_id)) { out.add(f.id); grew = true; }
  }
  return out;
}

export function folderSelect(folders, { value, exclude = new Set(), id } = {}) {
  const sel = h('select', { id });
  for (const f of folderTree(folders)) {
    if (exclude.has(f.id)) continue;
    sel.append(h('option', { value: f.id, text: f.path, selected: f.id === value }));
  }
  return sel;
}

// ---------- ฟอร์มรายละเอียดเอกสาร (ใช้ร่วมหน้าอัปโหลด/แก้ไข) ----------
let formSeq = 0;
export function detailsForm(boot, initial = {}, { withTitle = false } = {}) {
  const uid = `df${++formSeq}`;
  const s = boot.settings;
  const inputs = {};
  const field = (key, label, control, { req = false, hint } = {}) => {
    inputs[key] = control;
    control.id = `${uid}-${key}`;
    return h('div', { class: 'field' }, h('label', { for: control.id }, label, req ? h('span', { class: 'req', text: ' *' }) : ''), control, hint ? h('div', { class: 'hint', text: hint }) : '');
  };
  const sel = (opts, value, blank) => {
    const el = h('select');
    if (blank) el.append(h('option', { value: '', text: blank }));
    for (const o of opts) el.append(h('option', { value: o, text: o, selected: o === value }));
    return el;
  };

  const types = [...s.doc_types];
  if (initial.doc_type && !types.includes(initial.doc_type)) types.push(initial.doc_type);
  const years = fiscalYearOptions([initial.fiscal_year]);

  const date = h('input', { type: 'date', value: initial.doc_date || '' });
  const yearEl = sel(years, initial.fiscal_year || fiscalYearOf(initial.doc_date), '');
  let yearTouched = !!initial.fiscal_year;
  yearEl.addEventListener('change', () => (yearTouched = true));
  date.addEventListener('change', () => {
    if (!yearTouched && date.value) yearEl.value = fiscalYearOf(date.value);
  });

  const parts = [];
  if (withTitle) parts.push(field('title', 'ชื่อเอกสาร / เรื่อง', h('input', { type: 'text', value: initial.title || '', maxLength: 200 }), { req: true }));
  parts.push(
    h(
      'div',
      { class: 'grid2' },
      field('doc_no', 'เลขที่หนังสือ', h('input', { type: 'text', value: initial.doc_no || '', placeholder: 'เช่น รย 52004/…', maxLength: 100 })),
      field('doc_date', 'ลงวันที่', date),
      field('doc_type', 'ประเภทเอกสาร', sel(types, initial.doc_type, 'เลือกประเภท…'), { req: true }),
      field('fiscal_year', 'ปีงบประมาณ (พ.ศ.)', yearEl, { req: true })
    )
  );
  const customEls = [];
  for (const f of s.fields) {
    const v = initial.extra?.[f.key] || '';
    let control;
    if (f.kind === 'select') control = sel(f.options, v, 'เลือก…');
    else if (f.kind === 'date') control = h('input', { type: 'date', value: v });
    else if (f.kind === 'number') control = h('input', { type: 'number', value: v, step: 'any' });
    else control = h('input', { type: 'text', value: v, maxLength: 500 });
    inputs['x:' + f.key] = control;
    control.id = `${uid}-x-${f.key}`;
    customEls.push(h('div', { class: 'field' }, h('label', { for: control.id }, f.label, f.required ? h('span', { class: 'req', text: ' *' }) : ''), control));
  }
  if (customEls.length) parts.push(h('div', { class: 'grid2' }, customEls));
  parts.push(
    field('tags', 'คำค้น (แท็ก)', h('input', { type: 'text', value: initial.tags || '', placeholder: 'คั่นด้วยเครื่องหมายจุลภาค เช่น ถนน, ผิวจราจร' }), {
      hint: 'ช่วยให้ค้นหาเจอเร็วขึ้น',
    }),
    field('note', 'รายละเอียดเพิ่มเติม', h('textarea', { rows: 3, value: initial.note || '', placeholder: 'สรุปสาระสำคัญ ผู้เกี่ยวข้อง หรือหมายเหตุ', maxLength: 2000 }))
  );

  const el = h('div', { style: undefined, class: 'card', 'data-plain': '1' }, parts);
  el.style.cssText = 'border:0;padding:0;gap:14px';

  return {
    el,
    inputs,
    get() {
      const out = {
        doc_no: inputs.doc_no.value.trim(),
        doc_date: inputs.doc_date.value,
        doc_type: inputs.doc_type.value,
        fiscal_year: inputs.fiscal_year.value,
        tags: inputs.tags.value.trim(),
        note: inputs.note.value.trim(),
        extra: {},
      };
      if (inputs.title) out.title = inputs.title.value.trim();
      for (const f of s.fields) out.extra[f.key] = inputs['x:' + f.key].value.trim();
      return out;
    },
    // คืนข้อความผิดพลาด หรือ '' ถ้าครบถ้วน
    problem(values = this.get(), { needTitle = withTitle } = {}) {
      if (needTitle && !values.title) return 'กรุณากรอกชื่อเอกสาร';
      if (!values.doc_type) return 'กรุณาเลือกประเภทเอกสาร';
      if (!values.fiscal_year) return 'กรุณาเลือกปีงบประมาณ';
      for (const f of s.fields) if (f.required && !values.extra[f.key]) return `กรุณากรอก "${f.label}"`;
      return '';
    },
  };
}

// ---------- หัวเว็บ + แบนเนอร์ ----------
export async function init(active, pageTitle) {
  document.title = `${pageTitle} | ${SYSTEM_NAME} ${UNIT_NAME}`;
  // แสดงแถบบนพร้อมชื่อระบบทันที ไม่ต้องรอข้อมูลจากเซิร์ฟเวอร์ (เมนูและชื่อผู้ใช้ตามมาทีหลัง)
  const early = h('header', { class: 'top' }, h('div', { class: 'topin' }, bannerEl()));
  document.getElementById('top').replaceWith(early);
  const boot = await api('GET', '/api/bootstrap');
  const me = boot.me;
  const nav = [
    ['dash', '/dashboard.html', 'แดชบอร์ด'],
    ['docs', '/', 'เอกสาร'],
    ['upload', '/upload.html', 'อัปโหลด'],
    ['folders', '/folders.html', 'จัดการโฟลเดอร์'],
  ];
  if (me.role === 'admin') nav.push(['users', '/users.html', 'ผู้ใช้งาน']);

  const pw = h('button', { type: 'button', text: 'เปลี่ยนรหัสผ่าน', onclick: () => changePasswordDialog() });
  const out = h('button', {
    type: 'button',
    text: 'ออกจากระบบ',
    onclick: async () => {
      await api('POST', '/api/logout', {}).catch(() => {});
      location.href = '/login.html';
    },
  });
  const menu = h('details', { class: 'me' },
    h('summary', {}, h('div', { class: 'av', text: initials(me.display_name) }), h('div', { class: 'who' }, h('b', { text: me.display_name }), h('br'), me.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้ทั่วไป')),
    h('div', { class: 'menu' }, pw, out)
  );
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });

  const navEl = h('nav', { class: 'nav', 'aria-label': 'เมนูหลัก' }, nav.map(([k, href, label]) => h('a', { href, text: label, 'aria-current': k === active ? 'page' : false })));
  const top = h('header', { class: 'top' }, h('div', { class: 'topin' }, bannerEl(), navEl, menu));
  early.replaceWith(top);
  return boot;
}

export function bannerEl() {
  const logo = h('div', { class: 'mark', 'aria-hidden': 'true' }, svgIcon([ICON.folder, 'M8 13h8M8 16h5'], 24, { 'stroke-width': '1.7' }));
  return h('div', { class: 'banner' }, logo, h('div', {}, h('div', { class: 't1', text: `${SYSTEM_NAME} (${SYSTEM_EN})` }), h('div', { class: 't2', text: UNIT_NAME })));
}

function changePasswordDialog() {
  const cur = h('input', { type: 'password', id: 'pw0', autocomplete: 'current-password', required: true });
  const n1 = h('input', { type: 'password', id: 'pw1', autocomplete: 'new-password', required: true, minLength: 8 });
  const n2 = h('input', { type: 'password', id: 'pw2', autocomplete: 'new-password', required: true });
  openDialog('เปลี่ยนรหัสผ่าน', [
    h('div', { class: 'field' }, h('label', { for: 'pw0', text: 'รหัสผ่านปัจจุบัน' }), cur),
    h('div', { class: 'field' }, h('label', { for: 'pw1', text: 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)' }), n1),
    h('div', { class: 'field' }, h('label', { for: 'pw2', text: 'พิมพ์รหัสผ่านใหม่อีกครั้ง' }), n2),
  ], {
    okText: 'เปลี่ยนรหัสผ่าน',
    onOk: async () => {
      if (n1.value !== n2.value) throw new Error('รหัสผ่านใหม่สองช่องไม่ตรงกัน');
      await api('POST', '/api/me/password', { current: cur.value, next: n1.value });
      toast('เปลี่ยนรหัสผ่านแล้ว');
      return true;
    },
  });
}

export const driveFolderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;
export const qs = (k) => new URLSearchParams(location.search).get(k);

// อักษรย่อชื่อ (ใช้ในวงกลมรูปผู้ใช้): ชื่อไทยใช้ตัวอักษรแรกของคำแรก ชื่อ/นามสกุลอังกฤษใช้ตัวแรกของสองคำแรก
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]][0];
  if (/[\u0E00-\u0E7F]/.test(first)) return first;
  return (first + ([...(parts[1] || '')][0] || '')).toUpperCase();
}

// ---------- การเปลี่ยนชื่อ/ลบโฟลเดอร์ (ใช้ร่วมกันหลายหน้า) ----------
export function renameFolderDialog(f, after) {
  askText({
    title: 'เปลี่ยนชื่อโฟลเดอร์',
    label: 'ชื่อใหม่ (ชื่อโฟลเดอร์ในที่เก็บไฟล์จะเปลี่ยนตาม)',
    value: f.name,
    onOk: async (name) => {
      await api('PATCH', `/api/folders/${f.id}`, { name });
      toast('เปลี่ยนชื่อโฟลเดอร์แล้ว');
      await after?.(name);
      return true;
    },
  });
}

// ลบโฟลเดอร์: บอกจำนวนโฟลเดอร์ย่อยและเอกสารที่จะถูกลบไปด้วยก่อนยืนยัน
export function deleteFolderDialog(f, folders, after) {
  const ids = descendantIds(folders, f.id);
  const subs = ids.size - 1;
  const docs = folders.filter((x) => ids.has(x.id)).reduce((a, x) => a + (x.doc_count || 0), 0);
  const inside = subs || docs ? ` พร้อมโฟลเดอร์ย่อย ${subs} โฟลเดอร์ และเอกสารข้างในทั้งหมด ${docs} รายการ` : '';
  confirmBox(`ลบโฟลเดอร์ "${f.name}"${inside}? (ย้ายไปถังขยะ ผู้ดูแลระบบกู้คืนได้ภายใน 30 วัน)`, 'ลบโฟลเดอร์', true, async () => {
    await api('DELETE', `/api/folders/${f.id}?force=1`);
    toast('ลบโฟลเดอร์แล้ว');
    await after?.();
    return true;
  });
}
