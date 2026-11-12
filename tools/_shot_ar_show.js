/* 通过本地 8000 服务截 AR 导航页（桌面 + 手机竖屏 + 手机横屏），模拟真机效果 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(path.resolve(__dirname, '..'), '.workbuddy', 'ar_show');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8000/fp-ar.html';

const FAKE_CAM = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', ...FAKE_CAM] });

  // 桌面：扫码定位到 3F 西南楼梯口 → 导航到 3F 324（跨层示例）
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
  await d.waitForTimeout(2200);
  await d.screenshot({ path: path.join(OUT, '1_desktop_located.png') });
  await d.fill('#destInput', '324');
  await d.click('#btnGo');
  await d.waitForTimeout(800);
  await d.evaluate(() => window.__AR__ && window.__AR__.advanceMeters(8));
  await d.waitForTimeout(600);
  await d.screenshot({ path: path.join(OUT, '2_desktop_nav.png') });
  const g = await d.evaluate(() => window.__AR__.guidance());
  console.log('desktop guidance ' + JSON.stringify(g));
  await d.close();

  // 手机竖屏：2F 东南楼梯口 → 201
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await m.goto(BASE + '?loc=P-B2-12', { waitUntil: 'load' });
  await m.waitForTimeout(2200);
  await m.screenshot({ path: path.join(OUT, '3_phone_located.png') });
  await m.fill('#destInput', '201');
  await m.evaluate(() => document.getElementById('btnGo').click());
  await m.waitForTimeout(800);
  await m.evaluate(() => window.__AR__ && window.__AR__.advanceMeters(6));
  await m.waitForTimeout(600);
  await m.screenshot({ path: path.join(OUT, '4_phone_nav.png') });
  const gm = await m.evaluate(() => window.__AR__.guidance());
  console.log('phone guidance ' + JSON.stringify(gm));
  const lay = await m.evaluate(() => {
    const b = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return { header: b(document.querySelector('header')), ar: b(document.getElementById('arWrap')), ov: b(document.getElementById('ovWrap')), footer: b(document.querySelector('footer')) };
  });
  console.log('phone layout ' + JSON.stringify(lay));
  await m.close();

  // 手机横屏：真实用 AR 时的方向
  const l = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await l.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
  await l.waitForTimeout(2000);
  await l.fill('#destInput', '324');
  await l.evaluate(() => document.getElementById('btnGo').click());
  await l.waitForTimeout(700);
  await l.screenshot({ path: path.join(OUT, '5_phone_landscape.png') });
  const ll = await l.evaluate(() => {
    const b = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return { header: b(document.querySelector('header')), ar: b(document.getElementById('arWrap')), ov: b(document.getElementById('ovWrap')), footer: b(document.querySelector('footer')), scrollH: document.documentElement.scrollHeight };
  });
  console.log('landscape layout ' + JSON.stringify(ll));
  await l.close();

  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
