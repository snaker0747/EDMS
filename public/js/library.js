import { h, api, init, toast, askText, confirmBox, renameFolderDialog, deleteFolderDialog, folderTree, descendantIds, fmtSize, fmtUploadDate, extBadge, highlight, initials, svgIcon, ICON, driveFolderUrl, qs } from './common.js';

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

// ---------- แผนผังโฟลเดอร์: กด + / − เพื่อขยาย/ย่อ จำค่าไว้ในเครื่อง ----------
const TREE_KEY = 'edms.collapsed';
let collapsed = new Set();
try { collapsed = new Set(JSON.parse(localStorage.getItem(TREE_KEY) || '[]')); } catch { /* ใช้ค่าเริ่มต้น: ขยายทั้งหมด */ }
const saveCollapsed = () => { try { localStorage.setItem(TREE_KEY, JSON.stringify([...collapsed])); } catch { /* ไม่เป็นไร */ } };
// เปิดทุกโฟลเดอร์แม่ของโฟลเดอร์ที่กำลังดูอยู่ ไม่ให้มันซ่อนอยู่ในกลุ่มที่ย่อไว้
function revealCurrent() {
  for (let f = folders.find((x) => x.id === current); f && f.parent_id; f = folders.find((x) => x.id === f.parent_id)) collapsed.delete(f.parent_id);
}
// ข้อความบอกที่อยู่โฟลเดอร์ (ตัดชื่อโฟลเดอร์หลักที่ยาวออก)
function folderLabel(id) {
  const f = folders.find((x) => x.id === id);
  if (!f) return { text: 'ไม่พบโฟลเดอร์', title: '' };
  const segs = String(f.path || f.name).split(' › ');
  return { text: (segs.length > 1 ? segs.slice(1) : segs).join(' › '), title: f.path };
}

function renderTree() {
  const t = $('tree');
  t.replaceChildren();
  const direct = new Map();
  for (const d of docs) direct.set(d.folder_id, (direct.get(d.folder_id) || 0) + 1);
  const kids = new Map();
  for (const f of folders) kids.set(f.parent_id, [...(kids.get(f.parent_id) || []), f.id]);
  const memo = new Map();
  const total = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, 0);
    let n = direct.get(id) || 0;
    for (const k of kids.get(id) || []) n += total(k);
    memo.set(id, n);
    return n;
  };
  const byId = new Map(folders.map((f) => [f.id, f]));
  const hiddenByParent = (f) => {
    for (let p = byId.get(f.parent_id), i = 0; p && i < 50; p = byId.get(p.parent_id), i++) if (collapsed.has(p.id)) return true;
    return false;
  };
  const btn = (id, label, count, title) =>
    h('button', { class: 'fbtn', type: 'button', 'aria-current': current === id ? 'true' : 'false', title, onclick: () => select(id) },
      h('span', { class: 'lead' }, svgIcon(id ? ICON.folder : ICON.files, 16), h('span', { class: 'nm', text: label })), h('span', { class: 'n', text: count }));

  const parents = folders.filter((f) => (kids.get(f.id) || []).length);
  if (parents.length) {
    t.append(h('div', { class: 'treetools' },
      h('button', { type: 'button', text: 'ขยายทั้งหมด', onclick: () => { collapsed.clear(); saveCollapsed(); renderTree(); } }),
      h('button', { type: 'button', text: 'ย่อทั้งหมด', onclick: () => { collapsed = new Set(parents.map((f) => f.id)); revealCurrent(); saveCollapsed(); renderTree(); } })));
  }
  t.append(h('div', { class: 'fnode' }, btn('', 'เอกสารทั้งหมด', docs.length, '')));
  for (const f of folderTree(folders)) {
    if (hiddenByParent(f)) continue;
    const sub = (kids.get(f.id) || []).length;
    const open = !collapsed.has(f.id);
    const n = total(f.id);
    const own = direct.get(f.id) || 0;
    const toggle = sub
      ? h('button', {
          class: 'tg', type: 'button', 'aria-expanded': String(open), 'aria-label': `${open ? 'ย่อ' : 'ขยาย'}โฟลเดอร์ย่อยของ ${f.name}`, title: open ? 'ย่อโฟลเดอร์ย่อย' : `ขยายดูโฟลเดอร์ย่อย (${sub})`, text: open ? '−' : '+',
          onclick: () => { if (open) collapsed.add(f.id); else collapsed.delete(f.id); saveCollapsed(); renderTree(); },
        })
      : h('span', { class: 'tg sp' });
    t.append(h('div', { class: 'fnode', style: `padding-left:${f.depth * 14}px` }, toggle, btn(f.id, f.name, n, `${f.path} — ในโฟลเดอร์นี้ ${own} รายการ${sub ? `, รวมโฟลเดอร์ย่อย ${n} รายการ` : ''}`)));
  }
}

