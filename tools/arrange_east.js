#!/usr/bin/env node
/* =========================================================================
   tools/arrange_east.js —— 东侧下半区重排：331/329 横排 + 楼梯/330 竖排（两层同步）
   -------------------------------------------------------------------------
   用户要求：331 和 329 横向并排，东南楼梯和 330 竖向并排，排列方向协调统一。
   2 层对应 230/229 横排、楼梯/231 竖排。
   楼梯缩窄 140→100 宽，让出中庭东缘走廊 x=1160（避免挡路）。
   =========================================================================
   房间：
   - 331(3层)/230(2层) → (1190,820,60,70)
   - 329(3层)/229(2层) → (1250,820,60,70)   横排
   - STAIR-SE/STAIR-2SE → (1050,890,100,140)
   - 330(3层)/231(2层) → (1050,1030,100,70)  竖排
   节点：
   - n19 (1160,900)→(1160,855)  横排房间门朝左
   - 新增 n42 (1160,1065)        330 门朝右
   门：329/331(229/230) 保持 n19；330/231 → n42；楼梯保持 n21
   边：删 n19-n27（斜穿楼梯）；加 n19-n42、n42-n21
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

var PLAN = {
  'B2-2': { rowL: '230', rowR: '229', vert: '231', stair: 'STAIR-2SE' },
  'B2-3': { rowL: '331', rowR: '329', vert: '330', stair: 'STAIR-SE' }
};

['B2-2', 'B2-3'].forEach(function (fid) {
  var f = D.floors.filter(function (x) { return x.id === fid; })[0];
  if (!f) { console.log('找不到楼层 ' + fid); return; }
  var P = PLAN[fid];
  console.log('==== ' + fid + ' ====');

  function moveRoom(id, x, y, w, h) {
    var r = f.rooms.filter(function (z) { return z.id === id; })[0];
    if (!r) { console.log('  找不到房间 ' + id); return; }
    r.x = x; r.y = y; r.w = w; r.h = h;
    console.log('  ' + id + ' → (' + x + ',' + y + ',' + w + ',' + h + ')');
  }

  /* 横排：rowL 左、rowR 右（同 y=820） */
  moveRoom(P.rowL, 1190, 820, 60, 70);
  moveRoom(P.rowR, 1250, 820, 60, 70);
  /* 竖排：楼梯上、vert 下 */
  moveRoom(P.stair, 1050, 890, 100, 140);
  moveRoom(P.vert, 1050, 1030, 100, 70);

  /* 节点 */
  var nm = {};
  f.nodes.forEach(function (n) { nm[n.id.split('/')[1]] = n; });
  if (nm['n19'] && nm['n19'].y === 900) { nm['n19'].y = 855; console.log('  n19 → (1160,855)'); }
  if (!nm['n42']) {
    f.nodes.push({ id: fid + '/n42', x: 1160, y: 1065, note: '中庭东缘（330/231门前）' });
    console.log('  新增 n42 (1160,1065)');
  }

  /* 门字段：vert 房间门 → n42 */
  (D.labs || []).forEach(function (l) {
    if (l.floor === fid && l.room === P.vert) {
      l.door = fid + '/n42'; console.log('  ' + l.room + ' door → n42');
    }
  });

  /* 边 */
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
  del('n19', 'n27');
  add('n19', 'n42');
  add('n42', 'n21');
});

var out = 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n';
fs.writeFileSync(labsPath, out, 'utf8');
console.log('已写回 data/labs.js');
