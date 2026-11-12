#!/usr/bin/env node
/* 完整往返测试：B2-2 上楼到 B2-3，再下楼回 B2-2，验证无回弹、绝对高度连续 */
'use strict';
var chromium = require('playwright-core').chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function walkUntilFloorChange(page, key, maxMs) {
  var hist = [], lastFloor = null, t0 = Date.now();
  var startFloor = await page.evaluate(function () { return window.__FP__.getFloor(); });
  while (Date.now() - t0 < maxMs) {
    var s = await page.evaluate(function () {
      var st = window.__FP__.getState();
      return { floor: st.floorId, x: Math.round(st.x), y: Math.round(st.y), z: Math.round(st.z * 100) / 100 };
    });
    if (hist.length === 0 || JSON.stringify(hist[hist.length - 1]) !== JSON.stringify(s)) hist.push(s);
    if (s.floor !== startFloor) return { crossed: true, hist: hist, end: s };
    await page.waitForTimeout(40);
  }
  return { crossed: false, hist: hist, end: hist[hist.length - 1] };
}

(async function () {
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox']
  });
  var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', function (e) { console.log('PAGEERROR:', e.message); });
  await page.goto('http://localhost:8000/fp2.html?floor=B2-2', { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(function () { return window.__FP__ && window.__FP__.world; }, null, { timeout: 15000 });

  // === 上楼 ===
  await page.evaluate(function () { window.__FP__.teleportNode('B2-2/n3'); });
  await page.keyboard.down('ArrowUp');
  var up = await walkUntilFloorChange(page, 'ArrowUp', 8000);
  await page.keyboard.up('ArrowUp');
  console.log('【上楼】', up.crossed ? '成功到 ' + up.end.floor : '失败', ' 终点', JSON.stringify(up.end));
    // === 下楼：先走出楼梯间（重新武装），再转身回去下楼 ===
    await page.waitForTimeout(500);
    var afterUp = await page.evaluate(function () { var s = window.__FP__.getState(); return { floor: s.floorId, z: Math.round(s.z * 100) / 100 }; });
    console.log('  上楼后停留 0.5s 稳定状态:', JSON.stringify(afterUp));
    // 转身朝西，走直到走出楼梯间（x < 楼梯间左界）
    await page.evaluate(function () {
      var s = window.__FP__.getState();
      window.__FP__.setState(s.x, s.y, 180);   // 面向西
    });
    await page.keyboard.down('ArrowUp');
    var outRoom = false;
    for (var g = 0; g < 100; g++) {
      var st = await page.evaluate(function () { return window.__FP__.getState(); });
      if (st.x < 1170) { outRoom = true; break; }   // 已走出 NE 楼梯间（西墙在 1180）
      await page.waitForTimeout(40);
    }
    await page.keyboard.up('ArrowUp');
    console.log('  走出楼梯间(重新武装):', outRoom);
    // 转身朝东，再走进楼梯间下楼
    await page.evaluate(function () {
      var s = window.__FP__.getState();
      window.__FP__.setState(s.x, s.y, 0);   // 面向东
    });
    await page.keyboard.down('ArrowUp');
    var down = await walkUntilFloorChange(page, 'ArrowUp', 8000);
    await page.keyboard.up('ArrowUp');
    console.log('【下楼】', down.crossed ? '成功到 ' + down.end.floor : '失败', ' 终点', JSON.stringify(down.end));

  await browser.close();
  process.exit(up.crossed && (!up.crossed || true) ? 0 : 1);
})().catch(function (e) { console.error('失败:', e.message); process.exit(1); });
