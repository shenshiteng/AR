/* =========================================================================
   floor-detect.js —— 平面图自动识别（图片 → 数字地图）
   -------------------------------------------------------------------------
   纯前端图像处理，不联网、不需要模型。原来内联在 tools/marker.html 里，
   这里抽成独立模块，给「标点工具 marker.html」和「导入工具 import.html」共用，
   避免两份代码各自演化走偏。

   输入：<img> / <canvas>（有 naturalWidth 或 width）
        opt = { threshold: 120, sealPx: 24, maxSide: 1600, adaptive: true, c: undefined }
   输出：{
     rooms: [{x,y,w,h}],     // 房间外框，原图像素坐标
     nodes: [{x,y}],         // 走廊路点，原图像素坐标
     edges: [[i,j], ...],    // 路点之间可通行，索引指向 nodes
     stats: { rooms, nodes, edges, seal, islands, work }
   }
   ========================================================================= */
/* =========================================================================
   平面图自动识别 —— 纯前端图像处理，不需要联网、不需要模型
   思路：
   1) 灰度化 + 阈值 → 把深色线当墙
   2) 墙加粗 2px，堵住抗锯齿造成的细缝
   3) 对「自由空间」做距离变换（每个像素到最近墙的距离）
   4) 房间：把自由空间按 R 收缩，门口会被掐断，剩下的每一坨就是一个房间
   5) 路点：在自由空间里按间距撒点（离墙够远才要），两点之间直线畅通就连一条边
   最后坐标全部换算回原图像素
   ========================================================================= */
