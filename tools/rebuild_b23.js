#!/usr/bin/env node
/* 重做 B2-3（3层）：套用 B2-2（2层）的尺寸+布局（墙位置相同），房名换成3层自己的。
 * 核心：以 2 层 rooms/nodes/edges 为物理骨架（1540x1560），
 *       每个格子按映射表填 3 层的房名/编号；节点边照搬（前缀 B2-2/ → B2-3/）。
 *       这样两层物理完全叠合，5个楼梯口自动对齐。
 */
'use strict';
var fs = require('fs');
var raw = fs.readFileSync('data/labs.js', 'utf8');
raw = raw.replace(/^\s*window\.LAB_DATA\s*=\s*/, '').replace(/;\s*$/, '');
var D = JSON.parse(raw);

/* 找到 2 层和 3 层楼层对象 */
var f2 = null, f3 = null;
D.floors.forEach(function (f) { if (f.id === 'B2-2') f2 = f; if (f.id === 'B2-3') f3 = f; });
if (!f2 || !f3) { console.error('找不到 B2-2 或 B2-3'); process.exit(1); }

/* ---------- 映射表：2层格子id → { id, name, kind }（3层房名） ---------- */
var M = {
  /* 北排 y20~220 */
  'STAIR-2NW': { id: 'STAIR-NW', name: '楼梯间（西北角）', kind: 'stair' },
  '216': { id: '316', name: '配电间', kind: 'service' },
  '217': { id: '317', name: '档案资料室', kind: 'room' },
  '219': { id: '319', name: '心理健康工作室', kind: 'room' },
  '221': { id: '320', name: '新媒体中心办公室', kind: 'office' },
  '222': { id: '322', name: '学生阅览室', kind: 'room' },
  '224': { id: '423', name: '团委学工办工作室-2', kind: 'office' },
  '225': { id: '425', name: '团委学工办工作室-1', kind: 'office' },
  '226': { id: '326', name: '学生会活动室', kind: 'room' },
  /* 西北厕 */
  'WC-2NW1': { id: 'WC-N1', name: '男厕（西北）', kind: 'toilet' },
  'WC-2NW2': { id: 'WC-N2', name: '女厕（西北）', kind: 'toilet' },
  /* 西列（纵向，从上到下） */
  '215': { id: '315', name: '机械学院直属党支部党员活动室', kind: 'room' },
  '214': { id: '314', name: '机械创新实践中心（待建）', kind: 'lab' },
  '213': { id: '313', name: '机械系统设计实验室-2', kind: 'lab' },
  '212': { id: '312', name: '机械系统设计实验室-1', kind: 'lab' },
  /* 第二排（朝北，从左到右） */
  '218': { id: '318', name: '机械测试技术实验室（待建）', kind: 'lab' },
  '220': { id: '321', name: '精密测量实验室', kind: 'lab' },
  '223': { id: '324', name: '热工综合实验室-1', kind: 'lab' },
  /* 东侧 */
  'STAIR-2NE': { id: 'STAIR-NE', name: '楼梯间（东北角·324旁）', kind: 'stair' },
  'WC-2NE1': { id: 'WC-1', name: '卫生间（东）', kind: 'toilet', merge: 'WC-2NE2' },
  'WC-2NE2': { id: '__MERGED__', name: '', kind: 'toilet' },  /* 并入 WC-1 */
  '227': { id: '327', name: '全职教授办公室', kind: 'office' },
  '228': { id: '328', name: '机械学院资料室', kind: 'room' },
  '229': { id: '329', name: '机械学院会议室', kind: 'room' },
  '231': { id: '330', name: '行政副院长办公室', kind: 'office' },
  '230': { id: '331', name: '机械学院院长办公室', kind: 'office' },
  '232': { id: '332', name: '教学副院长办公室', kind: 'office' },
  'STAIR-2E': { id: 'STAIR-E', name: '楼梯间（东侧·334旁）', kind: 'stair' },
  '234': { id: '334', name: '材料专业教研室', kind: 'office' },
  '235': { id: '335', name: '材料专业负责人办公室', kind: 'office' },
  '233': { id: '333', name: '绿色成型及精密模具工程技术研究中心', kind: 'lab' },
  /* 中南排 */
  'WC-2SW1': { id: 'WC-S1', name: '女厕（西南）', kind: 'toilet' },
  'WC-2SW2': { id: 'WC-S2', name: '男厕（西南）', kind: 'toilet' },
  'STAIR-2SW': { id: 'STAIR-SW', name: '楼梯间（西南角）', kind: 'stair' },
  '211': { id: '311', name: '配电间', kind: 'service' },
  '208': { id: '308', name: '储物间', kind: 'store' },
  '207': { id: '307', name: '空地（大厅）', kind: 'room' },
  '204': { id: '304', name: '材料与热处理实验室', kind: 'lab' },
  '203': { id: '303', name: '模具认知与拆装实验室', kind: 'lab' },
  'STAIR-2SE': { id: 'STAIR-SE', name: '楼梯间（东南角）', kind: 'stair' },
  /* 南排 */
  '210': { id: '310', name: 'ET机器人工作室', kind: 'lab' },
  '209': { id: '309', name: '工程技术训练中心-2', kind: 'lab' },
  '206': { id: '306', name: '工程技术训练中心-1', kind: 'lab' },
  '205': { id: '305', name: '发动机拆装实验室', kind: 'lab' },
  '202': { id: '302', name: '微型原理及接口技术实验室（待建）', kind: 'lab' },
  '201': { id: '301', name: '液压传动实验室（待建）', kind: 'lab' }
};

