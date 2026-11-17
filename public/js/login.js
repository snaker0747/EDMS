import { h, api, bannerEl } from './common.js';

document.getElementById('top').replaceWith(h('header', { class: 'top' }, h('div', { class: 'topin' }, bannerEl())));

const f = document.getElementById('f');
const err = document.getElementById('err');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('go');
  btn.disabled = true;
  err.hidden = true;
  try {
    await api('POST', '/api/login', { username: document.getElementById('u').value, password: document.getElementById('p').value });
    const next = new URLSearchParams(location.search).get('next') || '/';
    location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
    document.getElementById('p').select();
  }
});
