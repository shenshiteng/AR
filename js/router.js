/* 寻路核心：把「数据」变成「路线 + 文字指引」 */
(function (global) {
  'use strict';

  /* 建立图：所有楼层的节点合成一张图，楼梯/电梯/室外道路就是跨层的边 */
  function buildGraph(data) {
    var nodes = {};       // id -> 节点
    var adj = {};         // id -> [{to, m}]
    var floors = {};      // id -> 楼层
    var scale = data.metersPerPixel || 0.05;

    (data.floors || []).forEach(function (f) {
      floors[f.id] = f;
      (f.nodes || []).forEach(function (n) {
        nodes[n.id] = { id: n.id, floor: f.id, x: n.x, y: n.y, note: n.note || '' };
        adj[n.id] = adj[n.id] || [];
      });
    });

    function dist(a, b) {
      var dx = nodes[a].x - nodes[b].x;
      var dy = nodes[a].y - nodes[b].y;
      return Math.sqrt(dx * dx + dy * dy) * scale;
    }

    function link(a, b, meters) {
      if (a === b || !nodes[a] || !nodes[b]) return;
      var m = (meters === null || meters === undefined) ? dist(a, b) : meters;
      adj[a].push({ to: b, m: m });
      adj[b].push({ to: a, m: m });
    }

    (data.floors || []).forEach(function (f) {
      (f.edges || []).forEach(function (e) {
        var a = e[0].indexOf('/') > -1 ? e[0] : f.id + '/' + e[0];
        var b = e[1].indexOf('/') > -1 ? e[1] : f.id + '/' + e[1];
        link(a, b, e[2]);
      });
    });

    (data.links || []).forEach(function (l) {
      link(l.from, l.to, l.meters === undefined ? 12 : l.meters);
    });

    return { nodes: nodes, adj: adj, floors: floors, scale: scale, data: data };
  }

  /* 最近节点（数据里没写 door 时兜底） */
  function nearestNode(graph, floorId, x, y) {
    var best = null, bestD = Infinity;
    Object.keys(graph.nodes).forEach(function (id) {
      var n = graph.nodes[id];
      if (n.floor !== floorId) return;
      var d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }

  /* Dijkstra：点少，直接用简单实现 */
  function shortestPath(graph, start, goal) {
    if (!graph.nodes[start] || !graph.nodes[goal]) return null;
    var dist = {}, prev = {}, prevW = {}, visited = {}, queue = [start];
    Object.keys(graph.nodes).forEach(function (id) { dist[id] = Infinity; });
    dist[start] = 0;

    while (queue.length) {
      queue.sort(function (a, b) { return dist[a] - dist[b]; });
      var u = queue.shift();
      if (visited[u]) continue;
      visited[u] = true;
      if (u === goal) break;
      (graph.adj[u] || []).forEach(function (e) {
        var nd = dist[u] + e.m;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = u;
          prevW[e.to] = e.m;
          if (!visited[e.to]) queue.push(e.to);
        }
      });
    }
    if (dist[goal] === Infinity) return null;

    var path = [goal], weights = [], cur = goal;
    while (cur !== start) {
      weights.unshift(prevW[cur]);
      cur = prev[cur];
      path.unshift(cur);
    }
    return { nodes: path, weights: weights, meters: dist[goal] };
  }

  function floorName(graph, floorId) {
    var f = graph.floors[floorId];
    if (!f) return floorId;
    var b = null;
    (graph.data.buildings || []).forEach(function (x) { if (x.id === f.building) b = x; });
    return (b ? b.name : f.building) + ' ' + f.name;
  }

  function roundM(m) { return Math.max(1, Math.round(m)); }

  /* 找到两段楼层之间用的通道（楼梯/电梯/室外），用于提示文字 */
  function findLink(graph, a, b) {
    var links = graph.data.links || [];
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if ((l.from === a && l.to === b) || (l.from === b && l.to === a)) return l;
    }
    return null;
  }

  /* 楼栋名，如 A栋 */
  function buildingName(graph, floorId) {
    var f = graph.floors[floorId];
    if (!f) return '';
    var name = f.building || '';
    (graph.data.buildings || []).forEach(function (b) { if (b.id === f.building) name = b.name; });
    return name;
  }

  /* 楼层高低：按楼层在数据里的顺序判断上下，避免「上楼」写成「下楼」 */
  function levelOf(graph, floorId) {
    var f = graph.floors[floorId];
    if (!f) return 0;
    var list = (graph.data.floors || []).filter(function (x) { return x.building === f.building; });
    for (var i = 0; i < list.length; i++) if (list[i].id === floorId) return i;
    return 0;
  }

  /* 换层提示文字：方向按实际走的楼层算，室外通道按楼栋名拼 */
  function switchText(graph, fromFloor, toFloor) {
    var links = graph.data.links || [];
    var lk = null;
    links.forEach(function (l) {
      var lf = (graph.nodes[l.from] || {}).floor;
      var lt = (graph.nodes[l.to] || {}).floor;
      if ((lf === fromFloor && lt === toFloor) || (lf === toFloor && lt === fromFloor)) lk = l;
    });

    if (lk && lk.type === 'outdoor') {
      return '走出 ' + buildingName(graph, fromFloor) + ' 大门，沿室外道路步行到 ' +
        buildingName(graph, toFloor) + ' 大门';
    }
    if (lk && lk.type === 'stair') {
      var up = levelOf(graph, toFloor) > levelOf(graph, fromFloor);
      return '走楼梯或乘电梯' + (up ? '上' : '下') + '到 ' + floorName(graph, toFloor);
    }
    if (lk && lk.text) return lk.text;
    return '前往 ' + floorName(graph, toFloor);
  }

  /* 主函数：从 startNode 走到 lab，返回 {meters, steps, nodes} */
  function routeToLab(graph, startNodeId, lab, loc) {
    var targetNode = lab.door;
    if (!targetNode) {
      var f = graph.floors[lab.floor];
      var room = null;
      (f.rooms || []).forEach(function (r) { if (r.id === lab.room) room = r; });
      if (room) targetNode = nearestNode(graph, lab.floor, room.x + room.w / 2, room.y + room.h / 2);
    }
    if (!targetNode) return null;

    var p = shortestPath(graph, startNodeId, targetNode);
    if (!p) return null;

    var nodes = graph.nodes, path = p.nodes, weights = p.weights;
    var steps = [];
    var i = 0;

    while (i < path.length) {
      var floor = nodes[path[i]].floor;
      var segNodes = [path[i]];
      var m = 0;
      var j = i;
      while (j + 1 < path.length && nodes[path[j + 1]].floor === floor) {
        m += weights[j];
        segNodes.push(path[j + 1]);
        j++;
      }
      if (segNodes.length > 1) {
        steps.push({ kind: 'walk', floor: floor, nodes: segNodes, meters: m });
      }
      if (j + 1 < path.length) {
        var nextFloor = nodes[path[j + 1]].floor;
        steps.push({
          kind: 'switch',
          floor: nextFloor,
          fromFloor: floor,
          toFloor: nextFloor,
          text: switchText(graph, floor, nextFloor)
        });
        i = j + 1;
      } else {
        i = path.length;
      }
    }

    /* 给每一步配上人话 */
    steps.forEach(function (s, idx) {
      if (s.kind !== 'walk') return;
      var startN = nodes[s.nodes[0]];
      var endN = nodes[s.nodes[s.nodes.length - 1]];
      var isLast = idx === steps.length - 1;
      var fromNote = s.nodes.length === 1 ? (loc ? loc.place : startN.note) : (startN.note || '当前位置');
      if (idx === 0 && fromNote === (startN.note || '')) fromNote = startN.note || '当前位置';
      s.fromLabel = idx === 0 ? (loc ? loc.place : fromNote) : fromNote;
      s.toLabel = isLast ? (lab.name + ' 门口') : (endN.note || '下一个路口');
      s.text = '在 ' + floorName(graph, s.floor) + '，从「' + s.fromLabel + '」走约 ' +
        roundM(s.meters) + ' 米到「' + s.toLabel + '」';
    });

    return {
      nodes: path,
      meters: p.meters,
      minutes: Math.max(1, Math.round(p.meters / 60)),
      steps: steps,
      targetFloor: lab.floor,
      targetNode: targetNode
    };
  }

  global.LabRouter = {
    buildGraph: buildGraph,
    shortestPath: shortestPath,
    routeToLab: routeToLab,
    nearestNode: nearestNode,
    floorName: floorName,
    buildingName: buildingName,
    switchText: switchText,
    roundM: roundM
  };
})(window);
