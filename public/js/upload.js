import { h, api, init, toast, askText, detailsForm, folderSelect, fmtSize, extLabel, extBadge, stripExt, qs } from './common.js';
import { imagesToPdf } from './pdf.js';

const boot = await init('upload', 'อัปโหลดเอกสาร');
const $ = (id) => document.getElementById(id);
document.querySelector('main').removeAttribute('aria-busy');
const MAX_MB = 40;
$('maxmb').textContent = MAX_MB;
let folders = boot.folders;
const OK_EXT = new Set('pdf jpg jpeg png gif webp tif tiff doc docx xls xlsx ppt pptx txt csv zip dwg dxf'.split(' '));

// ---------- ฟอร์มรายละเอียด ----------
const shared = detailsForm(boot, {}, { withTitle: false });
$('formHost').append(shared.el);

let folderSel;
function renderFolderSelect(value) {
  folderSel = folderSelect(folders, { value, id: 'folder' });
  $('folderRow').replaceChildren(
    h('div', { style: undefined, class: '' }, folderSel),
    h('button', { class: 'btn', type: 'button', text: '+ สร้างโฟลเดอร์ใหม่', onclick: newFolder })
  );
  folderSel.parentElement.style.flex = '1 1 240px';
}
function newFolder() {
  askText({
    title: 'สร้างโฟลเดอร์ใหม่',
    label: `ชื่อโฟลเดอร์ (จะสร้างภายใน "${folders.find((f) => f.id === folderSel.value)?.name}")`,
    okText: 'สร้างโฟลเดอร์',
    onOk: async (name) => {
      const { folder } = await api('POST', '/api/folders', { name, parent_id: folderSel.value });
      folders = [...folders, folder];
      renderFolderSelect(folder.id);
      toast('สร้างโฟลเดอร์แล้ว');
      return true;
    },
  });
}
const wanted = qs('folder');
renderFolderSelect(folders.some((f) => f.id === wanted) ? wanted : folders.find((f) => f.name === 'หนังสือราชการ')?.id || boot.root_id);

// ---------- คิวไฟล์ ----------
const queue = []; // { file, title, status, form, el }
let busy = false;

const MAX_BATCH = 300; // จำนวนไฟล์สูงสุดที่รับต่อครั้ง กันลากโฟลเดอร์ใหญ่เกินไป
const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store|~\$.*|\..*)$/i; // ไฟล์ขยะของระบบ ข้ามเงียบ ๆ
// items: File หรือ { file, dirs } (dirs = ชื่อโฟลเดอร์ที่ไฟล์อยู่ข้างใน ถ้าลากมาทั้งโฟลเดอร์)
function addFiles(items) {
  const skipped = { type: [], big: [], empty: [], over: 0 };
  let added = 0;
  for (const it of items) {
    const file = it.file || it;
    const dirs = it.dirs || [];
    if (JUNK.test(file.name)) continue;
    const ext = (/\.([A-Za-z0-9]+)$/.exec(file.name)?.[1] || '').toLowerCase();
    if (!OK_EXT.has(ext)) { skipped.type.push(file.name); continue; }
    if (file.size > MAX_MB * 1048576) { skipped.big.push(file.name); continue; }
    if (!file.size) { skipped.empty.push(file.name); continue; }
    if (queue.length >= MAX_BATCH) { skipped.over++; continue; }
    queue.push({ file, dirs, title: stripExt(file.name), status: 'ready', form: null });
    added++;
  }
  const list = (a) => (a.length <= 2 ? a.map((n) => `"${n}"`).join(', ') : `${a.length} ไฟล์`);
  if (skipped.type.length) toast(`ข้าม ${list(skipped.type)} (ไม่รองรับชนิดไฟล์นี้)`, true);
  if (skipped.big.length) toast(`ข้าม ${list(skipped.big)} (ใหญ่เกิน ${MAX_MB} MB)`, true);
  if (skipped.empty.length) toast(`ข้าม ${list(skipped.empty)} (ไฟล์ว่าง)`, true);
  if (skipped.over) toast(`รับได้ครั้งละไม่เกิน ${MAX_BATCH} ไฟล์ ข้ามไป ${skipped.over} ไฟล์`, true);
  if (items.some((it) => it.dirs?.length) && added) toast(`เพิ่ม ${added} ไฟล์จากโฟลเดอร์แล้ว`);
  renderQueue();
}

