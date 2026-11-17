import { h, api, init, toast, openDialog, confirmBox, fmtDateTime } from './common.js';

const boot = await init('users', 'ผู้ใช้งาน');
document.querySelector('main').removeAttribute('aria-busy');
const $ = (id) => document.getElementById(id);
if (boot.me.role !== 'admin') {
  document.querySelector('main').replaceChildren(h('div', { class: 'card', text: 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น' }));
  throw new Error('forbidden');
}
let users = [];
const ROLE = { admin: 'ผู้ดูแลระบบ', user: 'ผู้ใช้ทั่วไป' };
const cols = 'minmax(0,1.2fr) minmax(0,1.4fr) 130px 100px 340px';

function render() {
  const box = $('list');
  const row = (cells, head) => {
    const r = h('div', { class: 'tr' + (head ? ' head' : '') }, ...cells);
    r.style.gridTemplateColumns = cols;
    return r;
  };
  box.replaceChildren(row(['ชื่อผู้ใช้', 'ชื่อที่แสดง', 'สิทธิ์', 'สถานะ', ''].map((t) => h('div', { text: t })), true));
  for (const u of users) {
    const self = u.username === boot.me.username;
    const acts = h('div', { class: 'row', style: undefined },
      h('button', { class: 'btn sm', type: 'button', text: 'แก้ไข', onclick: () => editDialog(u) }),
      h('button', { class: 'btn sm', type: 'button', text: 'รีเซ็ตรหัสผ่าน', onclick: () => resetDialog(u) }),
      self ? '' : h('button', { class: 'btn sm' + (u.active ? ' danger' : ''), type: 'button', text: u.active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน', onclick: () => toggle(u) })
    );
    acts.style.gap = '6px';
    box.append(row([
      h('div', { class: 'mono', text: u.username }),
      h('div', {}, u.display_name, self ? h('span', { class: 'tag', text: 'คุณ', style: undefined }) : ''),
      h('div', { text: ROLE[u.role] || u.role }),
      h('div', { class: u.active ? 'st-ok' : 'muted', text: u.active ? 'ใช้งาน' : 'ปิดอยู่' }),
      acts,
    ]));
  }
  box.querySelectorAll('.tag').forEach((t) => { t.style.marginLeft = '8px'; t.style.fontSize = '12px'; });
}

async function load() {
  users = (await api('GET', '/api/users')).users;
  render();
}

function roleSelect(value) {
  return h('select', { id: 'ur' }, ...Object.entries(ROLE).map(([v, t]) => h('option', { value: v, text: t, selected: v === value })));
}
const pwField = (id, label) => h('div', { class: 'field' }, h('label', { for: id, text: label }), h('input', { type: 'password', id, autocomplete: 'new-password', minLength: 8, required: true }));

$('add').addEventListener('click', () => {
  const un = h('input', { type: 'text', id: 'uu', autocapitalize: 'off', autocomplete: 'off', required: true, placeholder: 'a-z 0-9 . _ -' });
  const dn = h('input', { type: 'text', id: 'ud', required: true, maxLength: 80 });
  const role = roleSelect('user');
  const pw = pwField('up', 'รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัวอักษร)');
  openDialog('เพิ่มผู้ใช้', [
    h('div', { class: 'field' }, h('label', { for: 'uu', text: 'ชื่อผู้ใช้ (ภาษาอังกฤษ)' }), un),
    h('div', { class: 'field' }, h('label', { for: 'ud', text: 'ชื่อที่แสดง (เช่น ชื่อ-นามสกุล)' }), dn),
    h('div', { class: 'field' }, h('label', { for: 'ur', text: 'สิทธิ์' }), role),
    pw,
  ], {
    okText: 'เพิ่มผู้ใช้',
    onOk: async () => {
      await api('POST', '/api/users', { username: un.value, display_name: dn.value, role: role.value, password: pw.querySelector('input').value });
      await load();
      toast('เพิ่มผู้ใช้แล้ว แจ้งชื่อผู้ใช้และรหัสผ่านให้เจ้าของบัญชี');
      return true;
    },
  });
});

function editDialog(u) {
  const dn = h('input', { type: 'text', id: 'ud', value: u.display_name, required: true, maxLength: 80 });
  const role = roleSelect(u.role);
  openDialog(`แก้ไขผู้ใช้ ${u.username}`, [
    h('div', { class: 'field' }, h('label', { for: 'ud', text: 'ชื่อที่แสดง' }), dn),
    h('div', { class: 'field' }, h('label', { for: 'ur', text: 'สิทธิ์' }), role),
  ], {
    okText: 'บันทึก',
    onOk: async () => { await api('PATCH', `/api/users/${encodeURIComponent(u.username)}`, { display_name: dn.value, role: role.value }); await load(); toast('บันทึกแล้ว'); return true; },
  });
}

function resetDialog(u) {
  const pw = pwField('rp', 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)');
  openDialog(`รีเซ็ตรหัสผ่านของ ${u.display_name}`, [pw], {
    okText: 'ตั้งรหัสผ่านใหม่',
    onOk: async () => { await api('PATCH', `/api/users/${encodeURIComponent(u.username)}`, { password: pw.querySelector('input').value }); toast('ตั้งรหัสผ่านใหม่แล้ว แจ้งเจ้าของบัญชีด้วย'); return true; },
  });
}

function toggle(u) {
  const off = u.active;
  confirmBox(off ? `ปิดการใช้งานของ ${u.display_name}? ผู้ใช้จะเข้าระบบไม่ได้จนกว่าจะเปิดใหม่` : `เปิดการใช้งานของ ${u.display_name} อีกครั้ง?`, off ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน', off, async () => {
    await api('PATCH', `/api/users/${encodeURIComponent(u.username)}`, { active: !off });
    await load();
    return true;
  });
}

await load();
