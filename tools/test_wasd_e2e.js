#!/usr/bin/env node
/* tools/test_wasd_e2e.js —— 真实键盘端到端验收（无头 Chrome + fp2.html）
   ---------------------------------------------------------------------------
   验的是完整链路：真实 keydown → fp-input 映射 → 页面 loop → fp-core step
   全部用 page.keyboard.down/up 触发，不直接调 __FP__.step，避免「测了个假路径」。

   键位要求（本轮）：
     W/S 只前进后退，绝不转向；A/D 只左右转视角；按键优先级最高、覆盖自动行为。

   五个场景（每个独立开页面，避免状态污染）：
     1) 走廊：A 左转 / D 右转 / W 只前进不转向
     2) 台阶上：A/D 照样能转（转向职责不变），W 只前进
     3) 楼梯平台：按 A 转向后不会被自动转弯「转回去」
     4) 自动巡航中按任意键：立即中断巡航，键盘接管
     5) 只按 W：仍能一路走到三楼（原有自动上楼能力不变）

   用法：先起 python -m http.server 8000 --bind 127.0.0.1，再
        NODE_PATH=<playwright-core 所在> node tools/test_wasd_e2e.js [起点节点]
   --------------------------------------------------------------------------- */
'use strict';
var chromium = require('playwright-core').chromium;
var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var START = process.argv[2] || 'B2-2/n1';
var BASE = 'http://127.0.0.1:8000/fp2.html?floor=B2-2';
var FLOOR_H = 3.0;

