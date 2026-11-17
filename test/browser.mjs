import { createRequire } from 'node:module';
import { start } from './dev-server.mjs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');

const { server, url, mock } = await start(8787);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const problems = [];
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'th-TH' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts.googleapis|fonts.gstatic|ERR_(NAME|INTERNET|CONNECTION|BLOCKED)/.test(m.text() + (m.location()?.url || ''))) problems.push(`[console.${m.type()}] ${m.text()} @ ${m.location()?.url || ''}`); });
  page.on('pageerror', (e) => problems.push('[pageerror] ' + e.message));
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true });

const { page } = await newPage({ width: 1440, height: 900 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

// ล็อกอิน
await page.goto(url + '/');
await page.waitForURL(/login\.html/);
await shot(page, '01-login');
await page.fill('#u', 'admin');
await page.fill('#p', 'ผิดรหัส');
await page.click('#go');
await page.waitForSelector('#err:not([hidden])');
console.log('login error shown:', await page.textContent('#err'));
await page.fill('#p', 'Passw0rd!x');
await page.check('#rem');
await page.click('#go');
await page.waitForURL(/dashboard\.html/); // ล็อกอินแล้วเข้าแดชบอร์ดก่อน
await page.waitForSelector('#kpis .kpi');
{ const ck = (await page.context().cookies()).find((c) => c.name === 'edms_session');
  console.log('remember cookie days:', ck ? Math.round((ck.expires - Date.now() / 1000) / 86400) : 'none'); }
// กลับมาหน้าล็อกอินอีกครั้ง: ต้องจำชื่อผู้ใช้และตัวเลือกไว้ (ไม่จำรหัสผ่าน)
await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
await page.goto(url + '/login.html');
console.log('prefill user:', await page.inputValue('#u'), '| remember checked:', await page.isChecked('#rem'), '| password empty:', (await page.inputValue('#p')) === '');
await shot(page, '01b-login-remember');
await page.fill('#p', 'Passw0rd!x');
await page.click('#go');
await page.waitForURL(/dashboard\.html/);
await page.goto(url + '/');
await page.waitForSelector('#tbl .tr:not(.head)');
await shot(page, '02-library');
console.log('banner:', (await page.textContent('.banner')).trim());
console.log('rows:', await page.locator('#tbl .tr:not(.head)').count());

// ค้นหา/กรอง
await page.fill('#q', 'ทางหลวง');
console.log('after search:', await page.textContent('#count'));
await page.fill('#q', '');

// สร้างโฟลเดอร์จากหน้าคลัง
await page.click('#newFolder');
await page.fill('dialog input', 'โครงการก่อสร้าง');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
console.log('folders in tree:', await page.locator('#tree .fbtn').count());

// อัปโหลด 2 ไฟล์
await page.goto(url + '/upload.html');
await page.waitForSelector('#formHost select');
await page.setInputFiles('#file', ['/tmp/e2e/t1.pdf']);
// ไฟล์ชื่อภาษาไทย (สร้างในหน้าเว็บ เพราะเครื่องทดสอบส่งพาธภาษาไทยให้ Playwright ไม่ได้)
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 49])], 'หนังสือทดสอบ ฉบับที่ 2.pdf', { type: 'application/pdf' }));
  const f = document.getElementById('file');
  f.files = dt.files;
  f.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForFunction(() => document.querySelectorAll('#queue .qitem').length === 2);
console.log('queue titles:', JSON.stringify(await page.locator('#queue .qitem input[type=text]').evaluateAll((els) => els.map((e) => e.value))));
await page.selectOption('#formHost select >> nth=0', 'หนังสือส่ง');
await page.fill('#formHost input[type=date]', '2026-11-10');
console.log('FY auto from date:', await page.inputValue('#formHost select >> nth=1'));
await shot(page, '03-upload');
await page.uncheck('#same');
await shot(page, '04-upload-per-file');
await page.check('#same');
await page.click('#save');
await page.waitForURL((u) => /\/\?folder=/.test(u.toString()), { timeout: 15000 });
await page.waitForSelector('#tbl .tr:not(.head)');
console.log('after upload count:', await page.textContent('#count'));
await shot(page, '05-library-after-upload');

// รายละเอียดเอกสาร
await page.click('#tbl .tr:not(.head) a.nm >> nth=0');
await page.waitForSelector('#kv dt');
await page.waitForTimeout(500);
await shot(page, '06-detail');
console.log('detail title:', await page.textContent('#h1'));

