'use strict';
var path=require('path'),fs=require('fs'),http=require('http'),url=require('url');
var chromium=require('playwright-core').chromium;
var CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
var root=path.join(__dirname,'..','..','nav3d');
var MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function serve(dir,port){return new Promise(function(res){var s=http.createServer(function(req,rq){var p=decodeURIComponent(url.parse(req.url).pathname);var f=path.join(dir,p==='/'?'/index.html':p);if(f.indexOf(dir)!==0||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rq.writeHead(404);rq.end('no');return;}rq.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});fs.createReadStream(f).pipe(rq);});s.listen(port,function(){res(s);});});}
(async function(){
  var srv=await serve(root,8096);
  var browser=await chromium.launch({executablePath:CHROME,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox','--disable-gpu-sandbox']});
  var page=await browser.newPage({viewport:{width:1400,height:900}});
  page.on('pageerror',function(e){console.log('PAGEERROR '+e.message);});
  await page.goto('http://127.0.0.1:8096/index.html?noauto=1&floor=B2-3',{waitUntil:'load',timeout:60000});
  await page.waitForTimeout(2500);
  var api=await page.evaluate(function(){
    var N=window.__NAV__||window.Nav||window.__NAV3D__||null;
    if(!N){ for(var k in window){ if(window[k]&&typeof window[k].planSummary==='function') { window.__FOUND__=k; N=window[k]; } } }
    return {found: window.__FOUND__||'', keys: N?Object.keys(N).slice(0,40):null};
  });
  console.log('API '+JSON.stringify(api));
  await browser.close(); srv.close();
})().catch(function(e){console.error('ERR '+e.message);process.exit(1);});
