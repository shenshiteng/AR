#!/usr/bin/env node
/* =========================================================================
   tools/walkdemo.js —— 第一人称探索的「逐步走查演示」

   实际控制角色（等价于游戏循环里的按键：先转向、再前进，逐帧 step）沿寻路
   路线走一遍，记录每一步的转向/前进/到达/碰撞，最后生成一张带轨迹的可视化
   页面 _walk.html：左 = 俯视轨迹图，右 = 逐步命令日志。

   用法：node tools/walkdemo.js <目的地> [起点节点id]   （默认 333 / n28）
   ========================================================================= */
'use strict';

global.window = global;

var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'data', 'labs.js'));
require(path.join(root, 'data', 'B2-3F_grid.js'));
var FPWorld = require(path.join(root, 'js', 'fp-core.js'));
require(path.join(root, 'js', 'router.js'));

var D = global.LAB_DATA;
var floor = D.floors[0];
var world = FPWorld.create({
  grid: global.FLOOR_GRID, rooms: floor.rooms, nodes: floor.nodes,
  edges: floor.edges, walls: global.FLOOR_WALLS
});
var G = global.LabRouter.buildGraph(D);

var q = String(process.argv[2] || '333').trim().toLowerCase();
var lab = null;
D.labs.forEach(function (l) {
  if (!lab && (String(l.room) === q || String(l.id).toLowerCase() === q || (l.name || '').toLowerCase().indexOf(q) > -1)) lab = l;
});
if (!lab) { console.log('找不到：' + process.argv[2]); process.exit(1); }
var startId = process.argv[3] || 'B2-3/n28';
var route = global.LabRouter.routeToLab(G, startId, lab, null);
if (!route) { console.log('寻路失败（未连通）'); process.exit(1); }

var DT = 0.05;
var turnSpeed = world.turnSpeed;   // 度/秒
var moveSpeed = world.moveSpeed;   // 像素/秒

var player = { x: G.nodes[route.nodes[0]].x, y: G.nodes[route.nodes[0]].y, theta: 0 };
var trace = [];       // 轨迹点 {x,y,theta}
var events = [];      // 逐步命令日志
trace.push({ x: player.x, y: player.y, theta: player.theta });

function turnTo(want) {
  var dth = ((want - player.theta + 540) % 360) - 180;
  if (Math.abs(dth) < 1) return 0;
  var steps = Math.ceil(Math.abs(dth) / (turnSpeed * DT));
  for (var i = 0; i < steps; i++) {
    player = world.step(player, { turnR: dth > 0 ? 1 : 0, turnL: dth < 0 ? 1 : 0 }, DT);
  }
  return dth;
}

function moveTo(tgt) {
  var startDist = Math.hypot(tgt.x - player.x, tgt.y - player.y);
  var steps = 0, stuck = 0, lastDist = Infinity, sample = 0;
  while (steps < 5000) {
    var dist = Math.hypot(tgt.x - player.x, tgt.y - player.y);
    if (dist < 8) return { ok: true, steps: steps, traveled: startDist, hit: null };
    var want = Math.atan2(tgt.y - player.y, tgt.x - player.x) * 180 / Math.PI;
    var dth = ((want - player.theta + 540) % 360) - 180;
    var fwd = Math.abs(dth) < 6 ? 1 : 0;   // 先转对齐再前进，避免拐点撞墙
    var before = { x: player.x, y: player.y };
    player = world.step(player, { fwd: fwd, turnR: dth > 0.5 ? 1 : 0, turnL: dth < -0.5 ? 1 : 0 }, DT);
    steps++;
    if (fwd) { if (Math.abs(dist - lastDist) < 0.5) stuck++; else stuck = 0; }
    if (stuck > 60) return { ok: false, steps: steps, traveled: startDist - dist, hit: { x: Math.round(player.x), y: Math.round(player.y), dist: dist } };
    lastDist = dist;
    if (++sample % 10 === 0) trace.push({ x: player.x, y: player.y, theta: player.theta });
  }
  return { ok: false, steps: steps, traveled: startDist - lastDist, hit: { x: Math.round(player.x), y: Math.round(player.y), dist: lastDist } };
}

events.push('起点 ' + route.nodes[0] + '（' + Math.round(player.x) + ',' + Math.round(player.y) + '）朝向 ' + Math.round(player.theta) + '°');

var reached = true;
for (var k = 1; k < route.nodes.length; k++) {
  var n = G.nodes[route.nodes[k]];
  var dx = n.x - player.x, dy = n.y - player.y;
  var want = Math.atan2(dy, dx) * 180 / Math.PI;
  var dth = turnTo(want);
  if (Math.abs(dth) >= 1) {
    events.push('→ 转向 ' + (dth > 0 ? '右' : '左') + '转 ' + Math.round(Math.abs(dth)) + '°（现在朝向 ' + Math.round(player.theta) + '°）');
    trace.push({ x: player.x, y: player.y, theta: player.theta });
  }
  var mv = moveTo(n);
  var seg = Math.hypot(n.x - G.nodes[route.nodes[k - 1]].x, n.y - G.nodes[route.nodes[k - 1]].y);
  if (mv.ok) {
    events.push('→ 前进 ' + Math.round(seg) + 'px（' + (mv.steps * DT).toFixed(1) + ' 秒 / ' + mv.steps + ' 步）');
    events.push('  ✓ 到达 ' + route.nodes[k] + '（' + Math.round(player.x) + ',' + Math.round(player.y) + '）');
    trace.push({ x: player.x, y: player.y, theta: player.theta });
  } else {
    reached = false;
    events.push('→ 前进时 ** 被墙挡住 **：走了 ' + Math.round(mv.traveled) + 'px 后卡在 (' + mv.hit.x + ',' + mv.hit.y + ')，距目标还有 ' + Math.round(mv.hit.dist) + 'px');
    trace.push({ x: mv.hit.x, y: mv.hit.y, theta: player.theta });
    break;
  }
}
if (reached) events.push('终点：到达 ' + lab.name + '（' + lab.room + '）门口');
else events.push('终点：未能到达 ' + lab.name + '，演示中断在上一段');

