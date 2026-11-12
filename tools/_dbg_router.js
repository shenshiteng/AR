/* 调试：为什么 Node 里 routeToLab 全返回 null（浏览器里是通的） */
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
const lab = D.labs.find(l => String(l.room) === '201');
const loc = D.locations.find(l => l.id === 'P-B2-12');
console.log('lab=' + JSON.stringify(lab));
console.log('loc=' + JSON.stringify(loc));
console.log('door exists in graph=' + !!(lab && G.nodes[lab.door]));
console.log('nodes count=' + Object.keys(G.nodes).length);
const p = R.shortestPath(G, loc.node, lab.door);
console.log('path=' + (p ? p.nodes.join(' > ') + ' meters=' + p.meters : 'NULL'));
const p2 = R.shortestPath(G, 'B2-2/n21', 'B2-2/n12');
console.log('known pair path=' + (p2 ? p2.nodes.length + ' nodes ' + p2.meters : 'NULL'));
console.log('adj of loc node=' + JSON.stringify(G.adj[loc.node]));
const r = R.routeToLab(G, loc.node, lab, loc);
console.log('routeToLab=' + (r ? JSON.stringify({ m: r.meters, nodes: r.nodes }) : 'NULL'));
