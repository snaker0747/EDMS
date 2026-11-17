import { h, api, init, toast, askText, folderTree, descendantIds, fmtSize, fmtUploadDate, extBadge, highlight, initials, svgIcon, ICON, driveFolderUrl, qs } from './common.js';

// ขอรายการเอกสารพร้อมกับข้อมูลเริ่มต้น ไม่ต้องรอกันทีละอย่าง
const docsReq = api('GET', '/api/documents');
docsReq.catch(() => {});
const boot = await init('docs', 'เอกสาร');
const isAdmin = boot.me.role === 'admin';
const $ = (id) => document.getElementById(id);
let folders = boot.folders;
let docs = (await docsReq).documents;
let current = qs('folder') || ''; // '' = ทุกโฟลเดอร์
let shown = 100;
$('main').removeAttribute('aria-busy');

const NA = () => h('em', { class: 'na', text: 'ยังไม่กรอก' });

function renderTree() {
  const t = $('tree');
  t.replaceChildren();
  const btn = (id, label, count) =>
    h('button', { class: 'fbtn', type: 'button', 'aria-current': current === id ? 'true' : 'false', onclick: () => select(id) },
      h('span', { class: 'lead' }, svgIcon(id ? ICON.folder : ICON.files, 16), h('span', { class: 'nm', text: label, title: label })), h('span', { class: 'n', text: count }));
  const all = btn('', 'เอกสารทั้งหมด', docs.length, 0);
  t.append(all);
  for (const f of folderTree(folders)) {
    const b = btn(f.id, f.name, f.doc_count, f.depth);
    b.style.paddingLeft = `${10 + f.depth * 16}px`;
    t.append(b);
  }
}

function select(id) {
  current = id;
  shown = 100;
  history.replaceState(null, '', id ? `/?folder=${encodeURIComponent(id)}` : '/');
  renderTree();
  renderHead();
  render();
}

function renderHead() {
  const f = folders.find((x) => x.id === current);
  $('h1').textContent = f ? f.name : 'เอกสารทั้งหมด';
  $('crumb').textContent = f ? f.path : 'ทุกโฟลเดอร์';
  $('lede').textContent = `สวัสดี ${boot.me.display_name} · ${todayTh()}`;
  const link = $('driveLink');
  link.hidden = !(f && isAdmin);
  if (f) link.href = driveFolderUrl(f.id);
  $('upBtn').href = current ? `/upload.html?folder=${encodeURIComponent(current)}` : '/upload.html';
}

