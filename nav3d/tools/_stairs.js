'use strict';
var path=require('path'),fs=require('fs'),http=require('http'),url=require('url');
var chromium=require('playwright-core').chromium;
var CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
var root=path.join(__dirname,'..','..','nav3d');
var MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
function serve(dir,port){return new Promise(function(res){var s=http.createServer(function(req,rq){var p=decodeURIComponent(url.parse(req.url).pathname);var f=path.join(dir,p==='/'?'/index.html':p);if(f.indexOf(dir)!==0||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rq.writeHead(404);rq.end('no');return;}rq.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});fs.createReadStream(f).pipe(rq);});s.listen(port,function(){res(s);});});}
(async function(){
  var srv=await serve(root,8098);
  var browser=await chromium.launch({executablePath:CHROME,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox','--disable-gpu-sandbox']});
  var page=await browser.newPage({viewport:{width:1200,height:800}});
  page.on('pageerror',function(e){console.log('PAGEERROR '+e.message);});
  await page.goto('http://127.0.0.1:8098/index.html?noauto=1&floor=B2-3',{waitUntil:'load',timeout:60000});
  await page.waitForTimeout(2000);
  var r=await page.evaluate(function(){
    var out={};
    var reg=window.FLOOR_DATA_BY_ID||{};
    out.regKeys=Object.keys(reg);
    out.stairs={};
    ['B2-2','B2-3','B2-4','B2-5'].forEach(function(fid){
      var d = fid==='B2-3'? window.FLOOR_DATA : reg[fid];
      if(!d){ out.stairs[fid]='MISSING'; return; }
      out.stairs[fid]=d.rooms.filter(function(x){return x.kind==='stair';}).map(function(x){return x.id;});
    });
    out.f4meta = reg['B2-4'] ? {id:reg['B2-4'].id,name:reg['B2-4'].name,bounds:reg['B2-4'].bounds,ppm:reg['B2-4'].pxPerMeter} : null;
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await browser.close(); srv.close();
})().catch(function(e){console.error('ERR '+e.message);process.exit(1);});
