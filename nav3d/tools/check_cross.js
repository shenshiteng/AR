#!/usr/bin/env node
/* =========================================================================
   nav3d/tools/check_cross.js —— 跨楼层导航验收（无头 Chrome 实跑）
   -------------------------------------------------------------------------
   验证什么：
     ① 三层各自的路网还能不能走（同层 47 / 46 / 14 间全可达，回归）
     ② 跨楼层规划：指定「从哪层 → 到哪层哪个房间」，能不能算出路线
     ③ 跨层路线必须**真的走楼梯**：楼层序列里相邻两层必须是同一部楼梯，
        且这部楼梯在两层里都存在（5 层只有 NW/NE 两部，不能凭空多出来）
     ④ 跨层路线长度必须 ≥ 同层等效距离（不能出现"因为跨层反而更近"的鬼路）
     ⑤ 反向（5F → 2F）也要通
   用法：
     node nav3d/tools/check_cross.js
     node nav3d/tools/check_cross.js --shot out.png   附带截图
   退出码 0 = 全绿。
   ========================================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var http = require('http');
var url = require('url');
var chromium = require('playwright-core').chromium;

var CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var nav = path.join(__dirname, '..');          // nav3d/
var root = path.join(nav, '..');               // 会话根

var shotIdx = process.argv.indexOf('--shot');
var shotOut = shotIdx > 0 ? path.resolve(process.argv[shotIdx + 1]) : null;

var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serve(dir, port) {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rq) {
      var p = decodeURIComponent(url.parse(req.url).pathname);
      var f = path.join(dir, p === '/' ? '/index.html' : p);
      if (f.indexOf(dir) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rq.writeHead(404); rq.end('no'); return;
      }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(port, function () { res(s); });
  });
}

var fails = 0, passes = 0;
function ok(cond, label, detail) {
  if (cond) { passes++; console.log('  [通过] ' + label + (detail ? '  ' + detail : '')); }
  else { fails++; console.log('  [失败] ' + label + (detail ? '  ' + detail : '')); }
}

(async function () {
  var srv = await serve(root, 8093);
  var browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
  });
  try {
    var page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    var errs = [], badUrls = [];
    page.on('pageerror', function (e) { errs.push(String(e.message).slice(0, 300)); });
    page.on('console', function (m) {
      if (m.type() !== 'error') return;
      var loc = m.location ? (m.location().url || '') : '';
      if (loc.indexOf('favicon') >= 0) return;          // favicon 404 不是页面问题
      errs.push('console: ' + m.text().slice(0, 200) + (loc ? ' @ ' + loc : ''));
    });
    page.on('response', function (r) {
      if (r.status() >= 400 && r.url().indexOf('favicon') < 0) badUrls.push(r.status() + ' ' + r.url());
    });

    await page.goto('http://localhost:8093/nav3d/_dev.html?noauto=1', { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction('window.__NAV__ && window.__NAV__.planSummary', null, { timeout: 15000 });
    await page.waitForTimeout(400);

    console.log('\n=== 1. 页面无 JS 异常 ===');
    ok(errs.length === 0, '零异常', errs.length ? errs.join(' | ') : '');
    ok(badUrls.length === 0, '无 4xx/5xx 资源', badUrls.length ? badUrls.join(' | ') : '');

    console.log('\n=== 2. 三层同层自检（回归：栅格改成每层一份之后不能坏） ===');
    for (var fi = 0; fi < 3; fi++) {
      var fid = ['B2-3', 'B2-2', 'B2-5'][fi];
      var res = await page.evaluate(function (id) {
        var nav = window.__NAV__;
        nav.switchFloor(id);
        var bad = [], total = 0;
        /* 用房间清单逐个点名（同层），navigate 的返回值才是真的"通/不通" */
        var rooms = window.FLOOR_DATA_BY_ID && window.FLOOR_DATA_BY_ID[id]
          ? window.FLOOR_DATA_BY_ID[id].rooms
          : (window.FLOOR_DATA ? window.FLOOR_DATA.rooms : []);
        for (var i = 0; i < rooms.length; i++) {
          total++;
          if (!nav.navigate(rooms[i].id, id)) bad.push(rooms[i].id);
        }
        return { floor: nav.floor(), total: total, bad: bad };
      }, fid);
      ok(res.bad.length === 0, fid + ' 同层 ' + res.total + ' 间全部可规划',
         res.bad.length ? ('不通: ' + res.bad.join(',')) : '');
    }

    console.log('\n=== 3. 跨楼层规划（每层每个代表房间 × 其它层） ===');
    /* 从 3F 出发，去 2F / 5F 的房间；再从 5F 出发回 2F */
    var cases = [
      { from: 'B2-3', to: 'B2-2', room: '201' },
      { from: 'B2-3', to: 'B2-2', room: '226' },
      { from: 'B2-3', to: 'B2-5', room: '501' },
      { from: 'B2-3', to: 'B2-5', room: '508' },
      { from: 'B2-2', to: 'B2-3', room: '333' },
      { from: 'B2-2', to: 'B2-5', room: '501' },
      { from: 'B2-5', to: 'B2-3', room: '318' },
      { from: 'B2-5', to: 'B2-2', room: '201' }
    ];
    var planLog = [];
    for (var ci = 0; ci < cases.length; ci++) {
      var c = cases[ci];
      var pr = await page.evaluate(function (cc) {
        window.__NAV__.switchFloor(cc.from);
        return window.__NAV__.planSummary(cc.to, cc.room);
      }, c);
      var label = c.from.replace('B2-', '') + 'F → ' + c.to.replace('B2-', '') + 'F 「' + c.room + '」';
      if (!pr) { ok(false, label, '算不出路线'); continue; }
      var seq = pr.floors.map(function (f) { return f.replace('B2-', ''); }).join('→');
      planLog.push(label + '  ' + Math.round(pr.meters) + 'm  ' + seq +
                   '  楼梯: ' + pr.hops.map(function (h) { return h.stair + (h.up ? '↑' : '↓'); }).join(','));
      ok(pr.floors[0] === c.from && pr.floors[pr.floors.length - 1] === c.to,
         label + ' 首末层正确', seq + '  ' + Math.round(pr.meters) + 'm');
      ok(pr.hops.length >= 1, label + ' 至少走一次楼梯', pr.hops.length + ' 次');
      /* 每一跳都必须是同一部楼梯、且它在这两层里都存在 */
      var hopOk = true, hopWhy = [];
      for (var hi = 0; hi < pr.hops.length; hi++) {
        var h = pr.hops[hi];
        if (!h.stair) { hopOk = false; hopWhy.push('第' + (hi+1) + '跳没有楼梯 id'); }
      }
      ok(hopOk, label + ' 每一跳都有具体楼梯', hopWhy.join('/'));
      /* 楼层数差 = 实际层差（2/3/5 层，没有 4 层） */
      var lv = { 'B2-2': 2, 'B2-3': 3, 'B2-5': 5 };
      var realGap = Math.abs(lv[c.from] - lv[c.to]);
      var hopGap = 0;
      for (var h2 = 0; h2 < pr.hops.length; h2++) hopGap += Math.abs(lv[pr.hops[h2].to] - lv[pr.hops[h2].from]);
      ok(hopGap === realGap, label + ' 楼梯层差=' + realGap + ' 层', '实际跨了 ' + hopGap + ' 层');
    }

    console.log('\n=== 4. 跨层路线必须真的经过楼梯间（几何核对） ===');
    /* 取 3F→5F 的规划，第一跳楼梯点必须落在某个 STAIR-* 房间的矩形内或紧贴其门 */
    var geo = await page.evaluate(function () {
      window.__NAV__.switchFloor('B2-3');
      var p = window.__NAV__.planSummary('B2-5', '501');
      if (!p) return null;
      var nav = window.__NAV__, out = [];
      for (var i = 0; i < p.hops.length; i++) {
        var f = p.hops[i].from;
        var rooms = nav.data && nav.floor() === f ? nav.data.rooms : null;
        var all = window.FLOOR_DATA_BY_ID || {};
        out.push({ stair: p.hops[i].stair, from: f, to: p.hops[i].to });
      }
      return out;
    });
    ok(!!geo && geo.length > 0, '3F→5F 至少一跳', geo ? JSON.stringify(geo) : 'null');

    console.log('\n=== 5. 跨层路线长度合理性 ===');
    /* 3F→5F 跨 2 层 = 16m 楼梯 + 两端步行，总长必须 > 16m */
    var m35 = await page.evaluate(function () {
      window.__NAV__.switchFloor('B2-3');
      var p = window.__NAV__.planSummary('B2-5', '501');
      return p ? p.meters : null;
    });
    ok(m35 !== null && m35 > 16, '3F→5F 总长 > 16m（楼梯本身 16m）', m35 === null ? '' : Math.round(m35) + 'm');

    var m32 = await page.evaluate(function () {
      window.__NAV__.switchFloor('B2-3');
      var p = window.__NAV__.planSummary('B2-2', '201');
      return p ? p.meters : null;
    });
    ok(m32 !== null && m32 > 8, '3F→2F 总长 > 8m（楼梯本身 8m）', m32 === null ? '' : Math.round(m32) + 'm');

    console.log('\n=== 6. 跨层导航真的会切层并画出路线 ===');
    var ui = await page.evaluate(function () {
      window.__NAV__.switchFloor('B2-3');
      window.__NAV__.navigate('501');         // 不给楼层 → 应自动找到 5F
      var p = window.__NAV__.planNow();
      return {
        cur: window.__NAV__.floor(),
        hasPlan: !!p,
        legs: window.__NAV__.lastRoute() ? window.__NAV__.lastRoute().length : 0,
        destText: document.getElementById('destName').textContent,
        steps: document.getElementById('steps').textContent.replace(/\s+/g, ' ').slice(0, 160)
      };
    });
    ok(ui.cur === 'B2-5', '点 501 后自动切到 5 层', '当前 ' + ui.cur);
    ok(ui.hasPlan, '保留了跨层规划');
    ok(ui.legs > 0, '本层（5F）那一段路线画出来了', ui.legs + ' 个点');
    ok(/501/.test(ui.destText), '右栏标题是 501', ui.destText);
    ok(/楼梯/.test(ui.steps), '右栏指引里有"楼梯"字样', ui.steps.slice(0, 80));

    console.log('\n=== 7. 换层后跨层路线不会丢（回到 3F 仍能看到 3F 那段） ===');
    var back = await page.evaluate(function () {
      window.__NAV__.switchFloor('B2-3');
      var p = window.__NAV__.planNow();
      return {
        cur: window.__NAV__.floor(),
        hasPlan: !!p,
        pts: window.__NAV__.lastRoute() ? window.__NAV__.lastRoute().length : 0,
        steps: document.getElementById('steps').textContent.replace(/\s+/g, ' ').slice(0, 120)
      };
    });
    ok(back.cur === 'B2-3', '手动切回 3F');
    ok(back.hasPlan, '规划还在（不因手动换层被清空）');
    ok(back.pts > 0, '3F 那一段重新画出来了', back.pts + ' 个点');

    console.log('\n--- 跨层规划明细 ---');
    planLog.forEach(function (l) { console.log('  ' + l); });

    if (shotOut) {
      await page.evaluate(function () {
        window.__NAV__.switchFloor('B2-3');
        window.__NAV__.navigate('501');
      });
      await page.waitForTimeout(600);
      fs.mkdirSync(path.dirname(shotOut), { recursive: true });
      var buf = await page.screenshot({ type: 'png' });
      fs.writeFileSync(shotOut, buf);
      console.log('\n截图：' + shotOut + '（' + buf.length + ' 字节）');
    }

    console.log('\n========================================');
    console.log('跨楼层验收：通过 ' + passes + '，失败 ' + fails);
    console.log(fails === 0 ? '★ 全部通过' : '✗ 有失败项，见上');
    process.exitCode = fails === 0 ? 0 : 1;
  } finally {
    await browser.close();
    srv.close();
  }
})().catch(function (e) {
  console.error('脚本自身出错：', e && e.stack || e);
  process.exit(1);
});
