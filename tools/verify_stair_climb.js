#!/usr/bin/env node
/* tools/verify_stair_climb.js —— 一键验收「5 个楼梯口都能真实走双跑楼梯到上一层」
   每个楼梯口的验收口径（双跑折返楼梯，不是瞬移、不是单跑）：
     第一跑升到中间平台（≈半层高 1.50）→ 平台转弯换跑道 → 第二跑升到上一层地面（≈层高 3.00）→ 跨层
   实现方式：直接驱动页面里的自动巡航（与真人按「走」完全同一条物理链路），
            逐个楼梯口出发，检查 window.__lastStairCross 记录的换层高度。
   用法：先起 python -m http.server 8000，再
        NODE_PATH=<playwright-core 所在> node tools/verify_stair_climb.js
   可选：node tools/verify_stair_climb.js 333   指定目的房间（默认 333） */
'use strict';
var chromium = require('playwright-core').chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var TARGET = process.argv[2] || '333';
var STARTS = ['B2-2/n1', 'B2-2/n3', 'B2-2/n12', 'B2-2/n21', 'B2-2/n29'];
var FLOOR_H = 3.0;

(async function () {
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox',
           '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
           '--disable-backgrounding-occluded-windows']
  });
  var allOk = true;
  try {
    for (var k = 0; k < STARTS.length; k++) {
      var start = STARTS[k];
      var page = await browser.newPage({ viewport: { width: 960, height: 600 } });
      var errs = [];
      page.on('pageerror', function (e) { errs.push(e.message); });
      await page.goto('http://localhost:8000/fp2.html?floor=B2-2', { waitUntil: 'load', timeout: 20000 });
      await page.waitForFunction(function () { return window.__FP__; }, null, { timeout: 15000 });
      await page.evaluate(function (args) {
        window.__FP__.teleportNode(args.n, undefined);
        window.__FP__.route(args.t);
      }, { n: start, t: TARGET });

      var landed = false, cross = null, landingSeen = false, stall = 0, lastPos = '';
      for (var i = 0; i < 1400; i++) {
        var st = await page.evaluate(function () {
          var s = window.__FP__.getState();
          return { x: s.x, y: s.y, z: s.z, floor: s.floorId,
                   note: document.getElementById('spawnNote').textContent,
                   cross: window.__lastStairCross || null };
        });
        if (st.note.indexOf('中间平台') > -1) landingSeen = true;
        if (!cross && st.cross) cross = st.cross;
        if (st.note.indexOf('已到达') > -1) { landed = true; break; }
        var pos = Math.round(st.x) + ',' + Math.round(st.y) + '@' + st.floor;
        if (pos === lastPos) { if (++stall > 150) break; } else { stall = 0; lastPos = pos; }
        await page.waitForTimeout(120);
      }

      var okCross = !!cross && Math.abs(cross.z) >= FLOOR_H - 0.05;   // 必须爬到层高才换层
      var ok = landed && landingSeen && okCross && errs.length === 0;
      if (!ok) allOk = false;
      console.log(start + ' | 平台转弯=' + landingSeen +
        ' 换层高度=' + (cross ? cross.z.toFixed(2) : '-') +
        ' 到达=' + landed + (errs.length ? ' 页面报错=' + errs[0] : '') +
        ' → ' + (ok ? 'OK' : 'FAIL'));
      await page.close();
    }
    console.log('\n结论: ' + (allOk
      ? '5 个楼梯口都能：第一跑→中间平台转弯→第二跑→爬到层高才换层→到达 3 层 ' + TARGET
      : '有楼梯口不达标'));
    await browser.close();
    process.exit(allOk ? 0 : 1);
  } catch (e) {
    console.error('失败：', e && e.message);
    await browser.close();
    process.exit(1);
  }
})();