/* 2层 doorMap：room → 门节点（用于映射到3层） */
var door2 = {
  '216': 'n17', '217': 'n17', '219': 'n2', '221': 'n2',
  '222': 'n2', '224': 'n2', '225': 'n3', '226': 'n3',
  '215': 'n18', '218': 'n2', '220': 'n2', '223': 'n3',
  '214': 'n31', '213': 'n32', '212': 'n33',
  '227': 'n23', '228': 'n23', '229': 'n19',
  '231': 'n19', '230': 'n19',
  '232': 'n29', '234': 'n29', '235': 'n29', '233': 'n29',
  '211': 'n14', '208': 'n14', '207': 'n39',
  '204': 'n39', '203': 'n27',
  '210': 'n35', '209': 'n11', '206': 'n10',
  '205': 'n10', '202': 'n9', '201': 'n9',
  'WC-2NW1': 'n1', 'WC-2NW2': 'n1',
  'WC-2NE1': 'n25', 'WC-2NE2': 'n25',
  'WC-2SW1': 'n35', 'WC-2SW2': 'n35',
  'STAIR-2NW': 'n1', 'STAIR-2NE': 'n3', 'STAIR-2E': 'n29',
  'STAIR-2SW': 'n12', 'STAIR-2SE': 'n21'
};

/* ---------- 生成 3 层 rooms（照 2 层坐标，换 3 层房名） ---------- */
var rooms3 = [];
var room3ByOld = {};  /* 2层格子id -> 3层room id（用于 door 映射） */

f2.rooms.forEach(function (r) {
  var m = M[r.id];
  if (!m) { console.error('2层房间 ' + r.id + ' 无映射'); process.exit(1); }
  if (m.id === '__MERGED__') { room3ByOld[r.id] = 'WC-1'; return; }  /* 并入WC-1，跳过 */
  if (m.merge) {
    /* 东北厕 WC-2NE1 合并 WC-2NE2：高度扩大覆盖两个格子 */
    var mergeRoom = null;
    f2.rooms.forEach(function (r2) { if (r2.id === m.merge) mergeRoom = r2; });
    var yTop = Math.min(r.y, mergeRoom.y);
    var yBot = Math.max(r.y + r.h, mergeRoom.y + mergeRoom.h);
    rooms3.push({ id: m.id, name: m.name, kind: m.kind, x: r.x, y: yTop, w: r.w, h: yBot - yTop });
    room3ByOld[r.id] = m.id;
    room3ByOld[m.merge] = m.id;
    return;
  }
  rooms3.push({ id: m.id, name: m.name, kind: m.kind, x: r.x, y: r.y, w: r.w, h: r.h });
  room3ByOld[r.id] = m.id;
});

