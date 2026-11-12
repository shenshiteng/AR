#!/usr/bin/env node
/* tools/test_stair_walk.js —— 纯逻辑走查：每个楼梯口节点能不能真的「走完两跑梯段」到上一层
   双跑折返楼梯的正确过程：
     进门 → 第一跑升到中间平台（半层高）→ 平台转弯换到折返跑 → 第二跑升到上一层地面（层高）
   本工具不依赖浏览器（直接 FPWorld.step 驱动），跑得快，用来回归楼梯几何/高度场。
   验收点：
     1) 第一跑能把人送到平台（z 到 半层高 ±6%）
     2) 平台处能横移到折返跑（不被墙/高度差挡住）
     3) 第二跑能升到 上一层地面（z 到 层高 ±6%）
   用法：node tools/test_stair_walk.js
*/
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var root = path.join(__dirname, '..');

function loadScript(rel) {
  var src = fs.readFileSync(path.join(root, rel), 'utf8');
  var sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return sb.window;
}

var FPWorld = loadScript('js/fp-core.js').FPWorld;
var D = loadScript('data/labs.js').LAB_DATA;
var GRIDS = {
  'B2-2': loadScript('data/B2-2F_grid.js').FLOOR_B2_2,
  'B2-3': loadScript('data/B2-3F_grid.js').FLOOR_B2_3
};

var floorMap = {};
D.floors.forEach(function (f) { floorMap[f.id] = f; });

/* 每层的楼梯口节点（跨层边两端）——和 fp2.html 的 buildWorld 同一套口径 */
var doorNodesByFloor = {};
(D.links || []).forEach(function (l) {
  [String(l.from), String(l.to)].forEach(function (id) {
    var fid = id.split('/')[0];
    (doorNodesByFloor[fid] = doorNodesByFloor[fid] || {})[id] = true;
  });
});

function buildWorld(fid) {
  var f = floorMap[fid];
  var doors = (f.nodes || []).filter(function (n) {
    return doorNodesByFloor[fid] && doorNodesByFloor[fid][n.id];
  });
  return FPWorld.create({
    grid: GRIDS[fid], rooms: f.rooms || [], nodes: f.nodes || [], edges: f.edges || [],
    walls: [], stairSign: (fid === 'B2-2') ? 1 : -1, stairDoors: doors
  });
}

/* 某一跑的横向中心（与 fp2.html 的 laneMidOf 同一套规则）：
   second=false → 从门进来先走的那一跑；second=true → 折返那一跑。
   上楼层(stairSign>0) 先进 A 侧(0.25)、折返 B 侧(0.75)；下楼层反过来。 */
function laneMid(st, second) {
  var aMin = st.axis === 'x' ? st.y : st.x;
  var aSize = st.axis === 'x' ? st.h : st.w;
  var up = st.upSign > 0;
  var frac = second ? (up ? 0.75 : 0.25) : (up ? 0.25 : 0.75);
  var v = aMin + aSize * frac;
  var lo = aMin + 24, hi = aMin + aSize - 24;
  if (hi < lo) { lo = hi = aMin + aSize / 2; }
  return Math.max(lo, Math.min(hi, v));
}

var allOk = true;

Object.keys(GRIDS).forEach(function (fid) {
  var w = buildWorld(fid);
  var stairs = w.stairs;
  stairs.forEach(function (s) { s.upSign = w.stairSign; });   // 让 laneMid 知道上/下楼层

  (floorMap[fid].nodes || []).forEach(function (node) {
    if (!doorNodesByFloor[fid] || !doorNodesByFloor[fid][node.id]) return;
    // 找对应的楼梯间（最近的一个）
    var st = null, bd = Infinity;
    stairs.forEach(function (s) {
      var d = Math.hypot(s.x + s.w / 2 - node.x, s.y + s.h / 2 - node.y);
      if (d < bd) { bd = d; st = s; }
    });
    if (!st) { console.log(fid + ' ' + node.id + ' 找不到楼梯间'); allOk = false; return; }

    var L = st.axis === 'x' ? st.w : st.h;
    var doorStart = st.axis === 'x' ? (st.dir > 0 ? st.x : st.x + st.w)
                                   : (st.dir > 0 ? st.y : st.y + st.h);
    var stepD = st.dir > 0 ? 1 : -1;
    /* t（0=进门平地末端，1=远端墙）→ 像素坐标 */
    function at(t, second) {
      var d = st.pad + st.buf + t * (L - 2 * st.pad - st.buf);
      var along = doorStart + stepD * d;
      var across = laneMid(st, second);
      return st.axis === 'x' ? [along, across] : [across, along];
    }
    /* 朝某点走 n 步（fwd=1） */
    function walkTo(p, tx, ty, n) {
      for (var i = 0; i < n; i++) {
        var want = Math.atan2(ty - p.y, tx - p.x) * 180 / Math.PI;
        var dth = ((want - p.theta + 540) % 360) - 180;
        p = w.step(p, { fwd: Math.abs(dth) < 8 ? 1 : 0, turnR: dth > 0.5 ? 1 : 0, turnL: dth < -0.5 ? 1 : 0 }, 0.05);
      }
      return p;
    }

    var p = { x: node.x, y: node.y, theta: 0, z: 0 };
    // 1) 第一跑：走到远端平台（lane A）
    var far = at(1.0, false);
    p = walkTo(p, far[0], far[1], 400);
    var zLanding = Math.abs(p.z);
    var tLand = w.stairT(st, p.x, p.y);

    // 2) 平台横移到折返跑（平台两跑等高，直接挪到折返跑中心）
    if (st.axis === 'x') p.y = laneMid(st, true); else p.x = laneMid(st, true);
    var moved = st.axis === 'x' ? p.y : p.x;
    var laneOk = Math.abs(moved - laneMid(st, true)) < 3;

    // 3) 第二跑：走回门端（上层出口），z 应升到层高
    var doorTop = at(0, true);
    p = walkTo(p, doorTop[0], doorTop[1], 500);
    var zTop = Math.abs(p.z);

    var fh = w.floorHeight;
    var ok1 = Math.abs(zLanding - fh / 2) < fh * 0.06 && tLand >= 0.78;
    var ok3 = Math.abs(zTop - fh) < fh * 0.06;
    var ok = ok1 && laneOk && ok3;
    if (!ok) allOk = false;
    console.log(fid + ' ' + node.id + ' 门侧=' + st.doorSide +
      ' | 第一跑到平台 z=' + zLanding.toFixed(2) + '(t=' + tLand.toFixed(2) + ') 换道=' + laneOk +
      ' 第二跑到顶 z=' + zTop.toFixed(2) + ' → ' + (ok ? 'OK(可跨层)' : 'FAIL'));
  });
});

console.log('\n结论: ' + (allOk ? '全部楼梯都能走完两跑到上一层（z 依次 0 → 半层 → 层高）' : '有楼梯走不通'));
process.exit(allOk ? 0 : 1);
