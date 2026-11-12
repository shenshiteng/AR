#!/usr/bin/env node
/* tools/test_wasd_keys.js —— 纯逻辑单测：WASD 键位映射 + 平移/转身语义
   ---------------------------------------------------------------------------
   不启浏览器、不开服务器，直接 require 两个模块，几秒钟跑完。
   验的是「按键 → 动作」和「动作 → 位移」这两层，楼梯上的表现由
   tools/test_wasd_e2e.js（真实键盘 + 无头浏览器）负责。

   用法：node tools/test_wasd_keys.js
   --------------------------------------------------------------------------- */
'use strict';
var path = require('path');

var ROOT = path.join(__dirname, '..');
var fails = 0;

function ok(name, cond, detail) {
  if (cond) console.log('  ✓ ' + name + (detail ? '  ' + detail : ''));
  else { fails++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.5 : tol); }

/* ========== 1) 键位映射：A/D 只管转向视角，W/S 只管前后 ========== */
console.log('[1] 键盘映射（js/fp-input.js）');
global.window = {};
require(path.join(ROOT, 'js/fp-input.js'));
var FPInput = global.window.FPInput;

var listeners = {};
var fakeWin = {
  addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); }
};
var action = {};
FPInput.attach(fakeWin, action);

function fire(type, code) {
  (listeners[type] || []).forEach(function (f) { f({ code: code, key: code, preventDefault: function () {} }); });
}
function press(code) { fire('keydown', code); }
function release(code) { fire('keyup', code); }

press('KeyA');
ok('按 A = 左转视角（turnL），不是平移', action.turnL === true && action.strafeL === false,
  'turnL=' + action.turnL + ' strafeL=' + action.strafeL);
release('KeyA');
press('KeyD');
ok('按 D = 右转视角（turnR），不是平移', action.turnR === true && action.strafeR === false,
  'turnR=' + action.turnR + ' strafeR=' + action.strafeR);
release('KeyD');

press('KeyW');
ok('按 W = 只前进，不产生任何转向',
  action.fwd === true && action.turnL === false && action.turnR === false,
  'fwd=' + action.fwd + ' turnL=' + action.turnL + ' turnR=' + action.turnR);
release('KeyW');
press('KeyS');
ok('按 S = 只后退，不产生任何转向',
  action.back === true && action.turnL === false && action.turnR === false);
release('KeyS');

press('ArrowLeft');
ok('按 ← = 左转（与 A 同一套转向逻辑）', action.turnL === true && action.strafeL === false);
release('ArrowLeft');
press('ArrowRight');
ok('按 → = 右转', action.turnR === true && action.strafeR === false);
release('ArrowRight');

/* A/D 的转向职责不受 Shift 影响（Shift 只作用于方向键的平移） */
press('ShiftLeft'); press('KeyA');
ok('Shift+A 仍然是左转（A 不做平移）', action.turnL === true && action.strafeL === false);
release('KeyA'); release('ShiftLeft');

/* 原有能力保留：Shift + ←/→ 仍是平移 */
press('ShiftLeft'); press('ArrowLeft');
ok('Shift+← 仍保留为左平移', action.strafeL === true && action.turnL === false);
release('ArrowLeft'); release('ShiftLeft');

/* 松开后必须全部归零，不能「卡键」 */
fire('blur');
ok('失焦后所有键清空', !action.fwd && !action.back && !action.turnL && !action.turnR &&
  !action.strafeL && !action.strafeR);

/* ========== 2) 动作语义：theta=0(东) 时各键的位移方向 ========== */
console.log('[2] 位移语义（js/fp-core.js step）');
var FPWorld = require(path.join(ROOT, 'js/fp-core.js'));

/* 400×400px 空地，全 '0'，无墙、无楼梯 */
var cols = 100, rows = 100;
var grid = { cols: cols, rows: rows, cell: 4, width: cols * 4, height: rows * 4, data: new Array(cols * rows + 1).join('0') };
function freshWorld() { return FPWorld.create({ grid: grid, rooms: [], nodes: [], edges: [], walls: [] }); }
function mk() { return { x: 200, y: 200, theta: 0, z: 0 }; }

var w = freshWorld();

var p = w.step(mk(), { fwd: 1 }, 1);
ok('W：theta=0 时向东(+x)走 40px', near(p.x - 200, 40, 1) && near(p.y - 200, 0, 1),
  'Δ=(' + (p.x - 200).toFixed(1) + ',' + (p.y - 200).toFixed(1) + ')');

p = w.step(mk(), { back: 1 }, 1);
ok('S：向西(-x)退 40px', near(p.x - 200, -40, 1) && near(p.y - 200, 0, 1),
  'Δ=(' + (p.x - 200).toFixed(1) + ',' + (p.y - 200).toFixed(1) + ')');

p = w.step(mk(), { strafeL: 1 }, 1);
ok('左平移动作（Shift+← 用）：向北(-y)走 40px，朝向不变', near(p.y - 200, -40, 1) && near(p.x - 200, 0, 1) && near(p.theta, 0, 0.01),
  'Δ=(' + (p.x - 200).toFixed(1) + ',' + (p.y - 200).toFixed(1) + ') θ=' + p.theta);

