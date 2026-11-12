/* AR 极简导航：ArUco 扫码定位 → 选教室 → 方向箭头 */
(function () {
  'use strict';

  var D = window.LAB_DATA;
  var G = window.LabRouter.buildGraph(D);
  var LABS = D.labs || [];
  var LOCS = D.locations || [];
  var $ = function (id) { return document.getElementById(id); };
  /* 安全绑定：元素不存在就跳过，绝不因为某个按钮缺失让整页崩掉。
     （踩过的坑：新 JS 去绑一个旧 HTML 里没有的按钮 → 抛错 → 后面所有绑定都不执行 → 搜索框失效） */
  function on(id, fn) {
    var el = $(id);
    if (el) el.onclick = fn;
    return el;
  }
  /* 安全写入：元素缺失就当没这回事，不让整页崩 */
  function txt(id, v) { var el = $(id); if (el) el.textContent = v; }
  function cls(id, name, add) {
    var el = $(id);
    if (el) { if (add) el.classList.add(name); else el.classList.remove(name); }
  }

  var labsById = {};
  LABS.forEach(function (l) { labsById[l.id] = l; });
  var locsByMarker = {};
  LOCS.forEach(function (l, i) {
    var m = (l.marker === undefined) ? i : l.marker;
    locsByMarker[m] = l;
  });

  var state = {
    loc: null,
    lab: null,
    route: null,
    facing: 0,          // 当前朝向（图像角，0=+x 东，90=南）
    baseFacing: null,   // 扫码那一刻的绝对朝向（由墙面法线算出，图像角）
    baseCompass: null,  // 扫码那一刻的罗盘读数
    facingOffset: 0,    // 手动校正（0 或 180）
    roll: 0,            // 码在画面里的倾斜角
    compass: null,      // 设备罗盘原始读数（只当"转了多少度"用）
    compassOn: false,
    compassWanted: true,
    orientBound: false,
    scanning: false,
    lastDetect: 0,
    detector: null,
    mode: 'scan'
  };

  var video, work, workCtx;

  /* ---------- 角度工具 ---------- */
  function deg(r) { return r * 180 / Math.PI; }
  function norm(a) { return ((a + 540) % 360) - 180; }        // -180..180
  function imageAngle(a, b) { return deg(Math.atan2(b.y - a.y, b.x - a.x)); }
  /* 注意：facing / rel 都用「图像角」（0=东 90=南 180=西 270=北，y 向下），
     和罗盘方位（0=北 90=东）差 90°：罗盘方位 = 图像角 + 90。
     罗盘只取增量，所以两边加减不用换算，只做差。 */

  function floorLabel(fid) { return window.LabRouter.floorName(G, fid); }

  /* ---------- 定位 ---------- */
  function setLoc(loc, via) {
    state.loc = loc;

    if (!loc) {
      txt('locText', '还没定位');
      txt('locSub', '把墙上的定位码对准取景框');
      cls('locBar', 'ok', false);
      return;
    }

    // 扫码时人站在码前面朝墙 → 用户的绝对朝向 = 墙面法线反过来。
    // 这个值来自数据里的 normal，比室内罗盘准得多，拿它当基准。
    state.baseFacing = (loc.normal === undefined ? 90 : loc.normal) + 180;
    state.baseCompass = state.compass;   // 可能还没收到，等第一帧补上
    state.facingOffset = 0;
    state.facing = state.baseFacing;
    txt('locText', loc.place);
    txt('locSub', via === 'aruco' ? '已通过定位码校准 · 面向墙面' : '手动指定位置');
    cls('locBar', 'ok', true);
    stopScan();
    cls('scanbox', 'hidden', true);

    if (state.lab) {
      cls('arrowwrap', 'hidden', false);
      refreshRoute();
    } else {
      cls('arrowwrap', 'hidden', true);
      showSheet();
    }
    if (navigator.vibrate) navigator.vibrate(60);
  }

  /* ---------- 相机与扫码 ---------- */
  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return camFail('这个浏览器不支持调用摄像头');
    }
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then(function (stream) {
      video.srcObject = stream;
      return video.play();
    }).then(function () {
      $('start').classList.add('hidden');
      startScan();
    }).catch(function (e) {
      camFail(e && e.name === 'NotAllowedError' ? '没拿到相机权限' : ('相机打不开：' + (e && e.message || e)));
    });
  }

  function camFail(msg) {
    $('start').classList.remove('hidden');
    var box = $('camfail');
    box.classList.remove('hidden');
    box.textContent = msg + '。可以用「手动选位置」继续。';
  }

  function startScan() {
    if (!state.detector) {
      try { state.detector = new AR.Detector({ dictionaryName: 'ARUCO' }); }
      catch (e) { return camFail('定位码识别库没加载'); }
    }
    if (!work) {
      work = document.createElement('canvas');
      workCtx = work.getContext('2d', { willReadFrequently: true });
    }
    state.scanning = true;
    requestAnimationFrame(loop);
    $('scanbox').classList.remove('hidden');
  }

  function stopScan() { state.scanning = false; }

  function loop(ts) {
    if (!state.scanning) return;
    if (ts - state.lastDetect > 220) {
      state.lastDetect = ts;
      detectFrame();
    }
    requestAnimationFrame(loop);
  }

  function detectFrame() {
    if (!video.videoWidth) return;
    var sw = 340, sh = Math.round(sw * video.videoHeight / video.videoWidth);
    work.width = sw; work.height = sh;
    workCtx.drawImage(video, 0, 0, sw, sh);
    var img = workCtx.getImageData(0, 0, sw, sh);
    var found;
    try { found = state.detector.detectImage(sw, sh, img.data); }
    catch (e) { return; }
    if (!found || !found.length) return;

    var mk = found[0];
    var loc = locsByMarker[mk.id];
    if (!loc) {
      $('locSub').textContent = '扫到了码 ID ' + mk.id + '，但数据里没有对应点位';
      return;
    }
    // 码在画面里的倾斜角（用户手机有没有歪）
    var c = mk.corners;
    state.roll = deg(Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x));
    $('rollHint').classList.toggle('hidden', Math.abs(norm(state.roll)) < 25);
    setLoc(loc, 'aruco');
  }

  /* ---------- 罗盘 ---------- */
  function toggleCompass() {
    if (state.compassOn || state.compassWanted) {
      state.compassWanted = false;
      state.compassOn = false;        // 保留最后一次读数，重开时立刻能用
      $('compassBtn').textContent = '开罗盘';
      computeFacing();                // 退回"扫码时的固定朝向"
      updateView();
      return;
    }
    state.compassWanted = true;
    if (state.orientBound) {           // 监听器已经在，直接用上一次的方位恢复
      state.compassOn = true;
      $('compassBtn').textContent = '罗盘已开';
      computeFacing();
      updateView();
      return;
    }
    if (typeof DeviceOrientationEvent === 'undefined') return toast('这台设备没有罗盘接口');
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function (r) {
        if (r === 'granted') bindOrient();
        else { state.compassWanted = false; toast('没给罗盘权限'); }
      }).catch(function () { state.compassWanted = false; toast('没给罗盘权限'); });
    } else {
      bindOrient();
    }
  }

  /* iOS 13+ 必须在用户手势里同时要「罗盘 + 运动」两个权限 */
  function requestSensors() {
    var jobs = [];
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      jobs.push(DeviceOrientationEvent.requestPermission()
        .then(function (r) { if (r === 'granted') bindOrient(); })
        .catch(function () {}));
    } else {
      bindOrient();
    }
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      jobs.push(DeviceMotionEvent.requestPermission()
        .then(function (r) { if (r === 'granted') bindMotion(); })
        .catch(function () {}));
    } else {
      bindMotion();
    }
    return Promise.all(jobs);
  }

  function bindOrient() {
    if (state.orientBound) return;
    state.orientBound = true;
    state.compassWanted = true;
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    $('compassBtn').textContent = '罗盘中…';
    setTimeout(function () {
      if (!state.compassOn && state.compassWanted) $('compassBtn').textContent = '开罗盘';
    }, 3000);
  }

  function onOrient(e) {
    if (!state.compassWanted) return;        // 用户主动关了就别再更新
    var h = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha !== null && e.alpha !== undefined) h = (360 - e.alpha) % 360;
    if (h === null) return;

    var now = Date.now();
    var gap = now - (state.lastOrientT || 0);
    state.lastOrientT = now;

    /* 室内磁场偶尔会让罗盘瞬间跳几十度，丢掉这种单帧跳变。
       但注意：真实快速转身也会是大幅跳变 —— 所以连续几帧都指向同一个新值，
       就认定是"真转身"，必须接受。否则会被永久卡住（这坑踩过）。 */
    if (state.compassRaw !== null && state.compassRaw !== undefined &&
        gap < 120 && Math.abs(norm(h - state.compassRaw)) > 45) {
      if (state.jumpVal !== null && state.jumpVal !== undefined &&
          Math.abs(norm(h - state.jumpVal)) < 15) {
        state.jumpCount = (state.jumpCount || 0) + 1;
      } else {
        state.jumpCount = 1;
      }
      state.jumpVal = h;
      if (state.jumpCount < 5) return;     // 还没确认，先丢弃
      state.jumpVal = null;                // 连续 5 帧一致 → 认定真转身，放行
      state.jumpCount = 0;
    } else {
      state.jumpVal = null;
      state.jumpCount = 0;
    }
    state.compassRaw = h;

    // 低通平滑，抑制手持抖动
    state.compass = (state.compass === null) ? h
      : state.compass + norm(h - state.compass) * 0.45;

    if (!state.compassOn) {
      state.compassOn = true;
      $('compassBtn').textContent = '罗盘已开';
    }
    // 扫码时若还没收到罗盘，用第一帧当基准
    if (state.baseFacing !== null && state.baseCompass === null) {
      state.baseCompass = state.compass;
    }
    // 60Hz 事件，转 1° 以上才重画，避免白烧电
    if (Math.abs(norm(state.compass - track.lastCompass)) < 1 && state.viewDone) return;
    track.lastCompass = state.compass;
    state.viewDone = true;
    computeFacing();
    updateView();
  }

  /* 当前朝向 = 扫码时的绝对朝向 + 罗盘测到的转角 + 手动校正
     只用罗盘的「变化量」，不用它的绝对值 —— 室内磁干扰会让绝对值偏几十度，
     但转了多少度是准的。这样就免疫了现场磁场偏差。 */
  function computeFacing() {
    if (state.baseFacing === null) return;
    var f = state.baseFacing;
    if (state.compassWanted && state.baseCompass !== null && state.compass !== null) {
      f += norm(state.compass - state.baseCompass);
    }
    f += state.facingOffset;
    state.facing = f;
  }

  /* ================= 实时步行跟踪 =================
     和「高德 AR 步导」一个思路，室内没有 GPS，手机能拿到的真实信号只有两个：
       ① 罗盘（DeviceOrientation）→ 手机转到哪，箭头跟着转到哪
       ② 加速度计（DeviceMotion）→ 计步，走了多远，沿路线往前推
     两者一合起来，就是"人走到哪、箭头指到哪"，而不是扫完码定格。
     位置用「沿路线的里程」来表示：pos = 已走米数，跟着步数实时推进。 */

  var track = {
    segs: [],        // 路线的直线段：[{a,b,len,cum0,ang}]
    total: 0,        // 全程米数
    pos: 0,          // 已走米数（实时）
    steps: 0,
    stepLen: 0.72,   // 一步约 0.72 米（成年人均值）
    lastT: 0,
    peak: false,
    lowPass: null,
    bound: false,
    arrived: false,
    lastCompass: -999
  };

  /* 把路线折线转成「里程表」 */
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
    track.steps = 0;
    track.arrived = false;
    track.lowPass = null;
    track.peak = false;
  }

  /* 路线上 pos 米处的坐标（只算点，不找拐弯） */
  function pointAt(pos) {
    var segs = track.segs;
    if (!segs.length) return null;
    var i, idx = segs.length - 1;
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

  /* 走了 pos 米之后：我在哪、下一个拐弯在哪、该瞄哪个点 */
  function planAt(pos) {
    var segs = track.segs;
    if (!segs.length) return null;

    var here = pointAt(pos);
    var segIdx = here.segIdx;
    var sg = here.seg;
    var remain = sg.len * (1 - here.t);

    /* 往前找第一个转角 > 28° 的点 */
    var toTurn = remain, prevAng = sg.ang, turn = null, k, dA;
    for (k = segIdx + 1; k < segs.length; k++) {
      dA = norm(segs[k].ang - prevAng);
      if (Math.abs(dA) > 28) { turn = { meters: toTurn, deg: dA, nextIdx: k }; break; }
      toTurn += segs[k].len;
      prevAng = segs[k].ang;
    }

    return {
      x: here.x, y: here.y, segIdx: segIdx, ang: sg.ang, remain: remain,
      turn: turn,
      left: Math.max(0, track.total - pos)
    };
  }

  /* 该朝哪个方向走：
     平时 = 当前这段走廊的方向；进入拐点前 6 米开始"逐渐"转过去（不是到路口才突然拐）。
     用「段的方向」而不是「瞄某个点」，避免在拐角处算出斜角。
     6 米 ≈ 8 步，走快点也不会错过提示。 */
  var TURN_LEAD = 6;

  function aimAngle(pos) {
    var p = planAt(pos);
    if (!p) return null;
    if (p.turn) {
      var ns = track.segs[p.turn.nextIdx];
      if (ns && p.turn.meters < TURN_LEAD) {
        var k = 1 - p.turn.meters / TURN_LEAD;    // 0（刚进 6 米）→ 1（到路口）
        k = Math.min(1, k * 1.45);                // 前段偏得慢、后段转到位
        return p.ang + norm(ns.ang - p.ang) * k;  // 平滑过渡，箭头是"慢慢偏过去"的
      }
    }
    return p.ang;
  }

  function refreshRoute() {
    var lab = state.lab;
    if (!lab || !state.loc) return;
    var r = window.LabRouter.routeToLab(G, state.loc.node, lab, state.loc);
    state.route = r;
    if (!r) { txt('action', '算不出路线'); return; }
    buildTrack(r);
    cls('arrowwrap', 'arrived', false);
    updateView();
  }

  function shortNote(n) {
    return String(n.note || '').split(' · ')[0].split('/')[0].replace(/\s+$/, '');
  }

  function updateView() {
    var r = state.route;
    if (!r) return;
    var p = planAt(track.pos);
    if (!p) return;

    /* --- 箭头方向：路线方向 - 当前朝向 --- */
    var imgAng = aimAngle(track.pos);
    if (imgAng === null) imgAng = p.ang;
    var rel = norm(imgAng - state.facing);

    var abs = Math.abs(rel);
    var action, hint;
    var way = rel > 0 ? '右' : '左';
    var turning = !!(p.turn && p.turn.meters < TURN_LEAD);   // 箭头已开始为拐弯偏转
    if (abs >= 145) {
      action = '掉头'; hint = '方向反了';
    } else if (abs < 12) {
      action = '直行'; hint = '正前方';
    } else if (turning && p.turn.meters > 3.5) {
      // 还有几米才到路口，只是箭头提前偏了 → 说"前方左转"，别让人现在就拐
      action = '前方' + way + '转';
      hint = '还有 ' + Math.round(p.turn.meters) + ' 米';
    } else if (abs < 38) {
      action = rel > 0 ? '稍向右' : '稍向左'; hint = Math.round(abs) + '°';
    } else {
      action = way + '转'; hint = Math.round(abs) + '°';
    }

    if (!track.arrived) {
      txt('action', action);
      txt('arrowHint', hint);
    }
    var arrowEl = $('arrow');
    if (arrowEl) arrowEl.style.transform = 'rotate(' + rel.toFixed(1) + 'deg)';
    var guideEl = $('guide');
    if (guideEl) guideEl.style.setProperty('--rot', (Math.max(-35, Math.min(35, rel * 0.5))).toFixed(1) + 'deg');

    /* --- 文案：实时跟着"下一个拐弯/终点"变 --- */
    var lab = state.lab;
    var detail = [];
    if (!track.arrived) {
      if (abs >= 145) {
        // 朝向和路线相反（多半是还没开罗盘、人已经背对路线）→ 别再说"就是这儿左转"
        detail.push('先转身，面向走廊再走');
      } else if (p.turn) {
        var cornerSeg = track.segs[p.turn.nextIdx - 1];
        var cornerName = cornerSeg ? shortNote(cornerSeg.b) : '拐角';
        var turnWay = p.turn.deg > 0 ? '右转' : '左转';
        if (p.turn.meters <= 3.5) {
          detail.push(p.turn.meters < 1 ? ('就是这儿，' + turnWay)
            : ('再走 ' + Math.round(p.turn.meters) + ' 米就' + turnWay));
        } else {
          detail.push('沿这条路走约 ' + Math.round(p.turn.meters) + ' 米到「' + cornerName + '」');
          detail.push('然后' + turnWay);
        }
      } else {
        detail.push('沿这条路走约 ' + Math.max(1, Math.round(p.left)) + ' 米就到「' +
          (lab ? lab.room : '目的地') + '」');
      }
      var switches = r.steps.filter(function (s) { return s.kind === 'switch'; }).length;
      if (switches) detail.push('中途换 ' + switches + ' 次楼层/楼栋');
      txt('detail', detail.join('，'));
    }

    /* --- 快到拐弯了振一下，不用一直盯着屏幕 --- */
    if (p.turn && p.turn.meters <= 5 && !track.warnedTurn) {
      track.warnedTurn = true;
      if (navigator.vibrate) navigator.vibrate(40);
    } else if (!p.turn || p.turn.meters > 9) {
      track.warnedTurn = false;
    }

    /* --- 进度条 --- */
    txt('walked', Math.round(track.pos));
    txt('left', Math.round(p.left));
    var fillEl = $('progFill');
    if (fillEl) fillEl.style.width = (track.total ? Math.min(100, track.pos / track.total * 100) : 0).toFixed(1) + '%';
    txt('stepInfo', track.bound ? ('计步 ' + track.steps + ' 步') : '没读到运动传感器');

    /* --- 模式标签 --- */
    var chip = $('modeChip');
    if (chip) {
      if (state.compassOn) {
        chip.textContent = '实时跟随 · 跟着你转';
        chip.classList.add('live');
      } else {
        chip.textContent = '朝向已锁定（点「开罗盘」可跟随）';
        chip.classList.remove('live');
      }
    }
  }

  /* ---------- 计步：加速度峰值检测 ---------- */
  function advance(m) {
    if (!state.route || !track.segs.length) return;
    track.pos = Math.max(0, Math.min(track.total, track.pos + m));
    if (track.pos >= track.total - 1 && !track.arrived) { onArrive(); return; }
    updateView();
  }

  function nudge(m) {
    if (!state.route) return;
    track.arrived = false;
    cls('arrowwrap', 'arrived', false);
    track.pos = Math.max(0, Math.min(track.total, track.pos + m));
    updateView();
  }

  function onArrive() {
    track.arrived = true;
    var lab = state.lab;
    cls('arrowwrap', 'arrived', true);
    txt('action', '已到达');
    txt('arrowHint', '到了');
    txt('detail', (lab ? lab.name : '目的地') + (lab && lab.desc ? ' · ' + lab.desc : ''));
    txt('walked', Math.round(track.total));
    txt('left', '0');
    var fillEl = $('progFill');
    if (fillEl) fillEl.style.width = '100%';
    if (navigator.vibrate) navigator.vibrate([70, 60, 70]);
    toast('到了：' + (lab ? lab.room : ''));
  }

  function bindMotion() {
    if (track.bound) return;
    track.bound = true;
    window.addEventListener('devicemotion', onMotion, true);
  }

  function onMotion(e) {
    if (!state.route) return;
    var a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x === null || a.x === undefined) return;
    var mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    if (track.lowPass === null) { track.lowPass = mag; return; }
    track.lowPass = track.lowPass * 0.90 + mag * 0.10;   // 重力基线
    var d = mag - track.lowPass;
    var now = Date.now();

    if (d > 1.1) {
      if (!track.peak && now - track.lastT > 260) {       // 两次起步至少隔 260ms
        track.peak = true;
        track.lastT = now;
        track.steps++;
        advance(track.stepLen);
      }
    } else if (d < 0.45) {
      track.peak = false;
    }
  }

  /* ---------- 教室列表 ---------- */
  function renderResults(q) {
    var box = $('results');
    if (!box) return;
    box.innerHTML = '';
    var list = LABS.filter(function (lab) {
      if (!q) return true;
      var hay = [lab.name, lab.room, lab.desc, floorLabel(lab.floor)].concat(lab.tags || []).join(' ').toLowerCase();
      return hay.indexOf(q.toLowerCase()) > -1;
    }).slice(0, 12);

    if (!list.length) {
      box.innerHTML = '<li class="empty">没找到，换个关键词试试</li>';
      return;
    }
    list.forEach(function (lab) {
      var li = document.createElement('li');
      li.className = 'res';
      li.innerHTML =
        '<div class="res-main"><div class="res-name">' + lab.name + '</div>' +
        '<div class="res-meta">' + floorLabel(lab.floor) + ' · ' + lab.room + '</div></div>' +
        '<div class="res-go">›</div>';
      li.onclick = function () { pickLab(lab.id); };
      box.appendChild(li);
    });
  }

  function pickLab(id) {
    var lab = labsById[id];
    if (!lab) return;
    state.lab = lab;
    txt('targetText', lab.name + ' · ' + lab.room);
    cls('mapBtn', 'hidden', false);
    cls('backBtn', 'hidden', false);
    cls('sheet', 'collapsed', true);
    cls('arrowwrap', 'hidden', false);
    refreshRoute();
  }

  function showSheet() {
    cls('sheet', 'collapsed', false);
    cls('arrowwrap', 'hidden', true);
  }

  function toast(msg) {
    var d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2200);
  }

  /* ---------- 启动 ---------- */
  function boot() {
    video = $('cam');

    var params = new URLSearchParams(location.search);
    var simLoc = params.get('loc');
    var simLab = params.get('lab');

    renderResults('');

    // 搜索框最先绑：万一后面某段出错，搜索也一定还能用
    var q = $('q');
    if (q) q.addEventListener('input', function () { renderResults(q.value.trim()); });

    on('startBtn', function () {
      requestSensors();      // 必须在用户手势里要传感器权限（iOS）
      startCamera();
    });
    on('manualBtn', function () {
      requestSensors();
      if ($('start')) $('start').classList.add('hidden');
      $('arrowwrap').classList.add('hidden');
      showSheet();
      $('locPick').classList.remove('hidden');
    });
    on('fixMinus', function () { nudge(-5); });
    on('fixPlus', function () { nudge(5); });
    on('flipBtn', function () {
      // 箭头整体反了 180°：多半是贴纸朝向填反了，或者扫码时不是正对墙面
      state.facingOffset = (state.facingOffset + 180) % 360;
      computeFacing();
      updateView();
      toast('朝向已翻转 180°');
      if (navigator.vibrate) navigator.vibrate(30);
    });
    on('compassBtn', toggleCompass);
    on('backBtn', function () { $('sheet').classList.remove('collapsed'); });
    on('mapBtn', function () {
      if (!state.lab || !state.loc) return;
      location.href = 'index.html?loc=' + encodeURIComponent(state.loc.id) +
        '&lab=' + encodeURIComponent(state.lab.id);
    });
    on('rescanBtn', function () {
      state.lab = null;
      state.route = null;
      track.segs = [];
      track.total = 0;
      track.pos = 0;
      track.steps = 0;
      track.arrived = false;
      $('targetText').textContent = '还没选教室';
      $('mapBtn').classList.add('hidden');
      $('backBtn').classList.add('hidden');
      $('sheet').classList.remove('collapsed');
      $('arrowwrap').classList.add('hidden');
      $('arrowwrap').classList.remove('arrived');
      setLoc(null);
      if (video && video.srcObject) {
        $('scanbox').classList.remove('hidden');
        startScan();
      } else {
        $('start').classList.remove('hidden');
      }
    });

    // 手动选位置
    var sel = $('locSel');
    if (sel) {
      LOCS.forEach(function (l) {
        var o = document.createElement('option');
        o.value = l.id; o.textContent = l.place;
        sel.appendChild(o);
      });
      sel.onchange = function () {
        var hit = null;
        LOCS.forEach(function (l) { if (l.id === sel.value) hit = l; });
        if (hit) { requestSensors(); setLoc(hit, 'manual'); }
      };
    }

    // 调试/演示：直接带参数进入
    if (simLoc) {
      var hit = null;
      LOCS.forEach(function (l) { if (l.id === simLoc) hit = l; });
      if (hit) {
        $('start').classList.add('hidden');
        requestSensors();      // 没手势时 iOS 可能不给权限，桌面/安卓正常
        setLoc(hit, 'manual');
        if (simLab) pickLab(simLab);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 调试用（浏览器控制台里 __arDebug.planAt(__arDebug.track.pos) 就能看当前位置推算）
  window.__arDebug = { state: state, track: track, planAt: planAt, pointAt: pointAt,
    aimAngle: aimAngle, updateView: updateView, graph: G };
})();
