#!/usr/bin/env node
/* =========================================================================
   tools/check_locations.js —— 12 个定位点（二维码/ArUco）全链路验证
   -------------------------------------------------------------------------
   用法：node tools/check_locations.js

   验证什么：
     1) data/labs.js 里每个 location 的 node 都真实存在于对应楼层的 nodes 里；
     2) 打开 fp-ar.html?loc=<点位ID>，页面确实定位到该点位：
        显示"已定位"、楼层自动切对、坐标 = 该节点的 x,y；
     3) 页面没有 JS 异常。

   为什么要这一步：
     ?loc= 是二维码扫进来后的唯一入口（deploy/redirect 与 make_qr.py 都指向它）。
     数据改过节点就很容易悄悄断链，而手机上只会表现为"扫了没反应"，很难查。
   ========================================================================= */
'use strict';

var path = require('path');
var http = require('http');
var fs = require('fs');
var url = require('url');

var ROOT = path.join(__dirname, '..');
var chromium = require(path.join(ROOT, 'node_modules', 'playwright-core')).chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var PORT = 8096;

var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'
};

function serve(dir, port) {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rq) {
      var p = decodeURIComponent(url.parse(req.url).pathname);
      var f = path.resolve(dir, '.' + p.replace(/\//g, '\\'));
      if (f.toLowerCase().indexOf(dir.toLowerCase()) !== 0 ||
          !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rq.writeHead(404); rq.end('not found'); return;
      }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(port, function () { res(s); });
  });
}

/* 用 Node 直接读 labs.js（就是 JSON 穿 JS 马甲） */
function loadLabs() {
  global.window = global;
  require(path.join(ROOT, 'data', 'labs.js'));
  return global.LAB_DATA;
}

(async function () {
  var D = loadLabs();
  var nodeOf = {};
  (D.floors || []).forEach(function (f) {
    (f.nodes || []).forEach(function (n) { nodeOf[f.id + '|' + n.id] = n; });
  });

  /* 第一关：数据自洽 —— location 指向的节点必须真实存在 */
  var dataBad = [];
  (D.locations || []).forEach(function (loc) {
    if (!nodeOf[loc.floor + '|' + loc.node]) {
      dataBad.push(loc.id + ' → ' + loc.node + '（楼层 ' + loc.floor + ' 里没有这个节点）');
    }
  });
  if (dataBad.length) {
    console.log('[数据] ' + dataBad.length + ' 个定位点指向了不存在的节点：');
    dataBad.forEach(function (s) { console.log('   ✗ ' + s); });
  } else {
    console.log('[数据] ' + D.locations.length + ' 个定位点指向的节点全部存在');
  }

  /* 第二关：页面真的能定位过去 */
  var srv = await serve(ROOT, PORT);
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox']
  });
  var pass = 0, fail = 0;
  try {
    var page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    var pageErrs = [];
    page.on('pageerror', function (e) { pageErrs.push(String(e).slice(0, 120)); });

    for (var i = 0; i < D.locations.length; i++) {
      var loc = D.locations[i];
      var want = nodeOf[loc.floor + '|' + loc.node];
      pageErrs.length = 0;
      await page.goto('http://localhost:' + PORT + '/fp-ar.html?loc=' + encodeURIComponent(loc.id),
        { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(800);

      var got = await page.evaluate(function () {
        var t = (document.body.innerText || '').replace(/\s+/g, ' ');
        var m = t.match(/位置\s*(-?\d+)\s*,\s*(-?\d+)/);
        var f = t.match(/最近路点\s*([A-Za-z0-9\-\/]+)/);
        return {
          located: t.indexOf('已定位') > -1,
          x: m ? +m[1] : null, y: m ? +m[2] : null,
          node: f ? f[1] : null
        };
      });

      var posOK = want && got.x === want.x && got.y === want.y;
      var nodeOK = want && got.node === want.id;
      var good = got.located && posOK && nodeOK && !pageErrs.length;
      if (good) pass++; else fail++;
      console.log((good ? '[OK]  ' : '[ERR] ') + loc.id + '  ' + loc.place +
        '  →  楼层 ' + loc.floor + ' · 节点 ' + loc.node +
        (good ? '（' + want.x + ',' + want.y + '）'
              : '\n        页面: 已定位=' + got.located + ' 坐标=' + got.x + ',' + got.y +
                ' 节点=' + got.node + ' 期望坐标=' + (want ? want.x + ',' + want.y : '无') +
                (pageErrs.length ? ' 异常=' + pageErrs.join(';') : '')));
    }
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('\n========================================');
  console.log('定位点验证：通过 ' + pass + '，失败 ' + fail);
  console.log((fail === 0 && dataBad.length === 0) ? '★ 全部通过' : '✗ 有问题，见上面 [ERR] 项');
  process.exit((fail === 0 && dataBad.length === 0) ? 0 : 1);
})().catch(function (e) {
  console.error('脚本自身出错：', e && e.message);
  process.exit(1);
});
