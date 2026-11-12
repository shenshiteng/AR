/* 复核：起点 == 终点 时 shortestPath 返回什么（真实用户场景：扫了码就在目标房间门口） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ctx = { window: {}, console, Math, JSON };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/labs.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/router.js'), 'utf8'), ctx);
const D = ctx.window.LAB_DATA, R = ctx.window.LabRouter;
const G = R.buildGraph(D);

const same = R.shortestPath(G, 'B2-2/n21', 'B2-2/n21');
console.log('start===goal -> ' + JSON.stringify(same));

// 12 个定位点：目标 = 该定位点所在节点的房间（door == loc.node）
const rows = [];
D.locations.forEach(loc => {
  const lab = D.labs.find(l => l.door === loc.node);
  if (!lab) { rows.push([loc.id, '(无 door==node 的房间)', '', '']); return; }
  const r = R.routeToLab(G, loc.node, lab, loc);
  rows.push([loc.id, loc.place, lab.room + ' ' + lab.name, r ? ('OK ' + r.meters.toFixed(1) + 'm') : 'NULL → 页面显示"目的地未连通"']);
});
console.log('\n定位点 · 站在目标房门口时：');
rows.forEach(r => console.log(r.join(' | ')));
