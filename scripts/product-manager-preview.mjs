/** Loopback-only preview against a real, private derived inventory.
 * Never forwards admin keys or requests to production.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {core} from './product-manager-snapshot.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), arg=k=>args[args.indexOf(k)+1];
if(!args.includes('--snapshot'))throw Error('--snapshot /private/path.json required');
const snapshot=JSON.parse(await fs.readFile(arg('--snapshot'),'utf8')), c=await core();
const port=Number(process.env.PM_PREVIEW_PORT||8797), key=process.env.PM_PREVIEW_KEY||'local-review-only';
const endpoint='/api/product-manager';
const allowed=new Map([['/command-center/product-manager/','index.html'],['/command-center/product-manager/product-manager.css','product-manager.css'],['/command-center/product-manager/product-manager.js','product-manager.js']]);
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  try{
    if(req.method==='POST'&&url.pathname===endpoint){
      if(req.headers.origin && req.headers.origin!=='http://127.0.0.1:'+port)throw Error('Origin not allowed');
      let body='';for await(const b of req){body+=b;if(body.length>4096)throw Error('Request too large');}const data=JSON.parse(body);
      const a=Buffer.from(String(data.key||'')),b=Buffer.from(key);if(a.length!==b.length||!timingSafeEqual(a,b)){res.writeHead(403);res.end(JSON.stringify({ok:false,error:'Invalid operator key.'}));return;}
      let result;if(data.action==='productManagerList')result=c.pmPage_(snapshot,data);else if(data.action==='productManagerDetail'){c.pmInput_(data);const product=c.pmInventory_(snapshot).find(r=>r.id===data.id);result=product?{ok:true,generated_at:snapshot.generated_at,product,sources:{cv:{url:'https://app.chasingmajors.com/data/v1/checklists/index.json',observed_at:snapshot.cv.observed_at,revision:snapshot.cv.revision},d1:{observed_at:snapshot.d1.observed_at,scope:snapshot.d1.scope,url:'https://dash.cloudflare.com/83cd48829e92ac6e4e15a25cb60cdf80/workers/d1/databases/9f264f1a-5a3b-4db5-b223-2c4c33af2c0f/metrics'},prv:{url:'https://app.chasingmajors.com/data/v2/vault/index.json',revision:snapshot.prv.revision}},validation:'Availability and structural checks only. Completeness is not certified.',freshness:'Local preview of real published files and the dashboard D1 export. Source authoring/import times are unknown.'}:{ok:false,error:'Product not found'};}else throw Error('Action not allowed');
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(req.method!=='GET')throw Error('Method not allowed');
    if(url.pathname==='/'||url.pathname==='/command-center/'){res.writeHead(302,{Location:'/command-center/product-manager/'});res.end();return;}
    const file=allowed.get(url.pathname);if(!file){res.writeHead(404);res.end('Not found');return;}
    let content=await fs.readFile(path.join(root,'command-center/product-manager',file),'utf8');
    if(file==='index.html')content=content.replace('Use your existing Sentinel admin key to view the inventory.',process.env.PM_PREVIEW_KEY?'Local preview: use the preview key configured for this server. The live site uses your Sentinel admin key.':'Local preview admin key: local-review-only. The live site uses your normal Sentinel admin key.');
    if(file.endsWith('.js'))content=content.replace(/const ENDPOINT='[^']+';/,`const ENDPOINT='${endpoint}';`);
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(content);
  }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log('Local preview http://127.0.0.1:'+port+'/command-center/product-manager/ (key: local-review-only, unless PM_PREVIEW_KEY overrides it)'));
