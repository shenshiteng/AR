#!/usr/bin/env node
/* =========================================================================
   tools/move_se_stair.js —— 东南楼梯移到 330 右边（下排），两层同步
   -------------------------------------------------------------------------
   最终布局：上排 [331][329]（已就位），下排 [330][楼梯]。
   329/331/330 都不动，只把东南楼梯从 330 上方移到 330 右边。
   - STAIR-SE/STAIR-2SE：(1050,890,100,140) → (1190,1030,70,70)
   - 楼梯门 n21：(1120,1200) → (1225,1200)（楼梯正下方，门朝下）
   楼梯放 1190-1260（避开中庭走廊 x=1160，该走廊在 330 右侧 1150-1190 空隙内）。
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

var STAIR = { 'B2-2': 'STAIR-2SE', 'B2-3': 'STAIR-SE' };

['B2-2', 'B2-3'].forEach(function (fid) {
  var f = D.floors.filter(function (x) { return x.id === fid; })[0];
  if (!f) { console.log('找不到楼层 ' + fid); return; }
  console.log('==== ' + fid + ' ====');

  /* 楼梯移到 330 右边 */
  var rid = STAIR[fid];
  var r = f.rooms.filter(function (z) { return z.id === rid; })[0];
  if (r) {
    console.log('  ' + rid + ' (' + r.x + ',' + r.y + ',' + r.w + ',' + r.h + ') → (1190,1030,70,70)');
    r.x = 1190; r.y = 1030; r.w = 70; r.h = 70;
  }

  /* 楼梯门 n21 移到楼梯正下方 */
  f.nodes.forEach(function (n) {
    if (n.id === fid + '/n21') { n.x = 1225; n.y = 1200; console.log('  n21 → (1225,1200)'); }
  });
});

var out = 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n';
fs.writeFileSync(labsPath, out, 'utf8');
console.log('已写回 data/labs.js');
