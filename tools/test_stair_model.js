/* 验证新楼梯坡向模型：对每个楼梯间，检查门口(z≈0)→对侧(z≈层高)的单调性 */
'use strict';
var fs = require('fs');
var vm = require('vm');

// 加载 fp-core（导出 FPWorld）
var coreSrc = fs.readFileSync('js/fp-core.js', 'utf8');
var coreSb = { window: {} };
vm.createContext(coreSb);
vm.runInContext(coreSrc, coreSb);
var FPWorld = coreSb.window.FPWorld;

// 加载 labs.js
var Dsrc = fs.readFileSync('data/labs.js', 'utf8');
var dsb = { window: {} };
vm.createContext(dsb);
vm.runInContext(Dsrc, dsb);
var D = dsb.window.LAB_DATA;

// 加载两个 grid
function loadGrid(path, varName) {
  var src = fs.readFileSync(path, 'utf8');
  var sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return sb.window[varName];
}
var GRIDS = {
  'B2-2': { grid: loadGrid('data/B2-2F_grid.js', 'FLOOR_B2_2'), walls: [] },
  'B2-3': { grid: loadGrid('data/B2-3F_grid.js', 'FLOOR_B2_3'), walls: [] }
};

var floorMap = {};
D.floors.forEach(function (f) { floorMap[f.id] = f; });

var worlds = {};
['B2-2', 'B2-3'].forEach(function (fid) {
  var f = floorMap[fid];
  worlds[fid] = FPWorld.create({
    grid: GRIDS[fid].grid,
    rooms: f.rooms || [],
    nodes: f.nodes || [],
    edges: f.edges || [],
    walls: [],
    stairSign: (fid === 'B2-2') ? 1 : -1
  });
});

var allOk = true;
['B2-2', 'B2-3'].forEach(function (fid) {
  var w = worlds[fid];
  console.log('\n===== ' + fid + ' (stairSign=' + w.stairSign + ') =====');
  w.stairs.forEach(function (st) {
    // 房间四个角/边中点的高度
    var doorPt, farPt;
    if (st.axis === 'x') {
      doorPt = st.dir > 0 ? [st.x, st.y + st.h / 2] : [st.x + st.w, st.y + st.h / 2];
      farPt = st.dir > 0 ? [st.x + st.w, st.y + st.h / 2] : [st.x, st.y + st.h / 2];
    } else {
      doorPt = st.dir > 0 ? [st.x + st.w / 2, st.y] : [st.x + st.w / 2, st.y + st.h];
      farPt = st.dir > 0 ? [st.x + st.w / 2, st.y + st.h] : [st.x + st.w / 2, st.y];
    }
    var zDoor = w.heightAt(doorPt[0], doorPt[1]);
    var zFar = w.heightAt(farPt[0], farPt[1]);
    var zMid = w.heightAt(st.x + st.w / 2, st.y + st.h / 2);
    var sign = w.stairSign > 0 ? '上' : '下';
    // 对称模型：门侧 z=0（本层标高），对侧 z=±层高
    var ok = Math.abs(zDoor) < 0.01 &&
      ((w.stairSign > 0 && zFar > 0.9 * w.floorHeight) ||
       (w.stairSign < 0 && zFar < -0.9 * w.floorHeight));
    if (!ok) allOk = false;
    console.log('  ' + (st.doorSide || '?') + ' 门 z=' + zDoor.toFixed(2) +
      ' 中 z=' + zMid.toFixed(2) + ' 对侧 z=' + zFar.toFixed(2) +
      ' (axis=' + st.axis + ' dir=' + st.dir + ' 期望' + sign + '到' + Math.abs(w.floorHeight).toFixed(1) + 'm) ' +
      (ok ? 'OK' : 'FAIL'));
  });
});
console.log('\n结论: ' + (allOk ? '全部通过' : '有失败'));
process.exit(allOk ? 0 : 1);