var fails = 0;
function ok(name, cond, detail) {
  if (cond) console.log('  ✓ ' + name + (detail ? '  ' + detail : ''));
  else { fails++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}
/* 有符号角度差：正=顺时针(右转)，负=逆时针(左转) */
function signedDiff(a, b) { return ((a - b + 540) % 360) - 180; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var browser, errs;

async function newPage() {
  var page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
  errs = [];
  page.on('pageerror', function (e) { errs.push(e.message); });
  await page.goto(BASE, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(function () { return window.__FP__; }, null, { timeout: 15000 });
  return page;
}
function getState(page) { return page.evaluate(function () { return window.__FP__.getState(); }); }

async function holdUntil(page, key, cond, maxMs) {
  await page.keyboard.down(key);
  var t0 = Date.now(), s = null;
  while (Date.now() - t0 < maxMs) {
    await sleep(70);
    s = await getState(page);
    if (cond(s)) break;
  }
  return s;
}

/* 按住键固定时长，返回首末状态与期间最大 |Δθ| */
async function holdAndWatch(page, key, ms) {
  var s0 = await getState(page);
  await page.keyboard.down(key);
  var maxD = 0, t0 = Date.now(), s = s0;
  while (Date.now() - t0 < ms) {
    await sleep(60);
    s = await getState(page);
    maxD = Math.max(maxD, Math.abs(signedDiff(s.theta, s0.theta)));
  }
  await page.keyboard.up(key);
  await sleep(150);
  var s1 = await getState(page);
  return { s0: s0, s1: s1, maxTurn: maxD, dTheta: signedDiff(s1.theta, s0.theta) };
}

(async function () {
  browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox',
           '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
           '--disable-backgrounding-occluded-windows']
  });
  try {
    /* ============ 场景 1：走廊上的 A/D 转向 + W 不转向 ============ */
    console.log('[1] 走廊：A 左转 / D 右转 / W 只前进');
    var page = await newPage();
    /* 找一个不撞墙的落脚点，统一朝东(theta=0)做基准 */
    var spot = await page.evaluate(function () {
      var w = window.__FP__.world;
      var cands = [{ x: 167, y: 120 }, { x: 1160, y: 375 }, { x: 1225, y: 1200 }];
      for (var i = 0; i < cands.length; i++) {
        if (!w.collides(cands[i].x, cands[i].y)) {
          window.__FP__.setState(cands[i].x, cands[i].y, 0);
          return cands[i];
        }
      }
      return null;
    });
    ok('找到落脚点', !!spot, spot ? '(' + spot.x + ',' + spot.y + ')' : '都被墙占据');

    await sleep(150);
    var rA = await holdAndWatch(page, 'a', 500);
    ok('按 A 向左转视角（θ 减小 >25°）', rA.dTheta < -25,
      'Δθ=' + rA.dTheta.toFixed(1) + '°');
    ok('按 A 只转视角、不产生位移',
      Math.hypot(rA.s1.x - rA.s0.x, rA.s1.y - rA.s0.y) < 1,
      '位移=' + Math.hypot(rA.s1.x - rA.s0.x, rA.s1.y - rA.s0.y).toFixed(1) + 'px');

    await page.evaluate(function (c) { window.__FP__.setState(c.x, c.y, 0); }, spot);
    await sleep(100);
    var rD = await holdAndWatch(page, 'd', 500);
    ok('按 D 向右转视角（θ 增大 >25°）', rD.dTheta > 25, 'Δθ=' + rD.dTheta.toFixed(1) + '°');

    await page.evaluate(function (c) { window.__FP__.setState(c.x, c.y, 0); }, spot);
    await sleep(100);
    var rW = await holdAndWatch(page, 'w', 400);
    ok('按 W 前进时朝向完全不变（<1°）', rW.maxTurn < 1, 'Δθ=' + rW.maxTurn.toFixed(1) + '°');

    await page.evaluate(function (c) { window.__FP__.setState(c.x, c.y, 0); }, spot);
    await sleep(100);
    var rS = await holdAndWatch(page, 's', 400);
    ok('按 S 后退时朝向完全不变（<1°）', rS.maxTurn < 1, 'Δθ=' + rS.maxTurn.toFixed(1) + '°');
    ok('页面无 JS 报错', errs.length === 0, errs[0] || '');
    await page.close();

    /* ============ 场景 2：台阶上 A/D 仍可转向，W 不转向 ============ */
    console.log('[2] 台阶上：A/D 仍能转视角，W 只前进');
    page = await newPage();
    await page.evaluate(function (n) { window.__FP__.teleportNode(n); }, START);
    await sleep(200);
    var s = await holdUntil(page, 'w', function (x) { return x.z > 0.15; }, 8000);
    await page.keyboard.up('w');
    await sleep(150);
    s = await getState(page);
    ok('已走上台阶（z>0.15m）', s.z > 0.15, 'z=' + s.z.toFixed(2) + 'm θ=' + s.theta.toFixed(1) + '°');

    var aRes = await holdAndWatch(page, 'a', 500);
    ok('台阶上按 A 仍能左转（转向职责不变）', aRes.dTheta < -25, 'Δθ=' + aRes.dTheta.toFixed(1) + '°');
    ok('台阶上按 A 不误触发换层', aRes.s1.floorId === 'B2-2');
    var dRes = await holdAndWatch(page, 'd', 500);
    ok('台阶上按 D 仍能右转', dRes.dTheta > 25, 'Δθ=' + dRes.dTheta.toFixed(1) + '°');

    /* 把朝向摆正后再测 W：只前进、不转向 */
    await page.keyboard.down('d');
    await sleep(100);
    await page.keyboard.up('d');
    var before = await getState(page);
    var wRes = await holdAndWatch(page, 'w', 500);
    ok('台阶上按 W 时朝向不变（<1°）', wRes.maxTurn < 1, 'Δθ=' + wRes.maxTurn.toFixed(1) + '°');
    ok('台阶上按 W 有位移', Math.hypot(before.x - wRes.s1.x, before.y - wRes.s1.y) > 1,
      '位移=' + Math.hypot(before.x - wRes.s1.x, before.y - wRes.s1.y).toFixed(1) + 'px');
    ok('页面无 JS 报错', errs.length === 0, errs[0] || '');
    await page.close();

    /* ============ 场景 3：平台按 A 转完不被自动逻辑转回去 ============ */
    console.log('[3] 楼梯平台：按 A 转向后不被自动转弯「转回去」');
    page = await newPage();
    await page.evaluate(function (n) { window.__FP__.teleportNode(n); }, START);
    await sleep(200);
    var plat = await holdUntil(page, 'w', function (x) { return x.z >= 1.42; }, 15000);
    await page.keyboard.up('w');
    await sleep(250);
    plat = await getState(page);
    ok('只按 W 已到达中间平台（≈1.5m，仍在本层）',
      plat.z >= 1.42 && plat.z < 2.6 && plat.floorId === 'B2-2',
      'z=' + plat.z.toFixed(2) + 'm θ=' + plat.theta.toFixed(1) + '°');

    var pa = await holdAndWatch(page, 'a', 600);
    ok('平台上按 A 能左转（不被自动逻辑压制）', pa.dTheta < -25, 'Δθ=' + pa.dTheta.toFixed(1) + '°');
    var t1 = (await getState(page)).theta;
    await sleep(700);                        // 松手静置：自动转弯不得把朝向拉回门方向
    var t2 = (await getState(page)).theta;
    ok('松手后朝向保持不变（自动转弯不再抢）', Math.abs(signedDiff(t2, t1)) < 3,
      t1.toFixed(1) + '° → ' + t2.toFixed(1) + '°');
    ok('平台上按 A 不会误触发换层', (await getState(page)).floorId === 'B2-2');
    ok('页面无 JS 报错', errs.length === 0, errs[0] || '');
    await page.close();

    /* ============ 场景 4：自动巡航中按键立即中断 ============ */
    console.log('[4] 自动巡航中按 W：立即中断，键盘接管');
    page = await newPage();
    await page.evaluate(function (n) { window.__FP__.teleportNode(n); }, START);
    await sleep(200);
    var started = await page.evaluate(function () { return window.__FP__.route('333'); });
    ok('巡航已启动', started === true);
    await sleep(400);
    var p0 = await getState(page);
    await page.keyboard.down('w');
    await sleep(250);
    await page.keyboard.up('w');
    var pack = await page.evaluate(function () {
      return { s: window.__FP__.getState(), note: document.getElementById('spawnNote').textContent };
    });
    ok('按键后提示「已由键盘接管」', pack.note.indexOf('已由键盘接管') > -1, pack.note);
    var moved = Math.hypot(pack.s.x - p0.x, pack.s.y - p0.y);
    ok('按键即时生效（250ms 内有位移）', moved > 1, '位移=' + moved.toFixed(1) + 'px');

    /* 松手后必须停下（无人驾驶，不再自动跑） */
    var p1 = await getState(page);
    await sleep(600);
    var p2 = await getState(page);
    ok('松手后不再自动移动（巡航确实停了）',
      Math.hypot(p2.x - p1.x, p2.y - p1.y) < 2,
      '位移=' + Math.hypot(p2.x - p1.x, p2.y - p1.y).toFixed(1) + 'px');
    ok('页面无 JS 报错', errs.length === 0, errs[0] || '');
    await page.close();

    /* ============ 场景 5：只按 W 仍能一路走到三楼 ============ */
    console.log('[5] 只按 W 从二楼走到三楼（原有自动上楼不变）');
    page = await newPage();
    await page.evaluate(function (n) { window.__FP__.teleportNode(n); }, START);
    await sleep(200);
    var cross = null, s5 = null, landingSeen = false, done = false;
    await page.keyboard.down('w');
    var t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await sleep(120);
      var pack5 = await page.evaluate(function () {
        return { s: window.__FP__.getState(), note: document.getElementById('spawnNote').textContent,
                 cross: window.__lastStairCross || null };
      });
      if (pack5.note.indexOf('中间平台') > -1) landingSeen = true;
      if (pack5.cross) cross = pack5.cross;
      s5 = pack5.s;
      if (s5.floorId === 'B2-3') { done = true; break; }
    }
    await page.keyboard.up('w');
    ok('走到三楼（floorId 变成 B2-3）', done, 'floor=' + (s5 ? s5.floorId : '-') +
      ' z=' + (s5 ? s5.z.toFixed(2) : '-'));
    ok('换层发生在层高（|z|≥2.95，不是半层 1.5）', !!cross && Math.abs(cross.z) >= FLOOR_H - 0.05,
      cross ? 'z=' + cross.z.toFixed(2) : '没有换层记录');
    ok('途中经过「中间平台」提示（双跑折返）', landingSeen);
    ok('页面无 JS 报错', errs.length === 0, errs[0] || '');
    await page.close();

    console.log('\n结论: ' + (fails === 0 ? '全部通过' : fails + ' 项失败'));
    await browser.close();
    process.exit(fails === 0 ? 0 : 1);
  } catch (e) {
    console.error('失败：', e && e.stack || e);
    await browser.close();
    process.exit(1);
  }
})();