// แก้ไขรายละเอียด
await page.click('#edit');
await page.waitForSelector('dialog');
await shot(page, '07-edit-dialog');
await page.fill('dialog textarea', 'บันทึกทดสอบ');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
await page.waitForTimeout(300);
console.log('hist items:', await page.locator('#hist > div').count());

// โฟลเดอร์ + ช่องรายละเอียด
await page.goto(url + '/folders.html');
await page.waitForSelector('#rows .frow');
await page.click('#addField');
await page.fill('#fl', 'หน่วยงานต้นเรื่อง');
await page.check('#fr');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
await shot(page, '08-folders');

// แดชบอร์ด
await page.goto(url + '/dashboard.html');
await page.waitForSelector('#kpis .kpi');
await page.waitForSelector('#recent .rr');
console.log('dashboard kpis:', await page.locator('#kpis .kpi').count(), 'recent:', await page.locator('#recent .rr').count(), 'types:', await page.locator('#types .hb').count());
await shot(page, '07b-dashboard');
await page.setViewportSize({ width: 390, height: 800 });
await page.reload();
await page.waitForSelector('#recent .rr');
await shot(page, '07c-dashboard-mobile');
await page.setViewportSize({ width: 1280, height: 800 });

// ซ่อน/แสดงแถบโฟลเดอร์ (จอคอม)
await page.goto(url + '/');
await page.waitForSelector('#tbl .tr:not(.head)');
console.log('side visible at start:', await page.locator('.side').isVisible(), '| collapse btn:', await page.locator('#sideCollapse').isVisible(), '| open btn hidden:', !(await page.locator('#sideOpen').isVisible()));
await shot(page, '07c-side-visible');
await page.click('#sideCollapse');
console.log('side hidden after collapse:', !(await page.locator('.side').isVisible()), '| open btn visible:', await page.locator('#sideOpen').isVisible(), '| main width:', await page.evaluate(() => Math.round(document.querySelector('#main').getBoundingClientRect().width)));
await shot(page, '07d-side-hidden');
await page.reload();
await page.waitForSelector('#tbl .tr:not(.head)');
console.log('side stays hidden after reload:', !(await page.locator('.side').isVisible()));
await page.click('#sideOpen');
console.log('side visible again:', await page.locator('.side').isVisible(), '| open btn hidden:', !(await page.locator('#sideOpen').isVisible()));

// ผู้ใช้
await page.goto(url + '/users.html');
await page.waitForSelector('#list .tr:not(.head)');
await page.click('#add');
await page.fill('#uu', 'somchai');
await page.fill('#ud', 'สมชาย ใจดี');
await page.fill('#up', 'Somchai#2570');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
await shot(page, '09-users');
console.log('users rows:', await page.locator('#list .tr:not(.head)').count());

