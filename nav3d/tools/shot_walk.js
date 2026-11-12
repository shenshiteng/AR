#!/usr/bin/env node
/* =========================================================================
   nav3d/tools/shot_walk.js —— 给 walk.html 拍一张指定机位的图（视觉迭代用）
   -------------------------------------------------------------------------
   用法：
     node nav3d/tools/shot_walk.js <floor> <out.png> [px] [py] [yawDeg]
   例：
     node nav3d/tools/shot_walk.js B2-4 _walkshots/a.png 700 1550 90
   px/py 是疏散图上的像素坐标（和 data/floor-*.js 一致），yaw 是角度：
     0=朝北 90=朝东 180=朝南 270=朝西
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var http = require('http');
var url = require('url');
var chromium = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core')).chromium;

var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var ROOT = path.join(__dirname, '..', '..');
var PORT = 8096;

var floor = process.argv[2] || 'B2-4';
var out = path.resolve(process.argv[3] || path.join(__dirname, '..', '_walkshots', 'shot.png'));
var tpx = parseFloat(process.argv[4] || '700');
var tpy = parseFloat(process.argv[5] || '1550');
var yawDeg = parseFloat(process.argv[6] || '90');

var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg' };

function serve(dir, port) {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rq) {
      var p = decodeURIComponent(url.parse(req.url).pathname);
      var f = path.join(dir, p);
      if (f.indexOf(dir) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); rq.end('no'); return; }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(port, function () { res(s); });
  });
}

(async function () {
  var srv = await serve(ROOT, PORT);
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--hide-scrollbars']
  });
  try {
    var page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', function (m) { if (m.type() === 'error') console.log('  console:', m.text()); });
    page.on('pageerror', function (e) { console.log('  pageerror:', e.message); });
    await page.goto('http://localhost:' + PORT + '/nav3d/walk.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200);

    var st = await page.evaluate(function (a) {
      var W = window.__WALK__;
      W.setFloor(a.floor, false);
      var F = W.floors[a.floor], ppm = F.pxPerMeter, ox = F.originPx[0], oy = F.originPx[1];
      var x = (a.px - ox) / ppm, z = (a.py - oy) / ppm;
      W.teleport(x, z, a.yaw * Math.PI / 180);
      return W.state;
    }, { floor: floor, px: tpx, py: tpy, yaw: yawDeg });

    await page.waitForTimeout(700);
    var buf = await page.screenshot({ type: 'png' });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    console.log('已保存 ' + out + '  (' + st.room + '  x=' + st.x.toFixed(1) + ' z=' + st.z.toFixed(1) + ')');
  } finally {
    await browser.close();
    srv.close();
  }
})().catch(function (e) { console.error('失败：', e && e.message); process.exit(1); });
