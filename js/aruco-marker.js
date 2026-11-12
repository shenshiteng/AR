/* ArUco 标记生成（用项目内置的 js-aruco2 字典，和识别端完全一致） */
window.ArucoMark = (function () {
  'use strict';
  var dict = null;

  function getDict() {
    if (dict) return dict;
    if (typeof AR === 'undefined') throw new Error('ArUco 库没加载');
    dict = new AR.Dictionary('ARUCO');
    return dict;
  }

  function bits(id) { return getDict().codeList[id]; }
  function maxId() { return getDict().codeList.length - 1; }

  /* 7x7 格：外圈黑边框 + 5x5 数据位，外面留 quiet 格白边 */
  function svg(id, opt) {
    opt = opt || {};
    var quiet = (opt.quiet === undefined) ? 1 : opt.quiet;
    var code = bits(id);
    if (!code) throw new Error('标记号 ' + id + ' 超出范围（0~' + maxId() + '）');
    var n = 7 + quiet * 2, s = [], x, y;

    s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">');
    s.push('<rect x="0" y="0" width="' + n + '" height="' + n + '" fill="#ffffff"/>');
    s.push('<rect x="' + quiet + '" y="' + quiet + '" width="7" height="7" fill="#000000"/>');
    for (y = 0; y < 5; y++) {
      for (x = 0; x < 5; x++) {
        if (code[y * 5 + x] === '1') {
          s.push('<rect x="' + (quiet + 1 + x) + '" y="' + (quiet + 1 + y) + '" width="1" height="1" fill="#ffffff"/>');
        }
      }
    }
    s.push('</svg>');
    return s.join('');
  }

  return { svg: svg, bits: bits, maxId: maxId };
})();
