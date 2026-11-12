/* 验证「边走边更新」：键盘前进是否推进里程、+5 米按钮是否生效、箭头是否跟着变 */
const { chromium } = require('playwright-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.workbuddy', 'ar_check');
const BASE = 'file:///C:/Users/35391/Desktop/python/%E5%AE%9E%E9%AA%8C%E5%AE%A4%E5%AE%9A%E4%BD%8D/fp-ar.html';

const read = page => page.evaluate(() => {
  const g = id => (document.getElementById(id) || {}).textContent || '';
  const a = document.getElementById('arArrow');
  const st = window.__FP__ ? window.__FP__.getState() : null;
  return { walked: g('arWalked'), left: g('arLeft'), action: g('arAction'), hint: g('arHint'), step: g('arStep'),
    rot: a ? a.style.transform : '', pos: st ? [Math.round(st.x), Math.round(st.y)] : null, theta: st ? Math.round(st.theta) : null,
    prog: (document.getElementById('arProg') || {}).style ? document.getElementById('arProg').style.width : '' };
});

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { get() { return { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) }; } });
  });
  await page.goto(BASE + '?loc=P-B2-05', { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.fill('#destInput', '324');
  await page.click('#btnGo');
  await page.waitForTimeout(600);
  console.log('T0 ' + JSON.stringify(await read(page)));

  // 点一下 AR 区（把焦点从输入框移开），再按 ↑
  await page.click('#arWrap', { position: { x: 120, y: 300 } });
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(400);
  console.log('T1_walk_up_1.5s ' + JSON.stringify(await read(page)));

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(400);
  console.log('T2_walk_up_1.5s ' + JSON.stringify(await read(page)));

  // 撞墙测试：往右转再走
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2000); await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(300);
  console.log('T3_turn_right_walk ' + JSON.stringify(await read(page)));
  await page.screenshot({ path: path.join(OUT, 'w1_after_walk.png') });

  // 手动修正按钮
  await page.click('#fixPlus'); await page.waitForTimeout(250);
  console.log('T4_fix_plus5 ' + JSON.stringify(await read(page)));
  await page.click('#fixMinus'); await page.waitForTimeout(250);
  console.log('T5_fix_minus5 ' + JSON.stringify(await read(page)));
  await page.screenshot({ path: path.join(OUT, 'w2_after_fix.png') });

  // 到终点附近：狂走
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(900); await page.keyboard.up('ArrowUp');
    const r = await read(page);
    if (/到达/.test(r.action)) { console.log('ARRIVED_AT ' + i + ' ' + JSON.stringify(r)); break; }
    if (i % 4 === 3) console.log('walk' + i + ' ' + JSON.stringify(r));
  }
  console.log('FINAL ' + JSON.stringify(await read(page)));
  await page.screenshot({ path: path.join(OUT, 'w3_end.png') });
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