// อ่านโฟลเดอร์ที่ลากมาทั้งก้อน (รวมโฟลเดอร์ย่อย) ด้วย webkitGetAsEntry
const readAll = (reader) => new Promise((resolve, reject) => {
  const all = [];
  const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject);
  next();
});
async function walk(entry, dirs, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, dirs });
  } else if (entry.isDirectory) {
    const kids = await readAll(entry.createReader());
    for (const k of kids) await walk(k, [...dirs, entry.name], out);
  }
}
function renderQueue() {
  const box = $('queue');
  box.replaceChildren();
  if (!queue.length) box.append(h('div', { class: 'muted', text: 'ยังไม่ได้เลือกไฟล์' }));
  const same = $('same').checked;
  queue.forEach((q, i) => {
    const title = h('input', { type: 'text', value: q.title, 'aria-label': 'ชื่อเอกสาร', maxLength: 200, disabled: q.status === 'done' || busy });
    title.addEventListener('input', () => (q.title = title.value));
    const bar = h('i');
    q.bar = bar;
    q.msg = h('div', { class: 'sub muted', style: undefined, text: statusText(q) });
    q.msg.style.fontSize = '13px';
    const rm = h('button', { class: 'btn', type: 'button', 'aria-label': 'นำไฟล์ออก', style: undefined, disabled: busy, onclick: () => { queue.splice(i, 1); renderQueue(); } }, h('span', { text: '✕' }));
    rm.style.minWidth = '44px';
    rm.style.padding = '0';
    const item = h('div', { class: 'qitem' },
      h('div', { class: 'top2' },
        extBadge(q.file.name),
        h('div', { class: 'body' }, title, q.msg),
        rm),
      h('div', { class: 'bar-p', hidden: q.status !== 'sending' }, bar));
    if (!same && q.status !== 'done') {
      q.form ||= detailsForm(boot, { ...shared.get() }, { withTitle: false });
      const d = h('details', {}, h('summary', { text: 'รายละเอียดเฉพาะไฟล์นี้', style: undefined }), q.form.el);
      d.querySelector('summary').style.cssText = 'cursor:pointer;min-height:36px;display:flex;align-items:center;color:var(--blue);font-weight:500';
      item.append(d);
    }
    q.el = item;
    box.append(item);
  });
  $('keepRow').hidden = !queue.some((q) => q.dirs?.length);
  $('keepTree').disabled = busy;
  $('save').disabled = busy || !queue.some((q) => q.status !== 'done');
}
function statusText(q) {
  const size = fmtSize(q.file.size) + (q.dirs?.length ? ` · 📁 ${q.dirs.join(' / ')}` : '');
  if (q.status === 'done') return `✔ อัปโหลดแล้ว · ${size}`;
  if (q.status === 'sending') return `กำลังอัปโหลด… · ${size}`;
  if (q.status === 'error') return `✖ ${q.error}`;
  return `พร้อมอัปโหลด · ${size}`;
}
const setStatus = (q, status, error) => {
  q.status = status;
  q.error = error;
  if (q.msg) {
    q.msg.textContent = statusText(q);
    q.msg.className = status === 'done' ? 'st-ok' : status === 'error' ? 'st-err' : 'muted';
    q.msg.style.fontSize = '13px';
  }
};
$('same').addEventListener('change', renderQueue);

