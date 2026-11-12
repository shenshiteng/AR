/* =========================================================================
   floor-import.js —— 识别结果 → 可导航数据（适配层）
   -------------------------------------------------------------------------
   把 floor-detect.js 的原始输出（房间框 + 路点 + 连线）转成 data/labs.js 里
   现成的两种结构：

     floors[i] = { id, building, name, image, width, height, nodes[], edges[], rooms[] }
     labs[j]   = { id, name, floor, room, door, tags[] }

   原来的流程是「识别 → 手工改房间号 → 手工把每间房的门挂到走廊节点 →
   粘 JSON」，最后一步靠人眼，最容易错（之前就挂错过一整排，路线停在墙外）。
   这里把「挂门」自动化：每个房间找最近的**走廊上**的节点当门。

   用法：
     var built = FloorImport.build(res, {
       floorId: 'B2-4', building: 'B2', name: '4层',
       image: 'assets/floors/B2-4F.jpg', scale: 0.045,
       roomNumbers: '401,402,403'      // 可空，空则用 R1..Rn 占位
     });
     // built.floor → 粘到 LAB_DATA.floors
     // built.labs  → 粘到 LAB_DATA.labs
     // built.warnings → 需要人工复核的地方
   ========================================================================= */
window.FloorImport = (function () {
  'use strict';

  var VERSION = '1.0';

  function round(v) { return Math.round(v); }

  /* ---------- 几何 ---------- */

  /* 点到矩形的距离（点在矩形内 = 0） */
  function distToRect(px, py, r) {
    var dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    var dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.sqrt(dx * dx + dy * dy);
  }

  function insideRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  /* 房间排序：先按行（y 分带），行内按 x。和人看图习惯一致，方便按顺序填门牌 */
  function sortRooms(rooms) {
    if (!rooms.length) return [];
    var minY = Infinity, maxY = -Infinity, i;
    for (i = 0; i < rooms.length; i++) {
      minY = Math.min(minY, rooms[i].y);
      maxY = Math.max(maxY, rooms[i].y + rooms[i].h);
    }
    var bandH = Math.max(20, (maxY - minY) * 0.045);   // 行高容差
    return rooms.slice().sort(function (a, b) {
      var ra = Math.round((a.y + a.h / 2) / bandH);
      var rb = Math.round((b.y + b.h / 2) / bandH);
      if (ra !== rb) return ra - rb;
      return a.x - b.x;
    });
  }

  /* 这个点是不是落在某个房间框里（房间内撒的路点不能当门） */
  function insideAnyRoom(px, py, rooms, skipIdx) {
    for (var i = 0; i < rooms.length; i++) {
      if (i === skipIdx) continue;
      if (insideRect(px, py, rooms[i])) return true;
    }
    return false;
  }

  /* 给一个房间找门。
     strict = true 时只在「不在任何房间框内」的点里找（也就是走廊上的点）；
     框本身不准（把走廊也框进去了）时不能这么筛，否则一个点都找不到，退化成
     「离房间最近的点」——那种情况下路线会从房间中间穿过去，所以要给 warning。 */
  function findDoor(nodes, rooms, room, roomIdx, strict) {
    var i, n, d;

    if (strict) {
      var best = null, bestD = Infinity;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (insideAnyRoom(n.x, n.y, rooms, roomIdx)) continue;
        d = distToRect(n.x, n.y, room);
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best) return { node: best, dist: bestD, fallback: false };
    }

    // 降级：不区分房间内外的最近点
    var any = null, anyD = Infinity;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      d = distToRect(n.x, n.y, room);
      if (d < anyD) { anyD = d; any = n; }
    }
    return any ? { node: any, dist: anyD, fallback: true } : null;
  }

  /* ---------- 主转换 ---------- */

  /**
   * res: floor-detect.analyze() 的返回值
   * opt: { floorId, building, name, image, scale, roomNumbers, defaultKind }
   */
  function toFloor(res, opt) {
    opt = opt || {};
    var floorId = opt.floorId || 'X-1';
    var roomNumbers = parseList(opt.roomNumbers);
    var warnings = [];

    var srcRooms = res.rooms || [];
    var ordered = sortRooms(srcRooms);

    // 节点：保持 analyze 的顺序，id 重新编号
    var nodes = (res.nodes || []).map(function (n, i) {
      return {
        id: floorId + '/n' + (i + 1),
        x: round(n.x),
        y: round(n.y),
        note: ''
      };
    });

    var edges = (res.edges || []).map(function (e) {
      var a = nodes[e[0]], b = nodes[e[1]];
      return (a && b) ? [a.id, b.id] : null;
    }).filter(function (e) { return e; });

    // 房间：按阅读顺序编号，尽量把 roomNumbers 按顺序塞进去
    var rooms = ordered.map(function (r, i) {
      var num = roomNumbers[i] || '';
      return {
        id: num || ('R' + (i + 1)),
        name: num ? (num + ' 室') : '待命名',
        x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h),
        kind: opt.defaultKind || 'lab'
      };
    });

    var floor = {
      id: floorId,
      building: opt.building || 'A',
      name: opt.name || '1层',
      image: opt.image || '',
      width: round(opt.width || 0),
      height: round(opt.height || 0),
      nodes: nodes,
      edges: edges,
      rooms: rooms
    };

    /* ---- 体检：把可能有问题的地方挑出来，别让人蒙在鼓里 ---- */
    if (res.stats && res.stats.islands) {
      warnings.push('有 ' + res.stats.islands + ' 个路点没连上主路网（多半是那几个房间在图上没画门），' +
        '这些地方算不出路线，需要在标点工具里补一条连线');
    }
    if (!rooms.length) warnings.push('没有识别到房间框：把「房间封口」调大一点再识别，或者手工补框');
    if (!nodes.length) warnings.push('没有识别到路点：图纸可能太糊，或墙线没切出来');
    if (roomNumbers.length && roomNumbers.length !== rooms.length) {
      warnings.push('你给了 ' + roomNumbers.length + ' 个房间号，但识别到 ' + rooms.length +
        ' 个框，多出来的框用 R 编号占位');
    }

    return { floor: floor, warnings: warnings, orderedRooms: ordered };
  }

  /**
   * 生成 labs 条目：每个房间挂到最近的走廊节点
   * floor 是 toFloor 的产物，orderedRooms 用于和房间框对齐（判断"点在房间内"）
   */
  function toLabs(floor, orderedRooms, opt) {
    opt = opt || {};
    var warnings = [];
    var labs = [];

    // 判断"点在房间内"用识别出来的原始框（比补过边的 rooms 更贴近走廊）
    var boxes = (orderedRooms && orderedRooms.length) ? orderedRooms : floor.rooms;
    var shortSide = Math.min(floor.width, floor.height) || 1000;
    var maxDoorDist = opt.maxDoorDist || shortSide * 0.16;   // 超过这个距离就认为没挂上

    /* 房间框可不可信：所有框面积加起来超过整图 55%，说明框把走廊也包进去了
       （照片拍的疏散图经常这样），这时不能再拿"是否在框内"来筛走廊点 */
    var areaSum = 0;
    boxes.forEach(function (r) { areaSum += r.w * r.h; });
    var imgArea = (floor.width || 1) * (floor.height || 1);
    var strict = areaSum < imgArea * 0.55;
    if (!strict) {
      warnings.push('识别出的房间框偏大（合计占了整图 ' + Math.round(areaSum / imgArea * 100) +
        '%），挂门只能按"最近的路点"来定，个别房间的入口可能不准，建议在标点工具里核一遍');
    }

    floor.rooms.forEach(function (r, idx) {
      var hit = findDoor(floor.nodes, boxes, r, idx, strict);
      if (!hit || !hit.node) {
        warnings.push('「' + r.name + '」附近没有路点，挂不上门，需要手工在标点工具里加一个走廊节点');
        return;
      }
      if (hit.dist > maxDoorDist) {
        warnings.push('「' + r.name + '」离最近的走廊路点约 ' + Math.round(hit.dist) +
          ' 像素，偏得有点远，现场可能要校一下门的位置');
      }
      if (hit.fallback && strict) {
        warnings.push('「' + r.name + '」附近没找到走廊上的路点，门只能挂在最近的房间里那个点上，' +
          '这条路线可能会穿墙，需要在标点工具里补一个门口节点');
      }

      var roomNo = r.id;
      labs.push({
        id: 'L-' + roomNo,
        name: r.name,
        floor: floor.id,
        room: roomNo,
        door: hit.node.id,
        tags: []
      });
    });

    return { labs: labs, warnings: warnings };
  }

  /** 一步到位：识别结果 → floors + labs */
  function build(res, opt) {
    opt = opt || {};
    var f = toFloor(res, opt);
    var l = toLabs(f.floor, f.orderedRooms, opt);
    return {
      floor: f.floor,
      labs: l.labs,
      warnings: f.warnings.concat(l.warnings),
      stats: res.stats || {}
    };
  }

  function parseList(s) {
    if (!s) return [];
    if (Object.prototype.toString.call(s) === '[object Array]') return s.filter(Boolean);
    return String(s).split(/[,，、\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* ---------- 合并进现有数据（运行时预览用，不落盘） ---------- */

  /**
   * 把 built 合并进 LAB_DATA：同 id 的楼层替换，labs 追加
   * 注意：只改内存里的对象，刷新就没了；要持久化还是得粘进 data/labs.js
   */
  function mergeInto(data, built, opt) {
    opt = opt || {};
    if (!data || !built || !built.floor) return data;
    var i;
    var replaced = false;
    for (i = 0; i < (data.floors || []).length; i++) {
      if (data.floors[i].id === built.floor.id) { data.floors[i] = built.floor; replaced = true; break; }
    }
    if (!replaced) data.floors = (data.floors || []).concat([built.floor]);

    // 同一楼层旧 labs 先清掉，避免重复
    data.labs = (data.labs || []).filter(function (l) { return l.floor !== built.floor.id; });
    data.labs = data.labs.concat(built.labs || []);

    return data;
  }

  return {
    version: VERSION,
    toFloor: toFloor,
    toLabs: toLabs,
    build: build,
    mergeInto: mergeInto,
    sortRooms: sortRooms,
    findDoor: findDoor
  };
})();
