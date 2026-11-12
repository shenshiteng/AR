#!/usr/bin/env node
/* =========================================================================
   tools/fix_211_column.js —— 211/311、208/308 列上移，紧贴 212/312（两层同步）
   -------------------------------------------------------------------------
   用户要求：这几个房间相对位置不变，311/211 紧贴 312/212。
   修法（两层相同）：
   - 211/311: (360,1160) → (370,980)   顶边贴住 212/312 底边(y=980)，x 对齐
   - 208/308: (360,1230) → (370,1050)  紧贴 211/311 正下方
   门节点 n14(320,1050) 在新位置左侧 → 门开左墙朝西走廊，无需改 door。
   幂等：可重复运行。改完需重跑 gen_grid_from_data.js 重生成墙网格。
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

/* 楼层 → { 房间id: [新x, 新y] } */
var PLAN = {
  'B2-2': { '211': [370, 980], '208': [370, 1050] },
  'B2-3': { '311': [370, 980], '308': [370, 1050] }
};

Object.keys(PLAN).forEach(function (fid) {
  var f = D.floors.filter(function (x) { return x.id === fid; })[0];
  if (!f) { console.log('找不到楼层 ' + fid); return; }
  Object.keys(PLAN[fid]).forEach(function (rid) {
    var r = f.rooms.filter(function (x) { return x.id === rid; })[0];
    if (!r) { console.log(fid + ' 找不到房间 ' + rid); return; }
    var nx = PLAN[fid][rid][0], ny = PLAN[fid][rid][1];
    if (r.x === nx && r.y === ny) { console.log('  ' + fid + '/' + rid + ' 已在目标位置'); return; }
    console.log('  ' + fid + '/' + rid + ': (' + r.x + ',' + r.y + ') → (' + nx + ',' + ny + ')');
    r.x = nx; r.y = ny;
  });
});

var out = 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n';
fs.writeFileSync(labsPath, out, 'utf8');
console.log('已写回 data/labs.js');
