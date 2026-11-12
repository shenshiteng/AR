#!/usr/bin/env node
/* =========================================================================
   tools/link_floor5.js —— 5 楼接入跨层导航（3 层 ↔ 5 楼两条楼梯）
   -------------------------------------------------------------------------
   5 楼只有西北、东北两个楼梯贯通（疏散图可证），东/西南/东南楼梯到 4 层就断。
   加两条 links：
   - 3层西北楼梯口 B2-3/n1 ↔ 5楼西北楼梯口 B2-5/n3
   - 3层东北楼梯口 B2-3/n3 ↔ 5楼东北楼梯口 B2-5/n9
   跨层距离：2↔3 一层 60m；3↔5 跨两层（4 层无楼梯数据）→ 120m。
   幂等：已存在的连接不重复加。
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

var links = D.links || [];
function exists(a, b) {
  return links.some(function (l) {
    return (l.from === a && l.to === b) || (l.from === b && l.to === a);
  });
}
function add(from, to, name, meters) {
  if (exists(from, to)) { console.log('  已存在 ' + from + ' ↔ ' + to); return; }
  links.push({ from: from, to: to, type: 'stair', name: name, meters: meters });
  console.log('  加连接 ' + from + ' ↔ ' + to + '（' + name + '，' + meters + 'm）');
}

add('B2-3/n1', 'B2-5/n3', '西北楼梯间', 120);
add('B2-3/n3', 'B2-5/n9', '东北楼梯间', 120);

D.links = links;

var out = 'window.LAB_DATA = ' + JSON.stringify(D, null, 2) + ';\n';
fs.writeFileSync(labsPath, out, 'utf8');
console.log('已写回 data/labs.js，links 共 ' + links.length + ' 条');
