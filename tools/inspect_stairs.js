/* 检查两层楼梯间几何 + 门洞朝向 + 节点/边关系，输出权威数据供改代码用 */
'use strict';
var fs = require('fs');
var vm = require('vm');

// 加载 labs.js（挂 window）
var src = fs.readFileSync('data/labs.js', 'utf8');
var sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
var D = sandbox.window.LAB_DATA;

var floorMap = {};
D.floors.forEach(function (f) { floorMap[f.id] = f; });

['B2-2', 'B2-3'].forEach(function (fid) {
  var f = floorMap[fid];
  console.log('\n===== 楼层 ' + fid + ' (' + f.name + ') =====');
  (f.rooms || []).forEach(function (r) {
    if (r.kind !== 'stair') return;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var alongX = r.w >= r.h;
    // 找最近节点（门口）
    var door = null, bd = Infinity;
    (f.nodes || []).forEach(function (n) {
      var d = Math.hypot(n.x - cx, n.y - cy);
      if (d < bd) { bd = d; door = n; }
    });
    // 找离这个房间最近的节点，看它在房间的哪个方位
    console.log('  房间 ' + r.id + ' 名称=' + r.name +
      '  x=' + r.x + ' y=' + r.y + ' w=' + r.w + ' h=' + r.h +
      ' (alongX=' + alongX + ')');
    console.log('    中心=(' + cx.toFixed(0) + ',' + cy.toFixed(0) + ')  最近节点=' +
      (door ? door.id + '(' + door.x + ',' + door.y + ')' : '无') +
      ' 距离=' + (door ? bd.toFixed(0) : '-'));
    if (door) {
      var side = '';
      if (Math.abs(door.x - r.x) < Math.abs(door.x - (r.x + r.w))) side += '靠西边 ';
      else side += '靠东边 ';
      if (Math.abs(door.y - r.y) < Math.abs(door.y - (r.y + r.h))) side += '靠北边 ';
      else side += '靠南边 ';
      console.log('    节点方位判断: ' + side);
    }
  });
});

// links
console.log('\n===== 跨层 links =====');
(D.links || []).forEach(function (l) {
  console.log('  ' + l.from + ' <-> ' + l.to + '  (' + l.name + ')');
});
