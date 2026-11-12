/* 观察 #arSim 画布尺寸随时间是否自增（反馈环） */
const { chromium } = require('playwright-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'file:///C:/Users/35391/Desktop/python/%E5%AE%9E%E9%AA%8C%E5%AE%A4%E5%AE%9A%E4%BD%8D/fp-ar.html';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  for (const vp of [{ width: 1440, height: 900, tag: 'desktop' }, { width: 390, height: 844, tag: 'phone' }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { get() { return { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) }; } });
    });
    await page.goto(BASE, { waitUntil: 'load' });
    const seq = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const cv = document.getElementById('arSim');
        return { cssW: Math.round(cv.getBoundingClientRect().width), bufW: cv.width };
      });
      seq.push(r.cssW + '/' + r.bufW);
    }
    console.log(vp.tag + ' canvas cssW/bufW over 1.5s: ' + seq.join('  ->  '));
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
