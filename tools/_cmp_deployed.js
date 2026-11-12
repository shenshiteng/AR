/* 对比线上托管版 与 本地 fp-ar.html 的功能差异（哪些 id/函数只在一边存在） */
const https = require('https');

const LOCAL = 'C:/Users/35391/Desktop/python/实验室定位/fp-ar.html';
const URL = 'https://lab-ar-nav.app.workbuddy.host/fp-ar.html?sharecode=COAQ2BOKWL';

function get(u) {
  return new Promise((res, rej) => {
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/156.0' } }, r => {
      let b = '';
      r.on('data', d => b += d);
      r.on('end', () => res(b));
    }).on('error', rej);
  });
}

(async () => {
  const fs = require('fs');
  const local = fs.readFileSync(LOCAL, 'utf8');
  const dep = await get(URL);
  const marks = ['btnScan', 'ARUCO_ENABLED', 'arSim', 'arTrack', 'fixMinus', 'ar-bridge.js', 'fp-input.js',
    'stairSel', 'btnCompass', 'startScan', 'syncToFp', 'renderSim', 'destList', 'B2-5F_grid'];
  const rows = marks.map(m => m + '\tlocal=' + local.includes(m) + '\tdep=' + dep.includes(m));
  console.log(rows.join('\n'));
  console.log('local bytes=' + Buffer.byteLength(local) + '  deployed bytes=' + Buffer.byteLength(dep));
  // 线上引用的脚本版本号
  const vs = s => (s.match(/\.js\?v=\d+/g) || []).join(' ');
  console.log('local js versions: ' + vs(local));
  console.log('dep   js versions: ' + vs(dep));
})().catch(e => { console.error('FAILED', e && e.message); process.exit(1); });
