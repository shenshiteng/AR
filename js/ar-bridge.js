/* =========================================================================
   ar-bridge.js —— AR 导航 与 第一人称探索 的「双向同步」桥接层
   -------------------------------------------------------------------------
   作用：让手机扫码的 AR 画面（js/ar.js 的能力）和 fp 的交互逻辑
   （定位、移动、路径、状态）互相驱动，两侧状态一致。

   关键约定：
     - 世界坐标 = 图片像素，朝向 theta（度）：0=东、90=南、180=西、270=北。
     - AR 里 facing 也是「图像角」，同一个约定，可直接对齐。
     - 路线用「里程」表示：AR 计步往前走，就把里程转回世界坐标；
       fp 里键盘移动/巡航，就把世界坐标转回里程，双向都通。

   对外暴露 window.__AR__（供校验器 / 调试用）：
     { state, setLoc, setTarget, routeTo, advanceMeters, syncFromFp, syncToFp }
   ========================================================================= */
window.ARBridge = (function () {
  'use strict';

  var D = null, G = null;

  /* 路线里程表：和 ar.js 的 buildTrack 同一套思路，但独立维护 */
  var track = {
    segs: [],          // [{a,b,len,cum0,ang}]  a/b = 世界坐标点
    total: 0,
    pos: 0             // 已走米数
  };

  /* AR 当前状态 */
  var state = {
    loc: null,         // 定位点（LAB_DATA.locations 条目）
    lab: null,         // 目标实验室（LAB_DATA.labs 条目）
    route: null,       // routeToLab 结果
    facing: 0,         // 当前朝向（图像角，度）
    arrived: false
  };

  function deg(r) { return r * 180 / Math.PI; }
  function norm(a) { return ((a + 540) % 360) - 180; }
  function imageAngle(a, b) { return deg(Math.atan2(b.y - a.y, b.x - a.x)); }

  function init(data) {
    D = data;
    G = window.LabRouter.buildGraph(D);
    return window.ARBridge;
  }

  /* ---------- 定位 ---------- */
  function setLoc(loc) {
    state.loc = loc;
    if (loc && loc.normal !== undefined) {
      /* 扫码时人面朝墙，绝对朝向 = 墙面法线反过来，和 ar.js 一致 */
      state.facing = (loc.normal + 180) % 360;
    }
    if (state.lab) routeTo(state.lab);
    return state;
  }

  /* ---------- 选目标 ---------- */
  function setTarget(lab) {
    state.lab = lab;
    if (state.loc) routeTo(lab);
    return state;
  }

  /* ---------- 算路线 + 建里程表 ---------- */
  function routeTo(lab) {
    if (!state.loc || !lab) return null;
    var r = window.LabRouter.routeToLab(G, state.loc.node, lab, state.loc);
    state.route = r;
    if (!r) { track.segs = []; track.total = 0; track.pos = 0; return null; }
    buildTrack(r);
    state.arrived = false;
    return r;
  }

  function buildTrack(r) {
    var ns = r.nodes || [], segs = [], cum = 0, i, a, b, d;
    for (i = 1; i < ns.length; i++) {
      a = G.nodes[ns[i - 1]];
      b = G.nodes[ns[i]];
      if (!a || !b) continue;
      d = Math.hypot(b.x - a.x, b.y - a.y) * G.scale;
      if (d < 0.01) continue;
      segs.push({ a: a, b: b, len: d, cum0: cum, ang: imageAngle(a, b) });
      cum += d;
    }
    track.segs = segs;
    track.total = cum;
    track.pos = 0;
  }

  /* ---------- 里程 ↔ 坐标 ---------- */
  function pointAt(pos) {
    var segs = track.segs;
    if (!segs.length) return null;
    var idx = segs.length - 1, i;
    for (i = 0; i < segs.length; i++) {
      if (pos < segs[i].cum0 + segs[i].len) { idx = i; break; }
    }
    var sg = segs[idx];
    var t = Math.max(0, Math.min(1, (pos - sg.cum0) / sg.len));
    return {
      x: sg.a.x + (sg.b.x - sg.a.x) * t,
      y: sg.a.y + (sg.b.y - sg.a.y) * t,
      segIdx: idx, seg: sg, t: t
    };
  }

  /* 世界坐标 → 最近路线里程（把 fp 的玩家位置映射回 AR 的进度） */
  function posOfPoint(x, y) {
    var segs = track.segs, best = null, bd = Infinity, i;
    for (i = 0; i < segs.length; i++) {
      var sg = segs[i];
      /* 点到线段的最近点 */
      var dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y;
      var len2 = dx * dx + dy * dy;
      var t = len2 ? ((x - sg.a.x) * dx + (y - sg.a.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var px = sg.a.x + dx * t, py = sg.a.y + dy * t;
      var dd = Math.hypot(x - px, y - py);
      if (dd < bd) { bd = dd; best = { seg: sg, t: t, d: dd }; }
    }
    if (!best) return 0;
    return best.seg.cum0 + best.seg.len * best.t;
  }

  /* ---------- 前进（AR 计步驱动） ---------- */
  function advanceMeters(m) {
    if (!track.segs.length) return state;
    track.pos = Math.max(0, Math.min(track.total, track.pos + m));
    if (track.pos >= track.total - 0.5) state.arrived = true;
    return state;
  }

  /* ---------- fp → AR（键盘移动/巡航时，把玩家坐标同步回里程） ---------- */
  function syncFromFp(x, y, theta) {
    if (!track.segs.length) return state;
    track.pos = posOfPoint(x, y);
    if (theta !== undefined && theta !== null) state.facing = theta;
    if (track.pos >= track.total - 0.5) state.arrived = true;
    return state;
  }

  /* ---------- AR → fp（把里程转回世界坐标，供 fp 渲染玩家位置） ---------- */
  function syncToFp() {
    var p = pointAt(track.pos);
    if (!p) return null;
    return { x: p.x, y: p.y, theta: state.facing };
  }

  /* ---------- 路径指引（方向 / 剩余距离 / 下一步预告） ---------- */
  var TURN_LEAD = 6;   // 提前 6 米预告转弯

  function plan() {
    if (!track.segs.length) return null;
    var p = pointAt(track.pos);
    if (!p) return null;
    var segIdx = p.segIdx, sg = p.seg;
    var remain = sg.len * (1 - p.t);
    var toTurn = remain, prevAng = sg.ang, turn = null, k, dA;
    for (k = segIdx + 1; k < track.segs.length; k++) {
      dA = norm(track.segs[k].ang - prevAng);
      if (Math.abs(dA) > 28) { turn = { meters: toTurn, deg: dA, nextIdx: k }; break; }
      toTurn += track.segs[k].len;
      prevAng = track.segs[k].ang;
    }
    return {
      x: p.x, y: p.y, segIdx: segIdx, ang: sg.ang, remain: remain,
      turn: turn, left: Math.max(0, track.total - track.pos)
    };
  }

  function aimAngle() {
    var p = plan();
    if (!p) return null;
    if (p.turn && p.turn.meters < TURN_LEAD) {
      var ns = track.segs[p.turn.nextIdx];
      if (ns) {
        var k = Math.min(1, (1 - p.turn.meters / TURN_LEAD) * 1.45);
        return p.ang + norm(ns.ang - p.ang) * k;
      }
    }
    return p.ang;
  }

  /* 生成指引文案：{ action, hint, detail[] } */
  function guidance() {
    var p = plan();
    if (!p || !state.route) return null;
    var imgAng = aimAngle();
    if (imgAng === null) imgAng = p.ang;
    var rel = norm(imgAng - state.facing);
    var abs = Math.abs(rel);
    var way = rel > 0 ? '右' : '左';
    var turning = !!(p.turn && p.turn.meters < TURN_LEAD);
    var action, hint;

    if (state.arrived) {
      action = '已到达'; hint = '到了';
    } else if (abs >= 145) {
      action = '掉头'; hint = '方向反了';
    } else if (abs < 12) {
      action = '直行'; hint = '正前方';
    } else if (turning && p.turn.meters > 3.5) {
      action = '前方' + way + '转'; hint = '还有 ' + Math.round(p.turn.meters) + ' 米';
    } else if (abs < 38) {
      action = rel > 0 ? '稍向右' : '稍向左'; hint = Math.round(abs) + '°';
    } else {
      action = way + '转'; hint = Math.round(abs) + '°';
    }

    var detail = [];
    if (!state.arrived) {
      if (abs >= 145) {
        detail.push('先转身，面向走廊再走');
      } else if (p.turn) {
        var turnWay = p.turn.deg > 0 ? '右转' : '左转';
        if (p.turn.meters <= 3.5) {
          detail.push(p.turn.meters < 1 ? ('就是这儿，' + turnWay)
            : ('再走 ' + Math.round(p.turn.meters) + ' 米就' + turnWay));
        } else {
          detail.push('沿这条路直行约 ' + Math.round(p.turn.meters) + ' 米');
          detail.push('然后' + turnWay);
        }
      } else {
        detail.push('直行 ' + Math.max(1, Math.round(p.left)) + ' 米到「' +
          (state.lab ? state.lab.room : '目的地') + '」');
      }
    } else {
      detail.push(state.lab ? (state.lab.name + ' · ' + state.lab.room) : '目的地');
    }

    return {
      action: action, hint: hint, detail: detail,
      rel: rel, left: p.left, pos: track.pos, total: track.total,
      turnMeters: p.turn ? p.turn.meters : null,
      turnWay: p.turn ? (p.turn.deg > 0 ? '右' : '左') : null
    };
  }

  window.__AR__ = {
    get state() { return state; },
    get track() { return track; },
    init: init, setLoc: setLoc, setTarget: setTarget,
    routeTo: routeTo, advanceMeters: advanceMeters,
    syncFromFp: syncFromFp, syncToFp: syncToFp,
    plan: plan, aimAngle: aimAngle, guidance: guidance,
    pointAt: pointAt, posOfPoint: posOfPoint
  };

  return window.__AR__;
})();
