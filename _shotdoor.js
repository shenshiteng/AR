'use strict';
var chromium = require('playwright-core').chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async function () {
  var browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
           '--no-sandbox', '--disable-gpu-sandbox']
  });
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  var errs = [];
  page.on('pageerror', function (e) { errs.push(e.message); });
  await page.goto('http://127.0.0.1:8000/nav3d/index.html?noauto=1&floor=B2-1&polar=52&zoom=2.2&focus=101',
                  { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'C:/Users/35391/Desktop/python/实验室定位/nav3d/_1f_door101.png' });

  // 统计场景里有多少个"门扇"对象（doorLeaf 用的是薄板 + 深色）
  var info = await page.evaluate(function () {
    if (!window.__NAV__) return { nav: false };
    var out = { nav: true, keys: Object.keys(window.__NAV__) };
    return out;
  });
  console.log(JSON.stringify({ info: info, errs: errs.slice(0, 4) }, null, 1));
  await browser.close();
})().catch(function (e) { console.error('ERR ' + e.message); process.exit(1); });
