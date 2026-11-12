#!/usr/bin/env node
/* 跨层导航的三张核对图：3F 出发层 / 5F 目的层 / 左侧跨楼层列表 */
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
  var srv = await serve(root, 8095);
  var browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox'] });
  try {
    var page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    await page.goto('http://localhost:8095/nav3d/_dev.html?noauto=1', { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction('window.__NAV__ && window.__NAV__.planSummary', null, { timeout: 15000 });
    await page.waitForTimeout(500);

    // 3F 出发 → 5F 501
    await page.evaluate(function () { window.__NAV__.navigate('501'); });
    await page.waitForTimeout(300);
    await page.evaluate(function () { window.__NAV__.switchFloor('B2-3'); });
    await page.waitForTimeout(700);
    fs.writeFileSync(path.join(nav, '_cross_from3f.png'), await page.screenshot({ type: 'png' }));
    console.log('3F 出发层已保存');

    // 2F 出发 → 5F（跨两层）
    await page.evaluate(function () { window.__NAV__.switchFloor('B2-2'); });
    await page.waitForTimeout(400);
    await page.evaluate(function () { window.__NAV__.navigate('501'); });
    await page.waitForTimeout(900);
    fs.writeFileSync(path.join(nav, '_cross_2f_to_5f.png'), await page.screenshot({ type: 'png' }));
    var s = await page.evaluate(function () {
      return { cur: window.__NAV__.floor(),
               steps: document.getElementById('steps').textContent.replace(/\s+/g, ' ').slice(0, 300) };
    });
    console.log('2F→5F 当前层=' + s.cur);
    console.log('指引: ' + s.steps);

    // 左侧列表整体（跨楼层）
    await page.screenshot({ path: path.join(nav, '_cross_list.png'), clip: { x: 0, y: 0, width: 235, height: 860 } });
    console.log('列表已保存');
  } finally { await browser.close(); srv.close(); }
})().catch(function (e) { console.error('失败：', e && e.stack || e); process.exit(1); });