function select(id) {
  setDrawer(false);
  current = id;
  revealCurrent();
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
  $('folderBtnLbl').textContent = f ? f.name : 'ทุกโฟลเดอร์';
  const manage = !!(f && isAdmin && f.id !== boot.root_id);
  $('renFolder').hidden = !manage;
  $('delFolder').hidden = !manage;
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


const nf = (n) => new Intl.NumberFormat('th-TH').format(n);

// เอกสารตามโฟลเดอร์ที่เลือกเท่านั้น (ยังไม่ใช้ตัวกรองอื่น) ใช้กับชิปประเภท
function scopeDocs() {
  if (!current) return docs;
  const ids = $('sub').checked ? descendantIds(folders, current) : new Set([current]);
  return docs.filter((d) => ids.has(d.folder_id));
}

const canEditDoc = (d) => isAdmin || d.uploader === boot.me.display_name;
const iconBtn = (icon, label, onclick, danger = false) =>
  h('button', { class: `iconbtn${danger ? ' danger' : ''}`, type: 'button', title: label, 'aria-label': label, onclick }, svgIcon(icon, 18));

function renameDoc(d) {
  askText({
    title: 'เปลี่ยนชื่อไฟล์',
    label: 'ชื่อเอกสาร (ชื่อไฟล์ในที่เก็บไฟล์จะเปลี่ยนตาม)',
    value: d.title,
    onOk: async (title) => {
      const r = await api('PATCH', `/api/documents/${encodeURIComponent(d.id)}`, { title });
      docs = docs.map((x) => (x.id === d.id ? r.document : x));
      render();
      toast('เปลี่ยนชื่อแล้ว');
      return true;
    },
  });
}
function deleteDoc(d) {
  confirmBox(`ลบเอกสาร "${d.title}"? (ย้ายไปถังขยะ ผู้ดูแลระบบกู้คืนได้ภายใน 30 วัน)`, 'ลบเอกสาร', true, async () => {
    await api('DELETE', `/api/documents/${encodeURIComponent(d.id)}`);
    docs = docs.filter((x) => x.id !== d.id);
    folders = folders.map((f) => (f.id === d.folder_id ? { ...f, doc_count: Math.max(0, (f.doc_count || 0) - 1) } : f));
    renderTree();
    render();
    toast('ลบเอกสารแล้ว');
    return true;
  });
}

// โหลดโฟลเดอร์/เอกสารใหม่จากเซิร์ฟเวอร์หลังเปลี่ยนชื่อหรือลบโฟลเดอร์
async function reloadAll() {
  const [b, d] = await Promise.all([api('GET', '/api/bootstrap'), api('GET', '/api/documents')]);
  folders = b.folders;
  docs = d.documents;
  seenVersion = b.data_version;
  if (current && !folders.some((f) => f.id === current)) current = '';
  history.replaceState(null, '', current ? `/?folder=${encodeURIComponent(current)}` : '/');
  renderFilters();
  renderTree();
  renderHead();
  render();
}
$('renFolder').addEventListener('click', () => { const f = folders.find((x) => x.id === current); if (f) renameFolderDialog(f, reloadAll); });
$('delFolder').addEventListener('click', () => { const f = folders.find((x) => x.id === current); if (f) deleteFolderDialog(f, folders, reloadAll); });

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
  renderTypeChips();
  renderChips();
  $('count').replaceChildren('พบ ', h('b', { text: String(list.length) }), ' รายการ');
  const q = $('q').value;
  const t = $('tbl');
  t.replaceChildren(h('div', { class: 'tr head' }, ...['ชื่อเอกสาร', 'เลขที่', 'ประเภท', 'ขนาด', 'ผู้อัปโหลด', 'วันที่อัปโหลด', ''].map((x, i) => h('div', { class: ['', 'c-no', 'c-type', 'c-size', 'c-by', 'c-date', 'c-act'][i], text: x }))));
  if (!list.length) t.append(emptyState());
  for (const d of list.slice(0, shown)) {
    t.append(
      h('div', { class: 'tr' },
        h('a', { class: 'nm', href: `/doc.html?id=${encodeURIComponent(d.id)}` }, extBadge(d.file_name),
          h('span', { class: 'tt' },
            h('span', { class: 't', title: d.title }, ...highlight(d.title, q)),
            (() => { const fl = folderLabel(d.folder_id); return h('span', { class: 'fp', title: fl.title }, svgIcon(ICON.folder, 13), fl.text); })())),
        h('div', { class: 'c-no sub' }, d.doc_no ? highlight(d.doc_no, q) : NA()),
        h('div', { class: 'c-type' }, d.doc_type ? h('span', { class: 'tag', text: d.doc_type }) : NA()),
        h('div', { class: 'c-size mono', text: fmtSize(d.size) }),
        h('div', { class: 'c-by who2' }, h('span', { class: 'ini', 'aria-hidden': 'true', text: initials(d.uploader) }), h('span', { text: d.uploader, title: d.uploader })),
        h('div', { class: 'c-date sub', text: fmtUploadDate(d.uploaded_at) }),
        h('div', { class: 'c-act' }, ...(canEditDoc(d) ? [
          iconBtn(ICON.edit, `เปลี่ยนชื่อไฟล์ ${d.title}`, () => renameDoc(d)),
          iconBtn(ICON.trash, `ลบ ${d.title}`, () => deleteDoc(d), true),
        ] : []))
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
revealCurrent();
renderFilters();
renderTree();
renderHead();
render();

// ตรวจเป็นระยะว่ามีข้อมูลใหม่ไหม (ผู้ใช้อื่นอัปโหลด หรือมีการแก้ไขจาก AppSheet/Google Sheet) แล้วรีเฟรชรายการให้เอง
let seenVersion = boot.data_version;
let checking = false;
async function checkUpdates() {
  if (checking || document.hidden) return;
  checking = true;
  try {
    const { data_version } = await api('GET', '/api/data-version');
    if (data_version === seenVersion) return;
    seenVersion = data_version;
    const [b, d] = await Promise.all([api('GET', '/api/bootstrap'), api('GET', '/api/documents')]);
    folders = b.folders;
    boot.settings = b.settings;
    docs = d.documents;
    if (current && !folders.some((f) => f.id === current)) current = '';
    renderFilters();
    renderTree();
    renderHead();
    render();
    toast('อัปเดตรายการเอกสารล่าสุดแล้ว');
  } catch { /* ลองใหม่รอบหน้า */ } finally { checking = false; }
}
setInterval(checkUpdates, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdates(); });

// ---------- จอใหญ่: ซ่อน/แสดงแถบโฟลเดอร์ (จำค่าไว้) ----------
const SIDE_KEY = 'edms.sideHidden';
function setSideHidden(hide, save = true) {
  document.body.classList.toggle('side-hidden', hide);
  $('sideToggle').setAttribute('aria-expanded', String(!hide));
  $('sideToggleLbl').textContent = hide ? 'แสดงแถบโฟลเดอร์' : 'ซ่อนแถบโฟลเดอร์';
  if (save) { try { localStorage.setItem(SIDE_KEY, hide ? '1' : '0'); } catch { /* ไม่เป็นไร */ } }
}
{ let hid = false; try { hid = localStorage.getItem(SIDE_KEY) === '1'; } catch { /* ใช้ค่าเริ่มต้น */ } setSideHidden(hid, false); }
$('sideToggle').addEventListener('click', () => setSideHidden(!document.body.classList.contains('side-hidden')));

// ---------- มือถือ/แท็บเล็ต: ลิ้นชักโฟลเดอร์ + ปุ่มเปิดตัวกรอง ----------
function setDrawer(open) {
  document.body.classList.toggle('drawer-open', open);
  $('scrim').hidden = !open;
}
$('folderBtn').addEventListener('click', () => setDrawer(true));
$('scrim').addEventListener('click', () => setDrawer(false));
$('sideClose').addEventListener('click', () => setDrawer(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });
// ปัดลิ้นชักไปทางซ้ายเพื่อซ่อน
{ let sx = 0, sy = 0;
  const side = document.querySelector('.side');
  side.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  side.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (document.body.classList.contains('drawer-open') && sx - t.clientX > 70 && Math.abs(t.clientY - sy) < 50) setDrawer(false);
  }, { passive: true }); }
addEventListener('resize', () => { if (innerWidth > 1100) setDrawer(false); });
$('filterBtn').addEventListener('click', () => {
  const open = $('toolbar').classList.toggle('open');
  $('filterBtn').setAttribute('aria-expanded', String(open));
});
function updateFilterBadge() {
  const n = ['f-year', 'f-by'].filter((id) => $(id).value).length + ($('f-sort').value !== 'new' ? 1 : 0) + ($('sub').checked ? 0 : 1);
  $('filterBadge').hidden = !n;
  $('filterBadge').textContent = String(n);
}
for (const id of ['f-year', 'f-by', 'f-sort', 'sub']) $(id).addEventListener('change', updateFilterBadge);
updateFilterBadge();
