#!/usr/bin/env node
/* =========================================================================
   nav3d/tools/shot_nav3d.js —— 无头 Chrome 截 nav3d 三维沙盘 + 抓自检结果
   -------------------------------------------------------------------------
   用法：
     node nav3d/tools/shot_nav3d.js "B2-5" out.png [额外查询串]
   例：
     node nav3d/tools/shot_nav3d.js B2-5 nav3d/shot-3d-5f.png "noauto=1&selftest=1"
   依赖：playwright-core + 系统 Chrome；本脚本自己起 http 服务（端口 8091）。
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var http = require('http');
var url = require('url');
var chromium = require('playwright-core').chromium;

var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var root = path.join(__dirname, '..');            // nav3d/
var session = path.join(root, '..');              // 会话根（playwright-core 在上一级 node_modules）

var floor = process.argv[2] || 'B2-5';
var out = path.resolve(process.argv[3] || path.join(root, 'shot-3d.png'));
var extra = process.argv[4] || 'noauto=1';

var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serve(dir, port) {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rq) {
      var p = decodeURIComponent(url.parse(req.url).pathname);
      var f = path.join(dir, p === '/' ? '/index.html' : p);
      if (f.indexOf(dir) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rq.writeHead(404); rq.end('no'); return;
      }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(port, function () { res(s); });
  });
}

(async function () {
  var srv = await serve(root, 8091);
  var browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
  });
  try {
    var page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    var link = 'http://localhost:8091/index.html?floor=' + encodeURIComponent(floor) + '&' + extra;
    await page.goto(link, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);

    // 自检结论（页面把坏房间写进 [data-bad] / #selftest）
    var bad = await page.evaluate(function () {
      var d = document.querySelector('[data-bad]');
      var st = document.getElementById('selftest');
      return { bad: d ? d.getAttribute('data-bad') : null, text: st ? st.textContent.slice(0, 600) : null };
    });
    console.log('URL: ' + link);
    console.log('data-bad = ' + JSON.stringify(bad.bad));
    if (bad.text) console.log('selftest  = ' + bad.text.replace(/\s+/g, ' '));

    var buf = await page.screenshot({ type: 'png' });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    console.log('已保存：' + out + '（' + buf.length + ' 字节）');
  } finally {
    await browser.close();
    srv.close();
  }
})().catch(function (e) { console.error('失败：', e && e.message); process.exit(1); });