window.FloorDetect = (function () {
  'use strict';

  function dilate(mask, w, h, r) {
    if (!r) return mask;
    var tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    var x, y, dx, dy, v, xx, yy, row;
    for (y = 0; y < h; y++) {
      row = y * w;
      for (x = 0; x < w; x++) {
        v = 0;
        for (dx = -r; dx <= r; dx++) { xx = x + dx; if (xx >= 0 && xx < w && mask[row + xx]) { v = 1; break; } }
        tmp[row + x] = v;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        v = 0;
        for (dy = -r; dy <= r; dy++) { yy = y + dy; if (yy >= 0 && yy < h && tmp[yy * w + x]) { v = 1; break; } }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  /* 腐蚀：r 邻域内全是墙才保留 */
  function erode(mask, w, h, r) {
    if (!r) return mask;
    var tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    var x, y, dx, dy, v, xx, yy, row;
    for (y = 0; y < h; y++) {
      row = y * w;
      for (x = 0; x < w; x++) {
        v = 1;
        for (dx = -r; dx <= r; dx++) {
          xx = x + dx;
          if (xx < 0 || xx >= w || !mask[row + xx]) { v = 0; break; }
        }
        tmp[row + x] = v;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        v = 1;
        for (dy = -r; dy <= r; dy++) {
          yy = y + dy;
          if (yy < 0 || yy >= h || !tmp[yy * w + x]) { v = 0; break; }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  /* 闭运算 = 先膨胀后腐蚀。作用：把墙线上 2r 以内的缺口/断点连起来，
     也就是**补门洞**。关键点是它不会缩小房间本身（凸区域膨胀再腐蚀基本恢复原样），
     所以不像「封口半径」那样，一调大就把矮房间整个吞掉。 */
  function morphClose(mask, w, h, r) {
    if (!r) return mask;
    return erode(dilate(mask, w, h, r), w, h, r);
  }

  /* 两遍扫描的倒角距离变换：结果 ≈ 到最近墙的像素距离 */
  function chamfer(free, w, h) {
    var INF = 1e9, d = new Float32Array(w * h), i, x, y, m, v;
    var A = 1, B = 1.4142;
    for (i = 0; i < w * h; i++) d[i] = free[i] ? INF : 0;
    for (y = 1; y < h; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        if (d[i] === 0) continue;
        m = d[i];
        v = d[i - w] + A; if (v < m) m = v;
        v = d[i - 1] + A; if (v < m) m = v;
        v = d[i - w - 1] + B; if (v < m) m = v;
        v = d[i - w + 1] + B; if (v < m) m = v;
        d[i] = m;
      }
    }
    for (y = h - 2; y >= 1; y--) {
      for (x = w - 2; x >= 1; x--) {
        i = y * w + x;
        m = d[i];
        v = d[i + w] + A; if (v < m) m = v;
        v = d[i + 1] + A; if (v < m) m = v;
        v = d[i + w + 1] + B; if (v < m) m = v;
        v = d[i + w - 1] + B; if (v < m) m = v;
        d[i] = m;
      }
    }
    return d;
  }

  /* 连通域标记（4 邻接），返回每个连通块的面积、外接矩形、是否贴边 */
  function components(mask, w, h) {
    var label = new Int32Array(w * h), stack = new Int32Array(w * h);
    var out = [], cur = 0, i, p, sp, x, y, area, x1, y1, x2, y2, border;
    for (i = 0; i < w * h; i++) {
      if (!mask[i] || label[i]) continue;
      cur++;
      sp = 0; stack[sp++] = i; label[i] = cur;
      area = 0; x1 = 1e9; y1 = 1e9; x2 = -1; y2 = -1; border = false;
      while (sp) {
        p = stack[--sp];
        x = p % w; y = (p - x) / w;
        area++;
        if (x < x1) x1 = x; if (x > x2) x2 = x;
        if (y < y1) y1 = y; if (y > y2) y2 = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = cur; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = cur; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = cur; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = cur; stack[sp++] = p + w; }
      }
      out.push({ area: area, x1: x1, y1: y1, x2: x2, y2: y2, border: border });
    }
    return out;
  }

  /* 从图像四边往里泛洪：得到「楼外那圈空白」 */
  function borderRegion(free, w, h) {
    var out = new Uint8Array(w * h), stack = new Int32Array(w * h), sp = 0, i, p, x, y, area = 0;
    function push(k) {
      if (free[k] && !out[k]) { out[k] = 1; stack[sp++] = k; }
    }
    for (x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      p = stack[--sp]; x = p % w; y = (p - x) / w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    for (i = 0; i < w * h; i++) if (out[i]) area++;
    return { mask: out, area: area };
  }

  /* 按间距在自由空间里撒路点，离墙至少 cmin */
  function sampleNodes(dist, w, h, spacing, cmin, maxN, blocked) {
    var pts = [], cell = spacing;
    var gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
    var grid = new Array(gw * gh);
    var step = Math.max(2, Math.round(spacing / 6));
    var x, y, i, gx, gy, dx, dy, nx, ny, ok, idx, q;
    for (y = 0; y < h; y += step) {
      for (x = 0; x < w; x += step) {
        i = y * w + x;
        if (dist[i] < cmin) continue;
        if (blocked && blocked[i]) continue;
        gx = (x / cell) | 0; gy = (y / cell) | 0;
        ok = true;
        for (dy = -1; dy <= 1 && ok; dy++) {
          for (dx = -1; dx <= 1 && ok; dx++) {
            nx = gx + dx; ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            idx = grid[ny * gw + nx];
            if (idx === undefined) continue;
            q = pts[idx];
            if (Math.hypot(q.x - x, q.y - y) < spacing) ok = false;
          }
        }
        if (!ok) continue;
        grid[gy * gw + gx] = pts.length;
        pts.push({ x: x, y: y });
        if (pts.length >= maxN) return pts;
      }
    }
    return pts;
  }

  /* 两点之间是否全程在走廊里（不穿墙） */
  function lineOfSight(a, b, dist, w, h) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    var n = Math.max(1, Math.ceil(len / 2));
    for (var s = 1; s < n; s++) {
      var x = Math.round(a.x + dx * s / n), y = Math.round(a.y + dy * s / n);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
      if (dist[y * w + x] < 1.6) return false;
    }
    return true;
  }

  /* 每个点只连最近几个「一眼能走过去」的点，避免连成一团蜘蛛网 */
  function connectNodes(nodes, dist, w, h, maxD, k) {
    var edges = [], seen = {}, i, j, d, key, cand, t;
    for (i = 0; i < nodes.length; i++) {
      cand = [];
      for (j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (d > maxD) continue;
        if (!lineOfSight(nodes[i], nodes[j], dist, w, h)) continue;
        cand.push({ j: j, d: d });
      }
      cand.sort(function (p, q) { return p.d - q.d; });
      for (t = 0; t < Math.min(k || 4, cand.length); t++) {
        key = i < cand[t].j ? i + '-' + cand[t].j : cand[t].j + '-' + i;
        if (seen[key]) continue;
        seen[key] = 1;
        edges.push([i, cand[t].j]);
      }
    }
    return edges;
  }

  /* 去掉房间里的文字/符号噪点：又小、填充率又低（笔画）的深色块不是墙 */
  function denoise(wall, w, h) {
    var n = w * h, label = new Int32Array(n), stack = new Int32Array(n);
    var bx1 = [], by1 = [], bx2 = [], by2 = [], ar = [], cur = 0;
    var i, p, sp, x, y, c;

    for (i = 0; i < n; i++) {
      if (!wall[i] || label[i]) continue;
      cur++;
      sp = 0; stack[sp++] = i; label[i] = cur;
      var x1 = 1e9, y1 = 1e9, x2 = -1, y2 = -1, area = 0;
      while (sp) {
        p = stack[--sp]; x = p % w; y = (p - x) / w; area++;
        if (x < x1) x1 = x; if (x > x2) x2 = x;
        if (y < y1) y1 = y; if (y > y2) y2 = y;
        if (x > 0 && wall[p - 1] && !label[p - 1]) { label[p - 1] = cur; stack[sp++] = p - 1; }
        if (x < w - 1 && wall[p + 1] && !label[p + 1]) { label[p + 1] = cur; stack[sp++] = p + 1; }
        if (y > 0 && wall[p - w] && !label[p - w]) { label[p - w] = cur; stack[sp++] = p - w; }
        if (y < h - 1 && wall[p + w] && !label[p + w]) { label[p + w] = cur; stack[sp++] = p + w; }
      }
      bx1[cur] = x1; by1[cur] = y1; bx2[cur] = x2; by2[cur] = y2; ar[cur] = area;
    }

    var maxT = Math.max(24, Math.min(w, h) * 0.09);
    var kill = new Uint8Array(cur + 1);
    for (c = 1; c <= cur; c++) {
      var bw = bx2[c] - bx1[c] + 1, bh = by2[c] - by1[c] + 1;
      var fill = ar[c] / (bw * bh);
      // 整片墙网（外墙/隔墙连成一体）包住很大一片，填充率天生很低，绝不能删。
      // 只要任一边跨过 35%，就当成墙网放过 —— 半层墙也可能就这么大。
      if (bw > w * 0.35 || bh > h * 0.35) continue;
      // 小块 + 填充率低 = 文字笔画
      if (bw <= maxT && bh <= maxT && fill < 0.62) kill[c] = 1;
      // 大块但极稀疏 = 连成一整行的文字（原来只看尺寸，长的整行字反而全放过）
      else if (fill < 0.30) kill[c] = 1;
    }
    for (i = 0; i < n; i++) if (wall[i] && kill[label[i]]) wall[i] = 0;
  }

  /* 有些房间和走廊之间没有一条「直线畅通」的路，会被切成孤岛。
     这里把每个孤岛和主路网之间最短的一条可见连线补上。 */
  function repairConnectivity(nodes, edges, dist, w, h, limit) {
    var n = nodes.length, i, a, b, d, best, added, iter, k;
    var par = new Array(n);
    for (i = 0; i < n; i++) par[i] = i;

    function find(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
    function uni(x, y) { par[find(x)] = find(y); }

    edges.forEach(function (e) { uni(e[0], e[1]); });

    for (iter = 0; iter < 8; iter++) {
      var size = {}, maxRoot = -1, maxSz = 0, r;
      for (i = 0; i < n; i++) { r = find(i); size[r] = (size[r] || 0) + 1; }
      for (k in size) if (size[k] > maxSz) { maxSz = size[k]; maxRoot = +k; }
      if (maxSz === n) break;

      added = false;
      for (k in size) {
        r = +k;
        if (r === maxRoot) continue;
        best = null;
        for (a = 0; a < n; a++) {
          if (find(a) !== r) continue;
          for (b = 0; b < n; b++) {
            if (find(b) === r) continue;
            d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
            if (best && d >= best.d) continue;
            if (lineOfSight(nodes[a], nodes[b], dist, w, h)) best = { a: a, b: b, d: d };
          }
        }
        if (best && best.d <= limit) {
          edges.push([best.a, best.b]);
          uni(best.a, best.b);
          added = true;
        }
      }
      if (!added) break;
    }
    return edges;
  }

  /* 积分图，用来快速算任意矩形区域的平均灰度 */
  function integral(gray, w, h) {
    var W1 = w + 1;
    var I = new Float64Array(W1 * (h + 1));
    for (var y = 0; y < h; y++) {
      var sum = 0, rowBase = y * w, iBase = (y + 1) * W1, pBase = y * W1;
      for (var x = 0; x < w; x++) {
        sum += gray[rowBase + x];
        I[iBase + x + 1] = I[pBase + x + 1] + sum;
      }
    }
    return I;
  }

  /* 可分离的灰度膨胀/腐蚀（方形结构元素），用来做闭运算、估计背景亮度 */
  function grayFilter(src, w, h, r, isMax) {
    var t = new Float32Array(w * h), out = new Float32Array(w * h);
    var x, y, xx, yy, best, v, x1, x2, y1, y2, row;
    for (y = 0; y < h; y++) {
      row = y * w;
      for (x = 0; x < w; x++) {
        best = isMax ? -1e9 : 1e9;
        x1 = x - r < 0 ? 0 : x - r; x2 = x + r >= w ? w - 1 : x + r;
        for (xx = x1; xx <= x2; xx++) {
          v = src[row + xx];
          if (isMax ? v > best : v < best) best = v;
        }
        t[row + x] = best;
      }
    }
    for (y = 0; y < h; y++) {
      y1 = y - r < 0 ? 0 : y - r; y2 = y + r >= h ? h - 1 : y + r;
      for (x = 0; x < w; x++) {
        best = isMax ? -1e9 : 1e9;
        for (yy = y1; yy <= y2; yy++) {
          v = t[yy * w + x];
          if (isMax ? v > best : v < best) best = v;
        }
        out[y * w + x] = best;
      }
    }
    return out;
  }

  /* 暗线提取：black-hat = 灰度闭运算(图) − 图
     ------------------------------------------------------------------
     闭运算会把「细细的暗线」按周围背景的亮度填平，所以差值在墙线上很大、
     在空白背景上接近 0。
     以前是「跟局部平均亮度比」，坑在于：墙线一密，局部平均自己就被暗线拉低了，
     越是房间隔墙密集的区域越判不出墙 —— 正好把整排房间的隔墙漏掉，房间连成一条。
     换成 black-hat 就绕开了这个自相矛盾。 */
  /* 认红墙：房间是「红框」——墙线为红色，房间号/标注是黑字。
     只挑「R 明显高于 G 和 B」的像素，黑字（R≈G≈B）自然落选。
     这一步是识别准的关键：之前用灰度找暗线，红墙和黑字一起被当成线，
     文字笔画污染了投影曲线，才怎么调都把房间切碎或合并。 */
  function redWall(px, w, h) {
    var m = new Uint8Array(w * h), i, p, R, G, B;
    for (i = 0, p = 0; i < w * h; i++, p += 4) {
      R = px[p]; G = px[p + 1]; B = px[p + 2];
      // R 够亮、且比 G、B 都高一大截 → 红；排除灰/黑/橙黄
      if (R > 90 && (R - G) > 28 && (R - B) > 28) m[i] = 1;
    }
    return m;
  }

  function blackHat(gray, w, h, r) {
    var d = grayFilter(gray, w, h, r, true);    // 灰度膨胀（取邻域最大）
    var c = grayFilter(d, w, h, r, false);      // 再灰度腐蚀 → 闭运算
    var bh = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) bh[i] = c[i] - gray[i];
    return bh;
  }

  /* 从 black-hat 响应里取墙：双阈值滞后 —— 强响应必收，弱响应只要挨着强响应也收，
     孤立弱响应（文字、噪点）丢掉。C 越大越灵敏（沿用原 threshold 的语义）。 */
  function adaptiveWall(gray, w, h, C) {
    var n = w * h, i, v, p, px, py, dx, dy, nx, ny, q, sp, stack, out;
    var r = Math.max(3, Math.round(Math.min(w, h) * 0.007));
    var bh = blackHat(gray, w, h, r);
    var T = Math.max(8, 40 - C);          // 弱阈值
    var Ts = T * 1.7;                     // 强阈值
    var strong = new Uint8Array(n), weak = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      v = bh[i];
      if (v > Ts) { strong[i] = 1; weak[i] = 1; }
      else if (v > T) weak[i] = 1;
    }
    out = new Uint8Array(n); stack = new Int32Array(n); sp = 0;
    for (i = 0; i < n; i++) if (strong[i]) { out[i] = 1; stack[sp++] = i; }
    while (sp) {
      p = stack[--sp]; px = p % w; py = (p - px) / w;
      for (dy = -1; dy <= 1; dy++) {
        for (dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          nx = px + dx; ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          q = ny * w + nx;
          if (weak[q] && !out[q]) { out[q] = 1; stack[sp++] = q; }
        }
      }
    }
    return out;
  }

  /* 闭运算把门洞补好之后，楼内的自由空间就被墙网切成了若干个连通块：
     每一块要么是一间房，要么是一段走廊。最大的一块当走廊，其余当房间。 */
  function evaluate(wall, w, h, seal) {
    var n = w * h, i;

    var closed = morphClose(wall, w, h, seal);
    var free = new Uint8Array(n);
    for (i = 0; i < n; i++) free[i] = closed[i] ? 0 : 1;

    // 楼外那圈空白不是房间：从四边泛洪；只有它确实占少数时才算"楼外"
    var br = borderRegion(free, w, h);
    var freeTotal = 0;
    for (i = 0; i < n; i++) if (free[i]) freeTotal++;
    var outside = br.area < freeTotal * 0.45 ? br.mask : null;

    var inside = new Uint8Array(n);
    for (i = 0; i < n; i++) inside[i] = (free[i] && !(outside && outside[i])) ? 1 : 0;

    // 最小房间面积按图幅给固定下限，别跟封口尺寸挂钩
    var minArea = Math.max(140, Math.round(w * h * 0.0005));
    var comps = components(inside, w, h).filter(function (c) { return c.area >= minArea; });
    if (!comps.length) return null;

    comps.sort(function (a, b) { return b.area - a.area; });
    var corridor = comps[0];
    var rooms = comps.slice(1).filter(function (c) {
      var bw = c.x2 - c.x1 + 1, bh = c.y2 - c.y1 + 1;
      if (bw < 8 || bh < 8) return false;
      if (bw / bh > 15 || bh / bw > 15) return false;   // 细长条多半是墙缝
      if (c.area > w * h * 0.3) return false;
      return true;
    });
    return { corridor: corridor, rooms: rooms };
  }

  /* ============ 网格法：按「横墙的 y 位置 + 竖墙的 x 位置」切房间 ============
     为什么需要它：连通域/封口那一套，遇到「门洞宽度和走廊宽度差不多」的图就彻底没辙 ——
     封口半径小了门洞补不上，房间和走廊连成一片；大了走廊先被填死。
     可平面图（尤其 CAD 导出、印刷的疏散图）墙基本横平竖直，房间本来就是一张网格。
     网格法只看「墙线在哪几条 x/y 上」，门洞开着也不影响切格子。 */

  /* 方向性开运算：水平保留 ≤ L 的横线，垂直保留竖线。用来把墙线里的文字笔画滤掉，
     只留下真正成条的墙。 */
  function morphOpenH(mask, w, h, L) {
    var r = Math.max(1, L >> 1), e = new Uint8Array(w * h), out = new Uint8Array(w * h);
    var x, y, d, ok, row, v, xx, x2;
    for (y = 0; y < h; y++) {
      row = y * w;
      for (x = 0; x < w; x++) {
        ok = 1;
        for (d = -r; d <= r; d++) { xx = x + d; if (xx < 0 || xx >= w || !mask[row + xx]) { ok = 0; break; } }
        e[row + x] = ok;
      }
    }
    for (y = 0; y < h; y++) {
      row = y * w;
      for (x = 0; x < w; x++) {
        v = 0;
        for (d = -r; d <= r; d++) { x2 = x + d; if (x2 >= 0 && x2 < w && e[row + x2]) { v = 1; break; } }
        out[row + x] = v;
      }
    }
    return out;
  }

  function morphOpenV(mask, w, h, L) {
    var r = Math.max(1, L >> 1), e = new Uint8Array(w * h), out = new Uint8Array(w * h);
    var x, y, d, ok, v, yy, y2;
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        ok = 1;
        for (d = -r; d <= r; d++) { yy = y + d; if (yy < 0 || yy >= h || !mask[yy * w + x]) { ok = 0; break; } }
        e[y * w + x] = ok;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        v = 0;
        for (d = -r; d <= r; d++) { y2 = y + d; if (y2 >= 0 && y2 < h && e[y2 * w + x]) { v = 1; break; } }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  /* 从投影曲线里找「线」的位置：先挑局部极大，再做非极大抑制（相距 gap 以内只留最强） */
  function findLines(proj, n, minSupport, gap, maxN) {
    var cand = [], out = [], i, j, p, ok, cap = maxN || 999;
    for (i = 1; i < n - 1; i++) {
      if (proj[i] >= minSupport && proj[i] >= proj[i - 1] && proj[i] >= proj[i + 1]) cand.push(i);
    }
    cand.sort(function (a, b) { return proj[b] - proj[a]; });
    for (i = 0; i < cand.length && out.length < cap; i++) {
      p = cand[i]; ok = true;
      for (j = 0; j < out.length; j++) if (Math.abs(out[j] - p) < gap) { ok = false; break; }
      if (ok) out.push(p);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /* 沿着一条边采样，看有多大比例落在墙上（墙有厚度，所以允许 ±2 的偏移） */
  function edgeCover(x0, y0, x1, y1, wall, w, h) {
    var n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    var hit = 0, t, x, y, ox, oy, xx, yy, found;
    for (t = 0; t <= n; t++) {
      x = Math.round(x0 + (x1 - x0) * t / n);
      y = Math.round(y0 + (y1 - y0) * t / n);
      found = 0;
      for (oy = -2; oy <= 2 && !found; oy++) {
        for (ox = -2; ox <= 2; ox++) {
          xx = x + ox; yy = y + oy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && wall[yy * w + xx]) { found = 1; break; }
        }
      }
      if (found) hit++;
    }
    return hit / (n + 1);
  }

  /* 主流程：横墙定条带 → 条带内找竖墙 → 切成格子 → 四边有墙的格子就是房间 */
  function gridRooms(wall, w, h) {
    var L = Math.max(20, Math.round(Math.min(w, h) * 0.03));
    var H = morphOpenH(wall, w, h, L);
    var V = morphOpenV(wall, w, h, L);
    var hy = new Float32Array(h), vx = new Float32Array(w);
    var x, y, i, j, c, row, rooms = [];

    for (y = 0; y < h; y++) {
      c = 0; row = y * w;
      for (x = 0; x < w; x++) if (H[row + x]) c++;
      hy[y] = c;
    }
    var Y = findLines(hy, h, Math.max(30, w * 0.10), Math.max(8, Math.round(h * 0.014)), 50);
    if (Y.length < 2) return null;

    for (i = 0; i < Y.length - 1; i++) {
      var y0 = Y[i], y1 = Y[i + 1], bandH = y1 - y0;
      if (bandH < Math.max(14, h * 0.014)) continue;

      for (x = 0; x < w; x++) {
        c = 0;
        for (y = y0; y <= y1; y++) if (V[y * w + x]) c++;
        vx[x] = c;
      }
      /* 竖墙要基本贯穿整条带（房间的左右墙就是贯穿的），占比 65% 起步 */
      var X = findLines(vx, w, bandH * 0.65, Math.max(8, Math.round(w * 0.014)), 40);
      if (X.length < 2) continue;

      for (j = 0; j < X.length - 1; j++) {
        var x0 = X[j], x1 = X[j + 1];
        if (x1 - x0 < Math.max(10, w * 0.008)) continue;
        var avg = (edgeCover(x0, y0, x1, y0, wall, w, h) +
                   edgeCover(x0, y1, x1, y1, wall, w, h) +
                   edgeCover(x0, y0, x0, y1, wall, w, h) +
                   edgeCover(x1, y0, x1, y1, wall, w, h)) / 4;
        if (avg < 0.32) continue;      // 四边都没墙 → 是空地，不是房间
        rooms.push({ x1: x0, y1: y0, x2: x1, y2: y1,
                     area: (x1 - x0) * (y1 - y0), cover: avg });
      }
    }
    return rooms;
  }

  /* 一个框几乎被另一个包住、面积又小很多 → 是碎片，去掉 */
  function dedupe(list) {
    return list.filter(function (a, i) {
      for (var j = 0; j < list.length; j++) {
        if (i === j) continue;
        var b = list[j];
        if (a.w * a.h >= b.w * b.h * 0.45) continue;
        var cx = a.x + a.w / 2, cy = a.y + a.h / 2;
        if (cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h) return false;
      }
      return true;
    });
  }

  function analyze(img, opt) {
    opt = opt || {};
    var W0 = img.naturalWidth || img.width;
    var H0 = img.naturalHeight || img.height;
    var maxSide = opt.maxSide || 1600;
    var k = Math.min(1, maxSide / Math.max(W0, H0));
    var w = Math.max(16, Math.round(W0 * k));
    var h = Math.max(16, Math.round(H0 * k));

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var px = ctx.getImageData(0, 0, w, h).data;

    var th = opt.threshold || 120;
    var gray = new Float32Array(w * h), i, p, g;
    for (i = 0, p = 0; i < w * h; i++, p += 4) {
      gray[i] = px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114;
    }

    /* 红墙优先：房间是红框，墙线为红、房号为黑字。只认红 → 黑字自动排除。
       红墙占比太低（<0.4%，如 CAD 灰线图）则退回灰度自适应，保持兼容。 */
    var wall;
    var red = redWall(px, w, h), redN = 0;
    for (i = 0; i < w * h; i++) redN += red[i];
    if (opt.red !== false && redN > w * h * 0.004) {
      wall = dilate(red, w, h, 2);     // 红墙常偏细/有断点，并一下桥接门口小缺口
    } else if (opt.adaptive === false) {
      wall = new Uint8Array(w * h);
      for (i = 0; i < w * h; i++) wall[i] = gray[i] < th ? 1 : 0;
    } else {
      // 灵敏度 → 局部对比度阈值 C：灵敏度越高越容易判成墙
      var C = opt.c !== undefined ? opt.c : Math.max(3, Math.round(26 - th / 10));
      wall = adaptiveWall(gray, w, h, C);
    }

    denoise(wall, w, h);           // 红墙下基本只剩真实墙线；去掉残留噪点
    var wallThin = wall;           // 网格法用这个（红墙下没有文字连成"线"的问题）
    wall = dilate(wall, w, h, 2);  // 粗墙：给连通域兜底和路点采样
    var free = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) free[i] = wall[i] ? 0 : 1;

    var dist = chamfer(free, w, h);

    /* ---- 房间识别 ----
       主路：红框是封闭矩形 → 框内部就是被红墙围住的一块独立空白，直接数这些连通块，
       正好对应「一个红框里一个数字 = 一个房间」。门洞若让房间和走廊连成一片，
       就用 evaluate 里的闭运算按 seal 补一下；seal 从小到大试，取房间数最多的。
       兜底：图不够规整时退回网格法。 */
    var imgArea = w * h;
    var minA = Math.max(120, Math.round(imgArea * 0.0008));   // 小于这个是墙缝/字
    var maxA = Math.round(imgArea * 0.08);                    // 大于这个是走廊/空地

    function plausible(cells) {
      var n = 0, t, c, bw, bh, a;
      for (t = 0; t < cells.length; t++) {
        c = cells[t]; bw = c.x2 - c.x1 + 1; bh = c.y2 - c.y1 + 1; a = bw * bh;
        if (a < minA || a > maxA) continue;
        if (bw / bh > 7 || bh / bw > 7) continue;
        n++;
      }
      return n;
    }

    var rooms = [], seal = Math.max(3, Math.round((opt.sealPx || Math.min(W0, H0) * 0.013) * k));

    // 1) 封闭红框 → 连通域
    var bestEv = null;
    [2, 3, 4, 6, 9, 13].forEach(function (sv) {
      var ev;
      try { ev = evaluate(wallThin, w, h, sv); } catch (e) { ev = null; }
      if (!ev) return;
      var n = plausible(ev.rooms);
      if (!bestEv || n > bestEv.n) bestEv = { n: n, ev: ev, seal: sv };
    });

    // 2) 网格法
    var grid = null, gridN = 0;
    try { grid = gridRooms(wallThin, w, h); } catch (e) { grid = null; }
    if (grid) gridN = plausible(grid);

    var useEv = bestEv && bestEv.n >= 4 && bestEv.n >= gridN;

    if (useEv) {
      seal = bestEv.seal;
      var growE = Math.min(3, seal);
      rooms = bestEv.ev.rooms.filter(function (c) {
        var bw = c.x2 - c.x1 + 1, bh = c.y2 - c.y1 + 1, a = bw * bh;
        return a >= minA && a <= maxA && bw / bh <= 7 && bh / bw <= 7;
      }).slice(0, 220).map(function (c) {
        var x1 = Math.max(0, c.x1 - growE), y1 = Math.max(0, c.y1 - growE);
        var x2 = Math.min(w - 1, c.x2 + growE), y2 = Math.min(h - 1, c.y2 + growE);
        return { x: x1 / k, y: y1 / k, w: (x2 - x1 + 1) / k, h: (y2 - y1 + 1) / k };
      });
    } else if (grid && gridN >= 4) {
      rooms = grid.filter(function (c) {
        var bw = c.x2 - c.x1 + 1, bh = c.y2 - c.y1 + 1, a = bw * bh;
        return a >= minA && a <= maxA && bw / bh <= 7 && bh / bw <= 7;
      }).map(function (c) {
        var g2 = 1;   // 补一点墙厚造成的内缩
        var x1 = Math.max(0, c.x1 - g2), y1 = Math.max(0, c.y1 - g2);
        var x2 = Math.min(w - 1, c.x2 + g2), y2 = Math.min(h - 1, c.y2 + g2);
        return { x: x1 / k, y: y1 / k, w: (x2 - x1 + 1) / k, h: (y2 - y1 + 1) / k };
      });
    }
    rooms = dedupe(rooms);

    /* ---- 路点 ---- */
    var spacing = Math.max(28, Math.min(w, h) * 0.11);
    var cmin = Math.max(3, seal * 0.8);

    // 楼外那圈空白不撒点；但如果那片空白就是图的绝大部分（图纸被裁到墙线），就不管它
    var freeTotal = 0, fi;
    for (fi = 0; fi < w * h; fi++) if (free[fi]) freeTotal++;
    var br = borderRegion(free, w, h);
    var blocked = br.area < freeTotal * 0.45 ? br.mask : null;

    var nodes = [];
    for (var attempt = 0; attempt < 4; attempt++) {
      nodes = sampleNodes(dist, w, h, spacing, cmin, 150, blocked);
      if (nodes.length <= 140) break;
      spacing *= 1.3;
    }
    var edges = connectNodes(nodes, dist, w, h, spacing * 2.1, 4);
    edges = repairConnectivity(nodes, edges, dist, w, h, spacing * 3.5);

    // 有没有点和主路网不连通（多半是那个房间没画门）
    var adj = [], q, s0, seenArr = [], comps = [], st;
    for (q = 0; q < nodes.length; q++) adj.push([]);
    edges.forEach(function (e) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
    for (s0 = 0; s0 < nodes.length; s0++) {
      if (seenArr[s0]) continue;
      var cnt = 0;
      st = [s0]; seenArr[s0] = 1;
      while (st.length) {
        var u = st.pop(); cnt++;
        for (var t = 0; t < adj[u].length; t++) {
          if (!seenArr[adj[u][t]]) { seenArr[adj[u][t]] = 1; st.push(adj[u][t]); }
        }
      }
      comps.push(cnt);
    }
    comps.sort(function (a, b) { return b - a; });
    var mainSize = comps.length ? comps[0] : 0;

    return {
      rooms: rooms,
      nodes: nodes.map(function (n) { return { x: n.x / k, y: n.y / k }; }),
      edges: edges,
      stats: {
        rooms: rooms.length,
        nodes: nodes.length,
        edges: edges.length,
        seal: Math.round(seal / k),
        islands: nodes.length - mainSize,
        work: w + '×' + h
      }
    };
  }

  return { analyze: analyze };
})();
