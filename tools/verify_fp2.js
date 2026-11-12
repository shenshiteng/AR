#!/usr/bin/env node
/* 端到端验证 fp2.html 两层探索模块 */
'use strict';
var chromium = require('playwright-core').chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async function () {
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
  });
  var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  var errors = [];
  page.on('pageerror', function (e) { errors.push('pageerror: ' + e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto('http://localhost:8000/fp2.html', { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(function () { return window.__FP__ && window.__FP__.world; }, null, { timeout: 15000 });

  var report = {};

  // 1. 校验器接口存在
  report.api = await page.evaluate(function () {
    var f = window.__FP__;
    return {
      hasState: typeof f.getState === 'function',
      hasStep: typeof f.step === 'function',
      hasRay: typeof f.castRay === 'function',
      hasTeleport: typeof f.teleportNode === 'function',
      hasSwitch: typeof f.switchFloor === 'function',
      hasStair: typeof f.useStair === 'function',
      hasSelfTest: typeof f.selfTest === 'function'
    };
  });

  // 2. 楼梯连接
  report.links = await page.evaluate(function () {
    var ls = window.__FP__.links();
    return { count: ls.length, names: ls.map(function (l) { return l.name; }) };
  });

  // 3. 起始层 B2-2 渲染 + 世界尺寸
  report.floor2 = await page.evaluate(function () {
    return { floor: window.__FP__.getFloor(), w: window.__FP__.world.width, h: window.__FP__.world.height,
             rooms: window.__FP__.rooms().length, nodes: window.__FP__.nodes().length };
  });

  // 4. 自检结果
  report.selftest2 = await page.evaluate(function () {
    var r = window.__FP__.selfTest();
    return r.map(function (it) { return { name: it.name, pass: it.pass, detail: it.detail }; });
  });

  // 5. 切到 3 层
  await page.evaluate(function () { window.__FP__.switchFloor('B2-3'); });
  report.floor3 = await page.evaluate(function () {
    return { floor: window.__FP__.getFloor(), w: window.__FP__.world.width, h: window.__FP__.world.height,
             rooms: window.__FP__.rooms().length, nodes: window.__FP__.nodes().length };
  });

  // 6. 楼梯口节点附近触发 useStair（从 3 层东侧楼梯口 n30 走回 2 层 n10）
  await page.evaluate(function () { window.__FP__.teleportNode('B2-3/n30', 90); });
  var stairRes = await page.evaluate(function () {
    var before = window.__FP__.getFloor();
    var ok = window.__FP__.useStair();
    var after = window.__FP__.getFloor();
    var st = window.__FP__.getState();
    return { before: before, ok: ok, after: after, node: st.node };
  });

  // 7. 跨层巡航：从 2 层西南楼梯口 n16 出发，去 3 层「精密测量实验室」(room 321)
  await page.evaluate(function () { window.__FP__.teleportNode('B2-2/n16', 90); });
  var route = await page.evaluate(function () {
    var ok = window.__FP__.route('321');
    var st = window.__FP__.getState();
    return { ok: ok, startFloor: window.__FP__.getFloor(), node: st.node };
  });

  // 8. 让自动巡航跑一段，看是否跨层到达
  var reached = false, crossed = false, guard = 0, noteHist = [];
  while (guard++ < 800) {
    var info = await page.evaluate(function () {
      return { note: document.getElementById('spawnNote').textContent, floor: window.__FP__.getFloor() };
    });
    if (noteHist.indexOf(info.floor) < 0) noteHist.push(info.floor);
    if (info.note.indexOf('已到达') > -1) { reached = true; break; }
    if (info.note.indexOf('未连通') > -1 || info.note.indexOf('找不到') > -1) break;
    await page.waitForTimeout(60);
  }
  crossed = noteHist.length >= 2;

  report.cruise = { reached: reached, crossed: crossed, floorsVisited: noteHist };

  // 截图第一人称 + 总览
  await page.screenshot({ path: 'C:/Users/35391/Desktop/python/实验室定位/_shot_fp2.png' });
  await page.locator('#fpWrap').screenshot({ path: 'C:/Users/35391/Desktop/python/实验室定位/_shot_fp2_fp.png' });

  console.log('=== 校验器接口 ==='); console.log(JSON.stringify(report.api, null, 2));
  console.log('=== 楼梯连接 ==='); console.log(JSON.stringify(report.links, null, 2));
  console.log('=== 2层 ==='); console.log(JSON.stringify(report.floor2, null, 2));
  console.log('=== 3层 ==='); console.log(JSON.stringify(report.floor3, null, 2));
  console.log('=== 走楼梯(3层n30→2层) ==='); console.log(JSON.stringify(stairRes, null, 2));
  console.log('=== 跨层巡航(2层n16→3层321) ==='); console.log(JSON.stringify(report.cruise, null, 2));
  console.log('=== 自检 ===');
  report.selftest2.forEach(function (it) { console.log((it.pass ? '✓' : '✗') + ' ' + it.name + ' —— ' + it.detail); });
  console.log('=== 页面错误 ==='); console.log(errors.length ? errors.join('\n') : '无');

  await browser.close();
})().catch(function (e) { console.error('验证失败：', e && e.message); process.exit(1); });
