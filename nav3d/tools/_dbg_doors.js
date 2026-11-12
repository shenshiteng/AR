#!/usr/bin/env node
/* 临时诊断：报告每个房间的门外落点与可站性 */
'use strict';
var path = require('path'), fs = require('fs'), http = require('http'), url = require('url');
var chromium = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core')).chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var ROOT = path.join(__dirname, '..', '..');
var PORT = 8094;
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
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
var FLOOR = process.argv[2] || 'B2-4';
(async function () {
  var srv = await serve(ROOT, PORT);
  var browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'] });
  try {
    var page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto('http://localhost:' + PORT + '/nav3d/walk.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    var out = await page.evaluate(function (fid) {
      var W = window.__WALK__;
      W.setFloor(fid, false);
      var F = W.floors[fid], ppm = F.pxPerMeter, ox = F.originPx[0], oy = F.originPx[1];
      function mx(v) { return (v - ox) / ppm; }
      function mz(v) { return (v - oy) / ppm; }
      var lines = [];
      F.rooms.forEach(function (r) {
        var x1 = mx(r.x1), x2 = mx(r.x2), z1 = mz(r.y1), z2 = mz(r.y2);
        var t = (r.doorT === undefined || r.doorT === null) ? 0.5 : r.doorT;
        var k = r.door || 'N';
        var along = (k === 'N' || k === 'S') ? (x1 + (x2 - x1) * t) : (z1 + (z2 - z1) * t);
        var dx = (k === 'N' || k === 'S') ? along : ((k === 'W') ? x1 : x2);
        var dz = (k === 'N' || k === 'S') ? ((k === 'N') ? z1 : z2) : along;
        var off = 0.75;
        var ox2 = dx + (k === 'W' ? -off : k === 'E' ? off : 0);
        var oz2 = dz + (k === 'N' ? -off : k === 'S' ? off : 0);
        var outFree = W.free(ox2, oz2);
        var doorFree = W.free(dx, dz);
        if (!outFree || !doorFree) {
          lines.push(r.id + ' [' + (r.kind || '') + '] door=' + k + ' t=' + t +
                     ' outFree=' + outFree + ' doorFree=' + doorFree +
                     ' blockers=' + JSON.stringify(W.blockers(dx, dz)));
        }
      });
      return lines.join('\n') || '(全部门口都可站)';
    }, FLOOR);
    console.log('== ' + FLOOR + ' 门口被挡的 ==');
    console.log(out);
  } finally { await browser.close(); srv.close(); }
})().catch(function (e) { console.error(e); process.exit(1); });
