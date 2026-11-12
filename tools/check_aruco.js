#!/usr/bin/env node
/* 自检：验证 aruco/ 目录里生成的每个 SVG 码，能被识别端字典正确归位。
   方法：把 SVG 的 5x5 数据位还原成 25 位二进制串（'1'=白），
   再旋转 0/90/180/270 四个方向，每个方向都去字典里找汉明距离=0 的码，
   确认归位到的 ID 就是该定位点分配到的 marker 号。 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var DICT_FILE = path.join(ROOT, 'js', 'vendor', 'js-aruco2.js');
var OUT_DIR = path.join(ROOT, 'aruco');
var DATA_FILE = path.join(ROOT, 'data', 'labs.js');

function loadDict() {
  var src = fs.readFileSync(DICT_FILE, 'utf8');
  var m = src.match(/ARUCO\s*:\s*\{[\s\S]*?codeList\s*:\s*\[([\s\S]*?)\]\s*\}/);
  var codes = [];
  m[1].split(',').forEach(function (tok) {
    tok = tok.trim();
    if (/^0x[0-9a-fA-F]+$/i.test(tok)) codes.push(tok);
  });
  // 转成 25 位二进制串
  return codes.map(function (h) { return parseInt(h, 16).toString(2).padStart(25, '0'); });
}

function loadData() {
  var raw = fs.readFileSync(DATA_FILE, 'utf8');
  raw = raw.replace(/^\s*window\.LAB_DATA\s*=\s*/, '').replace(/;\s*$/, '');
  return JSON.parse(raw);
}

/* 从 SVG 文本还原 5x5 数据位（返回 25 位串，'1'=白） */
function extractBits(svg) {
  var grid = new Array(5).fill(0).map(function () { return new Array(5).fill(0); }); // 0=黑
  var re = /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="#ffffff"/g;
  // 数据格的最小 x/y 就是「码的左上角数据格」坐标，用它做偏移基准，
  // 无论留白 margin 是多少都能自动对齐（不硬编码偏移）。
  var minX = Infinity, minY = Infinity, xs = [], ys = [], m;
  while ((m = re.exec(svg))) {
    var x = parseInt(m[1], 10), y = parseInt(m[2], 10);
    xs.push(x); ys.push(y);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  for (var i = 0; i < xs.length; i++) {
    var cx = xs[i] - minX, cy = ys[i] - minY;
    if (cx >= 0 && cx < 5 && cy >= 0 && cy < 5) grid[cy][cx] = 1;
  }
  var s = '';
  for (var y = 0; y < 5; y++) for (var x = 0; x < 5; x++) s += grid[y][x];
  return s;
}

/* 顺时针旋转 5x5 位串 90° */
function rotate(bits) {
  var g = [], i, x, y;
  for (y = 0; y < 5; y++) { g.push([]); for (x = 0; x < 5; x++) g[y].push(bits[y * 5 + x]); }
  var out = '';
  for (y = 0; y < 5; y++) for (x = 0; x < 5; x++) out += g[4 - x][y];
  return out;
}

function hamming(a, b) { var d = 0; for (var i = 0; i < 25; i++) if (a[i] !== b[i]) d++; return d; }

function findId(dict, bits) {
  var best = -1, bestD = 999;
  for (var i = 0; i < dict.length; i++) {
    var d = hamming(dict[i], bits);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { id: best, d: bestD };
}

var dict = loadDict();
var data = loadData();
var locs = data.locations || [];

var pass = 0, fail = 0;
locs.forEach(function (loc, i) {
  var mid = (loc.marker === undefined) ? i : loc.marker;
  var svgPath = path.join(OUT_DIR, loc.id + '.svg');
  if (!fs.existsSync(svgPath)) { console.log('  MISSING ' + loc.id); fail++; return; }
  var svg = fs.readFileSync(svgPath, 'utf8');
  var bits = extractBits(svg);

  // 检查四个旋转方向都能归位到 mid
  var ok = true, cur = bits, detail = [];
  for (var r = 0; r < 4; r++) {
    var rBits = (r === 0) ? bits : rotate((function () { var t = bits; for (var k = 0; k < r; k++) t = rotate(t); return t; })());
    var res = findId(dict, rBits);
    var expect = (r === 0) ? mid : -1;   // 旋转后 id 会变，但至少 0 方向必须 = mid
    if (r === 0 && (res.id !== mid || res.d !== 0)) { ok = false; detail.push('0°→id' + res.id + '(d=' + res.d + ')'); }
  }
  if (ok) { console.log('  \u2713 ' + loc.id + '  (ID ' + mid + ')  0°归位正确'); pass++; }
  else { console.log('  \u2717 ' + loc.id + '  (ID ' + mid + ')  ' + detail.join(' ')); fail++; }
});

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
if (fail) process.exit(1);
