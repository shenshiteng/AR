/* =========================================================================
   fp-validate.js —— 内置自检（window.FPValidate）
   -------------------------------------------------------------------------
   一方面给「全局校验器」演示怎么调 FPWorld 的接口，一方面当体检报告用：
   把地图数据里的可疑点（穿墙边、落在墙上的节点等）直接列出来给人看。

   每个检查返回 { name, pass, detail }；run() 返回数组。
   注意：网格来自照片，可能有「假墙/漏墙」，所以「穿墙」类检查只报告、不判死。
   ========================================================================= */
window.FPValidate = (function () {
  'use strict';

  function run(world) {
    var out = [];
    var nodes = world.nodes || [];
    var edges = world.edges || [];
    var rooms = world.rooms || [];

    /* 1. 节点都在地图内、且落点不是墙 */
    var badNodes = [];
    nodes.forEach(function (n) {
      if (n.x < 0 || n.y < 0 || n.x >= world.width || n.y >= world.height) {
        badNodes.push(n.id + '(越界)');
      } else if (world.isWallPx(n.x, n.y)) {
        badNodes.push(n.id + '(落在墙上)');
      }
    });
    out.push({
      name: '节点在地图内且非墙',
      pass: badNodes.length === 0,
      detail: badNodes.length ? '有问题的节点：' + badNodes.join('、') : nodes.length + ' 个节点全部通过'
    });

    /* 2. 每条边的两端应能互相「看见」（射线不该穿墙）。
          这是报告型检查：假墙会误报，所以只列出来、不判死。 */
    var badEdges = [];
    edges.forEach(function (e) {
      var a = world.getNode(e[0]), b = world.getNode(e[1]);
      if (!a || !b) return;
      var dx = b.x - a.x, dy = b.y - a.y;
      var theta = Math.atan2(dy, dx) * 180 / Math.PI;
      var r = world.castRay(a.x, a.y, theta);
      var d = Math.sqrt(dx * dx + dy * dy);
      // 射线在到达对端之前就撞墙了（留 2px 容差）
      if (r.dist < d - 2) badEdges.push(e[0] + '→' + e[1] + '(被墙挡 ' + Math.round(r.dist) + '/' + Math.round(d) + 'px)');
    });
    out.push({
      name: '边不穿墙（报告）',
      pass: true,
      detail: badEdges.length ? badEdges.join('；') : '所有边在网格里都能走通'
    });

    /* 3. 射线的边界：空地 0<dist<∞，墙内 dist=0 */
    var c0 = { dist: -1 }, c1 = { dist: -1 };
    if (nodes.length) {
      var n0 = nodes[0];
      c0 = world.castRay(n0.x, n0.y, 0);
      // 找一个墙格当起点
      var wcell = findWallCell(world);
      if (wcell) {
        var wpx = wcell[0] * world.cell + world.cell / 2;
        var wpy = wcell[1] * world.cell + world.cell / 2;
        c1 = world.castRay(wpx, wpy, 0);
      }
    }
    out.push({
      name: '射线边界',
      pass: c0.dist > 0 && c1.dist === 0,
      detail: '空地起步 dist=' + Math.round(c0.dist) + 'px，墙内起步 dist=' + Math.round(c1.dist) + 'px'
    });

    /* 4. 撞墙：从墙格旁边朝墙内走一步，坐标不该进墙 */
    var blocked = false, detail4 = '';
    if (nodes.length) {
      var n = nodes[0];
      var p = { x: n.x, y: n.y, theta: 0 };
      // 找到第一个挡路的墙，走到它前面再顶进去
      var r = world.castRay(p.x, p.y, 0);
      var nearX = p.x + Math.max(0, r.dist - 4);
      var p2 = { x: nearX, y: p.y, theta: 0 };
      var s2 = world.step(p2, { fwd: 1 }, 1);   // 1 秒，够撞上了
      blocked = world.isWallPx(s2.x, s2.y) === false;
      detail4 = '撞墙前 ' + Math.round(p2.x) + 'px → 撞后 ' + Math.round(s2.x) + 'px（未进墙）';
    }
    out.push({ name: '撞墙被挡住', pass: blocked, detail: detail4 });

    /* 5. 确定性：相同 action 序列跑两遍，结果逐位一致 */
    var det = true;
    if (nodes.length) {
      var start = world.spawnAtNode(nodes[0].id, 45);
      var seq = [
        { fwd: 1 }, { turnR: 1 }, { fwd: 1 }, { turnL: 1 }, { strafeR: 1 }, { back: 1 }
      ];
      var a = runSeq(world, start, seq);
      var b = runSeq(world, start, seq);
      det = a.x === b.x && a.y === b.y && a.theta === b.theta;
    }
    out.push({
      name: 'step 确定性',
      pass: det,
      detail: det ? '同一动作序列两次结果完全一致' : '两次结果不一致（存在非确定逻辑）'
    });

    /* 6. 朝向归一：转一整圈回到同朝向 */
    var norm = false;
    if (nodes.length) {
      var sp = world.spawnAtNode(nodes[0].id, 0);
      var t = sp.theta;
      t = world.normalizeAngle(t + 360);
      t = world.normalizeAngle(t - 90);
      t = world.normalizeAngle(t + 90);
      norm = Math.abs(t - 0) < 1e-9;
    }
    out.push({ name: '朝向归一', pass: norm, detail: norm ? '±360/±90 后仍回到 0°' : '归一化出错' });

    /* 附：房间数统计，方便一眼核对 */
    out.push({
      name: '数据规模',
      pass: true,
      detail: nodes.length + ' 节点 / ' + edges.length + ' 边 / ' + rooms.length + ' 房间 / ' + (world.walls ? world.walls.length : 0) + ' 墙矩形'
    });

    return out;
  }

  function findWallCell(world) {
    for (var cy = 0; cy < world.rows; cy++) {
      for (var cx = 0; cx < world.cols; cx++) {
        if (world.isWallCell(cx, cy)) return [cx, cy];
      }
    }
    return null;
  }

  function runSeq(world, start, seq) {
    var p = { x: start.x, y: start.y, theta: start.theta };
    seq.forEach(function (a) { p = world.step(p, a, 0.016); });
    return p;
  }

  return { run: run };
})();