function fillSelect(sel, first, values) {
  const old = sel.value;
  sel.replaceChildren(h('option', { value: '', text: first }));
  for (const v of values) sel.append(h('option', { value: v, text: v }));
  sel.value = values.includes(old) ? old : '';
}
function renderFilters() {
  fillSelect($('f-type'), 'ทุกประเภท', [...new Set([...boot.settings.doc_types, ...docs.map((d) => d.doc_type)].filter(Boolean))]);
  fillSelect($('f-year'), 'ทุกปี', [...new Set(docs.map((d) => d.fiscal_year).filter(Boolean))].sort((a, b) => b - a));
  fillSelect($('f-by'), 'ทุกคน', [...new Set(docs.map((d) => d.uploader).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')));
}

function filtered() {
  const ids = current ? ($('sub').checked ? descendantIds(folders, current) : new Set([current])) : null;
  const q = $('q').value.trim().toLowerCase();
  const type = $('f-type').value, year = $('f-year').value, by = $('f-by').value;
  let list = docs.filter((d) => {
    if (ids && !ids.has(d.folder_id)) return false;
    if (type && d.doc_type !== type) return false;
    if (year && d.fiscal_year !== year) return false;
    if (by && d.uploader !== by) return false;
    if (q) {
      const hay = `${d.title} ${d.doc_no} ${d.tags} ${d.note} ${d.file_name} ${Object.values(d.extra || {}).join(' ')}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const sort = $('f-sort').value;
  if (sort === 'old') list.sort((a, b) => String(a.uploaded_at).localeCompare(String(b.uploaded_at)));
  else if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title, 'th'));
  else if (sort === 'no') list.sort((a, b) => (a.doc_no || '~').localeCompare(b.doc_no || '~', 'th', { numeric: true }));
  return list;
}

function activeFilters() {
  const out = [];
  const add = (label, sel, reset) => { if (sel.value) out.push({ label: `${label}: ${sel.value}`, clear: () => { sel.value = ''; reset?.(); } }); };
  add('ประเภท', $('f-type'));
  add('ปี', $('f-year'));
  add('ผู้อัปโหลด', $('f-by'));
  if ($('q').value.trim()) out.push({ label: `ค้นหา: ${$('q').value.trim()}`, clear: () => { $('q').value = ''; } });
  return out;
}
function clearAll() {
  for (const f of activeFilters()) f.clear();
  shown = 100;
  render();
}
function renderChips() {
  const list = activeFilters();
  const box = $('chips');
  box.hidden = !list.length;
  box.replaceChildren(
    ...list.map((f) => h('span', { class: 'fchip' }, f.label, h('button', { type: 'button', 'aria-label': `ล้าง ${f.label}`, onclick: () => { f.clear(); shown = 100; render(); } }, svgIcon(ICON.x, 14)))),
    list.length > 1 ? h('button', { class: 'btn link', type: 'button', text: 'ล้างทั้งหมด', onclick: clearAll }) : ''
  );
}

function emptyState() {
  const filtering = docs.length > 0;
  return h('div', { class: 'empty' },
    h('div', { class: 'ill' }, svgIcon(filtering ? ICON.search : ICON.files, 28)),
    h('b', { text: filtering ? 'ไม่พบเอกสารที่ตรงกับเงื่อนไข' : 'ยังไม่มีเอกสารในโฟลเดอร์นี้' }),
    h('div', { text: filtering ? 'ลองเปลี่ยนคำค้น หรือล้างตัวกรองเพื่อดูเอกสารทั้งหมด' : 'กด "อัปโหลดเอกสาร" เพื่อเพิ่มไฟล์แรก' }),
    h('div', { class: 'row' },
      filtering && activeFilters().length ? h('button', { class: 'btn', type: 'button', text: 'ล้างตัวกรอง', onclick: clearAll }) : '',
      !filtering ? h('a', { class: 'btn primary', href: current ? `/upload.html?folder=${encodeURIComponent(current)}` : '/upload.html', text: 'อัปโหลดเอกสาร' }) : ''
    )
  );
}


const bkkYM = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d).slice(0, 7);
};
const nf = (n) => new Intl.NumberFormat('th-TH').format(n);

// เอกสารตามโฟลเดอร์ที่เลือกเท่านั้น (ยังไม่ใช้ตัวกรองอื่น) ใช้กับการ์ดสรุปและชิปประเภท
function scopeDocs() {
  if (!current) return docs;
  const ids = $('sub').checked ? descendantIds(folders, current) : new Set([current]);
  return docs.filter((d) => ids.has(d.folder_id));
}

function kpi(cls, icon, label, value, unit, sub, pct, pill) {
  return h('div', { class: `kpi ${cls}` },
    h('div', { class: 'top' }, h('div', { class: 'ib' }, svgIcon(icon, 20)), label),
    h('div', { class: 'vrow' }, h('div', { class: 'val' }, value, unit ? h('small', { text: unit }) : ''), pill || ''),
    h('div', { class: 'sub', text: sub }),
    h('div', { class: 'prog', role: 'presentation' }, h('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` }))
  );
}

function renderKpis() {
  const sc = scopeDocs();
  const ym = bkkYM(new Date().toISOString());
  const month = sc.filter((d) => bkkYM(d.uploaded_at) === ym).length;
  const bytes = sc.reduce((a, d) => a + (Number(d.size) || 0), 0);
  const types = new Map();
  for (const d of sc) if (d.doc_type) types.set(d.doc_type, (types.get(d.doc_type) || 0) + 1);
  const top = [...types.entries()].sort((a, b) => b[1] - a[1])[0];
  const noType = sc.filter((d) => !d.doc_type).length;
  $('kpis').replaceChildren(
    kpi('', ICON.files, current ? 'เอกสารในโฟลเดอร์นี้' : 'เอกสารทั้งหมด', nf(sc.length), 'รายการ', current ? `จากทั้งระบบ ${nf(docs.length)} รายการ` : `ใน ${nf(folders.length)} โฟลเดอร์`, docs.length ? (sc.length / docs.length) * 100 : 0),
    kpi('ok', ICON.clock, 'อัปโหลดเดือนนี้', nf(month), 'รายการ', sc.length ? `คิดเป็น ${Math.round((month / sc.length) * 100)}% ของเอกสารที่แสดง` : 'ยังไม่มีเอกสาร', sc.length ? (month / sc.length) * 100 : 0,
      month ? h('span', { class: 'pill ok', text: 'ใหม่' }) : null),
    kpi('', ICON.drive, 'พื้นที่ที่ใช้', fmtSize(bytes), '', sc.length ? `เฉลี่ย ${fmtSize(Math.round(bytes / sc.length))} ต่อไฟล์` : 'ยังไม่มีไฟล์', sc.length ? 100 : 0),
    kpi(noType ? 'warn' : '', ICON.chart, 'ประเภทเอกสาร', nf(types.size), 'ประเภท', top ? `มากสุด: ${top[0]} (${nf(top[1])})` : 'ยังไม่ได้ระบุประเภท', sc.length ? ((sc.length - noType) / sc.length) * 100 : 0,
      noType ? h('span', { class: 'pill warn', text: `ไม่ระบุ ${nf(noType)}` }) : null)
  );
}

function renderTypeChips() {
  const box = $('tchips');
  const sc = scopeDocs();
  const counts = new Map();
  for (const d of sc) if (d.doc_type) counts.set(d.doc_type, (counts.get(d.doc_type) || 0) + 1);
  const types = [...new Set([...boot.settings.doc_types, ...counts.keys()])].filter((t) => counts.has(t) || t === $('f-type').value);
  box.hidden = types.length < 1;
  const cur = $('f-type').value;
  const chip = (val, label, n) =>
    h('button', { class: 'tchip', type: 'button', 'aria-pressed': String(cur === val), onclick: () => { $('f-type').value = val; shown = 100; render(); } }, n == null ? label : `${label} · ${nf(n)}`);
  box.replaceChildren(chip('', 'ทั้งหมด', sc.length), ...types.map((t) => chip(t, t, counts.get(t) || 0)));
}

const todayTh = () => new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', dateStyle: 'full' }).format(new Date());

function render() {
  const list = filtered();
  renderKpis();
  renderTypeChips();
  renderChips();
  $('count').replaceChildren('พบ ', h('b', { text: String(list.length) }), ' รายการ');
  const q = $('q').value;
  const t = $('tbl');
  t.replaceChildren(h('div', { class: 'tr head' }, ...['ชื่อเอกสาร', 'เลขที่', 'ประเภท', 'ขนาด', 'ผู้อัปโหลด', 'วันที่อัปโหลด'].map((x) => h('div', { text: x }))));
  if (!list.length) t.append(emptyState());
  for (const d of list.slice(0, shown)) {
    t.append(
      h('div', { class: 'tr' },
        h('a', { class: 'nm', href: `/doc.html?id=${encodeURIComponent(d.id)}` }, extBadge(d.file_name), h('span', { class: 't', title: d.title }, ...highlight(d.title, q))),
        h('div', { class: 'c-no sub' }, d.doc_no ? highlight(d.doc_no, q) : NA()),
        h('div', { class: 'c-type' }, d.doc_type ? h('span', { class: 'tag', text: d.doc_type }) : NA()),
        h('div', { class: 'c-size mono', text: fmtSize(d.size) }),
        h('div', { class: 'c-by who2' }, h('span', { class: 'ini', 'aria-hidden': 'true', text: initials(d.uploader) }), h('span', { text: d.uploader, title: d.uploader })),
        h('div', { class: 'c-date sub', text: fmtUploadDate(d.uploaded_at) })
      )
    );
  }
  $('more').hidden = list.length <= shown;
  $('more').textContent = `แสดงเพิ่ม (เหลืออีก ${Math.max(0, list.length - shown)} รายการ)`;
}

for (const id of ['q', 'f-type', 'f-year', 'f-by', 'f-sort', 'sub']) $(id).addEventListener(id === 'q' ? 'input' : 'change', () => { shown = 100; render(); });
addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    $('q').focus();
  }
});
$('more').addEventListener('click', () => { shown += 100; render(); });

$('newFolder').addEventListener('click', () =>
  askText({
    title: current ? `สร้างโฟลเดอร์ภายใน "${folders.find((f) => f.id === current)?.name}"` : 'สร้างโฟลเดอร์ใหม่',
    label: 'ชื่อโฟลเดอร์',
    okText: 'สร้างโฟลเดอร์',
    onOk: async (name) => {
      const { folder } = await api('POST', '/api/folders', { name, parent_id: current || boot.root_id });
      folders = [...folders, folder];
      toast('สร้างโฟลเดอร์แล้ว');
      select(folder.id);
      return true;
    },
  })
);

if (current && !folders.some((f) => f.id === current)) current = '';
renderFilters();
renderTree();
renderHead();
render();