// มือถือ
const m = await newPage({ width: 390, height: 844 });
await m.page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await m.page.goto(url + '/login.html');
await m.page.fill('#u', 'somchai');
await m.page.fill('#p', 'Somchai#2570');
await m.page.click('#go');
await m.page.waitForURL(/dashboard\.html/);
await m.page.goto(url + '/');
await m.page.waitForSelector('#tbl .tr:not(.head)');
await shot(m.page, '10-mobile-library');
// แอปมือถือ: เมนูล่าง / ลิ้นชักโฟลเดอร์ / ตัวกรองพับเก็บ
console.log('tabbar items:', await m.page.locator('.tabbar a').count(), '| top nav visible:', await m.page.locator('.top .nav').isVisible());
console.log('phone: folder tree visible at start:', await m.page.locator('.side').isVisible(), '| above list:', await m.page.evaluate(() => document.querySelector('.side').getBoundingClientRect().top < document.querySelector('#tbl').getBoundingClientRect().top), '| open icon hidden:', !(await m.page.locator('#sideOpen').isVisible()));
await shot(m.page, '10b-mobile-tree');
console.log('phone: collapse icon clear of first row:', await m.page.evaluate(() => document.querySelector('#sideCollapse').getBoundingClientRect().bottom <= document.querySelector('#tree .fbtn').getBoundingClientRect().top));
await m.page.click('#sideCollapse');
console.log('phone: tree hidden:', !(await m.page.locator('.side').isVisible()), '| open icon visible near top:', await m.page.locator('#sideOpen').isVisible(), await m.page.evaluate(() => Math.round(document.querySelector('#sideOpen').getBoundingClientRect().top)));
await shot(m.page, '10c-mobile-tree-hidden');
await m.page.click('#sideOpen');
console.log('phone: tree visible again:', await m.page.locator('.side').isVisible());
await m.page.locator('#tree .fbtn >> nth=1').click();
await m.page.waitForTimeout(350);
console.log('phone: tree auto-hidden after pick:', !(await m.page.locator('.side').isVisible()), '| heading:', await m.page.textContent('#h1'));
console.log('filters hidden:', !(await m.page.locator('#fbox').isVisible()));
await m.page.click('#filterBtn');
console.log('filters visible after tap:', await m.page.locator('#fbox').isVisible());
await m.page.click('#filterBtn');
await m.page.locator('#tree .fbtn >> nth=0').waitFor({ state: 'attached' });
await m.page.evaluate(() => document.querySelector('#sideOpen').click());
await m.page.locator('#tree .fbtn >> nth=0').click();
await m.page.goto(url + '/upload.html');
await m.page.waitForSelector('#formHost select');
await m.page.click('#camBtn');
await shot(m.page, '11-mobile-upload');
// ถ่ายรูป 2 หน้า -> PDF (ใช้รูปที่สร้างจาก canvas)
const jpg = await m.page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 1100;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 1100); g.fillStyle = '#310081'; g.font = '60px sans-serif'; g.fillText('หน้าทดสอบ', 80, 200);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
});
const fs = await import('node:fs');
fs.writeFileSync('/tmp/e2e/p1.jpg', Buffer.from(jpg, 'base64'));
await m.page.setInputFiles('#shotIn', '/tmp/e2e/p1.jpg');
await m.page.setInputFiles('#shotIn', '/tmp/e2e/p1.jpg');
await m.page.click('#mkpdf');
await m.page.fill('dialog input', 'เอกสารจากกล้อง');
await m.page.click('dialog button[type=submit]');
await m.page.waitForSelector('dialog', { state: 'detached' });
console.log('camera->queue:', await m.page.locator('#queue .qitem').count());
const sel = m.page.locator('#formHost select');
await sel.nth(0).selectOption('รายงาน');
await sel.nth(1).selectOption({ index: 1 });
await m.page.fill('#queue .qitem input[type=text]', 'เอกสารจากกล้อง');
await shot(m.page, '12-mobile-queue');
// ฟิลด์บังคับ (หน่วยงานต้นเรื่อง) ต้องกรอกก่อน
await m.page.click('#save');
console.log('required toast:', await m.page.locator('.toast').first().textContent());
await m.page.fill('#formHost input[id$="-x-' + (await m.page.evaluate(() => 0)) + '"]', '').catch(() => {});
const reqInput = m.page.locator('#formHost input[id*="-x-"]').first();
await reqInput.fill('กองช่าง');
await m.page.click('#save');
await m.page.waitForURL(/doc\.html\?id=/, { timeout: 15000 });
await m.page.waitForSelector('#kv dt');
await shot(m.page, '13-mobile-detail');
const pdfDoc = [...mock.files.values()].find((f) => f.name === 'เอกสารจากกล้อง.pdf');
console.log('camera pdf in Drive:', !!pdfDoc, pdfDoc && new TextDecoder().decode(pdfDoc.bytes.slice(0, 8)), pdfDoc?.bytes.byteLength);

// ---- แผนผังโฟลเดอร์: ย่อ/ขยายด้วย + − ----
await page.goto(url + '/');
await page.waitForSelector('#tree .fbtn');
const fbBefore = await page.locator('#tree .fbtn').count();
await page.locator('#tree .tg[aria-expanded=true] >> nth=0').click();
const fbCollapsed = await page.locator('#tree .fbtn').count();
await shot(page, '16-tree-collapsed');
await page.reload();
await page.waitForSelector('#tree .fbtn');
console.log('tree rows expanded/collapsed/after reload:', fbBefore, fbCollapsed, await page.locator('#tree .fbtn').count());
await page.locator('#tree .tg[aria-expanded=false] >> nth=0').click();
console.log('after expand all:', await page.locator('#tree .fbtn').count(), '| row folder label:', await page.locator('#tbl .fp').first().textContent());
await shot(page, '17-tree-expanded');

