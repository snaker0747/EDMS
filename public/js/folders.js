import { h, api, init, toast, askText, confirmBox, openDialog, folderTree, folderSelect, descendantIds } from './common.js';

const boot = await init('folders', 'จัดการโฟลเดอร์');
document.querySelector('main').removeAttribute('aria-busy');
const $ = (id) => document.getElementById(id);
const isAdmin = boot.me.role === 'admin';
let folders = boot.folders;
let settings = boot.settings;

// ---------- โฟลเดอร์ ----------
function renderParent() {
  const sel = folderSelect(folders, { value: boot.root_id, id: 'n-parent' });
  $('parentHost').replaceChildren(sel);
}

function renderRows() {
  const box = $('rows');
  box.replaceChildren();
  for (const f of folderTree(folders)) {
    const info = h('div', { class: 'info' }, h('div', { style: undefined, text: f.name }), h('div', { class: 'muted', style: undefined, text: `${f.depth ? f.path.split(' › ').slice(0, -1).join(' › ') : 'โฟลเดอร์หลักของระบบ'} · มีเอกสาร ${f.doc_count} รายการ` }));
    info.firstChild.style.fontWeight = '600';
    info.lastChild.style.fontSize = '12px';
    const row = h('div', { class: 'frow' }, h('div', { style: undefined, 'aria-hidden': 'true', text: '' }), info);
    row.firstChild.style.width = `${f.depth * 20}px`;
    row.insertBefore(h('a', { class: 'btn sm', href: `/?folder=${encodeURIComponent(f.id)}`, text: 'เปิดดู' }), null);
    if (isAdmin && f.id !== boot.root_id) {
      row.append(
        h('button', { class: 'btn sm', type: 'button', text: 'เปลี่ยนชื่อ', onclick: () => rename(f) }),
        h('button', { class: 'btn sm', type: 'button', text: 'ย้าย', onclick: () => move(f) }),
        h('button', { class: 'btn sm danger', type: 'button', text: 'ลบ', onclick: () => remove(f) })
      );
    }
    box.append(row);
  }
}

async function reload() {
  const r = await api('GET', '/api/folders');
  folders = r.folders;
  renderParent();
  renderRows();
}

