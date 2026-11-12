#!/usr/bin/env node
/* =========================================================================
   tools/align_south.js —— 西南/东南角楼梯厕所与 307/304/303 排对齐（两层同步）
   -------------------------------------------------------------------------
   用户要求：西南角楼梯+厕所、东南角楼梯，与 307/304/303（2层 207/204/203）并排对齐
   到同一水平排（y 980~1120，高 140）。东南角楼梯与东走廊竖列重叠 → 竖列整体缩窄
   让位（x 1180→1190、w 80→70），排列方式不变。
   =========================================================================
   房间移动：
   - 西南角(y=1160 的 WC/STAIR-SW)：y 1160→980，x 不变
   - 东南角 STAIR-SE：x 1100→1050，y 1160→980
   - 东走廊竖列(x=1180,w=80)：x→1190，w→70（STAIR-NE/WC/327/328/329/330/331 等）
   节点：
   - n12 (230,1345)→(230,1200) 西南楼梯口
   - n21 (1170,1345)→(1120,1200) 东南楼梯口
   - n34 (320,1120)→(320,1200) 统一 y=1200 南走廊
   - 新增 n41 (80,1200) 西南厕所门前
   门字段：西南厕所 WC door n35→n41
   边：删 n35-n12、n12-n11、n38-n21；加 n41-n12、n12-n34、n27-n21、n35-n11
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

function has(edges, a, b) {
  return edges.some(function (e) { return (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a); });
}

/* 西南厕所房名 → 各层实际 id（用于 door 字段改 n35→n41） */
var WC_SW_IDS = {
  'B2-2': ['WC-2SW1', 'WC-2SW2'],
  'B2-3': ['WC-S1', 'WC-S2']
};

['B2-2', 'B2-3'].forEach(function (fid) {
  var f = D.floors.filter(function (x) { return x.id === fid; })[0];
  if (!f) { console.log('找不到楼层 ' + fid); return; }
  console.log('==== ' + fid + ' ====');

  /* 1) 房间：西南角 y 1160→980 */
  f.rooms.forEach(function (r) {
    if (r.y === 1160 && r.kind !== 'stair') { r.y = 980; console.log('  西南角 ' + r.id + ': y→980'); }
  });
  /* 西南楼梯（STAIR-2SW/STAIR-SW，x=160,y=1160） */
  f.rooms.forEach(function (r) {
    if (r.kind === 'stair' && r.x === 160 && r.y === 1160) { r.y = 980; console.log('  西南楼梯 ' + r.id + ': y→980'); }
  });
  /* 东南楼梯 STAIR-SE：x 1100→1050，y 1160→980 */
  f.rooms.forEach(function (r) {
    if (r.kind === 'stair' && r.x === 1100 && r.y === 1160) { r.x = 1050; r.y = 980; console.log('  东南楼梯 ' + r.id + ': →(1050,980)'); }
  });
  /* 东走廊竖列 x=1180,w=80 → x=1190,w=70 */
  f.rooms.forEach(function (r) {
    if (r.x === 1180 && r.w === 80) { r.x = 1190; r.w = 70; console.log('  东竖列 ' + r.id + ': x→1190,w→70'); }
  });

  /* 2) 节点移动 */
  var nm = {};
  f.nodes.forEach(function (n) { nm[n.id.split('/')[1]] = n; });
  if (nm['n12'] && nm['n12'].y === 1345) { nm['n12'].y = 1200; console.log('  n12 → (230,1200)'); }
  if (nm['n21'] && nm['n21'].y === 1345) { nm['n21'].x = 1120; nm['n21'].y = 1200; console.log('  n21 → (1120,1200)'); }
  if (nm['n34'] && nm['n34'].y === 1120) { nm['n34'].y = 1200; console.log('  n34 → (320,1200)'); }
  if (!nm['n41']) {
    f.nodes.push({ id: fid + '/n41', x: 80, y: 1200, note: '西南厕所门前' });
    console.log('  新增 n41 (80,1200)');
  }

  /* 3) 门字段：西南厕所 door n35→n41 */
  (D.labs || []).forEach(function (l) {
    if (l.floor !== fid) return;
    if (WC_SW_IDS[fid].indexOf(l.room) >= 0 && l.door === fid + '/n35') {
      l.door = fid + '/n41'; console.log('  ' + l.room + ' door → n41');
    }
  });

  /* 4) 边调整 */
  var edges = f.edges;
  function del(a, b) {
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if ((e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)) { edges.splice(i, 1); console.log('  删边 ' + a + '-' + b); return; }
    }
  }
  function add(a, b) {
    if (!has(edges, a, b)) { edges.push([a, b]); console.log('  加边 ' + a + '-' + b); }
  }
  del('n35', 'n12');
  del('n12', 'n11');
  del('n38', 'n21');
  add('n41', 'n12');
  add('n12', 'n34');
  add('n27', 'n21');
  add('n35', 'n11');
});

var out = 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n';
fs.writeFileSync(labsPath, out, 'utf8');
console.log('已写回 data/labs.js');
