#!/usr/bin/env node
/* 端到端：用真实 rAF 游戏循环跑「跨层自动巡航」，验证走楼梯从 2 层到 3 层 */
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
  page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:8000/fp2.html?autowalk=320', { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(function () { return window.__FP__ && window.__FP__.world; }, null, { timeout: 15000 });

  // 等自动巡航跑到 3 层 320（真实 rAF 循环 + 走楼梯跨层）
  var floorHist = [], note = '', guard = 0;
  var reached = false;
  while (guard++ < 1200) {
    var info = await page.evaluate(function () {
      return { floor: window.__FP__.getFloor(), note: document.getElementById('spawnNote').textContent,
               x: Math.round(window.__FP__.getState().x), y: Math.round(window.__FP__.getState().y),
               z: Math.round((window.__FP__.getState().z || 0) * 100) / 100 };
    });
    if (floorHist.indexOf(info.floor) < 0) floorHist.push(info.floor);
    note = info.note;
    if (note.indexOf('已到达') > -1) { reached = true; break; }
    if (note.indexOf('未连通') > -1 || note.indexOf('找不到') > -1) break;
    await page.waitForTimeout(50);
  }

  console.log('自动巡航结果:');
  console.log('  经过楼层: ' + floorHist.join(' → '));
  console.log('  到达: ' + reached);
  console.log('  最终提示: ' + note);
  console.log('  页面错误: ' + (errors.length ? errors.join(' | ') : '无'));

  // 截图看最终 3D 场景
  await page.screenshot({ path: 'C:/Users/35391/Desktop/python/实验室定位/_shot_cruise.png' });

  await browser.close();
  process.exit(reached ? 0 : 1);
})().catch(function (e) { console.error('验证失败：', e && e.message); process.exit(1); });
