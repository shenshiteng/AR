/* 一次性驱动脚本：模拟"扫码定位 → 选目的地 → 导航 → 走两步"，截图看效果 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.workbuddy', 'ar_check');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const BASE = 'file:///C:/Users/35391/Desktop/python/%E5%AE%9E%E9%AA%8C%E5%AE%A4%E5%AE%9A%E4%BD%8D/fp-ar.html';

const steps = [];
function log(s) { steps.push(s); }

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox', '--allow-file-access-from-files', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  async function snap(page, tag) {
    await page.screenshot({ path: path.join(OUT, tag + '.png') });
    const s = await page.evaluate(() => {
      const g = id => { const el = document.getElementById(id); return el ? (el.textContent || '').trim() : ''; };
      const cv = document.getElementById('arSim');
      const r = cv ? cv.getBoundingClientRect() : null;
      const ov = document.getElementById('ovCanvas');
      return {
        arCv: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
        buf: cv ? { w: cv.width, h: cv.height } : null,
        ovCv: ov ? { w: Math.round(ov.getBoundingClientRect().width), h: Math.round(ov.getBoundingClientRect().height) } : null,
        floor: g('floorSel'), mode: g('arMode'), action: g('arAction'), hint: g('arHint'), detail: g('arDetail'),
        loc: g('arLocMain') + ' / ' + g('arLocSub'), note: g('spawnNote'),
        hud: g('hudPos') + ' ' + g('hudTheta') + ' ' + g('hudNode'),
        walked: g('arWalked'), left: g('arLeft'), step: g('arStep'),
        arrowTransform: (document.getElementById('arArrow') || {}).style ? document.getElementById('arArrow').style.transform : null,
        warn: g('arWarn'), warnVisible: !document.getElementById('arWarn').classList.contains('hidden')
      };
    });
    log('### ' + tag + ' ' + JSON.stringify(s));
  }

  // ---------- 桌面 1440x900 ----------
  let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push('[' + m.type() + '] ' + m.text()); });

  // 1) 扫码链路：?loc=P-B2-05（2 层东南角楼梯口）
  await page.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await snap(page, 'd1_located');

  // 2) 同层导航：201（同层，西南角）
  await page.fill('#destInput', '201');
  await page.click('#btnGo');
  await page.waitForTimeout(900);
  await snap(page, 'd2_nav_samefloor');

  // 3) 走 3 秒（键盘 ↑）
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1200); await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(300);
  await snap(page, 'd3_walk');

  // 4) 跨层导航：324（3 层）
  await page.fill('#destInput', '324');
  await page.click('#btnGo');
  await page.waitForTimeout(900);
  await snap(page, 'd4_nav_crossfloor');

  // 5) 自检
  await page.click('#btnSelfTest');
  await page.waitForTimeout(600);
  await snap(page, 'd5_selftest');
  const report = await page.evaluate(() => {
    const box = document.getElementById('report');
    return Array.from(box.querySelectorAll('div')).map(d => d.textContent);
  });
  log('### selftest ' + JSON.stringify(report));

  // 6) 收外框：楼层标签 & 页脚
  const layout = await page.evaluate(() => ({
    header: document.querySelector('header').getBoundingClientRect().height,
    arWrap: (() => { const r = document.getElementById('arWrap').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    ovWrap: (() => { const r = document.getElementById('ovWrap').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
  }));
  log('### layout ' + JSON.stringify(layout));

  // ---------- 手机 390x844 ----------
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
  await m.waitForTimeout(1400);
  await m.screenshot({ path: path.join(OUT, 'm1_located.png'), fullPage: false });
  await m.fill('#destInput', '324');
  await m.evaluate(() => document.getElementById('btnGo').click());
  await m.waitForTimeout(900);
  await m.screenshot({ path: path.join(OUT, 'm2_nav.png') });
  const ml = await m.evaluate(() => ({
    arWrap: (() => { const r = document.getElementById('arWrap').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    ovWrap: (() => { const r = document.getElementById('ovWrap').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    action: (document.getElementById('arAction') || {}).textContent,
    docH: document.documentElement.scrollHeight, winH: window.innerHeight
  }));
  log('### mobile ' + JSON.stringify(ml));

  await browser.close();
  log('### errors ' + JSON.stringify(errs, null, 1));
  console.log(steps.join('\n'));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