$('create').addEventListener('click', async () => {
  const name = $('n-name').value.trim();
  if (!name) { toast('กรุณากรอกชื่อโฟลเดอร์', true); $('n-name').focus(); return; }
  $('create').disabled = true;
  try {
    await api('POST', '/api/folders', { name, parent_id: $('n-parent').value });
    $('n-name').value = '';
    await reload();
    toast('สร้างโฟลเดอร์แล้ว');
  } catch (e) {
    toast(e.message, true);
  } finally {
    $('create').disabled = false;
  }
});
$('n-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('create').click(); });

function rename(f) {
  askText({ title: 'เปลี่ยนชื่อโฟลเดอร์', label: 'ชื่อใหม่', value: f.name, onOk: async (name) => { await api('PATCH', `/api/folders/${f.id}`, { name }); await reload(); toast('เปลี่ยนชื่อแล้ว'); return true; } });
}
function move(f) {
  const sel = folderSelect(folders, { value: f.parent_id, exclude: descendantIds(folders, f.id), id: 'mvf' });
  openDialog(`ย้าย "${f.name}"`, [h('div', { class: 'field' }, h('label', { for: 'mvf', text: 'ย้ายไปไว้ภายใต้' }), sel)], {
    okText: 'ย้าย',
    onOk: async () => { await api('PATCH', `/api/folders/${f.id}`, { parent_id: sel.value }); await reload(); toast('ย้ายโฟลเดอร์แล้ว'); return true; },
  });
}
function remove(f) {
  confirmBox(`ลบโฟลเดอร์ "${f.name}"? (ลบได้เฉพาะโฟลเดอร์ที่ว่าง ระบบจะย้ายไปถังขยะของที่เก็บไฟล์)`, 'ลบโฟลเดอร์', true, async () => {
    await api('DELETE', `/api/folders/${f.id}`);
    await reload();
    toast('ลบโฟลเดอร์แล้ว');
    return true;
  });
}

if (isAdmin) {
  $('syncSheet').hidden = false;
  $('syncSheet').addEventListener('click', async () => {
    $('syncSheet').disabled = true;
    try {
      const r = await api('POST', '/api/admin/sync-sheet', {});
      if (r.busy) { toast('กำลังซิงก์อยู่ ลองใหม่อีกสักครู่'); return; }
      await reload();
      toast(`ซิงก์กับชีตแล้ว: รับจากชีต ${r.inbound} ส่งไปชีต ${r.outbound} รายการ${r.warning ? ' — ' + r.warning : ''}`);
    } catch (e) { toast(e.message, true); } finally { $('syncSheet').disabled = false; }
  });
  $('sync').hidden = false;
  $('sync').addEventListener('click', async () => {
    $('sync').disabled = true;
    try {
      const r = await api('POST', '/api/admin/sync', {});
      await reload();
      toast(`ซิงก์แล้ว: เพิ่มโฟลเดอร์ ${r.folders_added} เอกสาร ${r.documents_added} รายการ`);
    } catch (e) { toast(e.message, true); } finally { $('sync').disabled = false; }
  });
}

// ---------- ช่องรายละเอียด + ประเภทเอกสาร ----------
const KIND = { text: 'ข้อความ', date: 'วันที่', select: 'ตัวเลือก', number: 'ตัวเลข' };
const CORE = [
  ['ชื่อเอกสาร / เรื่อง', 'ข้อความ', 'บังคับกรอก'],
  ['เลขที่หนังสือ', 'ข้อความ', 'ไม่บังคับ'],
  ['ลงวันที่', 'วันที่', 'ไม่บังคับ'],
  ['ประเภทเอกสาร', 'ตัวเลือก', 'บังคับกรอก'],
  ['ปีงบประมาณ', 'ตัวเลือก', 'บังคับกรอก'],
  ['คำค้น (แท็ก)', 'หลายค่า', 'ไม่บังคับ'],
  ['รายละเอียดเพิ่มเติม', 'ข้อความยาว', 'ไม่บังคับ'],
];
const badge = (t) => h('span', { text: t, style: undefined, class: 'tag' });

async function saveSettings(patch) {
  const r = await api('PUT', '/api/settings', patch);
  settings = r.settings;
  renderSettings();
  toast('บันทึกการตั้งค่าแล้ว');
}

function renderSettings() {
  const fields = $('fields');
  fields.replaceChildren(
    ...CORE.map(([n, k, r]) => h('div', { class: 'item' }, h('div', { style: undefined }, h('div', { text: n }), h('div', { class: 'muted', text: `${k} · ช่องมาตรฐาน`, style: undefined })), badge(r))),
    ...settings.fields.map((f, i) => {
      const left = h('div', { style: undefined }, h('div', { text: f.label }), h('div', { class: 'muted', text: KIND[f.kind] + (f.kind === 'select' ? ` · ${f.options.join(', ')}` : ''), style: undefined }));
      const it = h('div', { class: 'item' }, left, badge(f.required ? 'บังคับกรอก' : 'ไม่บังคับ'));
      if (isAdmin) it.append(
        h('button', { class: 'btn sm', type: 'button', text: 'แก้ไข', onclick: () => fieldDialog(i) }),
        h('button', { class: 'btn sm danger', type: 'button', text: 'ลบ', onclick: () => confirmBox(`ลบช่อง "${f.label}"? (ข้อมูลที่เคยกรอกไว้ในช่องนี้จะไม่แสดงอีก)`, 'ลบช่อง', true, async () => { await saveSettings({ fields: settings.fields.filter((_, j) => j !== i) }); return true; }) })
      );
      return it;
    })
  );
  fields.querySelectorAll('.item > div:first-child').forEach((d) => { d.style.flexGrow = '1'; d.style.minWidth = '0'; d.firstChild.style.fontWeight = '500'; d.lastChild.style.fontSize = '12px'; });
  fields.querySelectorAll('.item .tag').forEach((t) => (t.style.fontSize = '12px'));

  $('types').replaceChildren(
    ...settings.doc_types.map((t) => h('span', { class: 'chip' }, t, isAdmin && t !== 'เอกสารอื่นๆ' ? h('button', { type: 'button', 'aria-label': `ลบ ${t}`, text: '✕', onclick: () => confirmBox(`ลบประเภท "${t}"? (เอกสารเดิมที่เป็นประเภทนี้ยังคงอยู่)`, 'ลบ', true, async () => { await saveSettings({ doc_types: settings.doc_types.filter((x) => x !== t) }); return true; }) }) : ''))
  );
}

function fieldDialog(index) {
  const cur = index == null ? { label: '', kind: 'text', required: false, options: [] } : settings.fields[index];
  const label = h('input', { type: 'text', id: 'fl', value: cur.label, maxLength: 60, required: true });
  const kind = h('select', { id: 'fk' }, ...Object.entries(KIND).map(([v, t]) => h('option', { value: v, text: t, selected: v === cur.kind })));
  const opts = h('textarea', { id: 'fo', rows: 4, value: cur.options.join('\n'), placeholder: 'พิมพ์ตัวเลือกละบรรทัด' });
  const optsBox = h('div', { class: 'field' }, h('label', { for: 'fo', text: 'ตัวเลือก (บรรทัดละ 1 ค่า)' }), opts);
  const req = h('input', { type: 'checkbox', id: 'fr', checked: cur.required });
  const sync = () => (optsBox.hidden = kind.value !== 'select');
  kind.addEventListener('change', sync);
  sync();
  openDialog(index == null ? 'เพิ่มช่องรายละเอียด' : 'แก้ไขช่องรายละเอียด', [
    h('div', { class: 'field' }, h('label', { for: 'fl', text: 'ชื่อช่อง' }), label),
    h('div', { class: 'field' }, h('label', { for: 'fk', text: 'ชนิดข้อมูล' }), kind),
    optsBox,
    h('label', { class: 'row', style: undefined }, req, 'บังคับกรอกทุกครั้งที่อัปโหลด'),
  ], {
    okText: 'บันทึก',
    onOk: async () => {
      const f = { key: cur.key, label: label.value.trim(), kind: kind.value, required: req.checked, options: opts.value.split('\n').map((x) => x.trim()).filter(Boolean) };
      if (!f.label) throw new Error('กรุณากรอกชื่อช่อง');
      const list = [...settings.fields];
      if (index == null) list.push(f); else list[index] = f;
      await saveSettings({ fields: list });
      return true;
    },
  });
}

if (isAdmin) {
  $('addField').hidden = false;
  $('addType').hidden = false;
  $('addField').addEventListener('click', () => fieldDialog(null));
  $('addType').addEventListener('click', () =>
    askText({ title: 'เพิ่มประเภทเอกสาร', label: 'ชื่อประเภท', okText: 'เพิ่ม', onOk: async (name) => {
      if (settings.doc_types.includes(name)) throw new Error('มีประเภทนี้อยู่แล้ว');
      await saveSettings({ doc_types: [...settings.doc_types, name] });
      return true;
    } })
  );
} else {
  $('fields').parentElement.append(h('div', { class: 'muted', text: 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขช่องและประเภทเอกสารได้', style: undefined }));
}

renderParent();
renderRows();
renderSettings();
