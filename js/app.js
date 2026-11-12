/* 界面逻辑：定位卡 → 搜索 → 列表 → 路线 */
(function () {
  'use strict';

  var D = window.LAB_DATA;
  var G = window.LabRouter.buildGraph(D);
  var LABS = D.labs || [];
  var LOCS = D.locations || [];

  var labsById = {};
  LABS.forEach(function (l) { labsById[l.id] = l; });

  var state = {
    loc: null,          // 当前定位点
    locFromQR: false,
    lab: null,
    route: null,
    distCache: null,
    floorId: null,
    stepIndex: -1,
    building: 'all',
    q: '',
    view: null,
    baseView: null,
    browseFloor: null,
    browseView: null,
    browseBase: null,
    browseLayer: 'photo',
    kindFilter: '',
    hlRoom: null
  };

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }

  function buildingName(id) {
    var n = id;
    (D.buildings || []).forEach(function (b) { if (b.id === id) n = b.name; });
    return n;
  }

  function floorLabel(fid) { return window.LabRouter.floorName(G, fid); }

  function getRoom(floorId, roomId) {
    var f = G.floors[floorId];
    if (!f) return null;
    var hit = null;
    (f.rooms || []).forEach(function (r) { if (r.id === roomId) hit = r; });
    return hit;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function toast(msg) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;bottom:calc(32px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);' +
      'background:rgba(15,23,42,.9);color:#fff;padding:10px 16px;border-radius:999px;font-size:13.5px;z-index:99;' +
      'box-shadow:0 10px 30px rgba(15,23,42,.25);transition:.2s;opacity:0';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.style.opacity = '1'; });
    setTimeout(function () {
      d.style.opacity = '0';
      setTimeout(function () { d.remove(); }, 260);
    }, 1900);
  }

  /* 从某个节点出发，到所有节点的最短距离（一次算完，列表里直接用） */
  function distMapFrom(startId) {
    var dist = {}, seen = {}, adj = G.adj;
    Object.keys(G.nodes).forEach(function (id) { dist[id] = Infinity; });
    if (!startId || !G.nodes[startId]) return dist;
    dist[startId] = 0;
    var q = [startId];
    while (q.length) {
      q.sort(function (a, b) { return dist[a] - dist[b]; });
      var u = q.shift();
      if (seen[u]) continue;
      seen[u] = true;
      (adj[u] || []).forEach(function (e) {
        var nd = dist[u] + e.m;
        if (nd < dist[e.to]) { dist[e.to] = nd; q.push(e.to); }
      });
    }
    return dist;
  }

  function labDistance(lab) {
    if (!state.distCache) return null;
    var door = lab.door;
    if (!door) {
      var room = getRoom(lab.floor, lab.room);
      if (room) door = window.LabRouter.nearestNode(G, lab.floor, room.x + room.w / 2, room.y + room.h / 2);
    }
    var d = door ? state.distCache[door] : Infinity;
    return (d === undefined || d === Infinity) ? null : d;
  }

  /* ---------------- 顶部与定位卡 ---------------- */
  function renderHero() {
    var loc = state.loc;
    $('siteName').textContent = D.site || '实验室定位';
    $('locPillText').textContent = loc ? loc.place : '未识别位置';
    $('locPill').className = 'loc-pill' + (loc ? '' : ' warn');

    if (loc) {
      $('whereText').textContent = loc.place;
      $('whereSub').textContent = '选择你要去的实验室，会给你画出路线';
      $('sourceBadge').textContent = state.locFromQR ? '二维码识别' : '手动选择';
      $('locPicker').classList.add('hidden');
    } else {
      $('whereText').textContent = '还没识别到你的位置';
      $('whereSub').textContent = '扫描墙上的定位二维码，或在下方手动选择你所在的位置';
      $('sourceBadge').textContent = '未定位';
      $('locPicker').classList.remove('hidden');
    }
  }

  function renderLocSelect() {
    var sel = $('locSelect');
    sel.innerHTML = '<option value="">— 请选择你所在的位置 —</option>';
    LOCS.forEach(function (l) {
      var o = document.createElement('option');
      o.value = l.id;
      o.textContent = l.place;
      sel.appendChild(o);
    });
    sel.value = state.loc ? state.loc.id : '';
    sel.onchange = function () {
      var hit = null;
      LOCS.forEach(function (l) { if (l.id === sel.value) hit = l; });
      setLoc(hit, false);
      if (hit) toast('已定位：' + hit.place);
    };
  }

  function setLoc(loc, fromQR) {
    state.loc = loc;
    state.locFromQR = !!fromQR;
    state.distCache = loc ? distMapFrom(loc.node) : null;
    renderHero();
    renderList();
    if (loc) {
      try { history.replaceState(null, '', '?loc=' + encodeURIComponent(loc.id)); } catch (e) { /* file:// 下不支持改 URL，忽略 */ }
    }
  }

  /* ---------------- 筛选条 ---------------- */
  function renderChips() {
    var box = $('chips');
    box.innerHTML = '';
    var items = [{ id: 'all', name: '全部' }].concat(D.buildings || []);
    items.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (state.building === b.id ? ' on' : '');
      btn.textContent = b.name + (b.desc ? ' · ' + b.desc : '');
      btn.onclick = function () {
        state.building = b.id;
        renderChips();
        renderList();
      };
      box.appendChild(btn);
    });
  }

  /* ---------------- 实验室列表 ---------------- */
  function matchLab(lab, q) {
    if (!q) return true;
    var hay = [lab.name, lab.room, lab.desc, floorLabel(lab.floor)].concat(lab.tags || []).join(' ').toLowerCase();
    return hay.indexOf(q.toLowerCase()) > -1;
  }

  function roomKindOf(lab) {
    var f = G.floors[lab.floor];
    if (!f) return null;
    var k = null;
    (f.rooms || []).forEach(function (r) { if (r.id === lab.room) k = r.kind || 'room'; });
    return k;
  }

  function renderList() {
    var box = $('list');
    box.innerHTML = '';

    var rows = LABS.filter(function (lab) {
      var bid = (G.floors[lab.floor] || {}).building;
      if (state.building !== 'all' && bid !== state.building) return false;
      if (state.kindFilter && roomKindOf(lab) !== state.kindFilter) return false;
      return matchLab(lab, state.q);
    });

    rows.sort(function (a, b) {
      var da = labDistance(a), db = labDistance(b);
      if (da != null && db != null) return da - db;
      if (da != null) return -1;
      if (db != null) return 1;
      return a.name.localeCompare(b.name, 'zh');
    });

    if (!rows.length) {
      $('empty').classList.remove('hidden');
    } else {
      $('empty').classList.add('hidden');
    }

    rows.forEach(function (lab) {
      var d = labDistance(lab);
      var distHtml;
      if (!state.loc) {
        distHtml = '<div class="lc-dist"><b>—</b><span>未定位</span></div>';
      } else if (d == null) {
        distHtml = '<div class="lc-dist"><b>—</b><span>暂不可达</span></div>';
      } else {
        var dtxt = d < 1 ? '≤1' : String(Math.round(d));
        distHtml = '<div class="lc-dist"><b>' + dtxt + '</b><span>米 · 约 ' +
          Math.max(1, Math.round(d / 60)) + ' 分钟</span></div>';
      }
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'lab-card';
      card.innerHTML =
        '<div class="lc-top">' +
          '<div class="lc-name">' + esc(lab.name) + '</div>' +
          distHtml +
        '</div>' +
        '<div class="lc-meta">' +
          '<span>' + esc(floorLabel(lab.floor)) + '</span>' +
          '<span class="lc-room">' + esc(lab.room) + '</span>' +
        '</div>' +
        ((lab.tags && lab.tags.length)
          ? '<div class="lc-tags">' + lab.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>'
          : '');
      card.onclick = function () { openLab(lab.id); };
      box.appendChild(card);
    });
  }

  /* ---------------- 地图 ---------------- */
  var KIND_FILL = {
    lab: ['#e0f2fe', '#93c5fd'],
    store: ['#fef3c7', '#fcd34d'],
    service: ['#f1f5f9', '#cbd5e1'],
    room: ['#f5f3ff', '#c4b5fd'],
    office: ['#ecfeff', '#a5f3fc'],
    toilet: ['#f0fdf4', '#86efac'],
    stair: ['#fff7ed', '#fb923c']
  };

  var KIND_LABEL = {
    lab: '实验室',
    office: '办公室',
    room: '其他房间',
    store: '库房',
    service: '设备用房',
    toilet: '卫生间',
    stair: '楼梯',
    corridor: '走廊'
  };

  function roomsSvg(f, opt) {
    opt = opt || {};
    var fillOp = (opt.fillOpacity == null) ? 1 : opt.fillOpacity;
    var stroke = opt.stroke || null;
    var out = '';
    (f.rooms || []).forEach(function (r) {
      var c = KIND_FILL[r.kind] || KIND_FILL.room;
      out += '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="4" fill="' + c[0] +
        '" fill-opacity="' + fillOp + '" stroke="' + (stroke || c[1]) + '" stroke-width="2"/>';
      if (opt.noLabel) return;
      out += '<text x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h / 2 - 8) + '" text-anchor="middle" font-size="18" font-weight="700" fill="#334155" font-family="sans-serif">' + esc(r.id) + '</text>';
      out += '<text x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h / 2 + 20) + '" text-anchor="middle" font-size="13" fill="#64748b" font-family="sans-serif">' + esc(r.name) + '</text>';
    });
    return out;
  }

  function polyline(points) {
    return points.map(function (p) { return p.x + ',' + p.y; }).join(' ');
  }

  function renderMap(floorId, nodeIds, lab) {
    var f = G.floors[floorId];
    if (!f) return;
    var W = f.width, H = f.height;
    var pts = (nodeIds || []).map(function (id) { return G.nodes[id]; }).filter(Boolean);

    var svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">'];
    svg.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#f8fafc"/>');
    // 底图优先用数字地图（红=墙的干净图），没有则退回原图
    var base = f.mapImage || f.image;
    var onMap = !!f.mapImage;
    if (base) {
      svg.push('<image href="' + esc(base) + '" x="0" y="0" width="' + W + '" height="' + H +
        '" preserveAspectRatio="none" onerror="this.style.display=\'none\'"/>');
    }
    // 房间画在底图之上：数字地图是不透明的，放下面会被盖住
    svg.push(roomsSvg(f, onMap ? { fillOpacity: 0.1, stroke: '#cbd5e1' } : null));

    var targetRoom = lab && floorId === lab.floor ? getRoom(lab.floor, lab.room) : null;

    if (targetRoom) {
      svg.push('<rect x="' + targetRoom.x + '" y="' + targetRoom.y + '" width="' + targetRoom.w + '" height="' + targetRoom.h +
        '" rx="4" fill="#e11d48" fill-opacity="0.16" stroke="#e11d48" stroke-width="4"/>');
    }

    if (pts.length >= 2) {
      var line = polyline(pts);
      svg.push('<polyline points="' + line + '" fill="none" stroke="#ffffff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.95"/>');
      svg.push('<polyline points="' + line + '" fill="none" stroke="#e11d48" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="18 12" class="route-line"/>');
    }

    // 终点到房门的一段（虚线表示「进门」）
    var lastPt = pts[pts.length - 1];
    if (targetRoom && lastPt) {
      var cx = targetRoom.x + targetRoom.w / 2, cy = targetRoom.y + targetRoom.h / 2;
      svg.push('<line x1="' + lastPt.x + '" y1="' + lastPt.y + '" x2="' + cx + '" y2="' + cy +
        '" stroke="#e11d48" stroke-width="4" stroke-dasharray="10 8" stroke-opacity="0.85"/>');
    }

    // 起点
    if (pts.length) {
      var s = pts[0];
      svg.push('<circle cx="' + s.x + '" cy="' + s.y + '" r="9" fill="#2563eb" stroke="#fff" stroke-width="4"/>');
      svg.push('<circle cx="' + s.x + '" cy="' + s.y + '" r="9" fill="#2563eb" class="start-pulse"/>');
    }

    // 终点
    if (pts.length > 1) {
      var e = pts[pts.length - 1];
      svg.push('<circle cx="' + e.x + '" cy="' + e.y + '" r="11" fill="#e11d48" stroke="#fff" stroke-width="4"/>');
    } else if (targetRoom) {
      var mx = targetRoom.x + targetRoom.w / 2, my = targetRoom.y + targetRoom.h / 2;
      svg.push('<circle cx="' + mx + '" cy="' + my + '" r="13" fill="#e11d48" stroke="#fff" stroke-width="4"/>');
    }

    svg.push('</svg>');
    $('map').innerHTML = svg.join('');

    // 视野：把路线框进来
    var vb = fitBox(pts, targetRoom, W, H);
    vb = snapToRooms(vb, f.rooms, W, H);
    state.baseView = vb;
    state.view = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
    applyView();
    bindPanZoom();
  }

  function snapToRooms(v, rooms, W, H) {
    // 如果视野边界正好切在房间中间（或正好压在房间边上），把边界推到房间边缘（只扩大，不缩小）
    for (var pass = 0; pass < 2; pass++) {
      (rooms || []).forEach(function (r) {
        var rx2 = r.x + r.w, ry2 = r.y + r.h;
        var cross = !(rx2 < v.x || r.x > v.x + v.w || ry2 < v.y || r.y > v.y + v.h);
        if (!cross) return;
        var x1 = Math.min(v.x, r.x), y1 = Math.min(v.y, r.y);
        var x2 = Math.max(v.x + v.w, rx2), y2 = Math.max(v.y + v.h, ry2);
        // 扩大太多就不吸附了，否则一下拉成整层
        if (x1 < v.x - 170 || y1 < v.y - 170 || x2 > v.x + v.w + 170 || y2 > v.y + v.h + 170) return;
        v.x = x1; v.y = y1; v.w = x2 - x1; v.h = y2 - y1;
      });
    }
    if (v.x < 0) { v.w += v.x; v.x = 0; }
    if (v.y < 0) { v.h += v.y; v.y = 0; }
    if (v.x + v.w > W) v.w = W - v.x;
    if (v.y + v.h > H) v.h = H - v.y;
    return v;
  }

  function fitBox(pts, room, W, H) {
    if (!pts.length && !room) return { x: 0, y: 0, w: W, h: H };

    var single = pts.length < 2 && !room;
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    if (room) {
      xs.push(room.x, room.x + room.w);
      ys.push(room.y, room.y + room.h);
    }
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var pad = single ? 240 : 110;
    var w = Math.max(maxX - minX + pad * 2, single ? 700 : 460);
    var h = Math.max(maxY - minY + pad * 2, single ? 460 : 320);
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var x = cx - w / 2, y = cy - h / 2;
    // 别超出楼层范围
    if (w > W) { w = W; x = 0; } else { x = Math.min(Math.max(x, 0), W - w); }
    if (h > H) { h = H; y = 0; } else { y = Math.min(Math.max(y, 0), H - h); }
    return { x: x, y: y, w: w, h: h };
  }

  function applyView() {
    var svg = $('map').querySelector('svg');
    if (!svg || !state.view) return;
    var v = state.view;
    svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
  }

  function zoomBy(factor, cx, cy) {
    var v = state.view;
    if (!v) return;
    var nw = Math.min(v.w * factor, (state.baseView.w) * 6);
    var nh = Math.min(v.h * factor, (state.baseView.h) * 6);
    nw = Math.max(nw, 120); nh = Math.max(nh, 90);
    cx = (cx === undefined) ? v.x + v.w / 2 : cx;
    cy = (cy === undefined) ? v.y + v.h / 2 : cy;
    var rx = (cx - v.x) / v.w, ry = (cy - v.y) / v.h;
    state.view = { x: cx - nw * rx, y: cy - nh * ry, w: nw, h: nh };
    applyView();
  }

  function bindPanZoom() {
    var box = $('map');
    var svg = box.querySelector('svg');
    if (!svg) return;
    var drag = null;

    svg.addEventListener('pointerdown', function (ev) {
      drag = { x: ev.clientX, y: ev.clientY, view: Object.assign({}, state.view) };
      svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var rect = box.getBoundingClientRect();
      var kx = drag.view.w / rect.width, ky = drag.view.h / rect.height;
      state.view = {
        x: drag.view.x - (ev.clientX - drag.x) * kx,
        y: drag.view.y - (ev.clientY - drag.y) * ky,
        w: drag.view.w, h: drag.view.h
      };
      applyView();
    });
    svg.addEventListener('pointerup', function () { drag = null; });
    svg.addEventListener('pointercancel', function () { drag = null; });
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      zoomBy(ev.deltaY > 0 ? 1.12 : 0.89);
    }, { passive: false });

    // 双指缩放
    var pinch = null;
    box.addEventListener('touchstart', function (ev) {
      if (ev.touches.length === 2) {
        pinch = dist2(ev.touches);
      }
    }, { passive: true });
    box.addEventListener('touchmove', function (ev) {
      if (ev.touches.length === 2 && pinch) {
        var d = dist2(ev.touches);
        zoomBy(pinch / d);
        pinch = d;
        ev.preventDefault();
      }
    }, { passive: false });
    box.addEventListener('touchend', function () { pinch = null; }, { passive: true });
  }

  function dist2(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  }

  /* ---------------- 路线面板 ---------------- */
  function openLab(labId) {
    var lab = labsById[labId];
    if (!lab) return;
    if (!state.loc) {
      toast('请先告诉我你在哪里（扫码或手动选择）');
      $('locPicker').classList.remove('hidden');
      $('locPicker').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var r = window.LabRouter.routeToLab(G, state.loc.node, lab, state.loc);
    if (!r) {
      toast('这个实验室暂时无法规划路线，请检查数据连接');
      return;
    }

    // 末尾补一条「到达」
    r.steps.push({ kind: 'arrive', floor: lab.floor, nodes: [r.targetNode], meters: 0 });

    state.lab = lab;
    state.route = r;

    $('rtName').textContent = lab.name;
    $('rtLoc').textContent = floorLabel(lab.floor) + ' · ' + lab.room;
    $('sumMeters').textContent = Math.round(r.meters);
    $('sumMinutes').textContent = r.minutes;
    var switches = r.steps.filter(function (s) { return s.kind === 'switch'; }).length;
    $('sumFloors').textContent = switches;

    renderFloorTabs();
    renderSteps();
    renderLabDetail(lab);
    setStep(0);

    $('routePanel').classList.remove('hidden');
    $('routePanel').scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }

  function closeRoute() {
    $('routePanel').classList.add('hidden');
    document.body.style.overflow = '';
    state.lab = null;
    state.route = null;
  }

  function routeFloors() {
    var seen = {}, out = [];
    (state.route.nodes || []).forEach(function (id) {
      var f = G.nodes[id].floor;
      if (!seen[f]) { seen[f] = 1; out.push(f); }
    });
    return out;
  }

  function renderFloorTabs() {
    var box = $('floorTabs');
    box.innerHTML = '';
    var floors = routeFloors();
    if (floors.length < 2) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    floors.forEach(function (fid) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'floor-tab';
      b.dataset.floor = fid;
      b.textContent = floorLabel(fid);
      b.onclick = function () { showFloor(fid); };
      box.appendChild(b);
    });
  }

  function markActiveFloor(fid) {
    Array.prototype.forEach.call($('floorTabs').children, function (b) {
      b.className = 'floor-tab' + (b.dataset.floor === fid ? ' on' : '');
    });
  }

  /* 切换楼层视图：找这一步在该层的节点 */
  function showFloor(fid) {
    if (!state.route) return;
    var step = state.route.steps[state.stepIndex] || state.route.steps[0];
    var ids = (step.nodes || []).filter(function (id) { return G.nodes[id] && G.nodes[id].floor === fid; });
    if (!ids.length) {
      var any = null;
      (state.route.nodes || []).forEach(function (id) { if (G.nodes[id].floor === fid && !any) any = id; });
      ids = any ? [any] : [];
    }
    markActiveFloor(fid);
    renderMap(fid, ids, state.lab);
  }

  function renderSteps() {
    var box = $('steps');
    box.innerHTML = '';
    state.route.steps.forEach(function (s, i) {
      var li = document.createElement('li');
      li.className = 'step ' + s.kind;
      li.dataset.i = i;

      var text, floorTxt;
      if (s.kind === 'walk') {
        text = s.text;
        floorTxt = floorLabel(s.floor) + ' · 约 ' + Math.round(s.meters) + ' 米';
      } else if (s.kind === 'switch') {
        text = s.text;
        floorTxt = floorLabel(s.fromFloor) + ' → ' + floorLabel(s.toFloor);
      } else {
        text = '到达「' + state.lab.name + '」（' + state.lab.room + '），' +
          (state.lab.desc ? state.lab.desc : '就是这里');
        floorTxt = floorLabel(s.floor);
      }

      li.innerHTML =
        '<div class="step-no">' + (s.kind === 'arrive' ? '✓' : (i + 1)) + '</div>' +
        '<div class="step-body">' +
          '<div class="step-text">' + esc(text) + '</div>' +
          '<span class="step-floor">' + esc(floorTxt) + '</span>' +
        '</div>';
      li.onclick = function () { setStep(i); };
      box.appendChild(li);
    });
  }

  function setStep(i) {
    state.stepIndex = i;
    var s = state.route.steps[i];
    if (!s) return;

    Array.prototype.forEach.call($('steps').children, function (li, k) {
      li.className = 'step ' + state.route.steps[k].kind + (k === i ? ' on' : '');
    });

    var fid = s.floor;
    var ids = (s.nodes || []).filter(function (id) { return G.nodes[id]; });
    if (s.kind === 'switch') {
      // 换层这一步：显示目标楼层，并标出落地点
      var to = s.toFloor;
      var land = null;
      state.route.nodes.forEach(function (id) { if (G.nodes[id].floor === to && !land) land = id; });
      ids = land ? [land] : [];
      fid = to;
    }
    markActiveFloor(fid);
    renderMap(fid, ids, state.lab);

    // 若当前楼层还有这一段路，滚动到可见
    var active = $('steps').children[i];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderLabDetail(lab) {
    var html = '<h3>实验室信息</h3>';
    html += '<p><b>' + esc(lab.name) + '</b>　' + esc(floorLabel(lab.floor)) + ' · ' + esc(lab.room) + '</p>';
    if (lab.desc) html += '<p>' + esc(lab.desc) + '</p>';
    if (lab.phone) html += '<p>联系电话：' + esc(lab.phone) + '</p>';
    html += '<p>出发点：' + esc(state.loc.place) + '</p>';
    $('labDetail').innerHTML = html;
  }

  /* ---------------- 楼层平面图（数字地图 · 点图查询） ---------------- */
  function kindLabel(k) { return KIND_LABEL[k] || '其他房间'; }

  function roomArea(r) {
    var mpp = D.metersPerPixel || 0.045;
    return Math.round(r.w * r.h * mpp * mpp * 10) / 10;
  }

  function renderBrowseMap() {
    var f = G.floors[state.browseFloor];
    if (!f) return;
    var W = f.width, H = f.height;

    var svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">'];
    svg.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#f8fafc"/>');
    // 底图：原图 或 自动生成的数字地图（红=墙，其余=可通行）
    var mapMode = state.browseLayer === 'map' && f.mapImage;
    var baseSrc = mapMode ? f.mapImage : f.image;
    if (baseSrc) {
      svg.push('<image href="' + esc(baseSrc) + '" x="0" y="0" width="' + W + '" height="' + H +
        '" preserveAspectRatio="none" onerror="this.style.display=\'none\'"/>');
    }
    // 房间画在底图之上（半透明，可点击）
    (f.rooms || []).forEach(function (r) {
      if (state.kindFilter && (r.kind || 'room') !== state.kindFilter) return;
      var c = KIND_FILL[r.kind] || KIND_FILL.room;
      var hl = state.hlRoom === r.id;
      svg.push('<g class="room-g" data-room="' + esc(r.id) + '">');
      svg.push('<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="4" fill="' + c[0] +
        '" fill-opacity="' + (hl ? 0.8 : (mapMode ? 0.08 : 0.55)) + '" stroke="' + (hl ? '#e11d48' : c[1]) + '" stroke-width="' + (hl ? 5 : 2) + '"/>');
      svg.push('<text x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h / 2 - 6) + '" text-anchor="middle" font-size="17" font-weight="700" fill="#334155" font-family="sans-serif" pointer-events="none">' + esc(r.id) + '</text>');
      svg.push('<text x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h / 2 + 16) + '" text-anchor="middle" font-size="12" fill="#475569" font-family="sans-serif" pointer-events="none">' + esc(r.name) + '</text>');
      svg.push('</g>');
    });
    svg.push('</svg>');
    $('browseMap').innerHTML = svg.join('');

    var suppress = false;
    Array.prototype.forEach.call($('browseMap').querySelectorAll('.room-g'), function (g) {
      g.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (suppress) return;
        showRoomCard(g.getAttribute('data-room'));
      });
    });
    var svgEl = $('browseMap').querySelector('svg');
    if (svgEl) {
      svgEl.addEventListener('click', function () {
        if (suppress) return;
        hideRoomCard();
      });
    }

    if (!state.browseBase) state.browseBase = { x: 0, y: 0, w: W, h: H };
    if (!state.browseView) state.browseView = { x: 0, y: 0, w: W, h: H };
    applyBrowseView();
    bindBrowsePanZoom();
  }

  function applyBrowseView() {
    var svg = $('browseMap').querySelector('svg');
    if (!svg || !state.browseView) return;
    var v = state.browseView;
    svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
  }

  function browseZoom(factor, cx, cy) {
    var v = state.browseView;
    if (!v || !state.browseBase) return;
    var nw = Math.min(v.w * factor, state.browseBase.w * 4);
    var nh = Math.min(v.h * factor, state.browseBase.h * 4);
    nw = Math.max(nw, 150); nh = Math.max(nh, 120);
    cx = (cx === undefined) ? v.x + v.w / 2 : cx;
    cy = (cy === undefined) ? v.y + v.h / 2 : cy;
    var rx = (cx - v.x) / v.w, ry = (cy - v.y) / v.h;
    state.browseView = { x: cx - nw * rx, y: cy - nh * ry, w: nw, h: nh };
    applyBrowseView();
  }

  function bindBrowsePanZoom() {
    var box = $('browseMap');
    var svg = box.querySelector('svg');
    if (!svg) return;
    var drag = null;
    var suppress = false;

    svg.addEventListener('pointerdown', function (ev) {
      drag = { x: ev.clientX, y: ev.clientY, view: Object.assign({}, state.browseView), moved: false };
      svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 8) drag.moved = true;
      var rect = box.getBoundingClientRect();
      var kx = drag.view.w / rect.width, ky = drag.view.h / rect.height;
      state.browseView = {
        x: drag.view.x - (ev.clientX - drag.x) * kx,
        y: drag.view.y - (ev.clientY - drag.y) * ky,
        w: drag.view.w, h: drag.view.h
      };
      applyBrowseView();
    });
    svg.addEventListener('pointerup', function () {
      suppress = !!(drag && drag.moved);
      drag = null;
      if (suppress) setTimeout(function () { suppress = false; }, 0);
    });
    svg.addEventListener('pointercancel', function () { drag = null; });
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      browseZoom(ev.deltaY > 0 ? 1.12 : 0.89);
    }, { passive: false });

    // 双指缩放（box 只绑一次，避免重复）
    if (!box.__pinchBound) {
      box.__pinchBound = true;
      var pinch = null;
      box.addEventListener('touchstart', function (ev) {
        if (ev.touches.length === 2) pinch = dist2(ev.touches);
      }, { passive: true });
      box.addEventListener('touchmove', function (ev) {
        if (ev.touches.length === 2 && pinch) {
          var d = dist2(ev.touches);
          browseZoom(pinch / d);
          pinch = d;
          ev.preventDefault();
        }
      }, { passive: false });
      box.addEventListener('touchend', function () { pinch = null; }, { passive: true });
    }
  }

  function centerBrowseOn(r) {
    var W = state.browseBase ? state.browseBase.w : (G.floors[state.browseFloor] || {}).width || 1791;
    var H = state.browseBase ? state.browseBase.h : (G.floors[state.browseFloor] || {}).height || 1920;
    var w = Math.max(r.w + 420, 560), h = Math.max(r.h + 420, 420);
    var x = r.x + r.w / 2 - w / 2, y = r.y + r.h / 2 - h / 2;
    if (w > W) { w = W; x = 0; } else { x = Math.min(Math.max(x, 0), W - w); }
    if (h > H) { h = H; y = 0; } else { y = Math.min(Math.max(y, 0), H - h); }
    state.browseView = { x: x, y: y, w: w, h: h };
  }

  function showRoomCard(roomId) {
    var f = G.floors[state.browseFloor];
    if (!f) return;
    var r = null;
    (f.rooms || []).forEach(function (x) { if (x.id === roomId) r = x; });
    if (!r) return;

    state.hlRoom = r.id;
    centerBrowseOn(r);
    renderBrowseMap();

    var lab = null;
    LABS.forEach(function (l) { if (l.room === r.id) lab = l; });

    var html = '<button class="rc-close" id="rcClose" type="button" aria-label="关闭">✕</button>' +
      '<div class="rc-head"><span class="rc-kind">' + esc(kindLabel(r.kind)) + '</span>' +
      '<span class="rc-id">' + esc(f.name) + ' · ' + esc(r.id) + ' 室</span></div>' +
      '<h3 class="rc-name">' + esc(r.name) + '</h3>' +
      '<div class="rc-grid">' +
        '<div><span>楼层</span><b>' + esc(f.name) + '</b></div>' +
        '<div><span>面积（按框估算）</span><b>' + roomArea(r) + ' ㎡</b></div>' +
      '</div>' +
      (r.desc ? '<p class="rc-desc">' + esc(r.desc) + '</p>' : '') +
      ((r.tags && r.tags.length) ? '<div class="rc-tags">' + r.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      (lab ? '<button class="rc-go" id="rcGo" type="button">从我的位置导航到这里 →</button>' : '');
    $('roomCard').innerHTML = html;
    $('roomCard').classList.remove('hidden');
    $('rcClose').onclick = function (e) { e.stopPropagation(); hideRoomCard(); };
    if (lab) $('rcGo').onclick = function (e) { e.stopPropagation(); hideRoomCard(); openLab(lab.id); };
  }

  function hideRoomCard() {
    $('roomCard').classList.add('hidden');
    if (state.hlRoom) { state.hlRoom = null; renderBrowseMap(); }
  }

  function populateKindFilter() {
    var sel = $('kindFilter');
    var f = G.floors[state.browseFloor];
    sel.innerHTML = '<option value="">全部分类</option>';
    if (f) {
      var counts = {}, order = [];
      (f.rooms || []).forEach(function (r) {
        var k = r.kind || 'room';
        if (!counts[k]) { counts[k] = 0; order.push(k); }
        counts[k]++;
      });
      order.sort(function (a, b) { return counts[b] - counts[a]; });
      order.forEach(function (k) {
        var o = document.createElement('option');
        o.value = k;
        o.textContent = kindLabel(k) + ' · ' + counts[k];
        sel.appendChild(o);
      });
    }
    sel.value = state.kindFilter;
    sel.onchange = function () {
      state.kindFilter = sel.value;
      renderBrowseMap();
      renderList();
    };
  }

  /* 搜索联动：输入房间号/名称时，平面图自动定位高亮 */
  function highlightByQuery(q) {
    var f = G.floors[state.browseFloor];
    if (!f) return;
    if (!q) {
      if (state.hlRoom) { state.hlRoom = null; renderBrowseMap(); }
      return;
    }
    var ql = q.toLowerCase();
    var hit = null;
    (f.rooms || []).forEach(function (r) {
      if (hit) return;
      if (String(r.id).toLowerCase() === ql || r.name.toLowerCase().indexOf(ql) > -1) hit = r;
    });
    if (hit) {
      showRoomCard(hit.id);
    } else if (state.hlRoom) {
      hideRoomCard();
    }
  }

  /* 导出房间台账 CSV（带 BOM，Excel 直接打开不乱码） */
  function exportCsv() {
    var f = G.floors[state.browseFloor];
    if (!f) return;
    var rows = [['房间号', '名称', '分类', '面积(㎡)', '楼层', 'X', 'Y', '宽', '高', '描述', '标签']];
    (f.rooms || []).forEach(function (r) {
      rows.push([
        r.id, r.name, kindLabel(r.kind), roomArea(r), f.name,
        r.x, r.y, r.w, r.h, r.desc || '', (r.tags || []).join('/')
      ]);
    });
    var csv = rows.map(function (row) {
      return row.map(function (c) {
        c = String(c == null ? '' : c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (D.site || 'rooms').replace(/\s+/g, '') + '-房间台账.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 800);
    toast('已导出 ' + (rows.length - 1) + ' 间房间台账');
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    $('labCount').textContent = LABS.length;
    renderChips();
    renderLocSelect();

    var params = new URLSearchParams(location.search);
    var locId = params.get('loc');
    var labId = params.get('lab');

    var hit = null;
    if (locId) LOCS.forEach(function (l) { if (l.id === locId) hit = l; });

    setLoc(hit, !!hit);
    renderLocSelect();

    if (labId) openLab(labId);

    // 搜索
    var q = $('q');
    q.addEventListener('input', function () {
      state.q = q.value.trim();
      $('qClear').classList.toggle('hidden', !state.q);
      renderList();
      highlightByQuery(state.q);
    });
    $('qClear').onclick = function () {
      q.value = ''; state.q = '';
      $('qClear').classList.add('hidden');
      renderList();
      highlightByQuery('');
    };

    // 定位胶囊 → 跳回定位选择
    $('locPill').onclick = function () {
      $('locPicker').classList.remove('hidden');
      $('locPicker').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('locSelect').focus();
    };

    // 返回
    $('backBtn').onclick = closeRoute;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeRoute(); hideRoomCard(); }
    });

    // 楼层平面图（数字地图）
    state.browseFloor = (D.floors && D.floors[0]) ? D.floors[0].id : null;
    if (/[?&]layer=map/.test(location.search)) state.browseLayer = 'map';
    populateKindFilter();
    renderBrowseMap();
    $('exportCsv').onclick = exportCsv;

    // 底图切换：原图 ⇄ 自动生成的数字地图
    if ($('layerToggle')) {
      if (state.browseLayer === 'map') { $('layerToggle').textContent = '原图'; $('layerToggle').classList.add('on'); }
      $('layerToggle').onclick = function () {
        state.browseLayer = (state.browseLayer === 'map') ? 'photo' : 'map';
        this.textContent = (state.browseLayer === 'map') ? '原图' : '数字地图';
        this.classList.toggle('on', state.browseLayer === 'map');
        renderBrowseMap();
      };
    }
    $('bZoomIn').onclick = function () { browseZoom(0.8); };
    $('bZoomOut').onclick = function () { browseZoom(1.25); };
    $('bZoomFit').onclick = function () {
      if (state.browseBase) { state.browseView = Object.assign({}, state.browseBase); applyBrowseView(); }
    };

    // 地图按钮
    $('zoomIn').onclick = function () { zoomBy(0.8); };
    $('zoomOut').onclick = function () { zoomBy(1.25); };
    $('zoomFit').onclick = function () {
      if (state.baseView) { state.view = Object.assign({}, state.baseView); applyView(); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
