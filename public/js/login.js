import { h, api, bannerEl } from './common.js';

document.getElementById('top').replaceWith(h('header', { class: 'top' }, h('div', { class: 'topin' }, bannerEl())));

const f = document.getElementById('f');
const err = document.getElementById('err');
const rem = document.getElementById('rem');
// จำเฉพาะชื่อผู้ใช้และตัวเลือก ไม่เก็บรหัสผ่านไว้ในเครื่อง
try {
  if (localStorage.getItem('edms.remember') === '1') {
    rem.checked = true;
    const u = localStorage.getItem('edms.user');
    if (u) { document.getElementById('u').value = u; document.getElementById('p').focus(); }
  }
} catch { /* ไม่เป็นไร */ }
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('go');
  btn.disabled = true;
  err.hidden = true;
  try {
    await api('POST', '/api/login', { username: document.getElementById('u').value, password: document.getElementById('p').value, remember: rem.checked });
    try {
      if (rem.checked) { localStorage.setItem('edms.remember', '1'); localStorage.setItem('edms.user', document.getElementById('u').value.trim()); }
      else { localStorage.removeItem('edms.remember'); localStorage.removeItem('edms.user'); }
    } catch { /* ไม่เป็นไร */ }
    const next = new URLSearchParams(location.search).get('next') || '/dashboard.html';
    location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard.html';
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
    document.getElementById('p').select();
  }
});
