#!/usr/bin/env node
/* =========================================================================
   gen_grid_from_data.js —— 从 data/labs.js 程序化生成某楼层的墙网格
   -------------------------------------------------------------------------
   用途：新楼层没有「红墙照片」可用时（如 5 层这种干净示意图），
   直接用 rooms 矩形 + labs.door 门节点生成：
     - window.FLOOR_GRID_<前缀>  墙掩码（4px 格，'1'=墙）
     - window.FLOOR_WALLS_<前缀> 墙矩形列表（第一人称 3D 渲染用）
     - window.FLOOR_WALLS_REMOVED_<前缀> 空数组（总览黄色层，保持接口一致）

   规则（保守版，与 3 层清理哲学一致）：
     1. 每个房间矩形四边 = 墙（厚 8px）；
     2. 朝走廊的边按 labs.door 门节点开 60px 宽门洞；
     3. 地图最外一圈封墙，防玩家走出世界；
     4. 走廊 = 房间之外的自然空地，不画任何墙。

   用法：
     node tools/gen_grid_from_data.js --floor B2-5 --out data/B2-5F_grid.js --prefix FLOOR_B2_5
   ========================================================================= */
'use strict';
var fs = require('fs');
var path = require('path');

/* ---------- 参数 ---------- */
var args = process.argv.slice(2);
function argOf(name, def) {
  var i = args.indexOf(name);
  return (i > -1 && args[i + 1]) ? args[i + 1] : def;
}
var floorId = argOf('--floor', null);
var outFile = argOf('--out', null);
var prefix = argOf('--prefix', 'FLOOR_' + (floorId || '').replace(/[^A-Za-z0-9]/g, '_'));
var CELL = parseInt(argOf('--cell', '4'), 10);
var WALL_T = parseInt(argOf('--wall-thickness', '8'), 10);  // 墙厚 px
var DOOR_W = parseInt(argOf('--door-width', '60'), 10);     // 门洞宽 px

if (!floorId || !outFile) {
  console.error('用法: node tools/gen_grid_from_data.js --floor <楼层ID> --out <输出.js> [--prefix <变量前缀>]');
  process.exit(1);
}

/* ---------- 读 labs.js（假 window 环境 eval） ---------- */
var labsPath = path.join(__dirname, '..', 'data', 'labs.js');
var sandboxWindow = {};
/* eslint-disable no-unused-vars */
var window = sandboxWindow;
eval(fs.readFileSync(labsPath, 'utf8'));
var D = sandboxWindow.LAB_DATA;
if (!D) { console.error('labs.js 解析失败'); process.exit(1); }

var floor = null;
(D.floors || []).forEach(function (f) { if (f.id === floorId) floor = f; });
if (!floor) { console.error('找不到楼层 ' + floorId); process.exit(1); }

var nodes = {};
(floor.nodes || []).forEach(function (n) { nodes[n.id] = n; });
/* 每个房间的门：从 labs 里收集（lab.floor 匹配、lab.room === room.id、lab.door 存在） */
var doorsByRoom = {};
(D.labs || []).forEach(function (l) {
  if (l.floor !== floorId || !l.room || !l.door || !nodes[l.door]) return;
  if (!doorsByRoom[l.room]) doorsByRoom[l.room] = [];
  doorsByRoom[l.room].push(nodes[l.door]);
});

/* ---------- 建网格 ---------- */
var cols = Math.ceil(floor.width / CELL);
var rows = Math.ceil(floor.height / CELL);
var grid = [];
for (var r = 0; r < rows; r++) grid.push(new Uint8Array(cols));

function fillRect(x, y, w, h) {
  var c1 = Math.floor(x / CELL), c2 = Math.ceil((x + w) / CELL);
  var r1 = Math.floor(y / CELL), r2 = Math.ceil((y + h) / CELL);
  for (var rr = Math.max(0, r1); rr < Math.min(rows, r2); rr++)
    for (var cc = Math.max(0, c1); cc < Math.min(cols, c2); cc++)
      grid[rr][cc] = 1;
}

/* ---------- 房间 → 四边墙（含门洞切割） ---------- */
var walls = [];   // [x1, y1, x2, y2, w, h]，x2=x1+w, y2=y1+h

/* 把一条「水平墙条」按门洞切割后加入 */
function addHWall(x1, y, w, doorGaps) {
  var segs = [[x1, x1 + w]];
  (doorGaps || []).forEach(function (g) {
    var next = [];
    segs.forEach(function (s) {
      if (g[1] <= s[0] || g[0] >= s[1]) { next.push(s); return; }
      if (g[0] > s[0]) next.push([s[0], g[0]]);
      if (g[1] < s[1]) next.push([g[1], s[1]]);
    });
    segs = next;
  });
  segs.forEach(function (s) {
    if (s[1] - s[0] < 2) return;
    walls.push([s[0], y, s[0] + (s[1] - s[0]), y + WALL_T, s[1] - s[0], WALL_T]);
  });
}
function addVWall(x, y1, h, doorGaps) {
  var segs = [[y1, y1 + h]];
  (doorGaps || []).forEach(function (g) {
    var next = [];
    segs.forEach(function (s) {
      if (g[1] <= s[0] || g[0] >= s[1]) { next.push(s); return; }
      if (g[0] > s[0]) next.push([s[0], g[0]]);
      if (g[1] < s[1]) next.push([g[1], s[1]]);
    });
    segs = next;
  });
  segs.forEach(function (s) {
    if (s[1] - s[0] < 2) return;
    walls.push([x, s[0], x + WALL_T, s[0] + (s[1] - s[0]), WALL_T, s[1] - s[0]]);
  });
}

