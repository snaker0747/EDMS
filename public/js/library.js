import { h, api, init, toast, askText, confirmBox, openDialog, folderSelect, renameFolderDialog, deleteFolderDialog, folderTree, folderOrder, descendantIds, fmtSize, fmtUploadDate, extBadge, highlight, initials, svgIcon, ICON, qs } from './common.js';

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

  t.append(h('div', { class: 'fnode' }, btn('', 'เอกสารทั้งหมด', docs.length, '')));
  for (const f of folderTree(folders)) {
    if (hiddenByParent(f)) continue;
    const sub = (kids.get(f.id) || []).length;
    const open = !collapsed.has(f.id);
    const n = total(f.id);
    const own = direct.get(f.id) || 0;
    const toggle = sub
      ? h('button', {
          class: 'tg', type: 'button', 'aria-expanded': String(open), 'aria-label': `${open ? 'ย่อ' : 'ขยาย'}โฟลเดอร์ย่อยของ ${f.name}`, title: open ? 'ย่อโฟลเดอร์ย่อย' : `ขยายดูโฟลเดอร์ย่อย (${sub})`,
          onclick: () => { if (open) collapsed.add(f.id); else collapsed.delete(f.id); saveCollapsed(); renderTree(); },
        }, svgIcon(open ? ICON.minus : ICON.plus, 14))
      : h('span', { class: 'tg sp' });
    t.append(folderNode(f, h('div', { class: 'fnode', style: `padding-left:${f.depth * 14}px` }, toggle, btn(f.id, f.name, n, `${f.path} — ในโฟลเดอร์นี้ ${own} รายการ${sub ? `, รวมโฟลเดอร์ย่อย ${n} รายการ` : ''}`))));
  }
}

// ---------- ย้ายเอกสาร/โฟลเดอร์: ลากไปวางบนโฟลเดอร์ในแผนผัง หรือกดปุ่ม "ย้าย" ----------
let dragging = null; // { kind: 'doc' | 'folder', id }
const folderById = (id) => folders.find((x) => x.id === id);

// ย้ายเอกสารเข้าโฟลเดอร์ (เจ้าของเอกสารหรือผู้ดูแล)
async function moveDocTo(d, folderId) {
  const target = folderById(folderId);
  if (!target || folderId === d.folder_id) return false;
  const r = await api('POST', `/api/documents/${encodeURIComponent(d.id)}/move`, { folder_id: folderId });
  docs = docs.map((x) => (x.id === d.id ? r.document : x));
  renderTree();
  render();
  toast(`ย้าย "${d.title}" ไปที่ ${folderLabel(folderId).text} แล้ว`);
  return true;
}
function moveDocDialog(d) {
  const sel = folderSelect(folders, { value: d.folder_id, id: 'mv-doc' });
  openDialog('ย้ายเอกสารไปโฟลเดอร์', [
    h('div', { class: 'muted', style: 'margin-bottom:8px', text: d.title }),
    h('div', { class: 'field' }, h('label', { for: 'mv-doc', text: 'ย้ายไปที่' }), sel),
  ], { okText: 'ย้าย', onOk: async () => { await moveDocTo(d, sel.value); return true; } });
}

