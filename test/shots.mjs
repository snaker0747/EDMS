// แคปหน้าหลัก ๆ ที่ขนาดมือถือ/แท็บเล็ต เพื่อตรวจ responsive (ไม่ใช่ชุดทดสอบถูก/ผิด)
import { createRequire } from 'node:module';
import { start } from './dev-server.mjs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const { server, url } = await start(8787);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const sizes = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, tabP: { width: 820, height: 1180, isMobile: true, hasTouch: true }, tabL: { width: 1180, height: 820, isMobile: true, hasTouch: true } };
const only = process.argv[2];
for (const [name, vp] of Object.entries(sizes)) {
  if (only && only !== name) continue;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1, locale: 'th-TH' });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url + '/login.html');
  await page.fill('#u', 'admin'); await page.fill('#p', 'Passw0rd!x'); await page.click('#go');
  await page.waitForURL(/dashboard/); await page.waitForSelector('#kpis .kpi'); await page.waitForTimeout(700);
  const pages = { dash: '/dashboard.html', lib: '/', upload: '/upload.html', folders: '/folders.html', users: '/users.html' };
  for (const [k, p] of Object.entries(pages)) {
    await page.goto(url + p); await page.waitForTimeout(900);
    await page.screenshot({ path: `/tmp/shots/r-${name}-${k}.png`, fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    console.log(name, k, 'overflow-x:', overflow);
  }
  await ctx.close();
}
await browser.close(); server.close();
