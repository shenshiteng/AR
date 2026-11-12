'use strict';
var path=require('path'),fs=require('fs'),http=require('http'),url=require('url');
var chromium=require('playwright-core').chromium;
var CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
var root=path.join(__dirname,'..','..','nav3d');
var MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
function serve(dir,port){return new Promise(function(res){var s=http.createServer(function(req,rq){var p=decodeURIComponent(url.parse(req.url).pathname);var f=path.join(dir,p==='/'?'/index.html':p);if(f.indexOf(dir)!==0||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rq.writeHead(404);rq.end('no');return;}rq.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});fs.createReadStream(f).pipe(rq);});s.listen(port,function(){res(s);});});}
(async function(){
  var srv=await serve(root,8099);
  var browser=await chromium.launch({executablePath:CHROME,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox','--disable-gpu-sandbox']});
  var page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',function(e){console.log('PAGEERROR '+e.message);});
  await page.goto('http://127.0.0.1:8099/index.html?noauto=1&floor=B2-3',{waitUntil:'load',timeout:60000});
  await page.waitForTimeout(2200);
  var ok=await page.evaluate(function(){ return window.__NAV__.navigate('426','B2-4'); });
  await page.waitForTimeout(2200);
  var info=await page.evaluate(function(){
    var f=document.querySelector('#floors .fl.on');
    return { ok:true, cur:window.__NAV__.floor(), floorTab:f?f.textContent.trim():'',
             dest:document.getElementById('destName').textContent,
             steps:document.getElementById('steps').textContent.replace(/\s+/g,' ').slice(0,260) };
  });
  console.log(JSON.stringify(info,null,1));
  await page.screenshot({path:path.join(root,'_cross_3f_to_4f.png')});
  await browser.close(); srv.close();
})().catch(function(e){console.error('ERR '+e.message);process.exit(1);});

