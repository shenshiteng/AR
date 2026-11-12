#!/usr/bin/env node
/* =========================================================================
   tools/pdf_qr_print.js —— 把 qr_final/print.html 导出成 A4 PDF（12 页，一页一张）
   -------------------------------------------------------------------------
   用法：node tools/pdf_qr_print.js
          node tools/pdf_qr_print.js --out qr_final/定位二维码.pdf
   为什么要 PDF：打印店的电脑不一定装了浏览器能正确渲染，PDF 尺寸写死不会跑版。
   依赖：playwright-core + 系统 Chrome。
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var chromium = require('playwright-core').chromium;

var ROOT = path.join(__dirname, '..');
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

(async function () {
  var src = path.join(ROOT, 'qr_final', 'print.html');
  if (!fs.existsSync(src)) throw new Error('先跑 python tools/make_final_qr.py');
  var out = path.resolve(arg('out', path.join(ROOT, 'qr_final', '定位二维码_A4.pdf')));

  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox']
  });
  try {
    var page = await browser.newPage();
    await page.goto('file:///' + src.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(800);

    await page.pdf({
      path: out,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,   // 让 @page { size: A4; margin: 0 } 说了算，避免被缩放
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    var st = fs.statSync(out);
    var pages = await page.evaluate(function () {
      return document.querySelectorAll('.card').length;
    });
    console.log('已导出 ' + path.relative(ROOT, out) + '  （' + pages + ' 页，'
                + (st.size / 1024).toFixed(0) + ' KB）');
    console.log('打印店直接印这份，选「实际大小 / 100%」，不要选「适应页面」。');
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error('失败：', e && e.message); process.exit(1); });