/* ---------- 节点/边：照搬 2 层，前缀换 B2-3/ ---------- */
var nodes3 = f2.nodes.map(function (n) {
  return { id: n.id.replace('B2-2/', 'B2-3/'), x: n.x, y: n.y, note: n.note };
});
var edges3 = f2.edges.map(function (e) {
  return e.map(function (x) { return x; });  /* 边里是裸 n1 等，保持不变 */
});

var b23 = {
  id: 'B2-3',
  building: 'B2',
  name: '3层',
  image: 'assets/floors/B2-3F.jpg',
  mapImage: 'assets/floors/B2-3F_map.png?v=5',
  width: 1540,
  height: 1560,
  nodes: nodes3,
  edges: edges3,
  rooms: rooms3
};

/* 替换 floors 里的 B2-3 */
for (var i = 0; i < D.floors.length; i++) {
  if (D.floors[i].id === 'B2-3') { D.floors[i] = b23; break; }
}

/* ---------- 3层 labs：room 引用 + door 映射 ---------- */
D.labs.forEach(function (l) {
  if (l.floor !== 'B2-3') return;
  /* 找到这个 lab 的 room 在 3 层新 rooms 里对应哪个 */
  var newRoom = null;
  rooms3.forEach(function (r) { if (r.id === l.room) newRoom = r; });
  if (newRoom) l.name = newRoom.name;  /* 保持3层自己的名字 */
  /* door 映射：从旧 B2-3/nX 换成新节点 */
  /* 旧 3 层 door 引用的是旧节点号，这里直接用 2 层 doorMap 反查：
     找到这个 3 层 room 对应的 2 层格子，取其门节点 */
  var old2 = null;
  for (var k in room3ByOld) { if (room3ByOld[k] === l.room) { old2 = k; break; } }
  if (old2 && door2[old2]) {
    l.door = 'B2-3/' + door2[old2];
  }
});

/* 特殊：LWC1 卫生间（东）room=WC-1，door 指向 n25 */
D.labs.forEach(function (l) {
  if (l.floor === 'B2-3' && l.room === 'WC-1') l.door = 'B2-3/n25';
});

/* ---------- locations：3层楼梯口定位点 node 换成新节点 ---------- */
/* 3层定位点旧 node → 新 node（旧 n28/n1/n22/n30/n14 → 新 n3/n1/n21/n29/n12） */
var locNode3 = {
  'B2-3/n28': 'B2-3/n3',   /* 东北 */
  'B2-3/n1': 'B2-3/n1',    /* 西北 */
  'B2-3/n22': 'B2-3/n21',  /* 东南 */
  'B2-3/n30': 'B2-3/n29',  /* 东侧 */
  'B2-3/n14': 'B2-3/n12'   /* 西南 */
};
D.locations.forEach(function (l) {
  if (l.floor === 'B2-3' && locNode3[l.node]) l.node = locNode3[l.node];
});

/* ---------- links：重写楼梯跨层连接（两层楼梯口已对齐，节点号一致） ---------- */
/* 2层/3层 楼梯口节点：NW=n1 NE=n3 E=n29 SW=n12 SE=n21（两层相同） */
var stairLinks = [
  ['B2-2/n1', 'B2-3/n1', '西北楼梯间'],
  ['B2-2/n3', 'B2-3/n3', '东北楼梯间'],
  ['B2-2/n29', 'B2-3/n29', '东侧楼梯间'],
  ['B2-2/n12', 'B2-3/n12', '西南楼梯间'],
  ['B2-2/n21', 'B2-3/n21', '东南楼梯间']
];
/* 清掉旧的 B2-2↔B2-3 楼梯 links，重建 */
D.links = (D.links || []).filter(function (l) {
  return !(/^B2-2\//.test(l.from) && /^B2-3\//.test(l.to));
});
stairLinks.forEach(function (s) {
  D.links.push({ from: s[0], to: s[1], type: 'stair', name: s[2], meters: 60 });
});

fs.writeFileSync('data/labs.js', 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n', 'utf8');
console.log('B2-3 已重做：rooms ' + rooms3.length + '，nodes ' + nodes3.length + '，edges ' + edges3.length);
console.log('画布 1540x1560（与2层一致）');
