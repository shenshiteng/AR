/* 从墙网格里找每个楼梯间「真正的门洞」在哪条边：沿房间矩形四边扫描，找墙上的缺口 */
'use strict';
var fs = require('fs');
var vm = require('vm');

function loadGrid(path, varName) {
  var src = fs.readFileSync(path, 'utf8');
  var sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window[varName];
}

var Dsrc = fs.readFileSync('data/labs.js', 'utf8');
var dsb = { window: {} };
vm.createContext(dsb);
vm.runInContext(Dsrc, dsb);
var D = dsb.window.LAB_DATA;
var floorMap = {};
D.floors.forEach(function (f) { floorMap[f.id] = f; });

var GRIDVAR = { 'B2-2': 'FLOOR_B2_2', 'B2-3': 'FLOOR_B2_3' };

['B2-2', 'B2-3'].forEach(function (fid) {
  var grid = loadGrid('data/' + fid + 'F_grid.js', GRIDVAR[fid]);
  var cell = grid.cell || 4;
  var cols = grid.cols, rows = grid.rows, data = grid.data;
  function isWallPx(x, y) {
    var cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return true;
    return data.charAt(cy * cols + cx) === '1';
  }
  var f = floorMap[fid];
  console.log('\n===== ' + fid + ' 楼梯间门洞（沿四边扫描，找墙缺口）=====');
  (f.rooms || []).forEach(function (r) {
    if (r.kind !== 'stair') return;
    var x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    // 四边的中点 + 在边上步进采样，记录「连续非墙段」
    function scan(edge) {
      // edge: 返回边上一系列采样点的 (x,y)
      var gaps = []; // [{from, to, len}]
      var cur = null;
      function add(x, y) {
        var wall = isWallPx(x, y);
        if (!wall) {
          if (!cur) cur = { start: x + ',' + y, len: 0 };
          cur.len += 1;
        } else {
          if (cur && cur.len >= 2) gaps.push(cur);
          cur = null;
        }
      }
      return { add: add, done: function () { if (cur && cur.len >= 2) gaps.push(cur); return gaps; } };
    }
    var result = {};
    // 北边（y=y1）
    var s = scan(); for (var x = x1; x <= x2; x += 2) s.add(x, y1); result.north = s.done();
    // 南边（y=y2）
    s = scan(); for (x = x1; x <= x2; x += 2) s.add(x, y2); result.south = s.done();
    // 西边（x=x1）
    s = scan(); for (var y = y1; y <= y2; y += 2) s.add(x1, y); result.west = s.done();
    // 东边（x=x2）
    s = scan(); for (y = y1; y <= y2; y += 2) s.add(x2, y); result.east = s.done();
    console.log('  房间 ' + r.id + ' (' + r.w + 'x' + r.h + ')');
    ['north', 'south', 'west', 'east'].forEach(function (edge) {
      var g = result[edge];
      if (g.length) {
        var total = g.reduce(function (a, b) { return a + b.len; }, 0);
        console.log('    ' + edge + ' 有门洞，总开口 ' + (total * 2) + 'px 分 ' + g.length + ' 段');
      } else {
        console.log('    ' + edge + ' 无门洞（整条墙）');
      }
    });
  });
});