// ---------- เลือกไฟล์ / ลากวาง ----------
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
$('pickDir').addEventListener('click', () => $('dirIn').click());
$('dirIn').addEventListener('change', (e) => {
  // webkitRelativePath = "ชื่อโฟลเดอร์/โฟลเดอร์ย่อย/ไฟล์.pdf"
  addFiles([...e.target.files].map((file) => ({ file, dirs: (file.webkitRelativePath || '').split('/').slice(0, -1) })));
  e.target.value = '';
});
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', async (e) => {
  const dt = e.dataTransfer; // ต้องดึง entry ทันที ก่อนมี await ไม่เช่นนั้นข้อมูลที่ลากจะหาย
  const entries = [...(dt.items || [])].map((i) => (i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (!entries.some(Boolean)) { addFiles([...dt.files]); return; }
  drop.classList.add('reading');
  try {
    const out = [];
    for (const en of entries) if (en) await walk(en, [], out);
    addFiles(out);
  } catch { toast('อ่านโฟลเดอร์ไม่สำเร็จ ลองเลือกไฟล์ด้วยปุ่มแทน', true); }
  drop.classList.remove('reading');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- ถ่ายจากกล้อง → รวมเป็น PDF ----------
const shots = []; // { file, url }
$('camBtn').addEventListener('click', () => { $('cam').hidden = !$('cam').hidden; });
$('shot').addEventListener('click', () => $('shotIn').click());
$('gallery').addEventListener('click', () => $('galIn').click());
const addShots = (files) => { for (const f of files) shots.push({ file: f, url: URL.createObjectURL(f) }); renderShots(); };
$('shotIn').addEventListener('change', (e) => { addShots([...e.target.files]); e.target.value = ''; });
$('galIn').addEventListener('change', (e) => { addShots([...e.target.files]); e.target.value = ''; });
function renderShots() {
  $('thumbs').replaceChildren(
    ...shots.map((s, i) =>
      h('div', { class: 'thumb' }, h('img', { src: s.url, alt: `หน้า ${i + 1}` }), h('b', { text: String(i + 1) }),
        h('button', { type: 'button', 'aria-label': `ลบหน้า ${i + 1}`, text: '✕', onclick: () => { URL.revokeObjectURL(s.url); shots.splice(i, 1); renderShots(); } }))
    )
  );
  $('mkpdf').disabled = !shots.length;
  $('camClear').disabled = !shots.length;
  $('mkpdf').textContent = shots.length ? `รวมเป็น PDF (${shots.length} หน้า)` : 'รวมเป็น PDF';
}
$('camClear').addEventListener('click', () => { shots.forEach((s) => URL.revokeObjectURL(s.url)); shots.length = 0; renderShots(); });
$('mkpdf').addEventListener('click', () => {
  const stamp = new Date().toLocaleDateString('th-TH-u-ca-buddhist', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  askText({
    title: 'ตั้งชื่อเอกสารที่ถ่าย',
    label: 'ชื่อเอกสาร',
    value: `เอกสารถ่ายจากมือถือ ${stamp}`,
    okText: 'สร้างไฟล์ PDF',
    onOk: async (name) => {
      if (!name) throw new Error('กรุณากรอกชื่อเอกสาร');
      const blob = await imagesToPdf(shots.map((s) => s.file));
      const file = new File([blob], `${name.replace(/[\\/:*?"<>|]/g, ' ')}.pdf`, { type: 'application/pdf' });
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      shots.length = 0;
      renderShots();
      addFiles([file]);
      toast('รวมเป็น PDF แล้ว อยู่ในรายการไฟล์ที่เลือก');
      return true;
    },
  });
});

// ---------- ส่งขึ้นเซิร์ฟเวอร์ ----------
function sendOne(q, meta) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.set('meta', JSON.stringify(meta));
    fd.set('file', q.file, q.file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && q.bar) q.bar.style.width = `${Math.round((e.loaded / e.total) * 100)}%`; };
    xhr.onerror = () => reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ไม่ใช่ JSON */ }
      if (xhr.status === 401) { location.href = '/login.html?next=' + encodeURIComponent('/upload.html'); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.document);
      else reject(new Error(data.error || `อัปโหลดไม่สำเร็จ (${xhr.status})`));
    };
    xhr.send(fd);
  });
}

// หาโฟลเดอร์ย่อยตามชื่อ ถ้าไม่มีก็สร้างใหม่ ทีละระดับ (ใช้ซ้ำถ้ามีชื่อเดียวกันอยู่แล้ว)
async function ensurePath(baseId, dirs, made) {
  let parent = baseId;
  for (const name of dirs) {
    const key = `${parent}/${name}`;
    if (!made.has(key)) {
      const lower = name.trim().toLowerCase();
      let f = folders.find((x) => x.parent_id === parent && x.name.toLowerCase() === lower);
      if (!f) {
        ({ folder: f } = await api('POST', '/api/folders', { name, parent_id: parent }));
        folders = [...folders, f];
      }
      made.set(key, f.id);
    }
    parent = made.get(key);
  }
  return parent;
}

