#!/usr/bin/env node
/* tools/record_climb.js —— 录制「走楼梯跨层」第一人称帧动画
   聚焦爬楼梯那一段（进入楼梯间 → 逐级上升 → 平台跨层 → 折返下来走出楼梯间）。
   用法：node tools/record_climb.js
   依赖：playwright-core + 系统 Chrome + 本地 http 服务(8000)。 */
'use strict';
var path = require('path');
var fs = require('fs');
var chromium = require('playwright-core').chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var root = path.join(__dirname, '..');
var OUT = path.join(root, '_climb_fp.html');
var FRAME_MS = 160;

(async function () {
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
  });
  try {
    var page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    await page.goto('http://localhost:8000/fp2.html?floor=B2-2', { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(function () { return window.__FP__; }, null, { timeout: 15000 });

    // 从东北楼梯口出发，巡航 333（会走东北楼梯跨层）
    await page.evaluate(function () {
      window.__FP__.teleportNode('B2-2/n3', undefined);
      window.__FP__.route('333');
    });

    // 从「走进楼梯间」开始录（覆盖第一跑爬升 → 中间平台转弯 → 第二跑 → 跨层 → 走出门）
    await page.waitForFunction(function () {
      return document.getElementById('spawnNote').textContent.indexOf('走进楼梯间') > -1;
    }, null, { timeout: 60000 });
    await page.waitForTimeout(200);

    var frames = [];
    var done = false, guard = 0, prevFloor = 'B2-2', notePrinted = '', crossed = false;
    while (!done && guard++ < 500) {
      var st = await page.evaluate(function () {
        var s = window.__FP__.getState();
        return { floor: s.floorId, z: s.z, note: document.getElementById('spawnNote').textContent };
      });
      if (st.floor !== prevFloor) { console.log('  ★ 跨层：' + prevFloor + ' → ' + st.floor + ' (z=' + st.z.toFixed(2) + ')'); prevFloor = st.floor; crossed = true; }
      var buf = await page.locator('#fpWrap').screenshot({ type: 'jpeg', quality: 60 });
      frames.push(buf.toString('base64'));
      // 录满 ~13 秒（覆盖 进门 → 第一跑爬升 → 平台转弯 → 第二跑 → 跨层 → 走出门）
      if (frames.length >= 80) { done = true; }
      await page.waitForTimeout(FRAME_MS);
    }
    console.log('录制帧数：' + frames.length);
    writePlayer(frames);
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error('录制失败：', e && e.message); process.exit(1); });

function writePlayer(frames) {
  var arr = frames.map(function (b) { return '"' + b + '"'; }).join(',');
  var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>走楼梯跨层 · 第一人称</title><style>' +
    'html,body{margin:0;height:100%;background:#0f1419;font:14px/1.5 system-ui,sans-serif;overflow:hidden}' +
    '#app{display:flex;flex-direction:column;height:100%}' +
    '#view{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}' +
    '#view img{max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.5)}' +
    '#bar{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#171d26;color:#e6ebf2;border-top:1px solid #2a3340}' +
    'button{background:#1d2834;color:#e6ebf2;border:1px solid #2a3340;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px}' +
    'button:hover{border-color:#38bdf8}' +
    'input[type=range]{flex:1}' +
    '#label{font:12px ui-monospace,Menlo,Consolas,monospace;color:#8b98a8;min-width:70px;text-align:right}' +
    '</style></head><body><div id="app">' +
    '<div id="view"><img id="frame" alt="走楼梯跨层"></div>' +
    '<div id="bar"><button id="playBtn">⏸ 暂停</button>' +
    '<button id="revBtn">⇤ 重播</button>' +
    '<input id="seek" type="range" min="0" max="' + (frames.length - 1) + '" value="0">' +
    '<span id="label"></span></div></div>' +
    '<script>' +
    'var F=[' + arr + '];' +
    'var i=0,playing=true,timer=null;' +
    'var img=document.getElementById("frame"),seek=document.getElementById("seek"),label=document.getElementById("label"),playBtn=document.getElementById("playBtn");' +
    'function show(){img.src="data:image/jpeg;base64,"+F[i];seek.value=i;label.textContent=(i+1)+" / "+F.length;}' +
    'function next(){i=(i+1)%F.length;show();}' +
    'function start(){clearInterval(timer);timer=setInterval(next,' + FRAME_MS + ');}' +
    'function stop(){clearInterval(timer);}' +
    'playBtn.onclick=function(){playing=!playing;playBtn.textContent=playing?"⏸ 暂停":"▶ 播放";playing?start():stop();};' +
    'document.getElementById("revBtn").onclick=function(){i=0;show();playing=true;playBtn.textContent="⏸ 暂停";start();};' +
    'seek.oninput=function(){i=+seek.value;show();};' +
    'show();start();' +
    '</script></body></html>';
  fs.writeFileSync(OUT, html, 'utf8');
  console.log('已生成 ' + OUT + '（' + Math.round(html.length / 1024) + ' KB）');
}
