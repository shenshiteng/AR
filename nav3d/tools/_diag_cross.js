#!/usr/bin/env node
/* 临时诊断：打印 5F→2F / 2F→5F 的完整规划细节（每一段、每一跳、长度） */
'use strict';
var path = require('path'), fs = require('fs'), http = require('http'), url = require('url');
var chromium = require('playwright-core').chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var nav = path.join(__dirname, '..'), root = path.join(nav, '..');
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
  var srv = await serve(root, 8097);
  var browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox'] });
  try {
    var page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto('http://localhost:8097/nav3d/_dev.html?noauto=1', { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction('window.__NAV__ && window.__NAV__.planSummary', null, { timeout: 15000 });

    var out = await page.evaluate(function () {
      function dump(from, to, room) {
        window.__NAV__.switchFloor(from);
        var p = window.__NAV__.planNow ? null : null;
        var r = window.__NAV__.plan(to, room);
        if (!r) return { from: from, to: to, room: room, err: 'null' };
        var legs = r.legs.map(function (L) {
          if (L.kind === 'stair') return 'STAIR ' + (L.stair ? L.stair.id : '?') + ' ' + L.fid + '->' + L.toFid +
            ' ' + Math.round(L.meters) + 'm';
          return 'walk ' + L.fid + ' ' + Math.round(L.meters) + 'm (' + L.pts.length + ' pts)';
        });
        return { from: from, to: to, room: room, meters: Math.round(r.meters),
                 floors: r.floors, legs: legs };
      }
      return [dump('B2-5', 'B2-2', '201'), dump('B2-2', 'B2-5', '501'),
              dump('B2-5', 'B2-3', '318'), dump('B2-3', 'B2-5', '501')];
    });
    out.forEach(function (o) {
      console.log('\n=== ' + o.from + ' -> ' + o.to + ' 「' + o.room + '」  ' + o.meters + 'm  ' +
                  (o.floors || []).join('→'));
      (o.legs || []).forEach(function (l) { console.log('   ' + l); });
    });
  } finally { await browser.close(); srv.close(); }
})().catch(function (e) { console.error('失败：', e && e.stack || e); process.exit(1); });
