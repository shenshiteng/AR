#!/usr/bin/env node
/* =========================================================================
   tools/shot_floor.js —— 无头 Chrome 截取俯视总览（#ovWrap）大图
   -------------------------------------------------------------------------
   用法：node tools/shot_floor.js <楼层ID> [输出PNG路径]
   例：  node tools/shot_floor.js B2-3 .workbuddy/shot_B2-3.png
   依赖：playwright-core + 系统 Chrome + 本地 http 服务(8000)。
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var chromium = require('playwright-core').chromium;

var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var root = path.join(__dirname, '..');
var floor = process.argv[2] || 'B2-3';
var out = process.argv[3] || path.join(root, '.workbuddy', 'shot_' + floor + '.png');

(async function () {
  var browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
  });
  try {
    var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('http://localhost:8088/fp.html?floor=' + encodeURIComponent(floor), { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(function () { return window.__FP__ && window.__FP__.world; }, null, { timeout: 15000 });
    await page.waitForTimeout(600);

    // 截取俯视总览（含房间编号 + 房名映射可对照）
    var buf = await page.locator('#ovWrap').screenshot({ type: 'png' });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    console.log('已保存：' + out + '（' + buf.length + ' 字节）');
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error('截图失败：', e && e.message); process.exit(1); });
