import { h, api, init, fmtSize, fmtUploadDate, extBadge, initials, svgIcon, ICON } from './common.js';

const docsReq = api('GET', '/api/documents');
docsReq.catch(() => {});
const boot = await init('dash', 'แดชบอร์ด');
const docs = (await docsReq).documents;
const folders = boot.folders;
const $ = (id) => document.getElementById(id);
$('main').removeAttribute('aria-busy');

const nf = (n) => new Intl.NumberFormat('th-TH').format(n);
const ymOf = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d).slice(0, 7);
};
const todayTh = () => new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', dateStyle: 'full' }).format(new Date());
$('lede').textContent = `สวัสดี ${boot.me.display_name} · ${todayTh()}`;

const empty = (t) => h('div', { class: 'dempty', text: t });
const countBy = (list, fn) => {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

// ---------- การ์ดสรุป ----------
function kpi(cls, icon, label, value, unit, sub, pct, pill) {
  return h('div', { class: `kpi ${cls}` },
    h('div', { class: 'top' }, h('div', { class: 'ib' }, svgIcon(icon, 20)), label),
    h('div', { class: 'vrow' }, h('div', { class: 'val' }, value, unit ? h('small', { text: unit }) : ''), pill || ''),
    h('div', { class: 'sub', text: sub }),
    h('div', { class: 'prog', role: 'presentation' }, h('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` }))
  );
}
{
  const now = new Date();
  const ym = ymOf(now.toISOString());
  const prev = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString());
  const month = docs.filter((d) => ymOf(d.uploaded_at) === ym).length;
  const lastMonth = docs.filter((d) => ymOf(d.uploaded_at) === prev).length;
  const bytes = docs.reduce((a, d) => a + (Number(d.size) || 0), 0);
  const types = countBy(docs, (d) => d.doc_type);
  const noType = docs.filter((d) => !d.doc_type).length;
  const uploaders = new Set(docs.map((d) => d.uploader).filter(Boolean)).size;
  $('kpis').replaceChildren(
    kpi('', ICON.files, 'เอกสารทั้งหมด', nf(docs.length), 'รายการ', `ใน ${nf(folders.length)} โฟลเดอร์ · ผู้อัปโหลด ${nf(uploaders)} คน`, docs.length ? 100 : 0),
    kpi('ok', ICON.clock, 'อัปโหลดเดือนนี้', nf(month), 'รายการ', `เดือนก่อน ${nf(lastMonth)} รายการ`, Math.max(month, lastMonth) ? (month / Math.max(month, lastMonth)) * 100 : 0, month ? h('span', { class: 'pill ok', text: 'ใหม่' }) : null),
    kpi('', ICON.drive, 'พื้นที่ที่ใช้', fmtSize(bytes), '', docs.length ? `เฉลี่ย ${fmtSize(Math.round(bytes / docs.length))} ต่อไฟล์` : 'ยังไม่มีไฟล์', docs.length ? 100 : 0),
    kpi(noType ? 'warn' : '', ICON.chart, 'ประเภทเอกสาร', nf(types.length), 'ประเภท', types[0] ? `มากสุด: ${types[0][0]} (${nf(types[0][1])})` : 'ยังไม่ได้ระบุประเภท', docs.length ? ((docs.length - noType) / docs.length) * 100 : 0,
      noType ? h('a', { class: 'pill warn', href: '/', text: `ไม่ระบุ ${nf(noType)}` }) : null)
  );
}

// ---------- อัปโหลดรายเดือน (12 เดือนล่าสุด) ----------
{
  const now = new Date();
  const cols = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    const key = ymOf(d.toISOString());
    cols.push({ key, label: new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'short' }).format(d), yr: new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { year: '2-digit' }).format(d), n: 0 });
  }
  for (const d of docs) {
    const c = cols.find((x) => x.key === ymOf(d.uploaded_at));
    if (c) c.n++;
  }
  const max = Math.max(1, ...cols.map((c) => c.n));
  const total = cols.reduce((a, c) => a + c.n, 0);
  $('months').replaceChildren(
    total
      ? h('div', { class: 'vbars', role: 'img', 'aria-label': `จำนวนเอกสารที่อัปโหลดรายเดือน รวม ${total} รายการ` },
          ...cols.map((c, i) =>
            h('div', { class: 'vb', title: `${c.label} ${c.yr}: ${c.n} รายการ` },
              h('span', { class: 'vn', text: c.n ? String(c.n) : '' }),
              h('div', { class: 'bar' }, h('i', { class: i === cols.length - 1 ? 'cur' : '', style: `height:${(c.n / max) * 100}%` })),
              h('span', { class: 'vl', text: c.label }))))
      : empty('ยังไม่มีการอัปโหลดใน 12 เดือนล่าสุด')
  );
}

// ---------- แถบแนวนอน (ประเภท / โฟลเดอร์) ----------
function hbars(box, rows, hrefOf) {
  if (!rows.length) return box.replaceChildren(empty('ยังไม่มีข้อมูล'));
  const max = rows[0][1];
  box.replaceChildren(
    h('div', { class: 'hbars' },
      ...rows.map(([name, n, sub]) => {
        const row = h('div', { class: 'hb' },
          h('div', { class: 'hl' }, h('span', { class: 'hn', text: name, title: sub || name }), h('span', { class: 'hv', text: `${nf(n)} · ${Math.round((n / docs.length) * 100)}%` })),
          h('div', { class: 'prog' }, h('i', { style: `width:${(n / max) * 100}%` })));
        const href = hrefOf?.(name);
        return href ? h('a', { class: 'hbl', href }, row) : row;
      }))
  );
}
{
  const rows = countBy(docs, (d) => d.doc_type || 'ไม่ระบุประเภท');
  hbars($('types'), rows);
}
{
  const byId = new Map(folders.map((f) => [f.id, f]));
  const rows = countBy(docs, (d) => d.folder_id).slice(0, 6).map(([id, n]) => [byId.get(id)?.name || 'ไม่พบโฟลเดอร์', n, byId.get(id)?.path, id]);
  const idOf = new Map(rows.map((r) => [r[0], r[3]]));
  hbars($('folders'), rows, (name) => (idOf.get(name) ? `/?folder=${encodeURIComponent(idOf.get(name))}` : null));
}

// ---------- ผู้อัปโหลด ----------
{
  const rows = countBy(docs, (d) => d.uploader).slice(0, 5);
  $('people').replaceChildren(
    rows.length
      ? h('div', { class: 'plist' }, ...rows.map(([name, n]) => h('div', { class: 'pr' }, h('span', { class: 'ini', 'aria-hidden': 'true', text: initials(name) }), h('span', { class: 'pn', text: name }), h('span', { class: 'pc', text: `${nf(n)} รายการ` }))))
      : empty('ยังไม่มีข้อมูล')
  );
}

// ---------- อัปโหลดล่าสุด ----------
{
  const rows = [...docs].sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at))).slice(0, 8);
  $('recent').replaceChildren(
    rows.length
      ? h('div', { class: 'rlist' },
          ...rows.map((d) =>
            h('a', { class: 'rr', href: `/doc.html?id=${encodeURIComponent(d.id)}` },
              extBadge(d.file_name),
              h('span', { class: 'rt', text: d.title, title: d.title }),
              d.doc_type ? h('span', { class: 'tag', text: d.doc_type }) : '',
              h('span', { class: 'rb sub', text: d.uploader }),
              h('span', { class: 'rd sub', text: fmtUploadDate(d.uploaded_at) }))))
      : empty('ยังไม่มีเอกสารในระบบ')
  );
}
