/* 量手机端布局：顶栏高度、左右分栏宽度、横向溢出、模拟画布尺寸 */
const { chromium } = require('playwright-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'file:///C:/Users/35391/Desktop/python/%E5%AE%9E%E9%AA%8C%E5%AE%A4%E5%AE%9A%E4%BD%8D/fp-ar.html';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const sizes = [{ w: 390, h: 844, tag: 'iphone' }, { w: 360, h: 740, tag: 'android' }, { w: 768, h: 1024, tag: 'tablet' }];
  for (const s of sizes) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { get() { return { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) }; } });
    });
    await page.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.fill('#destInput', '324');
    await page.evaluate(() => document.getElementById('btnGo').click());
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const box = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      const cv = document.getElementById('arSim');
      return {
        header: box(document.querySelector('header')),
        arWrap: box(document.getElementById('arWrap')),
        ovWrap: box(document.getElementById('ovWrap')),
        footer: box(document.querySelector('footer')),
        arSim: box(cv), arSimBuf: { w: cv.width, h: cv.height },
        arHud: box(document.getElementById('arHud')),
        track: box(document.getElementById('arTrack')),
        arrow: box(document.getElementById('arArrow')),
        actionFont: getComputedStyle(document.getElementById('arAction')).fontSize,
        scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
        scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight,
        headerChildren: Array.from(document.querySelector('header').children).map(c => c.id || c.className || c.tagName)
      };
    });
    console.log('### ' + s.tag + ' ' + JSON.stringify(r));
    await page.screenshot({ path: path.join(path.resolve(__dirname, '..'), '.workbuddy', 'ar_check', 'v_' + s.tag + '.png') });
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
