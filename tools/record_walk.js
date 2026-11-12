#!/usr/bin/env node
/* =========================================================================
   tools/record_walk.js —— 无头 Chrome 录第一人称走查为帧动画
   -------------------------------------------------------------------------
   打开 fp.html?autowalk=<目的地>，让 three.js 第一人称相机自动沿路线走，
   逐帧截图（jpeg），最后拼成一个自包含的帧动画页面 _walk_fp.html。

   用法：node tools/record_walk.js [目的地]   默认 333
   依赖：已装 playwright-core + 系统 Chrome + 本地 http 服务(8000)。
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var chromium = require('playwright-core').chromium;

var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var root = path.join(__dirname, '..');
var OUT = path.join(root, '_walk_fp.html');
var target = process.argv[2] || '333';
var FRAME_MS = 220;   // 截图间隔（毫秒）

(async function () {
  var browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
  });
  try {
    var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('http://localhost:8000/fp.html?autowalk=' + encodeURIComponent(target), { waitUntil: 'load', timeout: 20000 });

    await page.waitForFunction(function () { return window.__FP__ && window.__FP__.world; }, null, { timeout: 15000 });
    await page.waitForTimeout(600);

    var frames = [];
    var done = false, guard = 0, lastNote = '';
    while (!done && guard++ < 600) {
      var note = await page.evaluate(function () { return document.getElementById('spawnNote').textContent; });
      if (note !== lastNote) { console.log('  ' + note); lastNote = note; }
      var buf = await page.locator('#fpWrap').screenshot({ type: 'jpeg', quality: 62 });
      frames.push(buf.toString('base64'));
      if (note.indexOf('已到达') > -1) { done = true; break; }
      if (note.indexOf('找不到') > -1 || note.indexOf('寻路失败') > -1) { done = true; break; }
      await page.waitForTimeout(FRAME_MS);
    }
    // 收尾再截两张定格
    for (var i = 0; i < 3; i++) {
      var b2 = await page.locator('#fpWrap').screenshot({ type: 'jpeg', quality: 62 });
      frames.push(b2.toString('base64'));
    }
    console.log('录制帧数：' + frames.length);

    writePlayer(frames, target);
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error('录制失败：', e && e.message); process.exit(1); });

function writePlayer(frames, target) {
  var arr = frames.map(function (b) { return '"' + b + '"'; }).join(',');
  var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>第一人称走查 · ' + target + '</title><style>' +
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
    '<div id="view"><img id="frame" alt="第一人称走查"></div>' +
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
