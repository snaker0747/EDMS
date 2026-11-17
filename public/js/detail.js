import { h, api, init, toast, askText, confirmBox, openDialog, detailsForm, folderSelect, fmtDate, fmtDateTime, fmtSize, extLabel, driveFolderUrl, qs } from './common.js';

// ขอข้อมูลเอกสารพร้อมกับข้อมูลเริ่มต้นของระบบ
let firstReq = api('GET', `/api/documents/${encodeURIComponent(new URLSearchParams(location.search).get('id') || '')}`);
firstReq.catch(() => {});
const boot = await init('docs', 'รายละเอียดเอกสาร');
document.querySelector('main').removeAttribute('aria-busy');
const $ = (id) => document.getElementById(id);
const id = qs('id');
const isAdmin = boot.me.role === 'admin';
let doc, canEdit;

async function load() {
  const r = await (firstReq || api('GET', `/api/documents/${encodeURIComponent(id)}`));
  firstReq = null;
  doc = r.document;
  canEdit = r.can_edit;
  render();
  loadHistory();
}

const fileUrl = (dl) => `/api/documents/${encodeURIComponent(id)}/file${dl ? '?download=1' : ''}`;
const NA = () => h('em', { class: 'na', text: 'ยังไม่กรอก' });

function render() {
  const folder = boot.folders.find((f) => f.id === doc.folder_id);
  document.title = `${doc.title} | ระบบบริหารจัดการเอกสารอิเล็กทรอนิกส์ ส่วนการโยธา`;
  $('h1').textContent = doc.title;
  $('crumb').replaceChildren(h('a', { href: '/', text: 'เอกสาร' }), ' › ', folder ? h('a', { href: `/?folder=${encodeURIComponent(folder.id)}`, text: folder.path }) : '—');

  $('topActs').replaceChildren(
    h('a', { class: 'btn', href: fileUrl(true), text: 'ดาวน์โหลด' }),
    h('button', { class: 'btn', type: 'button', text: 'คัดลอกลิงก์', onclick: copyLink }),
    isAdmin && doc.drive_url ? h('a', { class: 'btn blue', href: doc.drive_url, target: '_blank', rel: 'noopener', text: 'เปิดในที่เก็บไฟล์' }) : ''
  );

  // ตัวอย่างไฟล์
  const v = $('viewer');
  v.replaceChildren(h('div', { class: 'row spread', style: undefined }, h('span', { text: 'ตัวอย่างไฟล์' }), h('a', { href: fileUrl(false), target: '_blank', rel: 'noopener', text: 'เปิดเต็มหน้าจอ', style: undefined })));
  v.querySelector('a').style.color = '#87F0FF';
  if (doc.mime === 'application/pdf') v.append(h('iframe', { src: fileUrl(false), title: `ตัวอย่าง ${doc.title}` }));
  else if (doc.mime.startsWith('image/')) v.append(h('img', { src: fileUrl(false), alt: doc.title }));
  else v.append(h('div', { class: 'none', text: 'ไฟล์ชนิดนี้แสดงตัวอย่างในหน้านี้ไม่ได้ กรุณากด "ดาวน์โหลด"' }));

  // รายละเอียด
  const kv = $('kv');
  const rows = [
    ['เลขที่หนังสือ', doc.doc_no ? h('span', { class: 'mono', text: doc.doc_no }) : NA()],
    ['ลงวันที่', doc.doc_date ? fmtDate(doc.doc_date) : NA()],
    ['ประเภทเอกสาร', doc.doc_type || NA()],
    ['ปีงบประมาณ', doc.fiscal_year || NA()],
  ];
  for (const f of boot.settings.fields) {
    const val = doc.extra[f.key];
    rows.push([f.label, val ? (f.kind === 'date' ? fmtDate(val) : val) : NA()]);
  }
  rows.push(
    ['โฟลเดอร์', folder ? folder.name : '—'],
    ['ผู้อัปโหลด', `${doc.uploader} · ${fmtDateTime(doc.uploaded_at)}`],
    ['ไฟล์', `${extLabel(doc.file_name).toUpperCase()} · ${fmtSize(doc.size)}`],
    ['คำค้น', doc.tags ? h('span', { class: 'row', style: undefined }, doc.tags.split(',').map((t) => h('span', { class: 'tag', text: t.trim() }))) : NA()],
    ['รายละเอียด', doc.note ? h('span', { style: undefined, text: doc.note }) : NA()]
  );
  kv.replaceChildren(...rows.flatMap(([k, val]) => [h('dt', { text: k }), h('dd', {}, val)]));
  kv.querySelectorAll('dd .row').forEach((r) => (r.style.gap = '6px'));
  kv.querySelectorAll('dd span[style]').forEach((s) => (s.style.whiteSpace = 'pre-wrap'));

  $('edit').hidden = !canEdit;
  const btns = [];
  if (canEdit) {
    btns.push(
      h('button', { class: 'btn', type: 'button', text: 'ย้ายโฟลเดอร์', onclick: moveDialog }),
      h('button', { class: 'btn', type: 'button', text: 'เปลี่ยนชื่อ', onclick: renameDialog }),
      h('button', { class: 'btn', type: 'button', text: 'อัปโหลดฉบับแก้ไข', onclick: () => $('replaceIn').click() })
    );
  }
  if (isAdmin) btns.push(h('button', { class: 'btn danger', type: 'button', text: 'ย้ายไปถังขยะ', onclick: trashDialog }));
  $('manageBtns').replaceChildren(...btns);
  $('manage').hidden = !btns.length;
}

