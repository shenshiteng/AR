/* =========================================================================
   fp-core.js —— 第一人称探索的「纯逻辑」内核（window.FPWorld）
   -------------------------------------------------------------------------
   只做数学：坐标换算、墙碰撞、DDA 射线、移动、转身、确定性 step。
   不碰 DOM / canvas / three.js，因此可以被「全局校验器」直接调用，
   也能在 Node 里离线跑（文件末尾有 module.exports 兜底）。

   坐标系约定（与 data/labs.js 一致）：
     - 世界坐标 = 图片像素，原点在左上角，x 向右(0..1791)、y 向下(0..1920)。
     - 朝向 theta 单位「度」：0=东(+x)、90=南(+y)、180=西、270=北（顺时针），
       与 locations[].normal 的约定一致。
     - 墙网格 448 列 × 480 行，每格 4px，'1'=墙、'0'=可通行。

   确定性：step() 只依赖传入的 action 和 dt，不读时钟/随机数；
   相同输入 → 相同输出。这是校验器的地基。
   ========================================================================= */
(function (global) {
  'use strict';

  var VERSION = '1.1.0';
  var DEFAULT_MOVE_SPEED = 40;   // 像素/秒（≈1.8 米/秒，按 0.045 米/像素）
  var DEFAULT_TURN_SPEED = 120;  // 度/秒
  var DEFAULT_RADIUS = 12;       // 玩家碰撞半径（像素）
  var DEFAULT_FLOOR_HEIGHT = 3.0;  // 层高（米），走楼梯从 0 升到该值即上到上一层

  /* 朝向归一到 [0, 360) */
  function normalizeAngle(a) {
    a = a % 360;
    if (a < 0) a += 360;
    return a;
  }

  /* ---------- 建世界 ----------
     opts = {
       grid:  window.FLOOR_GRID（{cols,rows,cell,width,height,data}）
       rooms: LAB_DATA.floors[0].rooms
       nodes: LAB_DATA.floors[0].nodes
       edges: LAB_DATA.floors[0].edges
       walls: 数据里的墙矩形 [{x,y,x2,y2,w,h}]（可空，仅总览画图用）
       moveSpeed / turnSpeed / radius: 可选覆盖默认值
     }
  */
  function create(opts) {
    opts = opts || {};
    var grid = opts.grid || { cols: 0, rows: 0, cell: 4, width: 0, height: 0, data: '' };
    var cols = grid.cols, rows = grid.rows, cell = grid.cell || 4, data = grid.data || '';
    var rooms = opts.rooms || [], nodes = opts.nodes || [], edges = opts.edges || [], walls = opts.walls || [];
    var moveSpeed = opts.moveSpeed || DEFAULT_MOVE_SPEED;
    var turnSpeed = opts.turnSpeed || DEFAULT_TURN_SPEED;
    var radius = (opts.radius === undefined) ? DEFAULT_RADIUS : opts.radius;
    var floorHeight = opts.floorHeight || DEFAULT_FLOOR_HEIGHT;
    var stairSign = opts.stairSign || 1;   // +1：楼梯上行（从本层升到上一层）；-1：楼梯下行（从本层降到下一层）

    /* ---------- 楼梯高度场（双跑折返 U 形楼梯） ----------
       每个 kind=stair 房间是一座真实意义的双跑折返楼梯（dogleg）：
         底层门厅（z=0）→ 第一跑台阶沿「A 半边」升到远端休息平台（z=半层高）
         → 平台上转身 → 第二跑沿「B 半边」折返回门侧，升到层高（z=层高，上层出口）。
       两层共用同一座楼梯的绝对标高面（abs，相对下层地面）：
         A 半边（门→远端）：abs = t/0.8 × 半层高（t=沿坡向进度，0=门端）
         B 半边（远端→门）：abs = 半层高 + (0.8−t)/0.8 × 半层高
         远端 20%（t≥0.8）：休息平台，abs = 半层高（水平）
       各层高度 z = stairSign>0 ? abs : abs − 层高（本层视原点）。
       两层在平台处绝对标高相同 → 跨层切换高度连续、不跳变。
       中线归属：stairSign>0（上行层）中线算 A 半边（从底层门进）；
                 stairSign<0（下行层）中线算 B 半边（从上层门进）。 */
    var stairs = [];
    var STAIR_PLAT = 0.8;   // 平台起点：沿坡向 80% 处（远端 20% 是休息平台）
    /* 楼梯间两端各让出的「不可走余量」（像素）：墙厚约 8px + 玩家碰撞半径 12px。
       坡面参数化必须按「可走范围」算，不能按房间矩形算：
       小楼梯间（如 60×70px）扣掉墙和半径后只剩一半可走，按矩形算永远爬不到平台。 */
    var STAIR_PAD = 20;
    /* 门口候选节点：优先用调用方指定的「楼梯口节点」（跨层边两端）。
       默认退回全部节点。用楼梯口节点判门在哪一侧更可靠 —— 楼梯间的门就是它。 */
    var doorPool = (opts.stairDoors && opts.stairDoors.length) ? opts.stairDoors : (nodes || []);
    (rooms || []).forEach(function (r) {
      if (r.kind !== 'stair') return;
      var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      // 找离房间中心最近的路点当门口
      var door = null, bd = Infinity;
      doorPool.forEach(function (n) {
        var d = Math.hypot(n.x - cx, n.y - cy);
        if (d < bd) { bd = d; door = n; }
      });
      // 判断门洞在哪一侧：比较门节点相对房间四边的位置
      var axis = 'x', dir = 1, doorSide = 'west';
      if (door) {
        var dxL = door.x - r.x, dxR = door.x - (r.x + r.w);
        var dyT = door.y - r.y, dyB = door.y - (r.y + r.h);
        if (dxL < 0) { axis = 'x'; dir = 1; doorSide = 'west'; }
        else if (dxR > 0) { axis = 'x'; dir = -1; doorSide = 'east'; }
        else if (dyT < 0) { axis = 'y'; dir = 1; doorSide = 'north'; }
        else if (dyB > 0) { axis = 'y'; dir = -1; doorSide = 'south'; }
        else {
          if (r.w >= r.h) { axis = 'x'; dir = (door.x > cx) ? -1 : 1; }
          else { axis = 'y'; dir = (door.y > cy) ? -1 : 1; }
        }
      }
      var runLen = axis === 'x' ? r.w : r.h;
      var pad = Math.min(STAIR_PAD, runLen * 0.25);                 // 两端不可走余量
      var spanAll = Math.max(8, runLen - 2 * pad);                  // 可走坡向长度
      var buf = Math.min(10, Math.max(3, spanAll * 0.3));           // 门端平地进深
      stairs.push({ x: r.x, y: r.y, w: r.w, h: r.h, axis: axis, dir: dir,
                    doorSide: doorSide, pad: pad, buf: buf, plat: STAIR_PLAT });
    });

    /* 沿坡向「离门端的距离」（像素） */
    function stairDist(st, x, y) {
      return st.axis === 'x' ? (st.dir > 0 ? x - st.x : (st.x + st.w) - x)
                             : (st.dir > 0 ? y - st.y : (st.y + st.h) - y);
    }
    /* 坡向进度 t：0 = 门端平地结束处，1 = 远端墙边（按可走范围归一，不是按房间矩形） */
    function stairT(st, x, y) {
      var span = Math.max(1, (st.axis === 'x' ? st.w : st.h) - 2 * st.pad - st.buf);
      return Math.max(0, Math.min(1, (stairDist(st, x, y) - st.pad - st.buf) / span));
    }

    /* 查询某像素位置对应的高度（米）。不在楼梯间 → 0。
       refZ：参考高度（一般传玩家当前 z）。只用于「门端缓冲区」——
       那个位置上下两层各有一块进门平台（底层地面 z=0 / 上层地面 z=层高），
       按「离参考高度最近」取一块，保证高度连续、不会在门口突然跳一层。
       stairSign=+1：本层是底层（z=abs，升到 +层高出去）；
       stairSign=-1：本层是顶层（z=abs−层高，降到 −层高出去）。 */
    var MAX_STEP = 0.3;     // 米，单步允许的最大高度突变（楼梯间限高移动用）
    function heightAt(x, y, refZ) {
      for (var i = 0; i < stairs.length; i++) {
        var st = stairs[i];
        if (x < st.x || y < st.y || x > st.x + st.w || y > st.y + st.h) continue;
        // 横跨位置 → 哪一跑（A=第一跑靠门起步侧，B=第二跑折返侧）
        var across, center;
        if (st.axis === 'x') { across = y; center = st.y + st.h / 2; }
        else { across = x; center = st.x + st.w / 2; }
        var laneB = (across > center) || (across === center && stairSign < 0);
        var d = stairDist(st, x, y);
        /* 门端缓冲区（进门平地）：这块地上下叠着两层的地面——
           第一跑那一侧是本层地面（0），第二跑那一侧是上层地面（层高）。
           先按跑道归属判；万一起点高度与归属差太多（例如从上层走进第一跑侧），
           再按「离当前高度最近」兜底，保证高度永远连续、不会在门口跳一层。 */
        if (d < st.pad + st.buf) {
          var zLo = stairSign > 0 ? 0 : -floorHeight;   // 本层地面
          var zHi = stairSign > 0 ? floorHeight : 0;    // 上层地面
          if (refZ === undefined || refZ === null) return 0;
          var byLane = laneB ? zHi : zLo;
          if (Math.abs(refZ - byLane) <= MAX_STEP) return byLane;
          return (Math.abs(refZ - zLo) <= Math.abs(refZ - zHi)) ? zLo : zHi;
        }
        // 坡段/平台：t 按可走范围归一（0=进门平地末端，1=远端墙边）
        var t = stairT(st, x, y);
        var halfH = floorHeight / 2, abs;
        if (t >= STAIR_PLAT) {
          abs = halfH;                                   // 休息平台（水平）
        } else if (!laneB) {
          abs = (t / STAIR_PLAT) * halfH;                // 第一跑：0 → 半层高
        } else {
          abs = halfH + ((STAIR_PLAT - t) / STAIR_PLAT) * halfH;  // 第二跑：半层高 → 层高
        }
        return stairSign > 0 ? abs : abs - floorHeight;
      }
      return 0;
    }

    /* 像素 → 格 */
    function toCellX(x) { return Math.floor(x / cell); }
    function toCellY(y) { return Math.floor(y / cell); }
    function inCell(cx, cy) { return cx >= 0 && cy >= 0 && cx < cols && cy < rows; }

    /* 取某格的 0/1；越界一律当墙，防止走出地图 */
    function cellAt(cx, cy) {
      if (!inCell(cx, cy)) return '1';
      return data.charAt(cy * cols + cx);
    }
    function isWallCell(cx, cy) { return cellAt(cx, cy) === '1'; }
    function isWallPx(x, y) { return isWallCell(toCellX(x), toCellY(y)); }

    /* 玩家圆碰撞：中心 + 上下左右四点采样（墙格本身已含 4px 厚） */
    function collides(x, y) {
      if (isWallPx(x, y)) return true;
      if (isWallPx(x - radius, y)) return true;
      if (isWallPx(x + radius, y)) return true;
      if (isWallPx(x, y - radius)) return true;
      if (isWallPx(x, y + radius)) return true;
      return false;
    }

    /* 轴向滑动移动：先试着只走 x，撞墙就回退；再只走 y。就地改 p 并返回。 */
    function move(p, dx, dy) {
      var nx = p.x + dx;
      if (!collides(nx, p.y)) p.x = nx;
      var ny = p.y + dy;
      if (!collides(p.x, ny)) p.y = ny;
      return p;
    }

    /* 楼梯间限高的移动：楼梯不是墙，玩家在楼梯间里横向走会跨过两跑之间的中线、
       嵌进隔壁台阶或悬空。规则：目标位置与当前高度的差超过 MAX_STEP（约一级台阶
       的几倍）就拒绝该方向移动 —— 把玩家锁在当前跑道上；平台处两跑等高可自由横走。
       进出门洞高度连续（缓冲区按跑道归属取上下层地面），不受影响。 */

    /* 目标点高度突变（跨进了另一条跑道或井口）时，把「横向坐标」夹回本侧中线，
       沿坡向的分量原样保留 —— 相当于两跑之间有隔离墙，玩家可以贴着中线左右平移，
       但绝不会一步跨到另一跑（那边高差一米半，人会被弹回来，表现为「按了没反应」）。
       旧实现把目标直接推到中线对侧 6px（主动帮玩家换道），换道后高差必然超标、
       整个方向被拒，于是按 A/D 横移在台阶上总是走不动 —— 已改正为「夹住不跨道」。 */
    var LANE_GAP = 3;   // 贴中线时额外留的余量（像素）
    function laneSlide(p, nx, ny) {
      for (var i = 0; i < stairs.length; i++) {
        var st = stairs[i];
        if (nx < st.x || ny < st.y || nx > st.x + st.w || ny > st.y + st.h) continue;
        var acrIsX = st.axis === 'y';   // axis='y'：坡向沿 y，横跨沿 x
        var center = acrIsX ? st.x + st.w / 2 : st.y + st.h / 2;
        var curA = acrIsX ? p.x : p.y;
        var wantA = acrIsX ? nx : ny;
        var side = (curA >= center) ? 1 : -1;                  // 玩家在中线的哪一侧
        var limit = center + side * (radius + LANE_GAP);        // 本侧最远能贴到哪
        var clamped = side > 0 ? Math.max(wantA, limit) : Math.min(wantA, limit);
        var tx = acrIsX ? clamped : nx;
        var ty = acrIsX ? ny : clamped;
        var ddx = tx - p.x, ddy = ty - p.y;
        var dd = Math.hypot(ddx, ddy);
        var maxD = Math.hypot(nx - p.x, ny - p.y) + 0.6;          // 一步限距，不瞬移
        if (dd > maxD) { ddx = ddx / dd * maxD; ddy = ddy / dd * maxD; }
        var fx = p.x + ddx, fy = p.y + ddy;
        if (!collides(fx, fy) && Math.abs(heightAt(fx, fy, p.z) - (p.z || 0)) <= MAX_STEP) {
          return { x: fx, y: fy };
        }
        return null;
      }
      return null;
    }

    function moveLocked(p, dx, dy) {
      var nx = p.x + dx;
      if (!collides(nx, p.y)) {
        if (Math.abs(heightAt(nx, p.y, p.z) - (p.z || 0)) <= MAX_STEP) {
          p.x = nx;
        } else {
          var c = laneSlide(p, nx, p.y);
          if (c) { p.x = c.x; p.y = c.y; }
        }
      }
      var ny = p.y + dy;
      if (!collides(p.x, ny)) {
        if (Math.abs(heightAt(p.x, ny, p.z) - (p.z || 0)) <= MAX_STEP) {
          p.y = ny;
        } else {
          var c2 = laneSlide(p, p.x, ny);
          if (c2) { p.x = c2.x; p.y = c2.y; }
        }
      }
      return p;
    }

    function turn(p, dTheta) {
      p.theta = normalizeAngle(p.theta + dTheta);
      return p;
    }

    /* 确定性单步：action={fwd,back,turnL,turnR,strafeL,strafeR}，dt=秒。
       返回新的玩家状态 {x,y,theta,z}，不改传入对象。free=true 时不判碰撞（穿墙模式）。 */
    function step(p, action, dt, free) {
      action = action || {};
      if (dt === null || dt === undefined) dt = 0.016;
      var s = { x: p.x, y: p.y, theta: p.theta, z: p.z || 0 };

      var turnDir = (action.turnR ? 1 : 0) - (action.turnL ? 1 : 0);
      if (turnDir) turn(s, turnDir * turnSpeed * dt);

      var fwd = (action.fwd ? 1 : 0) - (action.back ? 1 : 0);
      var str = (action.strafeR ? 1 : 0) - (action.strafeL ? 1 : 0);
      if (fwd || str) {
        var t = s.theta * Math.PI / 180;
        var fx = Math.cos(t), fy = Math.sin(t);       // 前进方向
        var rx = -Math.sin(t), ry = Math.cos(t);       // 右手方向
        var mx = fx * fwd + rx * str;
        var my = fy * fwd + ry * str;
        var len = Math.sqrt(mx * mx + my * my);
        if (len > 0) { mx = mx / len; my = my / len; }
        if (free) { s.x += mx * moveSpeed * dt; s.y += my * moveSpeed * dt; }
        else moveLocked(s, mx * moveSpeed * dt, my * moveSpeed * dt);
      }
      // 高度跟随：移动后按位置取楼梯坡面高度（不在楼梯间则回到 0）
      // 传旧高度当参考：门端缓冲区上下两层各有一块平台，按就近取，保证进出门高度连续
      s.z = heightAt(s.x, s.y, s.z);
      return s;
    }

    /* 穿墙模式的一步（自由飞行，不判碰撞），便于被假墙卡住时继续审核 */
    function stepFree(p, action, dt) { return step(p, action, dt, true); }

    /* DDA 射线：从 (x,y) 沿 theta 方向找第一堵墙。
       返回 {dist(px), hitX, hitY, cell:[cx,cy]}。在墙内起步 → dist=0。 */
    function castRay(x, y, theta) {
      var t = theta * Math.PI / 180;
      var dx = Math.cos(t), dy = Math.sin(t);
      var cx = toCellX(x), cy = toCellY(y);
      if (isWallCell(cx, cy)) return { dist: 0, hitX: x, hitY: y, cell: [cx, cy] };

      var stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
      var stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
      var nextX = dx > 0 ? (cx + 1) * cell : (dx < 0 ? cx * cell : Infinity);
      var nextY = dy > 0 ? (cy + 1) * cell : (dy < 0 ? cy * cell : Infinity);
      var tMaxX = dx !== 0 ? (nextX - x) / dx : Infinity;
      var tMaxY = dy !== 0 ? (nextY - y) / dy : Infinity;
      var tDeltaX = dx !== 0 ? cell / Math.abs(dx) : Infinity;
      var tDeltaY = dy !== 0 ? cell / Math.abs(dy) : Infinity;

      var maxDist = Math.sqrt(cols * cols + rows * rows) * cell;  // 对角长度，保险
      var traveled = 0, guard = 0;
      while (guard++ < cols + rows + 4) {
        if (tMaxX < tMaxY) {
          traveled = tMaxX; cx += stepX; tMaxX += tDeltaX;
        } else {
          traveled = tMaxY; cy += stepY; tMaxY += tDeltaY;
        }
        if (traveled > maxDist) break;
        if (isWallCell(cx, cy)) {
          return { dist: traveled, hitX: x + dx * traveled, hitY: y + dy * traveled, cell: [cx, cy] };
        }
      }
      return { dist: traveled, hitX: x + dx * traveled, hitY: y + dy * traveled, cell: [cx, cy] };
    }

    /* 按节点 id 取节点 */
    function getNode(nodeId) {
      for (var i = 0; i < nodes.length; i++) if (nodes[i].id === nodeId) return nodes[i];
      return null;
    }

    /* 把玩家放到某个走廊节点上，朝向给定角度（默认 0=东）。校验器用它做确定性放置。 */
    function spawnAtNode(nodeId, facingDeg) {
      var n = getNode(nodeId);
      if (!n) return null;
      return { x: n.x, y: n.y, theta: normalizeAngle(facingDeg === undefined ? 0 : facingDeg), z: 0 };
    }

    return {
      version: VERSION,
      grid: grid,
      rooms: rooms, nodes: nodes, edges: edges, walls: walls,
      cell: cell, cols: cols, rows: rows,
      width: grid.width, height: grid.height,
      moveSpeed: moveSpeed, turnSpeed: turnSpeed, radius: radius,
      floorHeight: floorHeight, stairs: stairs, stairSign: stairSign,
      toCellX: toCellX, toCellY: toCellY,
      cellAt: cellAt, isWallCell: isWallCell, isWallPx: isWallPx, collides: collides,
      move: move, turn: turn, step: step, stepFree: stepFree,
      castRay: castRay, spawnAtNode: spawnAtNode, getNode: getNode,
      heightAt: heightAt, stairT: stairT, stairDist: stairDist,
      normalizeAngle: normalizeAngle
    };
  }

  var api = { version: VERSION, create: create, normalizeAngle: normalizeAngle };

  /* 挂到全局（浏览器 window / Node globalThis） */
  global.FPWorld = api;

  /* Node 兼容：让校验器能在命令行里 require 这个文件跑纯逻辑 */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  return api;
})(typeof window !== 'undefined' ? window : globalThis);
