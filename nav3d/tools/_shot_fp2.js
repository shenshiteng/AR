#!/usr/bin/env node
/* 临时：确认 fp2.html 能正常渲染并截图 */
'use strict';
var path = require('path'), fs = require('fs'), http = require('http'), url = require('url');
var chromium = require('playwright-core').chromium;
var root = path.join(__dirname, '..', '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
function serve(dir, port) {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rq) {
      var p = decodeURIComponent(url.parse(req.url).pathname);
      var f = path.join(dir, p === '/' ? '/index.html' : p);
      if (f.indexOf(dir) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); rq.end('no'); return; }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(port, function () { res(s); });
  });
}
(async function () {
  var srv = await serve(root, 8099);
  var browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox'] });
  try {
    var page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
    var errs = [];
    page.on('pageerror', function (e) { errs.push(String(e.message).slice(0, 200)); });
    page.on('console', function (m) { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    await page.goto('http://localhost:8099/fp2.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);
    var info = await page.evaluate(function () {
      return {
        note: (document.getElementById('spawnNote') || {}).textContent || '',
        floors: Array.prototype.map.call(document.querySelectorAll('#floorSel option'), function (o) { return o.textContent; }),
        stairs: Array.prototype.map.call(document.querySelectorAll('#stairSel option'), function (o) { return o.value; }).filter(Boolean).length,
        canvas: Array.prototype.map.call(document.querySelectorAll('canvas'), function (c) { return c.width + 'x' + c.height; })
      };
    });
    console.log('提示: ' + info.note);
    console.log('楼层下拉: ' + info.floors.join(' | '));
    console.log('楼梯口选项: ' + info.stairs + ' 个');
    console.log('画布: ' + info.canvas.join(' , '));
    console.log('JS 错误: ' + (errs.length ? errs.join(' | ') : '无'));
    await page.screenshot({ path: path.join(root, '_fp2_now.png') });
    console.log('已截图 _fp2_now.png');
  } finally { await browser.close(); srv.close(); }
})().catch(function (e) { console.error('失败：', e && e.stack || e); process.exit(1); });