$('save').addEventListener('click', async () => {
  const same = $('same').checked;
  const todo = queue.filter((q) => q.status !== 'done');
  // ตรวจทุกไฟล์ก่อนเริ่ม จะได้ไม่อัปโหลดไปครึ่งทาง
  const jobs = [];
  for (const q of todo) {
    const form = same ? shared : q.form || shared;
    const values = form.get();
    values.title = q.title.trim();
    const problem = form.problem(values, { needTitle: true });
    if (problem) { toast(`${q.file.name}: ${problem}`, true); (same ? shared : q.form || shared).el.scrollIntoView({ block: 'center' }); return; }
    jobs.push({ q, meta: { ...values, folder_id: folderSel.value } });
  }
  busy = true;
  renderQueue();
  let okCount = 0, lastDoc = null;
  const keep = $('keepTree') && $('keepTree').checked;
  const made = new Map(); // "idพ่อ/ชื่อ/ชื่อ" -> id โฟลเดอร์ที่สร้างหรือพบแล้ว
  for (const { q, meta } of jobs) {
    setStatus(q, 'sending');
    q.el?.querySelector('.bar-p')?.removeAttribute('hidden');
    try {
      if (keep && q.dirs?.length) meta.folder_id = await ensurePath(meta.folder_id, q.dirs, made);
      lastDoc = await sendOne(q, meta);
      setStatus(q, 'done');
      okCount++;
    } catch (ex) {
      setStatus(q, 'error', ex.message);
    }
  }
  busy = false;
  const failed = queue.filter((q) => q.status === 'error').length;
  if (!failed && okCount === 1 && queue.length === 1) {
    location.href = `/doc.html?id=${encodeURIComponent(lastDoc.id)}`;
    return;
  }
  if (!failed) {
    toast(`อัปโหลดสำเร็จ ${okCount} ไฟล์`);
    setTimeout(() => (location.href = `/?folder=${encodeURIComponent(folderSel.value)}`), 900);
  } else {
    toast(`สำเร็จ ${okCount} ไฟล์ ไม่สำเร็จ ${failed} ไฟล์ — กดบันทึกอีกครั้งเพื่อลองใหม่เฉพาะไฟล์ที่ไม่สำเร็จ`, true);
    renderQueue();
  }
});

// เตือนก่อนปิดหน้าขณะอัปโหลด
window.addEventListener('beforeunload', (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } });
renderQueue();

// ไฟล์ที่แชร์เข้ามาจากแอปอื่น (เช่น LINE → แชร์ → EDMS โยธา) พักอยู่ในแคชโดย service worker: หยิบมาใส่คิวแล้วล้างทิ้ง
(async () => {
  if (!('caches' in window)) return;
  try {
    if (!(await caches.has('edms-share'))) return;
    const cache = await caches.open('edms-share');
    const keys = await cache.keys();
    const got = [];
    for (const k of keys) {
      const res = await cache.match(k);
      if (!res) continue;
      let name = 'ไฟล์ที่แชร์';
      try { name = decodeURIComponent(res.headers.get('x-filename') || name); } catch { /* ใช้ชื่อสำรอง */ }
      got.push(new File([await res.blob()], name, { type: res.headers.get('content-type') || '' }));
    }
    for (const k of keys) await cache.delete(k);
    if (qs('shared') === 'err') toast('รับไฟล์ที่แชร์ไม่สำเร็จ ลองเลือกไฟล์ด้วยปุ่มแทน', true);
    if (got.length) { addFiles(got); toast(`รับไฟล์ที่แชร์เข้ามา ${got.length} ไฟล์`); }
    else if (qs('shared') !== null && qs('shared') !== 'err') toast('ไม่พบไฟล์ที่แชร์เข้ามา (แชร์ได้เฉพาะไฟล์ ไม่รองรับข้อความหรือลิงก์)', true);
    if (qs('shared') !== null) history.replaceState(null, '', '/upload.html' + (qs('folder') ? `?folder=${encodeURIComponent(qs('folder'))}` : ''));
  } catch { /* ไม่เป็นไร */ }
})();

// จอสัมผัส (มือถือ/แท็บเล็ต) ลากวางไม่สะดวก: เปลี่ยนข้อความให้ตรงกับวิธีที่ใช้จริง
if (matchMedia('(pointer: coarse)').matches) document.getElementById('dropTitle').textContent = 'เลือกไฟล์ หรือถ่ายภาพเอกสาร';
