'use strict';
var path=require('path'),fs=require('fs'),http=require('http'),url=require('url');
var chromium=require('playwright-core').chromium;
var CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
var root=path.join(__dirname,'..','..','nav3d');
var MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function serve(dir,port){return new Promise(function(res){var s=http.createServer(function(req,rq){var p=decodeURIComponent(url.parse(req.url).pathname);var f=path.join(dir,p==='/'?'/index.html':p);if(f.indexOf(dir)!==0||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rq.writeHead(404);rq.end('no');return;}rq.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});fs.createReadStream(f).pipe(rq);});s.listen(port,function(){res(s);});});}
(async function(){
  var srv=await serve(root,8093);
  var browser=await chromium.launch({executablePath:CHROME,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox','--disable-gpu-sandbox']});
  var page=await browser.newPage({viewport:{width:1600,height:1000}});
  var errs=[]; page.on('console',function(m){ if(m.type()==='error') errs.push(m.text()); }); page.on('pageerror',function(e){errs.push('PAGEERROR '+e.message);});
  await page.goto('http://127.0.0.1:8093/index.html?noauto=1&selftest=1&floor=B2-4',{waitUntil:'load',timeout:60000});
  await page.waitForTimeout(4000);
  var info=await page.evaluate(function(){
    var api=window.__NAV3D__||window.Nav||null;
    var out={};
    out.floorBtns=[].map.call(document.querySelectorAll('#floors .fl'),function(e){return e.textContent.trim()+'|'+e.dataset.fid;});
    var heads=[].map.call(document.querySelectorAll('#roomList .rg'),function(e){return e.textContent.trim();});
    out.groupHeads=heads;
    out.roomRows=document.querySelectorAll('#roomList .ri').length;
    out.bad=document.body.getAttribute('data-bad');
    out.dataset=getComputedStyle(document.body).getPropertyValue('--x');
    return out;
  });
  console.log(JSON.stringify(info,null,1));
  console.log('CONSOLE_ERRORS: '+JSON.stringify(errs.slice(0,8)));
  await page.screenshot({path:path.join(root,'_4f_check.png')});
  await browser.close(); srv.close();
})().catch(function(e){console.error('ERR '+e.message);process.exit(1);});
