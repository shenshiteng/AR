'use strict';
var path=require('path'),fs=require('fs'),http=require('http'),url=require('url');
var chromium=require('playwright-core').chromium;
var CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
var root=path.join(__dirname,'..','..');
var MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.pdf':'application/pdf','.woff2':'font/woff2','.woff':'font/woff'};
function serve(dir,port){return new Promise(function(res){var s=http.createServer(function(req,rq){var p=decodeURIComponent(url.parse(req.url).pathname);var f=path.join(dir,p==='/'?'/index.html':p);if(f.indexOf(dir)!==0||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rq.writeHead(404);rq.end('no');return;}rq.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});fs.createReadStream(f).pipe(rq);});s.listen(port,function(){res(s);});});}
(async function(){
  var srv=await serve(root,8101);
  var browser=await chromium.launch({executablePath:CHROME,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox','--disable-gpu-sandbox']});
  var targets=[
    ['nav3d/index.html?noauto=1','nav3d-page'],
    ['fp2.html','fp2'],
    ['fp-ar.html?loc=P-B2-01','fpar'],
    ['index.html?map=1','map'],
    ['qr_final/print.html','qrprint']
  ];
  for (var t of targets){
    var page=await browser.newPage({viewport:{width:1200,height:800}});
    var errs=[];
    page.on('pageerror',function(e){errs.push(e.message);});
    try{
      await page.goto('http://127.0.0.1:8101/'+t[0],{waitUntil:'load',timeout:45000});
      await page.waitForTimeout(2500);
      var info=await page.evaluate(function(){
        return {title:document.title, bodyLen:document.body.innerText.length,
                canvases:document.querySelectorAll('canvas').length,
                err:(document.getElementById('err')||{}).textContent||''};
      });
      console.log(t[1]+' OK  title='+JSON.stringify(info.title)+' text='+info.bodyLen+' canvas='+info.canvases+' err='+JSON.stringify(info.err.slice(0,80))+' pageerr='+errs.length);
    }catch(e){ console.log(t[1]+' FAIL '+e.message); }
    await page.close();
  }
  await browser.close(); srv.close();
})().catch(function(e){console.error('ERR '+e.message);process.exit(1);});
