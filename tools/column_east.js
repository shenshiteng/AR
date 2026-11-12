#!/usr/bin/env node
/* =========================================================================
   tools/column_east.js —— 329/330/楼梯 竖排成一列（两层同步）
   -------------------------------------------------------------------------
   用户逐步要求：
   1. 329 和 331 互换位置（3层；2层 229 和 230 互换）
   2. 329 保持不动，330 移到 329 下方竖排
   3. 楼梯移到 330 下方，与 329/330 竖排成一列
   最终：x=1190~1250 一竖列，从上到下 329→330→楼梯；331 在右边。
   - 329/229 → (1190,820,60,70)   331/230 → (1250,820,60,70)
   - 330/231 → (1190,890,60,70)   楼梯 → (1190,960,60,70)
   - 节点 n42 (1160,1065)→(1160,925)（330 门朝左）
   幂等。改完重跑 gen_grid_from_data.js + verify_floors.js。
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var labsPath = path.join(root, 'data', 'labs.js');
var src = fs.readFileSync(labsPath, 'utf8');

var m = src.match(/window\.LAB_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
if (!m) { console.error('没找到 window.LAB_DATA'); process.exit(1); }
var D = eval('(' + m[1] + ')');

var PLAN = {
  'B2-2': { a: '229', b: '230', vert: '231', stair: 'STAIR-2SE' },
  'B2-3': { a: '329', b: '331', vert: '330', stair: 'STAIR-SE' }
};

['B2-2', 'B2-3'].forEach(function (fid) {
  var f = D.floors.filter(function (x) { return x.id === fid; })[0];
  if (!f) { console.log('找不到楼层 ' + fid); return; }
  var P = PLAN[fid];
  console.log('==== ' + fid + ' ====');

  function setRoom(id, x, y, w, h) {
    var r = f.rooms.filter(function (z) { return z.id === id; })[0];
    if (!r) { console.log('  找不到房间 ' + id); return; }
    r.x = x; r.y = y; r.w = w; r.h = h;
    console.log('  ' + id + ' → (' + x + ',' + y + ',' + w + ',' + h + ')');
  }

  /* 1) 329/331 互换：a 到左(1190)，b 到右(1250) */
  setRoom(P.a, 1190, 820, 60, 70);
  setRoom(P.b, 1250, 820, 60, 70);
  /* 2) 330 移到 329 下方 */
  setRoom(P.vert, 1190, 890, 60, 70);
  /* 3) 楼梯移到 330 下方 */
  setRoom(P.stair, 1190, 960, 60, 70);

  /* 节点 n42 移到 330 左侧 */
  f.nodes.forEach(function (n) {
    if (n.id === fid + '/n42') { n.x = 1160; n.y = 925; console.log('  n42 → (1160,925)'); }
  });
});

var out = 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n';
fs.writeFileSync(labsPath, out, 'utf8');
console.log('已写回 data/labs.js');