(floor.rooms || []).forEach(function (rm) {
  var gaps = { top: [], bottom: [], left: [], right: [] };
  (doorsByRoom[rm.id] || []).forEach(function (n) {
    /* 门节点在房间哪一侧？门洞中心收进房间范围（保证完整开在本房间边上） */
    if (n.y < rm.y) {
      var gx = Math.min(Math.max(n.x, rm.x + DOOR_W / 2 + 4), rm.x + rm.w - DOOR_W / 2 - 4);
      gaps.top.push([gx - DOOR_W / 2, gx + DOOR_W / 2]);
    } else if (n.y > rm.y + rm.h) {
      var gx2 = Math.min(Math.max(n.x, rm.x + DOOR_W / 2 + 4), rm.x + rm.w - DOOR_W / 2 - 4);
      gaps.bottom.push([gx2 - DOOR_W / 2, gx2 + DOOR_W / 2]);
    } else if (n.x < rm.x) {
      var gy = Math.min(Math.max(n.y, rm.y + DOOR_W / 2 + 4), rm.y + rm.h - DOOR_W / 2 - 4);
      gaps.left.push([gy - DOOR_W / 2, gy + DOOR_W / 2]);
    } else if (n.x > rm.x + rm.w) {
      var gy2 = Math.min(Math.max(n.y, rm.y + DOOR_W / 2 + 4), rm.y + rm.h - DOOR_W / 2 - 4);
      gaps.right.push([gy2 - DOOR_W / 2, gy2 + DOOR_W / 2]);
    }
  });
  addHWall(rm.x - WALL_T, rm.y - WALL_T, rm.w + WALL_T * 2, gaps.top);      /* 上边（含角） */
  addHWall(rm.x - WALL_T, rm.y + rm.h, rm.w + WALL_T * 2, gaps.bottom);     /* 下边 */
  addVWall(rm.x - WALL_T, rm.y, rm.h, gaps.left);                            /* 左边 */
  addVWall(rm.x + rm.w, rm.y, rm.h, gaps.right);                             /* 右边 */
});

/* 外框封一圈，防走出世界 */
fillRect(0, 0, cols * CELL, WALL_T);
fillRect(0, rows * CELL - WALL_T, cols * CELL, WALL_T);
fillRect(0, 0, WALL_T, rows * CELL);
fillRect(cols * CELL - WALL_T, 0, WALL_T, rows * CELL);

/* 墙矩形栅格化进网格 */
walls.forEach(function (w) { fillRect(w[0], w[1], w[4], w[5]); });

/* ---------- 路网保路：挖掉边线通道里的墙格 ----------
   玩家碰撞半径 12px，只贴路网线走会被房间墙角擦住（走廊窄点）。
   与 grid_to_js.py 的 corridor-half-px 同思路：路网边说「能走」，
   就把边线两侧 CARVE_PX 内的墙格挖掉（不动最外圈外框，防挖穿世界）。 */
var CARVE_PX = parseInt(argOf('--carve-px', '16'), 10);
(function carveCorridors() {
  var edges = floor.edges || [];
  function nodeOf(ref) {
    return nodes[ref] || nodes[floorId + '/' + ref];   // 兼容简写（无楼层前缀）
  }
  edges.forEach(function (e) {
    var a = nodeOf(e[0]), b = nodeOf(e[1]);
    if (!a || !b) return;
    if (String(a.id).split('/')[0] !== floorId || String(b.id).split('/')[0] !== floorId) return;  // 跳过跨层楼梯边
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (!len) return;
    var steps = Math.max(1, Math.ceil(len / 2));
    for (var i = 0; i <= steps; i++) {
      var px = a.x + dx * i / steps, py = a.y + dy * i / steps;
      var c0 = Math.max(1, Math.floor((px - CARVE_PX) / CELL));
      var c1 = Math.min(cols - 2, Math.ceil((px + CARVE_PX) / CELL));
      var r0 = Math.max(1, Math.floor((py - CARVE_PX) / CELL));
      var r1 = Math.min(rows - 2, Math.ceil((py + CARVE_PX) / CELL));
      for (var rr = r0; rr <= r1; rr++) {
        for (var cc = c0; cc <= c1; cc++) {
          var cx = cc * CELL + CELL / 2, cy = rr * CELL + CELL / 2;
          var t = ((cx - a.x) * dx + (cy - a.y) * dy) / (len * len);
          t = Math.max(0, Math.min(1, t));
          var ddx = cx - (a.x + dx * t), ddy = cy - (a.y + dy * t);
          if (Math.hypot(ddx, ddy) <= CARVE_PX) grid[rr][cc] = 0;
        }
      }
    }
  });
})();

/* ---------- 输出 ---------- */
var data = '';
for (r = 0; r < rows; r++) {
  var line = '';
  for (var c = 0; c < cols; c++) line += grid[r][c] ? '1' : '0';
  data += line;
}

var js = '/* 自动生成：node tools/gen_grid_from_data.js --floor ' + floorId + '\n'
  + '   不要手改本文件；改 data/labs.js 后重新运行生成命令。 */\n'
  + 'window.' + prefix + ' = ' + JSON.stringify({
    cols: cols, rows: rows, cell: CELL,
    width: cols * CELL, height: rows * CELL, data: data
  }) + ';\n'
  + 'window.' + prefix + '_WALLS = ' + JSON.stringify(walls) + ';\n'
  + 'window.' + prefix + '_REMOVED = [];\n';

fs.writeFileSync(path.join(__dirname, '..', outFile), js);
console.log('[' + floorId + '] 网格 ' + cols + 'x' + rows + ' 格（' + (cols * CELL) + 'x' + (rows * CELL) + ' px）');
console.log('  房间 ' + (floor.rooms || []).length + ' 个，墙矩形 ' + walls.length + ' 条，输出 ' + outFile);