/* ---------- 生成可视化 HTML ---------- */
var wallsSvg = (global.FLOOR_WALLS || []).map(function (w) {
  return '<rect x="' + w[0] + '" y="' + w[1] + '" width="' + Math.max(w[4], 2) + '" height="' + Math.max(w[5], 2) + '" fill="#3c4148"/>';
}).join('');
var removedSvg = (global.FLOOR_WALLS_REMOVED || []).map(function (w) {
  return '<rect x="' + w[0] + '" y="' + w[1] + '" width="' + Math.max(w[4], 2) + '" height="' + Math.max(w[5], 2) + '" fill="#fbbf24" fill-opacity="0.55"/>';
}).join('');
var roomsSvg = floor.rooms.map(function (r) {
  var c = { lab: '#dbeafe', office: '#d1fae5', room: '#ede9fe', store: '#fef3c7', service: '#e5e7eb', toilet: '#dcfce7' }[r.kind] || '#e5e7eb';
  return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="' + c + '" stroke="#94a3b8" stroke-width="1"/>' +
    '<text x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h / 2) + '" text-anchor="middle" font-size="14" fill="#334155">' + r.id + '</text>';
}).join('');
var nodeMap = {};
floor.nodes.forEach(function (n) { nodeMap[n.id] = n; });
var edgesSvg = floor.edges.map(function (e) {
  var a = nodeMap[e[0]], b = nodeMap[e[1]];
  return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#60a5fa" stroke-width="3" stroke-opacity="0.5"/>';
}).join('');
var nodesSvg = floor.nodes.map(function (n) {
  return '<circle cx="' + n.x + '" cy="' + n.y + '" r="5" fill="#2563eb" stroke="#fff" stroke-width="1.5"/>';
}).join('');
var tracePts = trace.map(function (t) { return Math.round(t.x) + ',' + Math.round(t.y); }).join(' ');
var arrowsSvg = trace.filter(function (_, i) { return i % Math.max(1, Math.floor(trace.length / 12)) === 0 || i === trace.length - 1; }).map(function (t) {
  var rad = t.theta * Math.PI / 180;
  var hx = t.x + Math.cos(rad) * 22, hy = t.y + Math.sin(rad) * 22;
  return '<line x1="' + t.x + '" y1="' + t.y + '" x2="' + hx + '" y2="' + hy + '" stroke="#e11d48" stroke-width="3"/>';
}).join('');

var logs = events.map(function (e) { return '<li>' + e.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</li>'; }).join('');

var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>走查演示 · ' + lab.room + '</title><style>' +
  'body{margin:0;background:#0f1419;color:#e6ebf2;font:14px/1.6 system-ui,sans-serif;display:flex;height:100vh;overflow:hidden}' +
  '.map{flex:1;padding:12px;min-width:0}.map svg{width:100%;height:100%;background:#0a0e13;border-radius:8px}' +
  '.side{width:380px;border-left:1px solid #2a3340;padding:16px;overflow:auto;background:#171d26}' +
  'h2{font-size:15px;margin:0 0 10px}h3{font-size:13px;color:#8b98a8;margin:14px 0 6px}' +
  'li{margin:4px 0;font:12px/1.7 ui-monospace,Menlo,Consolas,monospace;color:#cbd5e1}' +
  '.ok{color:#4ade80}.bad{color:#f87171}.legend{font-size:12px;color:#8b98a8;line-height:1.9}' +
  '.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}</style></head><body>' +
  '<div class="map"><svg viewBox="0 0 ' + floor.width + ' ' + floor.height + '" preserveAspectRatio="xMidYMid meet">' +
  '<rect width="' + floor.width + '" height="' + floor.height + '" fill="#0a0e13"/>' +
  roomsSvg + removedSvg + wallsSvg + edgesSvg +
  '<polyline points="' + tracePts + '" fill="none" stroke="#f43f5e" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="0.9"/>' +
  arrowsSvg + nodesSvg +
  '<circle cx="' + G.nodes[route.nodes[0]].x + '" cy="' + G.nodes[route.nodes[0]].y + '" r="10" fill="#22c55e" stroke="#fff" stroke-width="2"/>' +
  '<circle cx="' + player.x + '" cy="' + player.y + '" r="12" fill="#e11d48" stroke="#fff" stroke-width="2.5"/>' +
  '</svg></div>' +
  '<div class="side"><h2>走查演示：' + lab.name + '</h2>' +
  '<div class="legend">' +
  '<span class="sw" style="background:#60a5fa"></span>路网（可走走廊）<br>' +
  '<span class="sw" style="background:#3c4148"></span>保留墙<br>' +
  '<span class="sw" style="background:#fbbf24"></span>被删墙<br>' +
  '<span class="sw" style="background:#f43f5e"></span>实际行走轨迹 · 箭头=朝向<br>' +
  '<span class="sw" style="background:#22c55e"></span>起点　<span class="sw" style="background:#e11d48"></span>终点</div>' +
  '<h3>逐步命令日志</h3><ol>' + logs + '</ol></div></body></html>';

var out = path.join(root, '_walk.html');
fs.writeFileSync(out, html, 'utf8');
console.log('已生成 ' + out);
console.log('路线: ' + route.nodes.join(' → '));
console.log('结论: ' + (reached ? '全程可通行' : '有障碍中断'));
events.forEach(function (e) { console.log('  ' + e); });
