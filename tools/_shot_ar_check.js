/* 一次性截图脚本：打开 AR 导航页，抓控制台错误 + 截图，验证现状 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.workbuddy', 'ar_check');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => logs.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

  const urls = process.argv.slice(2);
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    logs.push('=== OPEN ' + u);
    await page.goto(u, { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    const name = 'shot' + i + '.png';
    await page.screenshot({ path: path.join(OUT, name) });
    const info = await page.evaluate(() => {
      const g = id => { const el = document.getElementById(id); return el ? (el.textContent || '').trim() : null; };
      return {
        title: document.title,
        hasFP: !!window.__FP__,
        hasAR: !!window.__AR__,
        floor: window.__FP__ ? window.__FP__.getFloor() : null,
        state: window.__FP__ ? window.__FP__.getState() : null,
        arAction: g('arAction'), arHint: g('arHint'), arDetail: g('arDetail'),
        locMain: g('arLocMain'), locSub: g('arLocSub'),
        mode: g('arMode'), spawnNote: g('spawnNote'),
        hudPos: g('hudPos'), hudTheta: g('hudTheta'), hudNode: g('hudNode'),
        walked: g('arWalked'), left: g('arLeft'), step: g('arStep'),
        warn: g('arWarn'),
        bodyText: document.body.innerText.slice(0, 400)
      };
    });
    logs.push('--- INFO ' + name + ' ' + JSON.stringify(info, null, 1));
  }
  await browser.close();
  console.log(logs.join('\n'));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
