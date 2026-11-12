// ArUco 解码桥：在 Node 里跑项目里那份真的 js-aruco2，不需要浏览器、不需要 canvas。
//
// 用法：
//   node tools/aruco_probe.js <宽> <高> <文件1.rgba> [文件2.rgba ...]
//   输出：JSON 数组，每项 { file, ms, markers:[{id, distance, center:[x,y]}], err }
//
// 说明：
//   - 输入是原始 RGBA 字节流（每像素 4 字节），不是 PNG。js-aruco2-cv.js 里 stride 硬编码为 4，
//     传单通道会越界读成 undefined → 整幅图变黑 → 静默返回空数组。
//   - js-aruco2.js 第 33 行写的是 `var CV = this.CV || require('./cv').CV`，
//     所以只要先把 global.CV 铺好，短路求值就不会走到 require，也就无需伪造 ./cv 模块。

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function boot() {
  // 先加载 CV（文件里是 `var CV = CV || {}`，在 runInThisContext 下会挂到 globalThis）
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/vendor/js-aruco2-cv.js'), 'utf8'));
  if (typeof global.CV === 'undefined' || !global.CV.findContours) {
    throw new Error('js-aruco2-cv.js 加载失败，global.CV 不可用');
  }
  // 再加载 AR，此时 `this.CV` 已存在，不会走 require('./cv')
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/vendor/js-aruco2.js'), 'utf8'));
  if (typeof global.AR === 'undefined' || !global.AR.Detector) {
    throw new Error('js-aruco2.js 加载失败，global.AR 不可用');
  }
  return new global.AR.Detector({ dictionaryName: 'ARUCO' });
}

function main() {
  const w = parseInt(process.argv[2], 10);
  const h = parseInt(process.argv[3], 10);
  const files = process.argv.slice(4);
  if (!w || !h || files.length === 0) {
    console.error('用法: node tools/aruco_probe.js <宽> <高> <file.rgba ...>');
    process.exit(2);
  }

  const det = boot();
  const out = [];

  for (const f of files) {
    const rec = { file: path.basename(f), ms: 0, markers: [], err: null };
    try {
      const buf = fs.readFileSync(f);
      if (buf.length !== w * h * 4) {
        rec.err = 'size mismatch: ' + buf.length + ' != ' + (w * h * 4);
        out.push(rec);
        continue;
      }
      const t0 = Date.now();
      const found = det.detectImage(w, h, new Uint8Array(buf)) || [];
      rec.ms = Date.now() - t0;
      rec.markers = found.map(function (m) {
        // corners 是 4 个 {x,y}
        const cx = m.corners.reduce(function (s, p) { return s + p.x; }, 0) / 4;
        const cy = m.corners.reduce(function (s, p) { return s + p.y; }, 0) / 4;
        return { id: m.id, distance: m.distance, center: [Math.round(cx), Math.round(cy)] };
      });
    } catch (e) {
      rec.err = String(e && e.message || e);
    }
    out.push(rec);
  }

  process.stdout.write(JSON.stringify(out));
}

main();