// ---- ลากวางย้ายเอกสาร/โฟลเดอร์ ----
await page.goto(url + '/');
await page.waitForSelector('#tbl .tr:not(.head)');
const mkFolder = async (name) => page.evaluate(async (n) => { const b = await (await fetch('/api/bootstrap')).json(); const r = await fetch('/api/folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, parent_id: b.root_id }) }); return (await r.json()).folder.id; }, name);
const fidA = await mkFolder('ปลายทาง A');
const fidB = await mkFolder('ปลายทาง B');
await page.reload();
await page.waitForSelector(`#tree .fnode[data-fid="${fidA}"]`);
const docsBefore = await page.locator('#tbl .tr:not(.head)').count();
console.log('drag hint visible:', await page.locator('.dndhint').isVisible(), '| draggable rows:', await page.locator('#tbl .tr[draggable=true]').count());
const firstTitle = (await page.locator('#tbl .tr:not(.head) .t >> nth=0').textContent()).trim();
await page.locator('#tbl .tr:not(.head) >> nth=0').dragTo(page.locator(`#tree .fnode[data-fid="${fidA}"]`));
await page.waitForSelector('.toast');
console.log('doc drag toast:', await page.locator('.toast').first().textContent());
await page.waitForTimeout(150);
const moved = await page.evaluate(async (t) => (await (await fetch('/api/documents')).json()).documents.find((d) => d.title === t)?.folder_id, firstTitle);
console.log('doc moved to folder A:', moved === fidA);
await shot(page, '18-after-doc-drag');
// ลากโฟลเดอร์ B ไปไว้ใต้ A (มีหน้ายืนยัน)
await page.locator(`#tree .fnode[data-fid="${fidB}"]`).dragTo(page.locator(`#tree .fnode[data-fid="${fidA}"]`));
await page.waitForSelector('dialog');
console.log('folder move confirm:', (await page.textContent('dialog h2')) + ' | ' + (await page.textContent('dialog p, dialog .msg').catch(() => '')).slice(0, 60));
await shot(page, '19-folder-drag-confirm');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
await page.waitForTimeout(300);
const pB = await page.evaluate(async (id) => (await (await fetch('/api/bootstrap')).json()).folders.find((f) => f.id === id)?.parent_id, fidB);
console.log('folder B now under A:', pB === fidA);
// ลากโฟลเดอร์ A ไปไว้ใต้ B (ลูกของตัวเอง) ต้องไม่อนุญาต
await page.locator(`#tree .fnode[data-fid="${fidA}"]`).dragTo(page.locator(`#tree .fnode[data-fid="${fidB}"]`));
await page.waitForTimeout(250);
console.log('no dialog when dropping into own child:', (await page.locator('dialog').count()) === 0);
// ปุ่มย้าย (เมนู) ของเอกสาร + ย้ายโฟลเดอร์จากหัวหน้า
await page.locator('#tbl .tr:not(.head) .iconbtn[title*="ไปโฟลเดอร์อื่น"] >> nth=0').click();
console.log('move dialog options:', await page.locator('#mv-doc option').count());
await page.keyboard.press('Escape');
await page.waitForSelector('dialog', { state: 'detached' });
await page.locator(`#tree .fnode[data-fid="${fidB}"] .fbtn`).click();
await page.click('#mvFolder');
console.log('folder move dialog excludes self:', (await page.locator('#mv-fo option', { hasText: 'ปลายทาง B' }).count()) === 0);
await page.keyboard.press('Escape');

// ---- ปุ่ม < > ปรับความกว้างแผนผังโฟลเดอร์ ----
await page.goto(url + '/');
await page.waitForSelector('#tree .fnode');
const sideW = () => page.evaluate(() => Math.round(document.querySelector('.side').getBoundingClientRect().width));
const w0 = await sideW();
console.log('grip visible, no step buttons:', await page.locator('#szGrip').isVisible(), (await page.locator('#szLess, #szMore').count()) === 0);
const g0 = await page.locator('#szGrip').boundingBox();
await page.mouse.click(g0.x + g0.width / 2, g0.y + g0.height / 2); // คลิกเฉย ๆ ต้องไม่ทำอะไร
console.log('plain click does nothing:', (await sideW()) === w0);
{ // กดค้างที่ปุ่ม < > แล้วลากซ้าย-ขวา
  await page.evaluate(() => localStorage.removeItem('edms.sideWidth'));
  await page.reload(); await page.waitForSelector('#tree .fnode');
  const d0 = await sideW();
  const gb = await page.locator('#szGrip').boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 + 120, gb.y + gb.height / 2, { steps: 8 });
  const dMid = await sideW();
  await page.mouse.up();
  console.log('hold & drag right:', d0, '->', dMid, '| ok:', dMid >= d0 + 100, '| no extra step click:', (await sideW()) === dMid);
  const gb2 = await page.locator('#szGrip').boundingBox();
  await page.mouse.move(gb2.x + gb2.width / 2, gb2.y + gb2.height / 2); await page.mouse.down();
  await page.mouse.move(gb2.x + gb2.width / 2 - 90, gb2.y + gb2.height / 2, { steps: 6 });
  await page.mouse.up();
  const dEnd = await sideW();
  console.log('hold & drag left (shrink):', dMid, '->', dEnd);
  await page.mouse.move(gb2.x + 15, gb2.y + 15);
  { const g = await page.locator('#szGrip').boundingBox(); await page.mouse.move(g.x + 15, g.y + 15); await page.mouse.down(); await page.mouse.move(g.x - 600, g.y + 15, { steps: 6 }); await page.mouse.up(); }
  console.log('drag to min clamps at 200:', await sideW());
  { const g = await page.locator('#szGrip').boundingBox(); await page.mouse.move(g.x + 15, g.y + 15); await page.mouse.down(); await page.mouse.move(g.x + 900, g.y + 15, { steps: 6 }); await page.mouse.up(); }
  const dMax = await sideW();
  console.log('drag to max clamps (<=560):', dMax);
  await page.focus('#szGrip'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  console.log('keyboard arrows adjust by 16:', dMax - (await sideW()));
  await page.mouse.move(gb2.x + 15, gb2.y + 15);
  await page.evaluate(() => localStorage.removeItem('edms.sideWidth')); await page.reload(); await page.waitForSelector('#tree .fnode');
  { const g = await page.locator('#szGrip').boundingBox(); await page.mouse.move(g.x + 15, g.y + 15); await page.mouse.down(); await page.mouse.move(g.x + 15 + 60, g.y + 15, { steps: 6 }); await page.mouse.up(); }
  const dEnd2 = await sideW();
  await page.reload(); await page.waitForSelector('#tree .fnode');
  await page.reload(); await page.waitForSelector('#tree .fnode');
  console.log('dragged width persisted:', (await sideW()) === dEnd2);
  await page.evaluate(() => localStorage.removeItem('edms.sideWidth'));
  await page.reload(); await page.waitForSelector('#tree .fnode');
}
console.log('buttons in viewport:', await page.evaluate(() => { const r = document.getElementById('szGrip').getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight; }));
await page.evaluate(() => localStorage.removeItem('edms.sideWidth'));
await page.reload();
await page.waitForSelector('#tree .fnode');

// ---- จัดลำดับเอง: โฟลเดอร์ (ลากที่ขอบ + ปุ่มขึ้น/ลง) และเอกสาร (โหมดลำดับที่กำหนดเอง) ----
await page.goto(url + '/');
await page.waitForSelector('#tree .fnode');
const fidC = await mkFolder('ลำดับ C');
const fidD = await mkFolder('ลำดับ D');
await page.reload();
await page.waitForSelector(`#tree .fnode[data-fid="${fidD}"]`);
const treeBefore = await page.locator('#tree .fnode').evaluateAll((els) => els.map((e) => e.dataset.fid));
console.log('tree order C before D:', treeBefore.indexOf(fidC) < treeBefore.indexOf(fidD));
await page.locator(`#tree .fnode[data-fid="${fidD}"]`).dragTo(page.locator(`#tree .fnode[data-fid="${fidC}"]`), { targetPosition: { x: 40, y: 2 } });
await page.waitForSelector('.toast');
await page.waitForTimeout(300);
const treeAfter = await page.locator('#tree .fnode').evaluateAll((els) => els.map((e) => e.dataset.fid));
console.log('drag to top edge: D now before C:', treeAfter.indexOf(fidD) < treeAfter.indexOf(fidC), '| dialog opened (should be false):', (await page.locator('dialog').count()) > 0);
await shot(page, '20-folder-reorder');
await page.locator(`#tree .fnode[data-fid="${fidD}"] .fbtn`).click();
const upDis = await page.locator('#upFolder').isDisabled();
await page.click('#dnFolder');
await page.waitForTimeout(400);
const treeAfter2 = await page.locator('#tree .fnode').evaluateAll((els) => els.map((e) => e.dataset.fid));
console.log('down button: D after C again:', treeAfter2.indexOf(fidD) > treeAfter2.indexOf(fidC), '| up disabled before:', upDis);
await page.reload();
await page.waitForSelector(`#tree .fnode[data-fid="${fidD}"]`);
const treeAfter3 = await page.locator('#tree .fnode').evaluateAll((els) => els.map((e) => e.dataset.fid));
console.log('order persisted after reload:', treeAfter3.indexOf(fidD) > treeAfter3.indexOf(fidC));
// เอกสาร: ย้ายเอกสาร 2 ไฟล์เข้าโฟลเดอร์ C แล้วเรียงแบบกำหนดเอง
await page.evaluate(async (fid) => { const d = (await (await fetch('/api/documents')).json()).documents.slice(0, 2); for (const x of d) await fetch(`/api/documents/${x.id}/move`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder_id: fid }) }); }, fidC);
await page.reload();
await page.waitForSelector(`#tree .fnode[data-fid="${fidC}"]`);
await page.locator(`#tree .fnode[data-fid="${fidC}"] .fbtn`).click();
await page.selectOption('#f-sort', 'manual');
await page.waitForSelector('#tbl .tr:not(.head)');
const titles = () => page.locator('#tbl .tr:not(.head) .t').allTextContents();
const t0 = await titles();
console.log('manual mode rows:', t0.length, '| row arrows:', await page.locator('#tbl .tr:not(.head) .iconbtn[title^="เลื่อน"]').count(), '| hint:', await page.locator('.dndhint').textContent());
await page.locator('#tbl .tr:not(.head) >> nth=1').dragTo(page.locator('#tbl .tr:not(.head) >> nth=0'), { targetPosition: { x: 200, y: 3 } });
await page.waitForTimeout(500);
const t1 = await titles();
console.log('doc reordered by drag (swapped):', t1[0] === t0[1] && t1[1] === t0[0]);
await page.locator('#tbl .tr:not(.head) .iconbtn[title^="เลื่อน"][title$="ลง"] >> nth=0').click();
await page.waitForTimeout(400);
const t2 = await titles();
console.log('doc down button (swapped back):', t2[0] === t0[0] && t2[1] === t0[1]);
await shot(page, '21-doc-reorder');
await page.reload();
await page.waitForSelector('#tbl .tr:not(.head)');
await page.selectOption('#f-sort', 'manual');
console.log('doc order persisted after reload:', JSON.stringify(await titles()) === JSON.stringify(t2));
await page.selectOption('#f-sort', 'new');