async function loadHistory() {
  const box = $('hist');
  try {
    const { history } = await api('GET', `/api/documents/${encodeURIComponent(id)}/history`);
    box.replaceChildren(...(history.length ? history.map((x) => h('div', {}, h('span', { class: 'muted', text: fmtDateTime(x.time) }), ` · ${x.user} ${x.action}`, x.detail ? h('span', { class: 'muted', text: ` (${x.detail})` }) : '')) : [h('div', { class: 'muted', text: 'ยังไม่มีประวัติ' })]));
  } catch (e) {
    box.replaceChildren(h('div', { class: 'st-err', text: e.message }));
  }
}

async function copyLink() {
  const url = `${location.origin}/doc.html?id=${encodeURIComponent(id)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('คัดลอกลิงก์แล้ว (ผู้รับต้องเข้าสู่ระบบก่อนจึงจะเปิดได้)');
  } catch {
    prompt('คัดลอกลิงก์นี้', url);
  }
}

$('edit').addEventListener('click', () => {
  const form = detailsForm(boot, doc, { withTitle: true });
  openDialog('แก้ไขรายละเอียด', [form.el], {
    wide: true,
    okText: 'บันทึก',
    onOk: async () => {
      const v = form.get();
      const problem = form.problem(v);
      if (problem) throw new Error(problem);
      const r = await api('PATCH', `/api/documents/${encodeURIComponent(id)}`, v);
      doc = r.document;
      render();
      loadHistory();
      toast('บันทึกแล้ว');
      return true;
    },
  });
});

function renameDialog() {
  askText({
    title: 'เปลี่ยนชื่อเอกสาร',
    label: 'ชื่อเอกสาร (ชื่อไฟล์ในที่เก็บไฟล์จะเปลี่ยนตาม)',
    value: doc.title,
    onOk: async (name) => {
      const r = await api('PATCH', `/api/documents/${encodeURIComponent(id)}`, { title: name });
      doc = r.document;
      render();
      loadHistory();
      toast('เปลี่ยนชื่อแล้ว');
      return true;
    },
  });
}

function moveDialog() {
  const sel = folderSelect(boot.folders, { value: doc.folder_id, id: 'mv' });
  openDialog('ย้ายโฟลเดอร์', [h('div', { class: 'field' }, h('label', { for: 'mv', text: 'ย้ายไปที่' }), sel)], {
    okText: 'ย้าย',
    onOk: async () => {
      const r = await api('POST', `/api/documents/${encodeURIComponent(id)}/move`, { folder_id: sel.value });
      doc = r.document;
      render();
      loadHistory();
      toast('ย้ายโฟลเดอร์แล้ว');
      return true;
    },
  });
}

function trashDialog() {
  confirmBox(`ย้าย "${doc.title}" ไปถังขยะ? (กู้คืนได้จากถังขยะของที่เก็บไฟล์ ภายใน 30 วัน)`, 'ย้ายไปถังขยะ', true, async () => {
    await api('DELETE', `/api/documents/${encodeURIComponent(id)}`);
    location.href = '/';
    return true;
  });
}

// ช่องเลือกไฟล์สำหรับอัปโหลดฉบับแก้ไข
const replaceIn = h('input', { type: 'file', id: 'replaceIn', hidden: true, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.dwg,.dxf,.zip' });
document.body.append(replaceIn);
replaceIn.addEventListener('change', async () => {
  const file = replaceIn.files[0];
  replaceIn.value = '';
  if (!file) return;
  if (!(await confirmBox(`แทนที่ไฟล์เดิมด้วย "${file.name}" ?`, 'อัปโหลดแทนที่'))) return;
  try {
    toast('กำลังอัปโหลด…');
    const fd = new FormData();
    fd.set('file', file, file.name);
    const r = await api('POST', `/api/documents/${encodeURIComponent(id)}/replace`, fd);
    doc = r.document;
    render();
    loadHistory();
    toast('อัปโหลดฉบับแก้ไขแล้ว');
  } catch (e) {
    toast(e.message, true);
  }
});

try {
  if (!id) throw new Error('ไม่ได้ระบุเอกสาร');
  await load();
} catch (e) {
  $('h1').textContent = 'เปิดเอกสารไม่ได้';
  $('viewer').replaceChildren(h('div', { class: 'none', text: e.message }));
}
