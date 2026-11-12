/* 检查「无摄像头」时模拟 AR 画布的实际尺寸与绘制情况 */
const { chromium } = require('playwright-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.workbuddy', 'ar_check');
const BASE = 'file:///C:/Users/35391/Desktop/python/%E5%AE%9E%E9%AA%8C%E5%AE%A4%E5%AE%9A%E4%BD%8D/fp-ar.html';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // 干掉摄像头，强制走"模拟 AR"
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { get() { return { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) }; } });
  });
  await page.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const cv = document.getElementById('arSim');
    const r = cv.getBoundingClientRect();
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      buf: { w: cv.width, h: cv.height },
      cls: cv.className,
      display: getComputedStyle(cv).display,
      dpr: window.devicePixelRatio,
      hiddenClass: cv.classList.contains('hidden')
    };
  });
  console.log('SIM ' + JSON.stringify(info));
  await page.screenshot({ path: path.join(OUT, 'x_sim_only.png') });
  // 再点一次"重新定位"触发渲染后复测
  await page.evaluate(() => document.getElementById('btnRescan').click());
  await page.waitForTimeout(1200);
  const info2 = await page.evaluate(() => {
    const cv = document.getElementById('arSim'); const r = cv.getBoundingClientRect();
    return { rect: { w: Math.round(r.width), h: Math.round(r.height) }, buf: { w: cv.width, h: cv.height } };
  });
  console.log('SIM2 ' + JSON.stringify(info2));
  await page.screenshot({ path: path.join(OUT, 'x_sim_after.png') });
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