// ---- แก้ชื่อ/ลบ ไฟล์และโฟลเดอร์ จากหน้าคลัง (เดสก์ท็อป) ----
await page.goto(url + '/');
await page.waitForSelector('#tbl .tr:not(.head)');
const before = await page.locator('#tbl .tr:not(.head)').count();
await page.locator('#tbl .tr:not(.head) .iconbtn[title^="เปลี่ยนชื่อไฟล์"] >> nth=0').click(); // เปลี่ยนชื่อไฟล์แถวแรก
await page.fill('#ask-in', 'ชื่อที่เปลี่ยนจากหน้ารายการ');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
console.log('renamed row:', await page.locator('#tbl .tr:not(.head) .nm .t', { hasText: 'ชื่อที่เปลี่ยนจากหน้ารายการ' }).count());
await shot(page, '14-library-actions');
await page.locator('#tbl .tr:not(.head) .iconbtn.danger >> nth=0').click(); // ลบแถวแรก
await shot(page, '15-delete-confirm');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
console.log('rows before/after delete:', before, await page.locator('#tbl .tr:not(.head)').count());
// โฟลเดอร์: สร้าง → เปลี่ยนชื่อ → ลบ จากหัวหน้าคลัง
await page.click('#newFolder');
await page.fill('dialog input', 'โฟลเดอร์ทดสอบลบ');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
await page.click('#renFolder');
await page.fill('#ask-in', 'โฟลเดอร์ชื่อใหม่');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
console.log('folder renamed h1:', await page.textContent('#h1'));
await page.click('#delFolder');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
console.log('after folder delete h1:', await page.textContent('#h1'), '| in tree:', await page.locator('#tree .fbtn', { hasText: 'โฟลเดอร์ชื่อใหม่' }).count());

console.log('\nปัญหาในคอนโซล:', problems.length ? '\n' + problems.join('\n') : 'ไม่มี');
await browser.close();
server.close();
