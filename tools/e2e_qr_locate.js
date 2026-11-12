#!/usr/bin/env node
/* =========================================================================
   tools/e2e_qr_locate.js —— 端到端实测：扫这 12 张码真的能定位到对应楼梯口吗
   -------------------------------------------------------------------------
   把 qr_final/spec.json 里每个点位 URL 在无头 Chrome 里逐一打开，读页面上的
   「已定位」结果（#arLocMain 的文本 + window.__FP__.getState() 的楼层与坐标），
   与 data/labs.js 里该点位的 place / floor / node 逐条比对。

   用法：
     node tools/e2e_qr_locate.js
     node tools/e2e_qr_locate.js --url-base https://...   # 换地址（如本地 file:// 调试）
   依赖：playwright-core + 系统 Chrome。
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var chromium = require('playwright-core').chromium;

var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var ROOT = path.join(__dirname, '..');

function readSpec() {
  var p = path.join(ROOT, 'qr_final', 'spec.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadLocs() {
  // labs.js 是 JSON 穿 JS 马甲
  var raw = fs.readFileSync(path.join(ROOT, 'data', 'labs.js'), 'utf8');
  raw = raw.replace(/^\s*window\.LAB_DATA\s*=\s*/, '').replace(/;\s*$/, '');
  var d = JSON.parse(raw);
  var map = {};
  (d.locations || []).forEach(function (l) { map[l.id] = l; });
  return d;
}

(async function () {
  var spec = readSpec();
  var data = loadLocs();
  var byId = {};
  data.locations.forEach(function (l) { byId[l.id] = l; });

  var browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
           '--no-sandbox', '--disable-gpu-sandbox',
           // 手机上摄像头/定位都要求安全上下文；给个假的授权避免页面卡在权限弹窗
           '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  var fails = [];
  try {
    var page = await browser.newPage({
      viewport: { width: 480, height: 900 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
               + '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44',
      permissions: ['camera', 'geolocation']
    });

    console.log('端到端实测 ' + spec.items.length + ' 个点位（真浏览器打开真链接）');
    console.log('-'.repeat(92));
    console.log(pad('点位', 9) + pad('页面定位结果', 30) + pad('楼层', 6) + pad('节点', 12) + '判定');

    for (var i = 0; i < spec.items.length; i++) {
      var it = spec.items[i];
      var loc = byId[it.id];
      var err = null;
      page.on('pageerror', function (e) { err = err || e.message; });

      var resp = await page.goto(it.url, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(1800);   // 等 doLocate + 切层画完

      var got = await page.evaluate(function () {
        var el = document.getElementById('arLocMain');
        var st = null;
        try { st = window.__FP__ ? window.__FP__.getState() : null; } catch (e) {}
        return {
          text: el ? el.textContent.trim() : null,
          sub: (document.getElementById('arLocSub') || {}).textContent || '',
          floor: st ? st.floorId : null,
          node: st ? st.node : null,
          x: st ? Math.round(st.x) : null,
          y: st ? Math.round(st.y) : null
        };
      }).catch(function (e) { return { error: e.message }; });

      var httpOk = resp && resp.status() === 200;
      var textOk = got && got.text && got.text.indexOf(loc.place) > -1;
      var floorOk = got && got.floor === loc.floor;
      var ok = httpOk && textOk && floorOk && !err;

      var detail = got.error ? ('ERR ' + got.error)
                 : (got.text || '(空)') + (floorOk ? '' : ' [楼层=' + got.floor + ']');

      console.log(pad(it.id, 9) + pad(detail.slice(0, 28), 30)
                  + pad(got.floor || '-', 6) + pad(got.node || '-', 12)
                  + (ok ? '✅' : '❌'));
      if (!ok) {
        fails.push(it.id + '  http=' + (resp && resp.status())
                   + ' 期望地点=' + loc.place + ' 实际=' + got.text
                   + ' 期望楼层=' + loc.floor + ' 实际=' + got.floor
                   + (err ? ' 页面异常=' + err : ''));
      }
      if (i === 0) {
        await page.screenshot({ path: path.join(ROOT, 'qr_final', '_e2e_first.png') });
      }
    }
  } finally {
    await browser.close();
  }

  console.log('-'.repeat(92));
  if (fails.length) {
    console.log('❌ 失败 ' + fails.length + ' 项：');
    fails.forEach(function (f) { console.log('   ' + f); });
    process.exit(1);
  }
  console.log('✅ 12/12：每个链接都打开成功、页面定位结果与该点位一致、楼层切换正确');

  function pad(s, n) {
    s = String(s === null || s === undefined ? '' : s);
    var w = 0;
    for (var k = 0; k < s.length; k++) w += s.charCodeAt(k) > 255 ? 2 : 1;
    var out = s;
    while (w < n) { out += ' '; w++; }
    return out;
  }
})().catch(function (e) { console.error('失败：', e && e.message); process.exit(1); });
