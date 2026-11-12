#!/usr/bin/env node
/* tools/test_cruise_cross.js —— 验证 fp2.html 跨层巡航「真实走双跑楼梯」
   验收点：
   1) 中间平台转弯：出现「到楼梯中间平台，转弯后继续…」提示，且位置横移到折返跑
   2) 爬到上一层地面才换层：换层瞬间的高度必须 ≈ 层高(3.00)，不是半层(1.50)
   3) z 值连续爬升（第一跑 → 平台 → 第二跑），不是瞬移
   4) 最终停在 三层 333 门口，楼层 B2-3
   5) 不黑屏（画布平均亮度 > 8）
   用法：先起 python -m http.server 8000，再 NODE_PATH=<playwright所在> node tools/test_cruise_cross.js
   可选：node tools/test_cruise_cross.js B2-2/n1   指定起点楼梯口节点 */
'use strict';
var chromium = require('playwright-core').chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var startNode = process.argv[2] || null;   // 例如 B2-2/n1（西北楼梯口）
var FLOOR_H = 3.0;

(async function () {
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox',
           '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
           '--disable-backgrounding-occluded-windows']
  });
  try {
    var page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', function (e) { console.log('[pageerror]', e.message); });
    var url = 'http://localhost:8000/fp2.html?floor=B2-2' + (startNode ? '' : '&autowalk=333');
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(function () { return window.__FP__; }, null, { timeout: 15000 });
    if (startNode) {
      await page.evaluate(function (n) { window.__FP__.teleportNode(n, undefined); window.__FP__.route('333'); }, startNode);
    }

    var lastNote = '', stall = 0, lastPos = '', maxZ = 0;
    var crossed = false, prevFloor = 'B2-2', crossZ = null, landingSeen = false;
    for (var i = 0; i < 2000; i++) {
      var st = await page.evaluate(function () {
        var s = window.__FP__.getState();
        var note = document.getElementById('spawnNote').textContent;
        return { x: s.x, y: s.y, z: s.z, floor: s.floorId, note: note,
                 cross: window.__lastStairCross || null };
      });
      var pos = Math.round(st.x) + ',' + Math.round(st.y) + '@' + st.floor;
      if (st.note.indexOf('中间平台') > -1) landingSeen = true;
      if (st.floor !== prevFloor) {
        crossed = true; prevFloor = st.floor;
        // 换层高度：优先用页面里记录的精确快照（逐帧轮询会漏掉换层那一帧的 z）
        crossZ = st.cross ? st.cross.z : maxZ;
        console.log('  ★ 换层：' + st.floor + '，换层时已爬到 z=' + crossZ.toFixed(2)
          + '（层高 ' + FLOOR_H.toFixed(2) + '，半层是 1.50）');
      }
      if (st.z > maxZ) maxZ = st.z;
      if (st.note !== lastNote) { console.log('  [' + i + '] ' + st.note); lastNote = st.note; }
      if (st.note.indexOf('已到达') > -1) {
        console.log('结果：到达时状态 = ' + pos);
        var okFloor = st.floor === 'B2-3';
        var okTop = crossZ !== null && crossZ >= FLOOR_H - 0.05;   // 必须爬到层高才换层
        var okClimb = maxZ > 1.0;                                  // z 连续爬升过
        var okLanding = landingSeen;                                // 中间平台转弯
        console.log(okFloor ? '✓ 楼层正确（三层）' : '✗ 楼层错误：' + st.floor);
        console.log(okLanding ? '✓ 中间平台转弯发生' : '✗ 未在中间平台转弯');
        console.log(okClimb ? '✓ 真实逐级爬升（峰值 z=' + maxZ.toFixed(2) + '）' : '✗ 未见爬升（疑似瞬移）');
        console.log(okTop ? '✓ 爬到上一层地面(z=' + (crossZ === null ? '-' : crossZ.toFixed(2)) + ')才换层' : '✗ 换层过早（z=' + (crossZ === null ? '-' : crossZ.toFixed(2)) + '，应在 ' + (FLOOR_H - 0.05).toFixed(2) + ' 以上）');
        // 黑屏检测
        var bright = await page.evaluate(function () {
          var c = document.querySelector('#fpWrap canvas');
          if (!c) return -1;
          var t = document.createElement('canvas'); t.width = 64; t.height = 36;
          var g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 36);
          var d = g.getImageData(0, 0, 64, 36).data, s = 0;
          for (var k = 0; k < d.length; k += 4) s += (d[k] + d[k + 1] + d[k + 2]) / 3;
          return s / (64 * 36);
        });
        console.log(bright > 8 ? '✓ 画面亮度 ' + bright.toFixed(1) + '（非黑屏）' : '✗ 疑似黑屏（亮度 ' + bright.toFixed(1) + '）');
        var all = okFloor && okTop && okClimb && okLanding && bright > 8;
        console.log(all ? '\n✓✓ 全部通过' : '\n✗ 有项目未通过');
        browser.close(); process.exit(all ? 0 : 2);
      }
      if (pos === lastPos) { stall++; if (stall > 200) { console.log('✗ 疑似卡死（位置 200 次无变化）：' + pos); browser.close(); process.exit(3); } }
      else { stall = 0; lastPos = pos; }
      await page.waitForTimeout(120);
    }
    console.log('✗ 超时未到达');
    browser.close(); process.exit(4);
  } catch (e) { console.error('失败：', e.message); browser.close(); process.exit(1); }
})();