// ย้ายโฟลเดอร์ไปไว้ใต้โฟลเดอร์อื่น (ผู้ดูแลระบบ) เอกสารและโฟลเดอร์ย่อยข้างในย้ายตามไปทั้งหมด
function canDropFolder(f, targetId) {
  if (!isAdmin || !f || f.id === boot.root_id) return false;
  if (targetId === f.parent_id || targetId === f.id) return false;
  return !descendantIds(folders, f.id).has(targetId);
}
async function moveFolderTo(f, targetId) {
  await api('PATCH', `/api/folders/${encodeURIComponent(f.id)}`, { parent_id: targetId });
  await reloadAll();
  toast(`ย้ายโฟลเดอร์ "${f.name}" ไปที่ ${folderLabel(targetId).text} แล้ว`);
}
function confirmMoveFolder(f, targetId) {
  const sub = descendantIds(folders, f.id);
  const n = docs.filter((d) => sub.has(d.folder_id)).length;
  confirmBox(`ย้ายโฟลเดอร์ "${f.name}" ไปไว้ใน "${folderLabel(targetId).text}"? เอกสาร ${n} รายการและโฟลเดอร์ย่อยข้างในจะย้ายตามไปด้วย`, 'ย้ายโฟลเดอร์', false, async () => { await moveFolderTo(f, targetId); return true; });
}
function moveFolderDialog(f) {
  const sel = folderSelect(folders, { value: f.parent_id, exclude: descendantIds(folders, f.id), id: 'mv-fo' });
  openDialog('ย้ายโฟลเดอร์', [
    h('div', { class: 'muted', style: 'margin-bottom:8px', text: `${f.name} (เอกสารและโฟลเดอร์ย่อยข้างในย้ายตามไปทั้งหมด)` }),
    h('div', { class: 'field' }, h('label', { for: 'mv-fo', text: 'ย้ายไปไว้ใต้' }), sel),
  ], { okText: 'ย้าย', onOk: async () => { if (sel.value === f.parent_id) return true; await moveFolderTo(f, sel.value); return true; } });
}

// ---------- จัดลำดับเอง (ผู้ดูแลระบบ): โฟลเดอร์ย่อยในแผนผัง + เอกสารในโฟลเดอร์เดียวกัน ----------
const manualMode = () => $('f-sort').value === 'manual';
const siblingsOf = (parentId, exceptId) => folders.filter((f) => f.parent_id === parentId && f.id !== exceptId).sort(folderOrder);

