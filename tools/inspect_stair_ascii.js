/* 打印每个楼梯间内部的墙格分布，判断楼梯实际走向（横向/纵向） */
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
  console.log('\n===== ' + fid + ' 楼梯间内部墙格 ASCII =====');
  (f.rooms || []).forEach(function (r) {
    if (r.kind !== 'stair') return;
    // 每格 4px，用 4px 步进太密，用 cell 步进画 ASCII
    console.log('房间 ' + r.id + ' (' + r.w + 'x' + r.h + ') at (' + r.x + ',' + r.y + ')');
    var cx1 = Math.floor(r.x / cell), cy1 = Math.floor(r.y / cell);
    var cx2 = Math.floor((r.x + r.w) / cell), cy2 = Math.floor((r.y + r.h) / cell);
    for (var cy = cy1; cy <= cy2; cy++) {
      var line = '';
      for (var cx = cx1; cx <= cx2; cx++) {
        var w = isWallPx(cx * cell + 2, cy * cell + 2);
        line += w ? '#' : '.';
      }
      console.log('    ' + line);
    }
  });
});
