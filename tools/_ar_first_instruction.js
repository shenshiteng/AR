/* 统计：12 个定位点分别"扫码后第一条指令"是什么（暴露 normal 全填 90 的问题） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const ctx = { window: {}, console, Math, JSON, document: { createElement: () => ({}) } };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/labs.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/router.js'), 'utf8'), ctx);

const D = ctx.window.LAB_DATA;
const R = ctx.window.LabRouter;
const G = R.buildGraph(D);
const LOCS = D.locations;
const LABS = D.labs;

// 每个定位点：选该层里"离起点路径最近"的一间房做目的地，看初始 facing 与实际路线方向的夹角
function nearestLabOnFloor(floorId, nodeId) {
  const n = G.nodes[nodeId];
  let best = null, bd = Infinity;
  LABS.forEach(l => {
    if (l.floor !== floorId || !l.door || !G.nodes[l.door]) return;
    const d = Math.hypot(G.nodes[l.door].x - n.x, G.nodes[l.door].y - n.y);
    if (d < bd) { bd = d; best = l; }
  });
  return best;
}

const rows = [];
LOCS.forEach(loc => {
  const lab = nearestLabOnFloor(loc.floor, loc.node);
  if (!lab) return;
  const r = R.routeToLab(G, loc.node, lab, loc);
  const facing = (loc.normal + 180) % 360;
  let first = null;
  if (r && r.nodes.length > 1) {
    const a = G.nodes[r.nodes[0]], b = G.nodes[r.nodes[1]];
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    let rel = ((ang - facing + 540) % 360) - 180;
    first = { ang: Math.round(ang), rel: Math.round(rel) };
  }
  rows.push({
    id: loc.id, place: loc.place, normal: loc.normal, facing,
    dest: lab.room + ' ' + lab.name,
    routeAng: first ? first.ang : null, rel: first ? first.rel : null,
    verdict: !first ? '无路线' : Math.abs(first.rel) < 12 ? '直行' : Math.abs(first.rel) >= 145 ? '掉头' : (first.rel > 0 ? '右转' : '左转') + ' ' + Math.abs(first.rel) + '°'
  });
});

console.log('定位点\tnormal\tfacing\t目的地\t路线方向\t夹角\t首条指令');
rows.forEach(r => console.log([r.id, r.normal, r.facing, r.dest, r.routeAng, r.rel, r.verdict].join('\t')));

const bad = rows.filter(r => Math.abs(r.rel) >= 60).length;
console.log('\n夹角≥60°（扫码后第一条指令就要求大幅转向）的点位: ' + bad + ' / ' + rows.length);
const normals = {};
LOCS.forEach(l => { normals[l.normal] = (normals[l.normal] || 0) + 1; });
console.log('normal 取值分布: ' + JSON.stringify(normals));
