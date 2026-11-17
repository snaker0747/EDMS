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
await page.click('#go');
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
await m.page.waitForSelector('#tbl .tr:not(.head)');
await shot(m.page, '10-mobile-library');
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

console.log('\nปัญหาในคอนโซล:', problems.length ? '\n' + problems.join('\n') : 'ไม่มี');
await browser.close();
server.close();
