'use strict';
var path=require('path'),fs=require('fs'),http=require('http'),url=require('url');
var chromium=require('playwright-core').chromium;
var CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
var root=path.join(__dirname,'..','..','nav3d');
var MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function serve(dir,port){return new Promise(function(res){var s=http.createServer(function(req,rq){var p=decodeURIComponent(url.parse(req.url).pathname);var f=path.join(dir,p==='/'?'/index.html':p);if(f.indexOf(dir)!==0||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rq.writeHead(404);rq.end('no');return;}rq.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});fs.createReadStream(f).pipe(rq);});s.listen(port,function(){res(s);});});}
(async function(){
  var srv=await serve(root,8095);
  var browser=await chromium.launch({executablePath:CHROME,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox','--disable-gpu-sandbox']});
  var page=await browser.newPage({viewport:{width:1400,height:900}});
  await page.goto('http://127.0.0.1:8095/index.html?noauto=1&floor=B2-3',{waitUntil:'load',timeout:60000});
  await page.waitForTimeout(2500);
  // 点左栏里 4F 的 426 会议室
  var clicked=await page.evaluate(function(){
    var rows=document.querySelectorAll('#roomList .ri');
    for(var i=0;i<rows.length;i++){
      if(rows[i].dataset.fid==='B2-4' && rows[i].dataset.rid==='426'){ rows[i].click(); return 'clicked'; }
    }
    return 'not found';
  });
  await page.waitForTimeout(2500);
  var res=await page.evaluate(function(){
    var st=document.getElementById('steps');
    var curFl=null;
    var fs=document.querySelectorAll('#floors .fl.on');
    return {clicked:true, floorOn:fs[0]?fs[0].textContent.trim():'', steps:(st?st.textContent:'').replace(/\s+/g,' ').slice(0,300), dest:(document.getElementById('destName')||{}).textContent};
  });
  console.log('CLICK: '+clicked);
  console.log(JSON.stringify(res,null,1));
  await page.screenshot({path:path.join(root,'_cross_3f_to_4f.png')});
  await browser.close(); srv.close();
})().catch(function(e){console.error('ERR '+e.message);process.exit(1);});
