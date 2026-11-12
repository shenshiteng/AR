#!/usr/bin/env node
/* 临时诊断：某房间的门到底通不通 */
'use strict';
var path = require('path'), fs = require('fs'), http = require('http'), url = require('url');
var chromium = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core')).chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var ROOT = path.join(__dirname, '..', '..');
var PORT = 8094;
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
var IDS = (process.argv[3] || '405,422,426,411').split(',');
(async function () {
  var srv = await serve(ROOT, PORT);
  var browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'] });
  try {
    var page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto('http://localhost:' + PORT + '/nav3d/walk.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    var out = await page.evaluate(function (arg) {
      var W = window.__WALK__;
      W.setFloor(arg.floor, false);
      var F = W.floors[arg.floor], ppm = F.pxPerMeter, ox = F.originPx[0], oy = F.originPx[1];
      function mx(v) { return (v - ox) / ppm; }
      function mz(v) { return (v - oy) / ppm; }
      var res = [];
      arg.ids.forEach(function (id) {
        var r = null;
        for (var i = 0; i < F.rooms.length; i++) if (F.rooms[i].id === id) r = F.rooms[i];
        if (!r) { res.push(id + ' no room'); return; }
        var x1 = mx(r.x1), x2 = mx(r.x2), z1 = mz(r.y1), z2 = mz(r.y2);
        var t = (r.doorT === undefined || r.doorT === null) ? 0.5 : r.doorT;
        var dx = mx(r.x1 + (r.x2 - r.x1) * t), dz = mz(r.y1 + (r.y2 - r.y1) * t);
        var k = r.door;
        var oz = (k === 'N') ? z1 - 0.7 : (k === 'S') ? z2 + 0.7 : dz;
        var ox2 = (k === 'W') ? x1 - 0.7 : (k === 'E') ? x2 + 0.7 : dx;
        res.push('=== ' + id + ' door=' + k + ' x' + x1.toFixed(2) + '..' + x2.toFixed(2) +
                 ' z' + z1.toFixed(2) + '..' + z2.toFixed(2) +
                 ' doorPt(' + dx.toFixed(2) + ',' + dz.toFixed(2) + ') out(' + ox2.toFixed(2) + ',' + oz.toFixed(2) + ')');
        res.push('  outFree=' + W.free(ox2, oz) + ' doorFree=' + W.free(dx, dz) +
                 ' centerFree=' + W.free((x1 + x2) / 2, (z1 + z2) / 2));
        res.push('  blockers@door: ' + JSON.stringify(W.blockers(dx, dz)));
        W.teleport(ox2, oz, k === 'N' ? 0 : k === 'S' ? Math.PI : k === 'W' ? -Math.PI / 2 : Math.PI / 2);
        res.push('  start ' + W.state.x.toFixed(2) + ',' + W.state.z.toFixed(2) + ' room=' + W.state.room);
        for (var s = 0; s < 50; s++) W.step({ fwd: true }, 0.05);
        res.push('  after ' + W.state.x.toFixed(2) + ',' + W.state.z.toFixed(2) + ' room=' + W.state.room);
      });
      return res.join('\n');
    }, { floor: FLOOR, ids: IDS });
    console.log(out);
  } finally { await browser.close(); srv.close(); }
})().catch(function (e) { console.error(e); process.exit(1); });
