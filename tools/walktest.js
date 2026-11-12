#!/usr/bin/env node
/* =========================================================================
   tools/walktest.js —— 自动「走一遍」测试（无需人工操作）

   用法：
     node tools/walktest.js <目的地> [起点节点id]

   目的地可以是：房间号（如 333）、实验室 id（如 L333）、或名称关键字（如 精密测量）。
   起点默认 B2-3/n28（东走廊楼梯口）。

   它做三件事：
     1) 用寻路算法算出起点 → 目的地的节点路径；
     2) 逐段做射线碰撞检测：这段墙是不是把路堵了；
     3) 模拟「人」沿路径实际走一遍，看能不能真的走到门口。

   依赖项目里的 data/labs.js、data/B2-3F_grid.js、js/fp-core.js、js/router.js，
   都是纯数据/纯逻辑，Node 里可直接 require（脚本开头把 window 指到 global 兜底）。
   ========================================================================= */
'use strict';

global.window = global;

var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'data', 'labs.js'));
require(path.join(root, 'data', 'B2-3F_grid.js'));
var FPWorld = require(path.join(root, 'js', 'fp-core.js'));
require(path.join(root, 'js', 'router.js'));

var LabRouter = global.LabRouter;
var D = global.LAB_DATA;
var floor = null;
(D.floors || []).forEach(function (f) { if (f.id === 'B2-3') floor = f; });   // 本工具专测三楼
if (!floor) { console.log('ERROR: 没读到 B2-3 楼层数据'); process.exit(1); }

var world = FPWorld.create({
  grid: global.FLOOR_B2_3 || global.FLOOR_GRID,   // 新旧两套全局名都兼容
  rooms: floor.rooms || [],
  nodes: floor.nodes || [],
  edges: floor.edges || [],
  walls: global.FLOOR_B2_3_WALLS || global.FLOOR_WALLS || []
});
var G = LabRouter.buildGraph(D);

/* ---- 找目的地实验室 ---- */
var q = String(process.argv[2] || '').trim().toLowerCase();
if (!q) { console.log('请给一个目的地，例：node tools/walktest.js 333'); process.exit(1); }
var lab = null;
(D.labs || []).forEach(function (l) {
  if (!lab && (String(l.room) === q || String(l.id).toLowerCase() === q || (l.name || '').toLowerCase().indexOf(q) > -1)) lab = l;
});
if (!lab) { console.log('找不到实验室：' + process.argv[2]); process.exit(1); }

var start = process.argv[3] || 'B2-3/n28';
var route = LabRouter.routeToLab(G, start, lab, null);
if (!route) { console.log('寻路失败：起点 ' + start + ' 到 ' + lab.name + ' 未连通'); process.exit(1); }

console.log('目的地: ' + lab.name + '（房间 ' + lab.room + '，门节点 ' + (lab.door || '自动') + '）');
console.log('起点:   ' + start);
console.log('路线:   ' + route.nodes.join(' → '));
console.log('总长:   ' + Math.round(route.meters) + ' px ≈ ' + (route.meters * (D.metersPerPixel || 0.045)).toFixed(1) + ' 米');
console.log('');

/* ---- 逐段射线碰撞检测 ---- */
console.log('【1】逐段射线碰撞：');
var blocked = 0;
route.nodes.forEach(function (id, i) {
  if (i === 0) return;
  var a = G.nodes[route.nodes[i - 1]];
  var b = G.nodes[id];
  var dx = b.x - a.x, dy = b.y - a.y;
  var seg = Math.hypot(dx, dy);
  var th = Math.atan2(dy, dx) * 180 / Math.PI;
  var ray = world.castRay(a.x, a.y, th);
  var ok = ray.dist >= seg - 2;
  if (!ok) blocked++;
  var mark = ok ? '  通  ' : '**堵**';
  console.log('  ' + mark + ' ' + route.nodes[i - 1] + ' → ' + id +
    '  段长 ' + Math.round(seg) + 'px，射线 ' + Math.round(ray.dist) + 'px' +
    (ok ? '' : '（差 ' + Math.round(seg - ray.dist) + 'px，挡在 ' + Math.round(a.x + Math.cos(th * Math.PI / 180) * ray.dist) + ',' + Math.round(a.y + Math.sin(th * Math.PI / 180) * ray.dist) + '）'));
});
console.log('  小结：' + (route.nodes.length - 1) + ' 段里 ' + blocked + ' 段被墙挡');

/* ---- 节点落墙检查 ---- */
console.log('');
console.log('【2】路径节点落墙检查：');
var onWall = 0;
route.nodes.forEach(function (id) {
  var n = G.nodes[id];
  if (world.isWallPx(n.x, n.y)) {
    onWall++;
    console.log('  ** ' + id + ' 落在墙上（' + Math.round(n.x) + ',' + Math.round(n.y) + '）');
  }
});
if (!onWall) console.log('  路径上所有节点都不在墙上');

/* ---- 模拟行走 ---- */
console.log('');
console.log('【3】模拟行走（连续朝向，先转后走，与 fp.html 巡航一致）：');
function walkTo(p, to) {
  var lastDist = Infinity, stuck = 0;
  for (var s = 0; s < 3000; s++) {
    var dx = to.x - p.x, dy = to.y - p.y;
    var dist = Math.hypot(dx, dy);
    if (dist < 8) return { reached: true, steps: s, dist: 0 };
    var want = Math.atan2(dy, dx) * 180 / Math.PI;
    var dth = ((want - p.theta + 540) % 360) - 180;
    var fwd = Math.abs(dth) < 6 ? 1 : 0;   // 先转对齐再前进，避免拐点撞墙
    var np = world.step(p, { fwd: fwd, turnR: dth > 0.5 ? 1 : 0, turnL: dth < -0.5 ? 1 : 0 }, 0.02);
    p.x = np.x; p.y = np.y; p.theta = np.theta;
    if (fwd) { if (Math.abs(dist - lastDist) < 0.4) stuck++; else stuck = 0; if (stuck > 80) return { reached: false, steps: s, dist: dist, stuckAt: [Math.round(p.x), Math.round(p.y)] }; }
    lastDist = dist;
  }
  return { reached: false, steps: 3000, dist: lastDist };
}
var reachedAll = true;
var walker = { x: G.nodes[route.nodes[0]].x, y: G.nodes[route.nodes[0]].y, theta: 0 };
route.nodes.forEach(function (id, i) {
  if (i === 0) return;
  var b = G.nodes[id];
  var res = walkTo(walker, b);
  if (!res.reached) reachedAll = false;
  console.log('  ' + route.nodes[i - 1] + ' → ' + id + '  ' +
    (res.reached ? '走到（' + res.steps + ' 步）' : '卡住（' + res.steps + ' 步，剩 ' + Math.round(res.dist) + 'px' + (res.stuckAt ? '，卡在 ' + res.stuckAt : '') + '）'));
});

console.log('');
console.log('结论：' + (reachedAll && blocked === 0 && onWall === 0
  ? '✅ 全程可通行，能走到 ' + lab.name + ' 门口'
  : '⚠️ 有障碍（上面标注），' + lab.name + ' 目前走不到'));
