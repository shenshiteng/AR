#!/usr/bin/env node
/* =========================================================================
   nav3d/tools/check_walk.js —— 无头 Chrome 体检 nav3d/walk.html
   -------------------------------------------------------------------------
   做什么：
     1) 起本地 http（端口 8093，nav3d 目录为根）
     2) 打开 walk.html，收集 pageerror / console.error / 404
     3) 读 __WALK__.state：确认人眼高度 1.62、碰撞盒/房间数量正常
     4) 逐层跑 audit()：从起点做 0.5m 栅格泛洪，列出走不到的走廊/房间
     5) 真按键走一段（按 W 前进），确认位置真的变了、并且没有穿墙
     6) 站到 4F 门口按进门方向走，确认能进 406 房间
     7) 截图存盘
   用法：
     node nav3d/tools/check_walk.js [输出图目录]
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var http = require('http');
var url = require('url');
var chromium = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core')).chromium;

var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var NAV3D = path.join(__dirname, '..');                // nav3d/
var ROOT = path.join(NAV3D, '..');                     // 会话根（页面要 ../js/vendor/three.min.js）
var PAGE = '/nav3d/walk.html';
var OUT = path.resolve(process.argv[2] || path.join(NAV3D, '_walkshots'));
var PORT = 8093;
var FLOORS = ['B2-2', 'B2-3', 'B2-4', 'B2-5'];

var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'
};

function serve(dir, port) {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rq) {
      var p = decodeURIComponent(url.parse(req.url).pathname);
      var f = path.join(dir, p);
      if (f.indexOf(dir) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rq.writeHead(404); rq.end('no'); return;
      }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(port, function () { res(s); });
  });
}

(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  var srv = await serve(ROOT, PORT);
  var browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox',
           '--disable-gpu-sandbox', '--hide-scrollbars']
  });
  var fails = 0;
  function ok(cond, label, extra) {
    console.log((cond ? '  [OK]   ' : '  [FAIL] ') + label + (extra ? '   ' + extra : ''));
    if (!cond) fails++;
  }

  try {
    var page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    var errs = [];
    page.on('pageerror', function (e) { errs.push('pageerror: ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('response', function (r) {
      if (r.status() >= 400 && r.url().indexOf('favicon') < 0) errs.push('http ' + r.status() + ' ' + r.url());
    });

    await page.goto('http://localhost:' + PORT + PAGE, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1400);

    console.log('== 1. 加载 ==');
    var has = await page.evaluate(function () { return !!window.__WALK__; });
    ok(has, '页面脚本跑通，__WALK__ 存在');
    ok(errs.length === 0, '无 JS 报错 / 无 404', errs.slice(0, 4).join(' | '));

    console.log('== 2. 初始状态 ==');
    var st = await page.evaluate(function () { return window.__WALK__.state; });
    console.log('     ' + JSON.stringify(st));
    ok(Math.abs(st.eye - 1.62) < 1e-6, '人眼高度 = 1.62m', 'eye=' + st.eye);
    ok(st.colliders > 300, '碰撞盒数量合理', 'colliders=' + st.colliders);
    ok(st.rooms >= 40, '房间已建', 'rooms=' + st.rooms);
    ok(st.room.length > 0, '起点能识别出所在的房间/走廊', st.room);

    console.log('== 3. 逐层连通性（从起点 0.5m 泛洪） ==');
    for (var i = 0; i < FLOORS.length; i++) {
      var fid = FLOORS[i];
      var rep = await page.evaluate(function (f) {
        window.__WALK__.setFloor(f, false);
        return window.__WALK__.audit();
      }, fid);
      var bad = rep.unreachable.filter(function (x) {
        /* 套间（要通过宿主房间才能进）与楼梯/厕所允许单独统计，这里只报不是这两类 */
        return true;
      });
      ok(bad.length === 0, fid + ' 全部 ' + rep.total + ' 个房间/走廊可达',
         bad.length ? '走不到：' + bad.slice(0, 6).join('; ') : '');
    }

    console.log('== 4. 键盘真的能走 ==');
    await page.evaluate(function () { window.__WALK__.setFloor('B2-2', false); });
    var p0 = await page.evaluate(function () { return window.__WALK__.state; });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(120);
    var p1 = await page.evaluate(function () { return window.__WALK__.state; });
    var moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    ok(moved > 0.3, '按住 W 前进后位置变化 > 0.3m', 'moved=' + moved.toFixed(2) + 'm');

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowRight');
    var p2 = await page.evaluate(function () { return window.__WALK__.state; });
    ok(Math.abs(p2.yaw - p1.yaw) > 0.15, '按住 → 视角真的转了', 'dyaw=' + (p2.yaw - p1.yaw).toFixed(2));

    console.log('== 5. 撞墙不穿墙 ==');
    var wall = await page.evaluate(function () {
      /* 站在南侧走廊，一直朝南顶外墙，看会不会跑到楼外 */
      window.__WALK__.setFloor('B2-4', false);
      var F = window.__WALK__.floors['B2-4'], ppm = F.pxPerMeter, ox = F.originPx[0], oy = F.originPx[1];
      var mx = function (v) { return (v - ox) / ppm; };
      var mz = function (v) { return (v - oy) / ppm; };
      window.__WALK__.teleport(mx(700), mz(1550), Math.PI);   // 南走廊，yaw=PI 朝南（+z）
      for (var i = 0; i < 400; i++) window.__WALK__.step({ fwd: true }, 0.05);
      return window.__WALK__.state;
    });
    var freeOut = await page.evaluate(function (p) { return window.__WALK__.free(p.x, p.z); },
                                      { x: wall.x, z: wall.z });
    ok(freeOut, '一直朝外墙走仍停在可站立区域（没穿到楼外）',
       'x=' + wall.x.toFixed(2) + ' z=' + wall.z.toFixed(2) + ' room=' + wall.room);

    console.log('== 6. 穿门进 406（4F 南排，门朝北） ==');
    var into = await page.evaluate(function () {
      window.__WALK__.setFloor('B2-4', false);
      var F = window.__WALK__.floors['B2-4'];
      var r = null;
      for (var i = 0; i < F.rooms.length; i++) if (F.rooms[i].id === '406') r = F.rooms[i];
      var ppm = F.pxPerMeter, ox = F.originPx[0], oy = F.originPx[1];
      var mx = function (v) { return (v - ox) / ppm; };
      var mz = function (v) { return (v - oy) / ppm; };
      var doorX = mx(r.x1 + (r.x2 - r.x1) * r.doorT);
      var outZ = mz(r.y1) - 1.3;                      // 门外（走廊一侧，z 更小）
      window.__WALK__.teleport(doorX, outZ, Math.PI);  // 朝南 = 朝 +z = 进门
      var trail = [];
      for (var k = 0; k < 80; k++) { window.__WALK__.step({ fwd: true }, 0.05); }
      return window.__WALK__.state;
    });
    ok(into.room === '移动互联实验室-1', '从门外朝门走能进到 406 里', '现在在：' + into.room);

    console.log('== 6b. 反向：从 406 里走出来回走廊 ==');
    var backOut = await page.evaluate(function () {
      for (var k = 0; k < 80; k++) { window.__WALK__.step({ back: true }, 0.05); }
      return window.__WALK__.state;
    });
    ok(backOut.room.indexOf('走廊') >= 0, '倒退能原路出到走廊', '现在在：' + backOut.room);

    console.log('== 6c. 楼梯上下楼（4F → 3F → 2F） ==');
    var stair = await page.evaluate(function () {
      var W = window.__WALK__;
      W.setFloor('B2-4', false);
      var F = W.floors['B2-4'], ppm = F.pxPerMeter, ox = F.originPx[0], oy = F.originPx[1];
      var mx = function (v) { return (v - ox) / ppm; };
      var mz = function (v) { return (v - oy) / ppm; };
      /* 东北楼梯间 STAIR-NE：1188..1320 / 579..658 */
      W.teleport(mx(1254), mz(618), 0);
      var seq = [W.state.fid];
      W.stair(-1); seq.push(W.state.fid);
      W.stair(-1); seq.push(W.state.fid);
      return seq;
    });
    ok(stair[0] === 'B2-4' && stair[1] === 'B2-3' && stair[2] === 'B2-2',
       '在楼梯间按 Q 能一路下楼 4F→3F→2F', stair.join(' → '));

    console.log('== 7. 截图 ==');
    var shots = [['B2-4', 'walk-4f.png'], ['B2-2', 'walk-2f.png'], ['B2-5', 'walk-5f.png']];
    for (var s = 0; s < shots.length; s++) {
      await page.evaluate(function (f) { window.__WALK__.setFloor(f, false); }, shots[s][0]);
      await page.waitForTimeout(700);
      var buf = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(OUT, shots[s][1]), buf);
      console.log('     已保存 ' + path.join(OUT, shots[s][1]));
    }

    /* 走廊视角（人站在走廊中间，看前方） */
    await page.evaluate(function () {
      window.__WALK__.setFloor('B2-4', false);
      var F = window.__WALK__.floors['B2-4'], ppm = F.pxPerMeter, ox = F.originPx[0], oy = F.originPx[1];
      var mx = function (v) { return (v - ox) / ppm; };
      var mz = function (v) { return (v - oy) / ppm; };
      window.__WALK__.teleport(mx(1180), mz(1300), 0);   // 东侧走廊，朝北
    });
    await page.waitForTimeout(600);
    fs.writeFileSync(path.join(OUT, 'walk-corridor.png'), await page.screenshot({ type: 'png' }));
    console.log('     已保存 ' + path.join(OUT, 'walk-corridor.png'));

    console.log('== 8. 收尾 ==');
    ok(errs.length === 0, '全程无 JS 报错', errs.slice(0, 4).join(' | '));

    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('');
  console.log(fails === 0 ? '全部通过 ✅' : (fails + ' 项失败 ❌'));
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error('跑挂了：', e && e.stack || e); process.exit(1); });
