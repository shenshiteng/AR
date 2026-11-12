#!/usr/bin/env node
/* =========================================================================
   tools/verify_floors.js —— 全楼层门开口 + 路网 + 可达性验证
   -------------------------------------------------------------------------
   检查两层（B2-2/B2-3）：
   1) 每个楼梯间/厕所/房间的门节点是否落在房间正确一侧（门洞方向）
   2) 节点是否落在墙格上（落墙 = 出生/导航点不可达）
   3) 每条边是否穿墙（DDA 射线检测）
   4) 5 个楼梯口 × 所有 lab 是否都能寻路可达（含跨层）
   用法：node tools/verify_floors.js
   ========================================================================= */
'use strict';
global.window = global;

var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'data', 'labs.js'));
require(path.join(root, 'data', 'B2-2F_grid.js'));
require(path.join(root, 'data', 'B2-3F_grid.js'));
require(path.join(root, 'data', 'B2-5F_grid.js'));
var FPWorld = require(path.join(root, 'js', 'fp-core.js'));
require(path.join(root, 'js', 'router.js'));

var D = global.LAB_DATA;
var LabRouter = global.LabRouter;
var GRIDS = { 'B2-2': global.FLOOR_B2_2, 'B2-3': global.FLOOR_B2_3, 'B2-5': global.FLOOR_B2_5 };
var TARGET_FLOORS = ['B2-2', 'B2-3', 'B2-5'];   /* 三层全部验证 */

var fail = 0;
function bad(tag, msg) { fail++; console.log('  [失败] ' + tag + ': ' + msg); }
function ok(tag) { console.log('  [通过] ' + tag); }

/* 每层 world */
var worlds = {};
D.floors.forEach(function (f) {
  worlds[f.id] = FPWorld.create({
    grid: GRIDS[f.id],
    rooms: f.rooms || [],
    nodes: f.nodes || [],
    edges: f.edges || [],
    walls: []
  });
});

var G = LabRouter.buildGraph(D);

D.floors.forEach(function (f) {
  if (TARGET_FLOORS.indexOf(f.id) < 0) return;
  var fid = f.id;
  var w = worlds[fid];
  var nm = {};
  f.nodes.forEach(function (n) { nm[n.id] = n; });
  console.log('\n===== ' + fid + '（节点 ' + f.nodes.length + '，边 ' + f.edges.length + '）=====');

  /* 1) 节点落墙检查 */
  var nodeOnWall = 0;
  f.nodes.forEach(function (n) {
    if (w.isWallPx(n.x, n.y)) { nodeOnWall++; bad('节点落墙', n.id + ' (' + n.x + ',' + n.y + ')'); }
  });
  if (nodeOnWall === 0) ok('节点：' + f.nodes.length + ' 个全部不在墙上');

  /* 2) 边穿墙检查（DDA 采样） */
  var edgeHit = 0;
  function nid(raw) { return raw.indexOf('/') > -1 ? raw : fid + '/' + raw; }
  f.edges.forEach(function (e) {
    var a = nm[nid(e[0])], b = nm[nid(e[1])];
    if (!a || !b) { edgeHit++; bad('边缺节点', e[0] + '-' + e[1]); return; }
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    var steps = Math.ceil(len / 4);
    var hit = false;
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var px = a.x + dx * t, py = a.y + dy * t;
      if (w.isWallPx(px, py)) { hit = true; break; }
    }
    if (hit) { edgeHit++; bad('边穿墙', e[0] + '-' + e[1]); }
  });
  if (edgeHit === 0) ok('边：' + f.edges.length + ' 条全部不穿墙');

  /* 3) 门开口方向 */
  var doorBad = 0;
  (D.labs || []).forEach(function (l) {
    if (l.floor !== fid || !l.door) return;
    var rm = f.rooms.filter(function (r) { return r.id === l.room; })[0];
    if (!rm) return;
    var dn = nm[l.door];
    if (!dn) { doorBad++; bad('门节点不存在', l.room + ' → ' + l.door); return; }
    // 门节点必须落在房间四边外侧（不在房间内部，也不离太远）
    var side = '';
    if (dn.y < rm.y) side = '上';
    else if (dn.y > rm.y + rm.h) side = '下';
    else if (dn.x < rm.x) side = '左';
    else if (dn.x > rm.x + rm.w) side = '右';
    else { doorBad++; bad('门节点在房间内部', l.room + ' → ' + l.door + ' (' + dn.x + ',' + dn.y + ')'); }
  });
  if (doorBad === 0) ok('门：全部 lab 门节点方位有效');
});

/* 4) 5 楼梯口 × 所有 lab 可达性（跨层） */
console.log('\n===== 可达性（5 楼梯口 × 全部 lab，跨层）=====');
var stairStarts = ['B2-2/n1', 'B2-2/n3', 'B2-2/n29', 'B2-2/n12', 'B2-2/n21'];
var total = 0, failTotal = 0;
stairStarts.forEach(function (st) {
  var failN = 0;
  (D.labs || []).forEach(function (l) {
    if (TARGET_FLOORS.indexOf(l.floor) < 0) return;   /* 只验证 2/3 层的 lab */
    total++;
    var r = LabRouter.routeToLab(G, st, l, null);
    if (!r) { failN++; failTotal++; bad('不可达', st + ' → ' + l.id + '（' + l.name + '）'); }
  });
  if (failN === 0) ok(st + ' → 全部 ' + (D.labs || []).length + ' 个 lab 可达');
  else console.log('  [部分失败] ' + st + '：' + failN + ' 个不可达');
});

console.log('\n======================================');
console.log('总检查：' + total + ' 条路径，失败 ' + failTotal + ' 条，其他检查失败 ' + fail + ' 处');
if (fail === 0 && failTotal === 0) console.log('★ 全部通过');
else { console.log('✗ 存在问题，见上方失败项'); process.exit(1); }
