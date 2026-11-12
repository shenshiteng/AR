#!/usr/bin/env node
/* =========================================================================
   tools/fix_south_row.js —— 307/304/303（及 2 层 207/204/203）整组上移 180px
   -------------------------------------------------------------------------
   用户要求：截图里这组房间（211/308+307/304/303，2 层 211/208+207/204/203）
   相对位置不变，整组上移让 211/311 紧贴 212/312。
   211/311、208/308 已由 fix_211_column.js 移好；本脚本处理其余三个房间 + 路网：
   - 房间 y: 1160 → 980（x 不变）
   - 门节点 n39 (700,1120)→(700,1200)、n27 (1070,1120)→(1070,1200)（挪到南侧走廊，
     307/304/303 门改开下边朝南走廊）
   - 边：删 n14-n39（会斜穿 208/308）→ 加 n34-n39；删 n15-n27（会斜穿 304），
     中庭→南侧改走 n19-n27（已验证不穿房间）
   幂等：可重复运行。改完需重跑 gen_grid_from_data.js。
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
  'B2-2': { rooms: ['207', '204', '203'] },
  'B2-3': { rooms: ['307', '304', '303'] }
};

function has(edges, a, b) {
  return edges.some(function (e) { return (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a); });
}

Object.keys(PLAN).forEach(function (fid) {
  var f = D.floors.filter(function (x) { return x.id === fid; })[0];
  if (!f) { console.log('找不到楼层 ' + fid); return; }

  /* 1) 房间整组上移 180 */
  PLAN[fid].rooms.forEach(function (rid) {
    var r = f.rooms.filter(function (x) { return x.id === rid; })[0];
    if (!r) { console.log(fid + ' 找不到房间 ' + rid); return; }
    if (r.y === 980) { console.log('  ' + fid + '/' + rid + ' 已在目标位置'); return; }
    console.log('  ' + fid + '/' + rid + ': y ' + r.y + ' → ' + (r.y - 180));
    r.y -= 180;
  });

  /* 2) 门节点下移到南侧走廊 */
  f.nodes.forEach(function (n) {
    var bare = n.id.split('/')[1];
    if (bare === 'n39' && n.y === 1120) { n.y = 1200; n.note = '南侧走廊（207/204或307/304门前）'; console.log('  ' + fid + '/n39: → (700,1200)'); }
    if (bare === 'n27' && n.y === 1120) { n.y = 1200; n.note = '中庭南出口（南侧走廊）'; console.log('  ' + fid + '/n27: → (1070,1200)'); }
  });

  /* 3) 边调整 */
  var edges = f.edges;
  function del(a, b) {
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if ((e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)) { edges.splice(i, 1); console.log('  ' + fid + ' 删边 ' + a + '-' + b); return; }
    }
  }
  function add(a, b) {
    if (!has(edges, a, b)) { edges.push([a, b]); console.log('  ' + fid + ' 加边 ' + a + '-' + b); }
  }
  del('n14', 'n39');
  add('n34', 'n39');
  del('n15', 'n27');
});

var out = 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n';
fs.writeFileSync(labsPath, out, 'utf8');
console.log('已写回 data/labs.js');