// วางโฟลเดอร์ก่อน/หลังโฟลเดอร์เป้าหมาย (ถ้าอยู่คนละโฟลเดอร์แม่ จะย้ายมาอยู่ใต้โฟลเดอร์แม่ของเป้าหมายด้วย)
async function placeFolder(src, target, where) {
  const parentId = target.parent_id;
  if (src.parent_id !== parentId) await api('PATCH', `/api/folders/${encodeURIComponent(src.id)}`, { parent_id: parentId });
  const sibs = siblingsOf(parentId, src.id);
  sibs.splice(sibs.findIndex((f) => f.id === target.id) + (where === 'after' ? 1 : 0), 0, src);
  await api('POST', '/api/folders/reorder', { parent_id: parentId, ids: sibs.map((f) => f.id) });
  await reloadAll();
  toast(`จัดลำดับโฟลเดอร์ "${src.name}" แล้ว`);
}
function canPlaceFolder(src, target) {
  if (!isAdmin || !src || src.id === boot.root_id || !target || target.id === boot.root_id) return false;
  return target.id !== src.id && !descendantIds(folders, src.id).has(target.id);
}
// เลื่อนโฟลเดอร์ที่เลือกขึ้น/ลง 1 ตำแหน่งในกลุ่มเดียวกัน (ใช้ปุ่มแทนการลาก ได้ทั้งมือถือ/แท็บเล็ต)
async function shiftFolder(dir) {
  const f = folderById(current);
  if (!f) return;
  const sibs = siblingsOf(f.parent_id);
  const i = sibs.findIndex((x) => x.id === f.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  await api('POST', '/api/folders/reorder', { parent_id: f.parent_id, ids: sibs.map((x) => x.id) });
  await reloadAll();
}
$('upFolder').addEventListener('click', () => shiftFolder(-1).catch((e) => toast(e.message, true)));
$('dnFolder').addEventListener('click', () => shiftFolder(1).catch((e) => toast(e.message, true)));
function updateShiftButtons() {
  const f = folderById(current);
  const show = !!(f && isAdmin && f.id !== boot.root_id);
  $('shiftBtns').hidden = !show;
  if (!show) return;
  const sibs = siblingsOf(f.parent_id);
  const i = sibs.findIndex((x) => x.id === f.id);
  $('upFolder').disabled = i <= 0;
  $('dnFolder').disabled = i < 0 || i >= sibs.length - 1;
}

// เอกสารในโฟลเดอร์หนึ่ง เรียงตามลำดับที่จัดไว้ (ที่ยังไม่จัดอยู่ท้าย ใหม่ก่อน)
const docOrder = (a, b) => {
  const x = a.sort_order ?? Infinity, y = b.sort_order ?? Infinity;
  return x !== y ? (x < y ? -1 : 1) : String(b.uploaded_at).localeCompare(String(a.uploaded_at));
};
const docsInFolder = (fid) => docs.filter((d) => d.folder_id === fid).sort(docOrder);
async function saveDocOrder(fid, list) {
  await api('POST', '/api/documents/reorder', { folder_id: fid, ids: list.map((d) => d.id) });
  const pos = new Map(list.map((d, i) => [d.id, i + 1]));
  docs = docs.map((d) => (pos.has(d.id) ? { ...d, sort_order: pos.get(d.id) } : d));
  render();
}
async function placeDoc(src, target, where) {
  if (src.folder_id !== target.folder_id) { toast('จัดลำดับได้เฉพาะเอกสารที่อยู่ในโฟลเดอร์เดียวกัน', true); return; }
  const list = docsInFolder(src.folder_id).filter((d) => d.id !== src.id);
  list.splice(list.findIndex((d) => d.id === target.id) + (where === 'after' ? 1 : 0), 0, src);
  await saveDocOrder(src.folder_id, list);
}
async function shiftDoc(d, dir) {
  const list = docsInFolder(d.folder_id);
  const i = list.findIndex((x) => x.id === d.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await saveDocOrder(d.folder_id, list);
}

// ---------- ลากด้วยเมาส์ (และการกดค้างลากบนแท็บเล็ตที่เบราว์เซอร์รองรับ) ----------
const clearZones = () => { for (const e of document.querySelectorAll('.dropok,.dropno,.drop-before,.drop-after')) e.classList.remove('dropok', 'dropno', 'drop-before', 'drop-after'); };
const setDragging = (v) => { dragging = v; document.body.classList.toggle('dragging', !!v); if (!v) clearZones(); };
function showZone(el, zone) {
  el.classList.toggle('dropok', zone === 'into');
  el.classList.toggle('dropno', zone === 'no');
  el.classList.toggle('drop-before', zone === 'before');
  el.classList.toggle('drop-after', zone === 'after');
}
function zoneOf(e, el, allowInto) {
  const r = el.getBoundingClientRect();
  const y = (e.clientY - r.top) / Math.max(1, r.height);
  if (!allowInto) return y < 0.5 ? 'before' : 'after';
  return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into';
}
function docRow(d, row) {
  if (!canEditDoc(d)) return row;
  row.draggable = true;
  row.classList.add('dragsrc');
  row.addEventListener('dragstart', (e) => {
    setDragging({ kind: 'doc', id: d.id });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', d.title);
    row.classList.add('dragged');
  });
  row.addEventListener('dragend', () => { row.classList.remove('dragged'); setDragging(null); });
  // จัดลำดับ: วางบนแถวอื่นในโหมด "ลำดับที่กำหนดเอง" (ผู้ดูแลระบบ)
  if (isAdmin) {
    row.addEventListener('dragover', (e) => {
      if (!dragging || dragging.kind !== 'doc' || !manualMode() || dragging.id === d.id) return;
      const src = docs.find((x) => x.id === dragging.id);
      if (!src || src.folder_id !== d.folder_id) { showZone(row, 'no'); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      showZone(row, zoneOf(e, row, false));
    });
    row.addEventListener('dragleave', (e) => { if (!row.contains(e.relatedTarget)) showZone(row, null); });
    row.addEventListener('drop', async (e) => {
      if (!dragging || dragging.kind !== 'doc' || !manualMode() || dragging.id === d.id) return;
      e.preventDefault();
      const src = docs.find((x) => x.id === dragging.id);
      const where = zoneOf(e, row, false);
      setDragging(null);
      try { if (src) await placeDoc(src, d, where); } catch (ex) { toast(ex.message || 'จัดลำดับไม่สำเร็จ', true); }
    });
  }
  return row;
}
// โฟลเดอร์ในแผนผัง: วางตรงกลาง = ย้ายเข้าไปข้างใน / วางที่ขอบบน-ล่าง = จัดลำดับก่อน-หลัง
function folderZone(f, e, node) {
  if (!dragging) return null;
  if (dragging.kind === 'doc') { const d = docs.find((x) => x.id === dragging.id); return d && d.folder_id !== f.id ? 'into' : 'no'; }
  const src = folderById(dragging.id);
  if (!src) return 'no';
  const into = canDropFolder(src, f.id);
  const edge = f.id !== boot.root_id && canPlaceFolder(src, f);
  const z = zoneOf(e, node, into); // ย้ายเข้าข้างในไม่ได้ → แบ่งแค่ครึ่งบน/ครึ่งล่าง
  if (z === 'into') return 'into';
  return edge ? z : into ? 'into' : 'no';
}
function folderNode(f, node) {
  if (isAdmin && f.id !== boot.root_id) {
    node.draggable = true;
    node.classList.add('dragsrc');
    node.addEventListener('dragstart', (e) => {
      setDragging({ kind: 'folder', id: f.id });
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', f.name);
      node.classList.add('dragged');
    });
    node.addEventListener('dragend', () => { node.classList.remove('dragged'); setDragging(null); });
  }
  node.dataset.fid = f.id;
  node.addEventListener('dragover', (e) => {
    const z = folderZone(f, e, node);
    if (!z) return;
    showZone(node, z);
    if (z !== 'no') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) showZone(node, null); });
  node.addEventListener('drop', async (e) => {
    e.preventDefault();
    const z = folderZone(f, e, node);
    const drag = dragging;
    setDragging(null);
    if (!drag || !z || z === 'no') return;
    try {
      if (drag.kind === 'doc') { const d = docs.find((x) => x.id === drag.id); if (d && d.folder_id !== f.id) await moveDocTo(d, f.id); }
      else {
        const src = folderById(drag.id);
        if (z === 'into') { if (canDropFolder(src, f.id)) confirmMoveFolder(src, f.id); }
        else if (canPlaceFolder(src, f)) await placeFolder(src, f, z);
      }
    } catch (ex) { toast(ex.message || 'ย้ายไม่สำเร็จ', true); }
  });
  return node;
}

function select(id) {
  if (innerWidth <= 760) setSideHidden(true, false); // มือถือ: เลือกแล้วพับเก็บให้เห็นรายการ
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
  const manage = !!(f && isAdmin && f.id !== boot.root_id);
  $('renFolder').hidden = !manage;
  $('mvFolder').hidden = !manage;
  updateShiftButtons();
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
  else if (sort === 'manual') {
    const pos = new Map(folderTree(folders).map((f, i) => [f.id, i]));
    list.sort((a, b) => ((pos.get(a.folder_id) ?? 1e9) - (pos.get(b.folder_id) ?? 1e9)) || docOrder(a, b));
  }
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
$('mvFolder').addEventListener('click', () => { const f = folders.find((x) => x.id === current); if (f) moveFolderDialog(f); });
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
  $('count').replaceChildren('พบ ', h('b', { text: String(list.length) }), ' รายการ', list.some(canEditDoc) ? h('span', { class: 'dndhint', text: isAdmin && manualMode() ? 'ลากแถวขึ้น/ลงเพื่อจัดลำดับ หรือวางบนโฟลเดอร์ด้านซ้ายเพื่อย้าย' : 'ลากเอกสารไปวางบนโฟลเดอร์ด้านซ้ายเพื่อย้าย' }) : '');
  const q = $('q').value;
  const t = $('tbl');
  t.replaceChildren(h('div', { class: 'tr head' }, ...['ชื่อเอกสาร', 'เลขที่', 'ประเภท', 'ขนาด', 'ผู้อัปโหลด', 'วันที่อัปโหลด', ''].map((x, i) => h('div', { class: ['', 'c-no', 'c-type', 'c-size', 'c-by', 'c-date', 'c-act'][i], text: x }))));
  if (!list.length) t.append(emptyState());
  for (const d of list.slice(0, shown)) {
    t.append(
      docRow(d, h('div', { class: 'tr' },
        h('a', { class: 'nm', href: `/doc.html?id=${encodeURIComponent(d.id)}` }, extBadge(d.file_name),
          h('span', { class: 'tt' },
            h('span', { class: 't', title: d.title }, ...highlight(d.title, q)),
            (() => { const fl = folderLabel(d.folder_id); return h('span', { class: 'fp', title: fl.title }, svgIcon(ICON.folder, 13), fl.text); })())),
        h('div', { class: 'c-no sub' }, d.doc_no ? highlight(d.doc_no, q) : NA()),
        h('div', { class: 'c-type' }, d.doc_type ? h('span', { class: 'tag', text: d.doc_type }) : NA()),
        h('div', { class: 'c-size mono', text: fmtSize(d.size) }),
        h('div', { class: 'c-by who2' }, h('span', { class: 'ini', 'aria-hidden': 'true', text: initials(d.uploader) }), h('span', { text: d.uploader, title: d.uploader })),
        h('div', { class: 'c-date sub', text: fmtUploadDate(d.uploaded_at) }),
        h('div', { class: 'c-act' }, ...(isAdmin && manualMode() ? [
          iconBtn(ICON.up, `เลื่อน ${d.title} ขึ้น`, () => shiftDoc(d, -1).catch((e) => toast(e.message, true))),
          iconBtn(ICON.down, `เลื่อน ${d.title} ลง`, () => shiftDoc(d, 1).catch((e) => toast(e.message, true))),
        ] : []), ...(canEditDoc(d) ? [
          iconBtn(ICON.move, `ย้าย ${d.title} ไปโฟลเดอร์อื่น`, () => moveDocDialog(d)),
          iconBtn(ICON.edit, `เปลี่ยนชื่อไฟล์ ${d.title}`, () => renameDoc(d)),
          iconBtn(ICON.trash, `ลบ ${d.title}`, () => deleteDoc(d), true),
        ] : []))
      ))
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

// ---------- ลากขอบแผนผังโฟลเดอร์เพื่อปรับความกว้าง (จำค่าไว้) ----------
const WIDTH_KEY = 'edms.sideWidth';
const MIN_SIDE = 200;
const maxSide = () => Math.max(MIN_SIDE, Math.min(560, Math.round(innerWidth * (innerWidth <= 1100 ? 0.5 : 0.6) - 40)));
function applySideWidth(w, save = false) {
  const root = document.documentElement.style;
  if (w == null) { root.removeProperty('--side-w'); if (save) try { localStorage.removeItem(WIDTH_KEY); } catch { /* ไม่เป็นไร */ } return; }
  const v = Math.max(MIN_SIDE, Math.min(maxSide(), Math.round(w)));
  root.setProperty('--side-w', v + 'px');
  if (save) try { localStorage.setItem(WIDTH_KEY, String(v)); } catch { /* ไม่เป็นไร */ }
}
{
  let saved = null;
  try { saved = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10) || null; } catch { /* ไม่เป็นไร */ }
  if (saved) applySideWidth(saved);
  addEventListener('resize', () => { const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w'), 10); if (cur) applySideWidth(cur); });
  const grip = $('sideGrip');
  const side = $('side');
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const left = side.getBoundingClientRect().left;
    const move = (ev) => applySideWidth(ev.clientX - left);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      applySideWidth(side.getBoundingClientRect().width, true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => applySideWidth(null, true));
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    applySideWidth(side.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 24 : -24), true);
  });
}

// ---------- จอใหญ่: ซ่อน/แสดงแถบโฟลเดอร์ (จำค่าไว้) ----------
const SIDE_KEY = 'edms.sideHidden';
function setSideHidden(hide, save = true) {
  document.body.classList.toggle('side-hidden', hide);
  $('sideOpen').hidden = !hide;
  $('sideOpen').setAttribute('aria-expanded', String(!hide));
  $('sideCollapse').setAttribute('aria-expanded', String(!hide));
  if (save) { try { localStorage.setItem(SIDE_KEY, hide ? '1' : '0'); } catch { /* ไม่เป็นไร */ } }
}
{ let hid = false; try { hid = localStorage.getItem(SIDE_KEY) === '1'; } catch { /* ใช้ค่าเริ่มต้น */ } setSideHidden(hid, false); }
$('sideCollapse').addEventListener('click', () => setSideHidden(true));
$('sideOpen').addEventListener('click', () => setSideHidden(false));

// ---------- มือถือ: ปุ่มโฟลเดอร์ซ่อน/แสดงแผนผัง + ปุ่มเปิดตัวกรอง ----------
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
