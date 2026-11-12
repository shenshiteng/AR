/* =========================================================================
   fp-view.js —— 渲染层（window.FPView）
   -------------------------------------------------------------------------
   两部分：
     1) 第一人称：three.js 真 3D（地面 + 654 个墙盒 + 相机 lookAt），只负责「画」，
        朝向/位置一律以 fp-core 的玩家状态为准。
     2) 俯视总览：2D canvas，固定视角画整层楼（房间/墙/路网），
        叠一个代表玩家的箭头 + 朝向张开的 FOV 扇形，让人不迷路。

   坐标映射：three.X = 世界x * MPP，three.Z = 世界y * MPP，three.Y = 高度(米)。
   ========================================================================= */
window.FPView = (function () {
  'use strict';

  var MPP = 0.045;     // 米/像素，与 data/labs.js 的 metersPerPixel 一致
  var WALL_H = 2.8;    // 墙高（米）
  var EYE_H = 1.6;     // 眼睛高度（米）
  var FOV_DEG = 30;    // 总览里朝向扇形半角

  var KIND_FILL = {
    lab: '#cfe4f7', office: '#d2efe4', room: '#e7e0f2',
    store: '#f6ecc9', service: '#e2e6ea', toilet: '#d9ecd9'
  };

  /* ================= 第一人称（three.js） ================= */

  /* 建一个完整的第一人称场景。
     floors：数组 [{ world, baseY }]，baseY 是该层地面的绝对高度（米）。
       - 单层（旧用法）：initFirstPerson(container, world) 内部转成 [{world, 0}]
       - 多层（建房子）：initFirstPerson(container, [{world:二楼, baseY:0}, {world:三楼, baseY:3}])
     楼板：在相邻两层之间（baseY 高处）放一块天花板，楼梯间位置挖洞。 */
  function initFirstPerson(container, floors) {
    // 兼容旧调用：传单个 world 则包成一层
    if (floors && floors.rooms && !floors.length) floors = [{ world: floors, baseY: 0 }];
    floors = floors || [];

    var w = container.clientWidth || 800;
    var h = container.clientHeight || 600;
    var renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x232936);
    var camera = new THREE.PerspectiveCamera(66, w / h, 0.05, 300);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    var dl = new THREE.DirectionalLight(0x000000, 0.0);   // 占位，下面重设
    scene.remove(dl);
    var key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(40, 80, 30);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b929c, 0.35));  // 补顶面/底面光照

    // 每一层：地面 + 墙 + 楼梯
    // 只有最底层画地面；上层的地面由「层间楼板」（addCeiling）兼任地板，
    // 不单独画，避免同一高度两块板重叠 z-fighting（楼板是跟墙一样的实心板）
    floors.forEach(function (fl, i) {
      var skipFloor = i > 0;
      addFloorGeometry(scene, fl.world, fl.baseY, null, skipFloor);
    });

    // 相邻层之间的楼板（天花板）：只在有多层时画
    if (floors.length > 1) {
      for (var i = 0; i + 1 < floors.length; i++) {
        var lo = floors[i], hi = floors[i + 1];
        addCeiling(scene, lo.world, hi.baseY);
      }
    }

    return { renderer: renderer, scene: scene, camera: camera, container: container, floors: floors };
  }

  /* 画一层的地面 + 墙 + 楼梯，整体上移 baseY。
     holeRooms：需要在地面挖洞的矩形（楼梯间），传 null 则不挖。
     skipFloor：true 则不画本层地面（由层间楼板兼任地板，避免和楼板重叠 z-fighting）。 */
  function addFloorGeometry(scene, world, baseY, holeRooms, skipFloor) {
    var gw = world.width * MPP, gh = world.height * MPP;
    if (!skipFloor) {
      // 地面：整层一张平面（有 holeRooms 时用 Shape 挖洞，和天花板楼板同一套逻辑）
      var floor;
      if (holeRooms && holeRooms.length) {
        var shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(gw, 0);
        shape.lineTo(gw, gh);
        shape.lineTo(0, gh);
        shape.closePath();
        holeRooms.forEach(function (r) {
          var hx = r.x * MPP, hy = r.y * MPP;
          var hole = new THREE.Path();
          hole.moveTo(hx, hy);
          hole.lineTo(hx + r.w * MPP, hy);
          hole.lineTo(hx + r.w * MPP, hy + r.h * MPP);
          hole.lineTo(hx, hy + r.h * MPP);
          hole.closePath();
          shape.holes.push(hole);
        });
        var geo = new THREE.ShapeGeometry(shape);
        // ShapeGeometry 顶点不居中（原点在角落），直接 rotateX 会绕原点转到负 z 导致错位。
        // 先 center() 把几何体中心移到原点，再 mesh 级 rotation + position 平移才对齐。
        geo.center();
        floor = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xd8d2c3, side: THREE.DoubleSide }));
        floor.rotation.x = -Math.PI / 2;
      } else {
        floor = new THREE.Mesh(
          new THREE.PlaneGeometry(gw, gh),
          new THREE.MeshLambertMaterial({ color: 0xd8d2c3 })
        );
        floor.rotation.x = -Math.PI / 2;
      }
      floor.position.set(gw / 2, baseY, gh / 2);
      scene.add(floor);
    }

    // 墙：每个矩形拉成一块薄板，用 InstancedMesh 一次画出
    var walls = world.walls || [];
    if (!walls.length) return;
    var boxGeo = new THREE.BoxGeometry(1, 1, 1);
    var boxMat = new THREE.MeshLambertMaterial({ color: 0x8b929c });
    var inst = new THREE.InstancedMesh(boxGeo, boxMat, walls.length);
    var m4 = new THREE.Matrix4();
    walls.forEach(function (wr, i) {
      var cx = (wr[0] + wr[2]) / 2 * MPP;
      var cz = (wr[1] + wr[3]) / 2 * MPP;
      var sx = Math.max(wr[4], 1) * MPP;
      var sz = Math.max(wr[5], 1) * MPP;
      m4.makeScale(sx, WALL_H, sz);
      m4.setPosition(cx, baseY + WALL_H / 2, cz);
      inst.setMatrixAt(i, m4);
    });
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);

    // 楼梯：只由「下层」铺一套（stairSign>0 表示本层有上一层，负责画通往上层的楼梯）。
    // 顶层（stairSign<0）不再重复铺：两层之间只有一座楼梯，顶层脚下/旁边的台阶
    // 就是下层画的那套。否则顶层会多出悬在头顶的假台阶（绝对高度 baseY+层高 以上），
    // 玩家上楼爬到第二跑时眼睛正好穿进这些多余台阶盒子里 → 穿模。
    if ((world.stairSign === undefined) || world.stairSign > 0) {
      addStairs(scene, world, baseY);
    }
  }

  /* 天花板：覆盖整层的一块板，楼梯间位置挖洞。
     放在 baseY 高度，既是下层天花板，也是上层地板。
     楼梯间整井挖穿（含门端缓冲区）：第二跑顶端就在门端，玩家爬到顶时
     眼睛已在楼板之上，若缓冲区还留着楼板，走进去时板面会从眼前切过（像穿墙）。
     上层进门的地面的损失，由下面补的小块「进门地板」找回来。 */
  function addCeiling(scene, world, baseY) {
    var gw = world.width * MPP, gh = world.height * MPP;
    var shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(gw, 0);
    shape.lineTo(gw, gh);
    shape.lineTo(0, gh);
    shape.closePath();
    var MARGIN = 8;   // 像素，等于墙厚，井口覆盖到围井墙外缘
    var BUF_PX = 20;  // 门端缓冲区深度，与 fp-core/fp-view 的 STAIR_BUF_PX 一致
    (world.stairs || []).forEach(function (st) {
      // 整个楼梯间外扩 MARGIN 全挖穿
      var x1 = (st.x - MARGIN) * MPP, y1 = (st.y - MARGIN) * MPP;
      var hw = (st.w + MARGIN * 2) * MPP, hh = (st.h + MARGIN * 2) * MPP;
      var hole = new THREE.Path();
      hole.moveTo(x1, y1);
      hole.lineTo(x1 + hw, y1);
      hole.lineTo(x1 + hw, y1 + hh);
      hole.lineTo(x1, y1 + hh);
      hole.closePath();
      shape.holes.push(hole);
      // 上层进门缓冲区补一小块地板（楼板在此处是洞，不会 z-fighting）：
      // 门端往井内 BUF_PX 深、横跨整个楼梯间宽，颜色同普通地面
      var bufX1, bufY1, bufX2, bufY2;
      if (st.axis === 'x') {
        bufX1 = st.dir > 0 ? st.x : (st.x + st.w) - BUF_PX;
        bufX2 = bufX1 + BUF_PX;
        bufY1 = st.y; bufY2 = st.y + st.h;
      } else {
        bufY1 = st.dir > 0 ? st.y : (st.y + st.h) - BUF_PX;
        bufY2 = bufY1 + BUF_PX;
        bufX1 = st.x; bufX2 = st.x + st.w;
      }
      var pw = (bufX2 - bufX1) * MPP, ph = (bufY2 - bufY1) * MPP;
      var patch = new THREE.Mesh(
        new THREE.PlaneGeometry(pw, ph),
        new THREE.MeshLambertMaterial({ color: 0xd8d2c3, side: THREE.DoubleSide })
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set((bufX1 + bufX2) / 2 * MPP, baseY, (bufY1 + bufY2) / 2 * MPP);
      scene.add(patch);
    });
    var geo = new THREE.ShapeGeometry(shape);
    geo.center();   // ShapeGeometry 顶点不居中，先 center 到原点，否则 rotateX 后错位
    // 楼板：跟墙一样的材质（实心不透明），双面渲染（从二楼往上看是天花板、从三楼往下看是地板）
    var ceil = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x8b929c, side: THREE.DoubleSide }));
    ceil.rotation.x = -Math.PI / 2;   // mesh 级旋转平铺到 XZ 平面
    ceil.position.set(gw / 2, baseY, gh / 2);
    scene.add(ceil);
  }

  /* 在场景里为每个楼梯间画「双跑折返 U 形楼梯」：
     第一跑占半边（门端→远端，升半层高）、远端休息平台（整宽、半层高）、
     第二跑占另半边（远端→门端，再升半层高）。台阶高度与 fp-core 高度场一致。 */
  /* 铺楼梯 3D 台阶。几何必须和 fp-core 的高度场严格对齐，所以这里不再自己猜
     「门在哪一侧」，而是直接用 world.stairs（axis/dir/pad/buf/plat 全从那里来）。
     以前两边各算一遍，门侧判定不一致时会出现「看着有台阶、走上去是平地」。 */
  function addStairs(scene, world, baseY) {
    baseY = baseY || 0;
    var FLOOR_H = world.floorHeight || 3.0;
    var HALF_H = FLOOR_H / 2;
    var N1 = 8;              // 每跑台阶数
    var stairMat = new THREE.MeshLambertMaterial({ color: 0x9a8f7a });
    var landingMat = new THREE.MeshLambertMaterial({ color: 0xb5a98f });
    var stepGeo = new THREE.BoxGeometry(1, 1, 1);
    var stairs = world.stairs || [];

    stairs.forEach(function (st) {
      var r = st;
      var alongX = st.axis === 'x';
      var runLen = alongX ? r.w : r.h;
      var PLAT = st.plat || 0.8;
      var pad = st.pad || 0, buf = st.buf || 0;
      /* 坡段长度（像素）：与 fp-core 的 stairT 完全同一套 —— 扣掉两端不可走余量和进门平地 */
      var span = Math.max(1, runLen - 2 * pad - buf);
      var stepD = st.dir >= 0 ? 1 : -1;
      var doorStart = alongX ? (st.dir >= 0 ? r.x : r.x + r.w)
                             : (st.dir >= 0 ? r.y : r.y + r.h);
      /* t（0=进门平地末端，1=远端墙）→ 坡向像素坐标 */
      function pxOf(t) { return doorStart + stepD * (pad + buf + t * span); }
      var useD = span * PLAT / N1;            // 每级进深（像素）
      var STEP_H = HALF_H / N1;               // 每级高
      var aMin = alongX ? r.y : r.x;          // 横跨方向小端
      var aSize = alongX ? r.h : r.w;         // 横跨总长
      var cx = (r.x + r.w / 2) * MPP, cz = (r.y + r.h / 2) * MPP;
      // 两条跑各占横跨方向的一半（A=靠坐标小的一侧，B=另一侧）
      function laneCenter(isB) { return aMin + aSize * (isB ? 0.75 : 0.25); }

      /* 铺一跑台阶：A 跑 0 → 半层高；B 跑 半层高 → 层高（折返） */
      function flight(baseRise, isB) {
        var lc = laneCenter(isB);
        for (var i = 0; i < N1; i++) {
          var frac = (i + 0.5) / N1;                       // 本跑内的相对位置 0..1
          var t = isB ? (PLAT - frac * PLAT) : (frac * PLAT);   // 换算成全坡向 t
          var top = baseRise + (i + 1) * STEP_H;           // 台阶顶面（实心填到顶）
          var centerPx = pxOf(t);
          var step = new THREE.Mesh(stepGeo, stairMat);
          if (alongX) {
            step.scale.set(useD * MPP, top, aSize / 2 * MPP);
            step.position.set(centerPx * MPP, baseY + top / 2, lc * MPP);
          } else {
            step.scale.set(aSize / 2 * MPP, top, useD * MPP);
            step.position.set(lc * MPP, baseY + top / 2, centerPx * MPP);
          }
          scene.add(step);
        }
      }

      flight(0, false);        // 第一跑（A 半边）：门端 0 → 远端 半层高
      flight(HALF_H, true);    // 第二跑（B 半边）：远端 半层高 → 门端 层高（折返）

      // 远端休息平台：t=PLAT → t=1，整宽，实心到地、顶面在半层高
      var platLen = Math.max(2, span * (1 - PLAT));
      var platCenterPx = pxOf((PLAT + 1) / 2);
      var plat = new THREE.Mesh(stepGeo, landingMat);
      if (alongX) {
        plat.scale.set(platLen * MPP, HALF_H, aSize * MPP);
        plat.position.set(platCenterPx * MPP, baseY + HALF_H / 2, cz);
      } else {
        plat.scale.set(aSize * MPP, HALF_H, platLen * MPP);
        plat.position.set(cx, baseY + HALF_H / 2, platCenterPx * MPP);
      }
      scene.add(plat);
    });
  }

  function updateFirstPerson(v, player) {
    var cx = player.x * MPP, cz = player.y * MPP;
    var eyeY = EYE_H + (player.baseY || 0) + (player.z || 0);   // 眼高 + 当前层绝对高度 + 楼梯抬高
    v.camera.position.set(cx, eyeY, cz);
    var t = player.theta * Math.PI / 180;
    v.camera.lookAt(cx + Math.cos(t) * 10, eyeY, cz + Math.sin(t) * 10);
    v.renderer.render(v.scene, v.camera);
  }

  function resizeFirstPerson(v, w, h) {
    v.camera.aspect = w / h;
    v.camera.updateProjectionMatrix();
    v.renderer.setSize(w, h);
  }

  /* ================= 俯视总览（2D canvas，固定视角） ================= */

  function initOverview(canvas, world, removedWalls, stairNodes) {
    var ctx = canvas.getContext('2d');
    var v = { canvas: canvas, ctx: ctx, world: world, removed: removedWalls || [], s: 1, ox: 0, oy: 0, staticCv: null, stairNodes: stairNodes || [] };

    function fit() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cw = canvas.clientWidth || canvas.width;
      var ch = canvas.clientHeight || canvas.height;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      var pad = 12 * dpr;
      v.s = Math.min((canvas.width - pad * 2) / world.width, (canvas.height - pad * 2) / world.height);
      v.ox = (canvas.width - world.width * v.s) / 2;
      v.oy = (canvas.height - world.height * v.s) / 2;
      v.staticCv = drawStatic(world, v.removed, canvas.width, canvas.height, v.s, v.ox, v.oy, v.stairNodes);
    }

    function w2x(px) { return v.ox + px * v.s; }
    function w2y(py) { return v.oy + py * v.s; }

    fit();
    return { v: v, fit: fit, w2x: w2x, w2y: w2y };
  }

  /* 静态层：被删墙（黄）→ 房间 → 保留墙 → 路网，画到离屏 canvas 只画一次 */
  function drawStatic(world, removed, cw, ch, s, ox, oy, stairNodes) {
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var g = cv.getContext('2d');
    var X = function (px) { return ox + px * s; };
    var Y = function (py) { return oy + py * s; };

    // 被清理掉的墙：黄色半透明描边 + 淡黄填充，方便核对误删
    g.fillStyle = 'rgba(250, 204, 21, 0.18)';
    g.strokeStyle = 'rgba(202, 138, 4, 0.9)';
    g.lineWidth = 1;
    removed.forEach(function (w) {
      g.fillRect(X(w[0]), Y(w[1]), Math.max(w[4], 1) * s, Math.max(w[5], 1) * s);
      g.strokeRect(X(w[0]), Y(w[1]), Math.max(w[4], 1) * s, Math.max(w[5], 1) * s);
    });

    // 房间
    (world.rooms || []).forEach(function (r) {
      var fill = KIND_FILL[r.kind] || KIND_FILL.room;
      g.fillStyle = fill;
      g.fillRect(X(r.x), Y(r.y), r.w * s, r.h * s);
      g.strokeStyle = '#9aa3ad';
      g.lineWidth = 1;
      g.strokeRect(X(r.x), Y(r.y), r.w * s, r.h * s);
      // 楼梯间：画双跑折返台阶纹理（两段 + 中间平台横线），一眼认出是楼梯
      if (r.kind === 'stair') {
        g.strokeStyle = 'rgba(120, 90, 40, 0.7)';
        g.lineWidth = 1;
        /* 楼梯走向：优先用 world.stairs（与高度场/3D 台阶同源），
           拿不到才退回「离房间中心最近的路点」这种近似判断。 */
        var stAxis = 'x';
        var stDef = null;
        (world.stairs || []).forEach(function (s2) {
          if (s2.x === r.x && s2.y === r.y && s2.w === r.w && s2.h === r.h) stDef = s2;
        });
        if (stDef) {
          stAxis = stDef.axis;
        } else {
          var stDoor = null, stBd = Infinity;
          (world.nodes || []).forEach(function (n) {
            var d = Math.hypot(n.x - (r.x + r.w / 2), n.y - (r.y + r.h / 2));
            if (d < stBd) { stBd = d; stDoor = n; }
          });
          if (stDoor) {
            var dxL = stDoor.x - r.x, dxR = stDoor.x - (r.x + r.w);
            var dyT = stDoor.y - r.y, dyB = stDoor.y - (r.y + r.h);
            if (dxL < 0 || dxR > 0) stAxis = 'x';
            else if (dyT < 0 || dyB > 0) stAxis = 'y';
            else stAxis = (r.w >= r.h) ? 'x' : 'y';
          }
        }
        // 双跑折返纹理：远端 20% 是平台（浅色带），两个半边各画台阶线
        g.strokeStyle = 'rgba(120, 90, 40, 0.55)';
        g.lineWidth = 1;
        var n = 4;
        for (var si = 1; si <= n; si++) {
          var tt = (si / (n + 1)) * 0.8;              // 台阶线分布在 0..0.8（平台区不画）
          g.beginPath();
          if (stAxis === 'x') {
            var sx0 = X(r.x + r.w * tt);
            g.moveTo(sx0, Y(r.y)); g.lineTo(sx0, Y(r.y + r.h));
          } else {
            var sy0 = Y(r.y + r.h * tt);
            g.moveTo(X(r.x), sy0); g.lineTo(X(r.x + r.w), sy0);
          }
          g.stroke();
        }
        // 平台分界线（坡向 80% 处一条稍粗的线）
        g.strokeStyle = 'rgba(120, 90, 40, 0.9)';
        g.lineWidth = 1.5;
        g.beginPath();
        if (stAxis === 'x') {
          var px0 = X(r.x + r.w * 0.8);
          g.moveTo(px0, Y(r.y)); g.lineTo(px0, Y(r.y + r.h));
        } else {
          var py0 = Y(r.y + r.h * 0.8);
          g.moveTo(X(r.x), py0); g.lineTo(X(r.x + r.w), py0);
        }
        g.stroke();
        // 中线（两条跑的分隔）
        g.beginPath();
        if (stAxis === 'x') {
          var mcx = X(r.x + r.w / 2);
          g.moveTo(mcx, Y(r.y)); g.lineTo(mcx, Y(r.y + r.h));
        } else {
          var mcy = Y(r.y + r.h / 2);
          g.moveTo(X(r.x), mcy); g.lineTo(X(r.x + r.w), mcy);
        }
        g.stroke();
      }
      if (r.w * s > 22 && r.h * s > 16) {
        g.fillStyle = '#475569';
        g.font = Math.max(9, Math.min(12, r.w * s * 0.2)) + 'px sans-serif';
        g.textAlign = 'center';
        g.fillText(String(r.id), X(r.x + r.w / 2), Y(r.y + r.h / 2) + 3);
      }
    });

    // 墙矩形（深色）
    g.fillStyle = '#3c4148';
    (world.walls || []).forEach(function (w) {
      g.fillRect(X(w[0]), Y(w[1]), Math.max(w[4], 1) * s, Math.max(w[5], 1) * s);
    });

    // 路网：边 + 节点
    g.strokeStyle = '#b45309';
    g.lineWidth = 1;
    var nodeMap = {};
    (world.nodes || []).forEach(function (n) { nodeMap[n.id] = n; });
    (world.edges || []).forEach(function (e) {
      var a = nodeMap[e[0]], b = nodeMap[e[1]];
      if (a && b) { g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke(); }
    });
    g.fillStyle = '#2563eb';
    (world.nodes || []).forEach(function (n) {
      g.beginPath(); g.arc(X(n.x), Y(n.y), 2.5, 0, 6.2832); g.fill();
    });

    // 楼梯口（跨层连接点）：亮蓝圈 + 小白心，让人一眼看到能上/下楼的地方
    if (stairNodes && stairNodes.length) {
      var nodeMap2 = {};
      (world.nodes || []).forEach(function (n) { nodeMap2[n.id] = n; });
      stairNodes.forEach(function (sid) {
        var sn = nodeMap2[sid];
        if (!sn) return;
        g.strokeStyle = '#38bdf8';
        g.lineWidth = 2;
        g.beginPath(); g.arc(X(sn.x), Y(sn.y), 6, 0, 6.2832); g.stroke();
        g.fillStyle = '#38bdf8';
        g.beginPath(); g.arc(X(sn.x), Y(sn.y), 2, 0, 6.2832); g.fill();
      });
    }

    return cv;
  }

  /* 动态：行进轨迹 + 玩家箭头 + FOV 扇形，叠在静态层上 */
  function renderOverview(o, player, trail) {
    var v = o.v, g = v.ctx, world = v.world;
    var X = o.w2x, Y = o.w2y;
    g.clearRect(0, 0, v.canvas.width, v.canvas.height);
    if (v.staticCv) g.drawImage(v.staticCv, 0, 0);

    var px = player.x, py = player.y, th = player.theta;

    // 行进轨迹（已走过的路，亮绿色）
    if (trail && trail.length > 1) {
      g.strokeStyle = '#22c55e';
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      trail.forEach(function (p, i) {
        var tx = X(p.x), ty = Y(p.y);
        if (i === 0) g.moveTo(tx, ty); else g.lineTo(tx, ty);
      });
      g.stroke();
    }

    // FOV 扇形
    var r1 = world.castRay(px, py, th - FOV_DEG);
    var r2 = world.castRay(px, py, th + FOV_DEG);
    g.fillStyle = 'rgba(245,158,11,0.18)';
    g.beginPath();
    g.moveTo(X(px), Y(py));
    g.lineTo(X(r1.hitX), Y(r1.hitY));
    g.lineTo(X(r2.hitX), Y(r2.hitY));
    g.closePath();
    g.fill();

    // 玩家箭头（朝 theta）
    var t = th * Math.PI / 180;
    var L = 12;
    var bx = X(px), by = Y(py);
    var hx = bx + Math.cos(t) * L, hy = by + Math.sin(t) * L;
    var rx = -Math.sin(t), ry = Math.cos(t);
    g.fillStyle = '#e11d48';
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(bx + rx * L * 0.6 - Math.cos(t) * L * 0.5, by + ry * L * 0.6 - Math.sin(t) * L * 0.5);
    g.lineTo(bx - rx * L * 0.6 - Math.cos(t) * L * 0.5, by - ry * L * 0.6 - Math.sin(t) * L * 0.5);
    g.closePath();
    g.fill();
  }

  return {
    MPP: MPP, WALL_H: WALL_H, EYE_H: EYE_H,
    initFirstPerson: initFirstPerson,
    updateFirstPerson: updateFirstPerson,
    resizeFirstPerson: resizeFirstPerson,
    initOverview: initOverview,
    renderOverview: renderOverview
  };
})();
