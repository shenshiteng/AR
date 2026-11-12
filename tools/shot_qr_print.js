#!/usr/bin/env node
/* =========================================================================
   tools/shot_qr_print.js —— 把 qr_final/print.html 打成图片，核对 A4 版面
   -------------------------------------------------------------------------
   用法：
     node tools/shot_qr_print.js                    # 截前 2 页（第 1 页全尺寸 + 第 2 页缩略）
     node tools/shot_qr_print.js --page 6           # 只截第 6 页
     node tools/shot_qr_print.js --all              # 12 页全截（慢）

   产物：qr_final/_print_p1.png / _print_p2.png …
   依赖：playwright-core + 系统 Chrome。
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var chromium = require('playwright-core').chromium;

var ROOT = path.join(__dirname, '..');
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var MM = 96 / 25.4;   // 1mm ≈ 3.7795 CSS px

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}
var all = process.argv.indexOf('--all') > -1;
var only = arg('page', null);

(async function () {
  var file = 'file:///' + path.join(ROOT, 'qr_final', 'print.html').replace(/\\/g, '/');
  if (!fs.existsSync(path.join(ROOT, 'qr_final', 'print.html'))) {
    throw new Error('先跑 python tools/make_final_qr.py 生成 print.html');
  }
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox',
           '--force-device-scale-factor=1']
  });
  try {
    var page = await browser.newPage({
      viewport: { width: Math.round(210 * MM), height: Math.round(297 * MM) },
      deviceScaleFactor: 1.5
    });
    await page.goto(file, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(600);

    var n = await page.evaluate(function () { return document.querySelectorAll('.card').length; });
    var overflow = await page.evaluate(function () {
      var bad = [];
      document.querySelectorAll('.card').forEach(function (c, i) {
        if (c.scrollHeight > c.clientHeight + 2) {
          bad.push({ page: i + 1, scroll: c.scrollHeight, client: c.clientHeight });
        }
      });
      return bad;
    });
    console.log('共 ' + n + ' 页');
    if (overflow.length) {
      console.log('❌ 有页面内容溢出（打印会被裁掉）：');
      overflow.forEach(function (o) {
        console.log('   第 ' + o.page + ' 页 内容高 ' + o.scroll + 'px > 版面 ' + o.client + 'px');
      });
    } else {
      console.log('✅ 12 页都没有溢出（内容都装得进 297mm 版面）');
    }

    var shots = only ? [+only] : (all ? Array.from({ length: n }, function (_, i) { return i + 1; })
                                     : [1, 2]);
    for (var k = 0; k < shots.length; k++) {
      var idx = shots[k];
      var el = page.locator('.card').nth(idx - 1);
      var out = path.join(ROOT, 'qr_final', '_print_p' + idx + '.png');
      await el.screenshot({ path: out });
      console.log('已保存 ' + path.relative(ROOT, out));
    }
    if (overflow.length) process.exit(1);
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error('失败：', e && e.message); process.exit(1); });
