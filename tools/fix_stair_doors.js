#!/usr/bin/env node
/* =========================================================================
   tools/fix_stair_doors.js —— 修正西北/东北楼梯间门开口方向（两层同步）
   -------------------------------------------------------------------------
   问题：西北楼梯间门开在下边（应开右侧/东侧），东北楼梯间门开在上边（应开左侧/西侧）。
   原因：门开口方向由 lab.door 指向的节点相对房间的方位决定，而楼梯口节点 n1/n3
         位置放错了方位。
   修法：
   - 西北 STAIR-NW（x20-150,y20-220）：门应开东侧 → n1 从 (85,265) 移到 (210,120)，
     新增拐点 n40(210,265) 接北走廊；边 n1-n17 拆成 n1-n40+n40-n17，删 n1-n2。
   - 东北 STAIR-NE（x1180-1260,y310-440）：门应开西侧 → n3 从 (1240,265) 移到 (1160,375)，
     插入中庭东缘走廊 n16(1160,300)-n3(1160,375)-n25(1160,480)；
     边 n2-n3 改成 n2-n16，n16-n25 改成 n3-n25。
   幂等：可重复运行；改完用 tools/gen_grid_from_data.js 重生成墙网格并重新验证。
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

var FLOORS = ['B2-2', 'B2-3'];
var changed = 0;

FLOORS.forEach(function (fid) {
  var f = D.floors.filter(function (x) { return x.id === fid; })[0];
  if (!f) { console.log('  找不到楼层 ' + fid); return; }

  var nodes = f.nodes;
  var byId = {};
  nodes.forEach(function (n) { byId[n.id.split('/')[1]] = n; });

  // 1) 移动 n1 / n3
  if (byId['n1']) { byId['n1'].x = 210; byId['n1'].y = 120; changed++; }
  else { console.log('  ' + fid + ' 缺 n1'); }
  if (byId['n3']) { byId['n3'].x = 1160; byId['n3'].y = 375; changed++; }
  else { console.log('  ' + fid + ' 缺 n3'); }

  // 2) 新增拐点 n40（若已存在则不重复加）
  if (!byId['n40']) {
    nodes.push({ id: fid + '/n40', x: 210, y: 265, note: '西北楼梯口走廊拐点' });
    changed++;
  }

  // 3) 边调整
  var edges = f.edges;
  function has(a, b) { return edges.some(function (e) { return (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a); }); }
  function add(a, b) { if (!has(a, b)) { edges.push([a, b]); changed++; } }
  function del(a, b) {
    var i = edges.findIndex(function (e) { return (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a); });
    if (i >= 0) { edges.splice(i, 1); changed++; }
  }

  // 西北：n1-n17 拆 n1-n40 + n40-n17，删 n1-n2
  del('n1', 'n17');
  del('n1', 'n2');
  add('n1', 'n40');
  add('n40', 'n17');

  // 东北：n2-n3 改 n2-n16；n16-n25 改 n3-n25（保留 n3-n16）
  del('n2', 'n3');
  add('n2', 'n16');
  del('n16', 'n25');
  add('n3', 'n25');

  console.log('  ' + fid + ' 处理完成：节点数 ' + nodes.length + '，边数 ' + edges.length);
});

// 写回（无注释、无尾逗号、双引号）
var out = 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n';
fs.writeFileSync(labsPath, out, 'utf8');
console.log('已写回 data/labs.js，共修改 ' + changed + ' 处');