p = w.step(mk(), { strafeR: 1 }, 1);
ok('右平移动作（Shift+→ 用）：向南(+y)走 40px，朝向不变', near(p.y - 200, 40, 1) && near(p.x - 200, 0, 1) && near(p.theta, 0, 0.01),
  'Δ=(' + (p.x - 200).toFixed(1) + ',' + (p.y - 200).toFixed(1) + ') θ=' + p.theta);

/* 转身 90° 后，A/D 必须跟着朝向走（而不是固定东南西北） */
p = w.step({ x: 200, y: 200, theta: 90, z: 0 }, { strafeL: 1 }, 1);
ok('面朝南(θ=90)时左平移=向东(+x)，跟着朝向走', near(p.x - 200, 40, 1) && near(p.y - 200, 0, 1) && near(p.theta, 90, 0.01),
  'Δ=(' + (p.x - 200).toFixed(1) + ',' + (p.y - 200).toFixed(1) + ')');

p = w.step(mk(), { turnL: 1 }, 1);
ok('←：逆时针转 120°/s', near(FPWorld.normalizeAngle(0 - 120), p.theta, 0.01) || near(p.theta, 240, 0.01),
  'θ=' + p.theta);

p = w.step(mk(), { turnR: 1 }, 1);
ok('→：顺时针转 120°/s', near(p.theta, 120, 0.01), 'θ=' + p.theta);

/* 同时按前进 + 左平移（Shift+←）：斜着走，朝向不变 */
p = w.step(mk(), { fwd: 1, strafeL: 1 }, 1);
var dl = Math.hypot(p.x - 200, p.y - 200);
ok('前进+左平移：斜向(东北)匀速 40px，朝向不变',
  near(dl, 40, 1) && p.x > 200 && p.y < 200 && near(p.theta, 0, 0.01),
  '位移=' + dl.toFixed(1) + 'px Δ=(' + (p.x - 200).toFixed(1) + ',' + (p.y - 200).toFixed(1) + ')');

/* ========== 3) 楼梯上横移：不跨跑道、高度不突跳 ========== */
console.log('[3] 台阶上左右平移（laneSlide 夹在本侧）');
/* 造一个 120x60 的楼梯间（坡向沿 x，门在西侧），带楼梯高度场 */
var rooms = [{ id: 'st', name: '楼梯', x: 100, y: 170, w: 120, h: 60, kind: 'stair' }];
var nodes = [{ id: 'n1', x: 90, y: 200, note: '门口' }];   // 西侧门外
var sw = FPWorld.create({ grid: grid, rooms: rooms, nodes: nodes, edges: [], walls: [], stairSign: 1, stairDoors: nodes });
var st = sw.stairs[0];
ok('楼梯间被识别（axis=' + st.axis + ', dir=' + st.dir + '）', !!st && st.axis === 'x' && st.dir === 1);

/* 从门端走进去，到坡上某处（t≈0.4，第一跑） */
var startY = st.y + st.h * 0.25;        // 第一跑一侧（上行时 A 半侧是小 across）
var probe = { x: st.x + st.w * 0.5, y: startY, theta: 0, z: 0 };
probe.z = sw.heightAt(probe.x, probe.y, 0);
var z0 = probe.z;
ok('坡上探针高度 >0（确实站在台阶上）', z0 > 0.2, 'z=' + z0.toFixed(2));

/* 在坡上按 D（向南 = 朝两跑之间的中线）走 20 步，记录高度变化 */
var q = { x: probe.x, y: probe.y, theta: 0, z: z0 };
var maxJump = 0, prevZ = q.z, crossed = false;
var centerY = st.y + st.h / 2;
for (var i = 0; i < 20; i++) {
  q = sw.step(q, { strafeR: 1 }, 0.05);
  maxJump = Math.max(maxJump, Math.abs(q.z - prevZ));
  prevZ = q.z;
  if (q.y > centerY + 1) crossed = true;
}
ok('横移不跨过两跑中线', !crossed, 'y=' + q.y.toFixed(1) + ' 中线=' + centerY);
ok('横移过程中高度不突跳(≤0.3m/步)', maxJump <= 0.31, '最大跳变=' + maxJump.toFixed(3) + 'm');
ok('横移后朝向没被改变', near(q.theta, 0, 0.01), 'θ=' + q.theta);

/* 沿坡向前进（W）仍然能正常上升 */
var r = { x: probe.x, y: probe.y, theta: 0, z: z0 };
for (var j = 0; j < 20; j++) r = sw.step(r, { fwd: 1 }, 0.05);
ok('坡上按 W 仍能沿台阶上升', r.z > z0 + 0.1, z0.toFixed(2) + ' → ' + r.z.toFixed(2) + 'm');

console.log('\n结论: ' + (fails === 0 ? '全部通过' : fails + ' 项失败'));
process.exit(fails === 0 ? 0 : 1);
