/* 验证「模拟 AR 画布不铺满」的成因：给 #arSim 加 width/height:100% 后是否铺满 */
const { chromium } = require('playwright-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.workbuddy', 'ar_show');
const BASE = 'http://127.0.0.1:8000/fp-ar.html';

const denyCam = () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    get() { return { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) }; }
  });
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  // A：现状
  const a = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await a.addInitScript(denyCam);
  await a.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
  await a.waitForTimeout(1500);
  const before = await a.evaluate(() => {
    const c = document.getElementById('arSim'); const r = c.getBoundingClientRect();
    return { css: [Math.round(r.width), Math.round(r.height)], buf: [c.width, c.height],
      wrap: [Math.round(document.getElementById('arWrap').clientWidth), Math.round(document.getElementById('arWrap').clientHeight)],
      cs: (s => ({ w: getComputedStyle(c)[s] }))('width') };
  });
  console.log('BEFORE ' + JSON.stringify(before));
  await a.screenshot({ path: path.join(OUT, 'bug_before.png') });
  await a.close();

  // B：打补丁 width/height 100% 后再看
  const b = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await b.addInitScript(denyCam);
  await b.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '#arSim{width:100%!important;height:100%!important}';
      document.head.appendChild(st);
    });
  });
  await b.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
  await b.waitForTimeout(1500);
  const after = await b.evaluate(() => {
    const c = document.getElementById('arSim'); const r = c.getBoundingClientRect();
    return { css: [Math.round(r.width), Math.round(r.height)], buf: [c.width, c.height] };
  });
  console.log('AFTER_PATCH ' + JSON.stringify(after));
  await b.screenshot({ path: path.join(OUT, 'bug_after.png') });
  await b.close();
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
