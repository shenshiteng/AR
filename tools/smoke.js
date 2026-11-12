#!/usr/bin/env node
/* =========================================================================
   tools/smoke.js —— 全站冒烟体检（无头 Chrome，一次跑完所有入口）
   -------------------------------------------------------------------------
   用法：
     node tools/smoke.js            # 跑默认页面清单
     node tools/smoke.js --verbose  # 额外打印每个页面的首段文字

   它做什么：
     1) 自己起一个 http 服务（端口 8095），把项目根当站点根；
     2) 逐个打开清单里的页面，等 900ms 让脚本跑完；
     3) 收集三类问题：页面 JS 异常（pageerror）、console.error、HTTP >= 400；
     4) 汇总打印 [OK] / [ERR]，有 ERR 时退出码为 1（可接 CI / 批处理）。

   注意：
     - index.html 会主动跳转到 fp-ar.html，这不算错误，报告里会显示最终 URL；
     - favicon.ico 的 404 已内置忽略（浏览器自动请求，项目本来就没放图标）；
     - 依赖 playwright-core（会话根 node_modules）+ 系统 Chrome。
   ========================================================================= */
'use strict';

var path = require('path');
var http = require('http');
var fs = require('fs');
var url = require('url');

var ROOT = path.join(__dirname, '..');
var chromium = require(path.join(ROOT, 'node_modules', 'playwright-core')).chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var PORT = 8095;
var VERBOSE = process.argv.indexOf('--verbose') > -1;

/* 要体检的入口。加新页面就往这里加一行。 */
var PAGES = [
  'index.html',                          /* 会跳 fp-ar.html */
  'index.html?map=1',                    /* 总览地图页（不跳转） */
  'index.html?loc=P-B2-01',
  'ar.html',
  'fp.html',
  'fp2.html',
  'fp-ar.html',
  'fp-ar.html?loc=P-B2-06',              /* 跨层定位（5 层） */
  'tools/import.html',
  'tools/marker.html',
  'tools/aruco-print.html',
  'aruco/print.html',
  'qr/print.html',
  'nav3d/index.html',
  'nav3d/index.html?floor=B2-2',
  'nav3d/index.html?floor=B2-5&noauto=1&selftest=1'
];

var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function serve(dir, port) {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rq) {
      var p = decodeURIComponent(url.parse(req.url).pathname);
      /* 浏览器会自动来要图标，项目本来就没放；给个 204 别让 404 混进体检结果。
         真正缺资源（图片/脚本）仍然会照常报 404。 */
      if (p === '/favicon.ico') { rq.writeHead(204); rq.end(); return; }
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

(async function () {
  var srv = await serve(ROOT, PORT);
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
           '--no-sandbox', '--disable-gpu-sandbox']
  });
  var okCount = 0, errCount = 0;
  try {
    var page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i], errs = [], httpBad = [];
      page.removeAllListeners('pageerror');
      page.removeAllListeners('console');
      page.removeAllListeners('response');
      page.on('pageerror', function (e) { errs.push('异常: ' + String(e).slice(0, 120)); });
      page.on('console', function (m) {
        if (m.type() === 'error') {
          var t = m.text();
          if (t.indexOf('favicon') > -1) return;
          errs.push('console: ' + t.slice(0, 120));
        }
      });
      page.on('response', function (r) {
        if (r.status() >= 400 && r.url().indexOf('favicon') < 0) {
          httpBad.push(r.status() + ' ' + r.url().split('/').slice(-2).join('/'));
        }
      });

      var loaded = true;
      try {
        await page.goto('http://localhost:' + PORT + '/' + p, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(900);
      } catch (e) {
        loaded = false;
        errs.push('打开超时/失败: ' + String(e.message).slice(0, 100));
      }

      var txt = '';
      try {
        txt = await page.evaluate(function () {
          return (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70);
        });
      } catch (e) { /* 页面已经跳走时可能取不到 */ }

      var good = loaded && !errs.length && !httpBad.length;
      if (good) okCount++; else errCount++;
      console.log((good ? '[OK]  ' : '[ERR] ') + p +
        (good ? '' : '\n        原因: ' + errs.concat(httpBad).join(' | ')));
      if (!good || VERBOSE) console.log('        文字: ' + (txt || '(空)'));
      if (p.indexOf('index.html') === 0) console.log('        最终URL: ' + page.url());
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('\n========================================');
  console.log('体检 ' + PAGES.length + ' 个页面：通过 ' + okCount + '，异常 ' + errCount);
  console.log(errCount === 0 ? '★ 全部通过' : '✗ 有页面不正常，见上面 [ERR] 项');
  process.exit(errCount === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('体检脚本自身出错：', e && e.message);
  process.exit(1);
});
