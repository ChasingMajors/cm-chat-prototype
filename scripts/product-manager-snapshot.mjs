/** Local verification/export of derived metadata; NEVER writes to source systems.
 * node scripts/product-manager-snapshot.mjs --out /private/path.json [--d1-csv /path/export.csv]
 * D1 CSV is evidence from the fixed SELECT documented in PRODUCT-MANAGER.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function core(){const c=vm.createContext({console});vm.runInContext(await fs.readFile(path.join(root,'command-center/operator-backend/ProductManagerCore.gs'),'utf8'),c);return c;}
function csvRows(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(!quoted&&(ch===','||ch==='\n')){row.push(field.replace(/\r$/,''));field='';if(ch==='\n'){rows.push(row);row=[];}}else field+=ch;}if(field||row.length){row.push(field);rows.push(row);}const keys=rows.shift();return rows.filter(r=>r.length===keys.length).map(r=>Object.fromEntries(keys.map((k,i)=>[k,r[i]])));}
export async function readD1Csv(d1Csv) {
  const stat=await fs.stat(d1Csv), records=csvRows(await fs.readFile(d1Csv,'utf8'));
  if(records.some(e=>!Object.hasOwn(e,'raw_row_count')))throw Error('D1 CSV must distinguish card row_count from raw_row_count and metadata types.');
  return {ok:true,entries:records.map(e=>({...e,row_count:Number(e.row_count),raw_row_count:Number(e.raw_row_count),product_rows:Number(e.product_rows),other_rows:Number(e.other_rows)})),observed_at:stat.mtime.toISOString(),scope:'Card records only (type=card); product-summary and other row types excluded. Dashboard export; orphan groups not included in this local sample. Import scope equivalence to JSON remains unverified.'};
}
export async function collect({out,d1Csv}){
  const c=await core(), now=new Date().toISOString();let calls=0,bytes=0;
  async function json(url){calls++;const r=await fetch(url,{signal:AbortSignal.timeout(45000),cache:'no-store'});if(!r.ok){const e=Error('HTTP '+r.status);e.statusCode=r.status;throw e;}const text=await r.text();bytes+=Buffer.byteLength(text);try{return JSON.parse(text);}catch{throw Error('Invalid JSON');}}
  const s={schema:1,generated_at:now,cv_facts:{},prv_facts:{},d1:{ok:false,entries:[],error:'D1 read credential unavailable; database dashboard export not supplied.'}};
  if(d1Csv)s.d1=await readD1Csv(d1Csv);
  for(const [key,url]of [['cv','https://app.chasingmajors.com/data/v1/checklists/index.json'],['prv','https://app.chasingmajors.com/data/v2/vault/index.json']]){
    try{const p=await json(url);if(!Array.isArray(p.index))throw Error('Invalid index');s[key]={ok:true,entries:p.index,revision:p.generated_at||p.source_revision,observed_at:now};}catch(e){s[key]={ok:false,entries:[],error:e.message};}
  }
  const cvBase='https://app.chasingmajors.com/data/v1/checklists/products/',prvBase='https://app.chasingmajors.com/data/v2/vault/products/';
  const jobs=new Map();s.manifest_errors=[];
  for(const sport of new Set(s.cv.entries.map(e=>String(e.sport).toLowerCase()))){
    try{const m=await json(cvBase+encodeURIComponent(sport)+'.json');if(!m.product_map)throw Error('Missing product map');for(const e of s.cv.entries.filter(e=>String(e.sport).toLowerCase()===sport)){
      const key=c.pmKey_(e.sport,e.Code),file=m.product_map[e.Code];if(!file){s.cv_facts[key]={state:'missing',error:'CV index entry has no product-map location.'};continue;}
      if(typeof file!=='string'||file.includes('..')||file.startsWith('/')||!/^[\w./-]+\.json$/.test(file))throw Error('Invalid shard path');const url=cvBase+file.split('/').map(encodeURIComponent).join('/');if(!jobs.has(url))jobs.set(url,[]);jobs.get(url).push({e,key});
    }}catch(e){s.manifest_errors.push(sport+': '+e.message);}
  }
  const tasks=[...jobs].map(([url,items])=>async()=>{try{const p=await json(url);for(const {e,key}of items)s.cv_facts[key]=c.pmCvFact_((p.products||{})[e.Code],e.Code,url,new Date().toISOString());}catch(err){for(const {key}of items)s.cv_facts[key]={state:err.statusCode===404?'missing':'unavailable',error:err.message,url,observed_at:now};}});
  for(const e of s.prv.entries)tasks.push(async()=>{const key=c.pmKey_(e.sport,e.Code);try{if(typeof e.file!=='string'||!/^[\w.-]+\.json$/.test(e.file))throw Error('Invalid PRV file');const url=prvBase+encodeURIComponent(e.file);s.prv_facts[key]=c.pmPrvFact_(await json(url),e.Code,url,new Date().toISOString());}catch(err){s.prv_facts[key]={state:err.statusCode===404?'missing':'unavailable',error:err.message,observed_at:now};}});
  let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<tasks.length){const i=cursor++;await tasks[i]();if((i+1)%50===0)console.log(`Checked ${i+1}/${tasks.length} published files`);}}));
  s.progress={cv_files_remaining:0,prv_files_remaining:0,manifest_errors:s.manifest_errors};s.generated_at=new Date().toISOString();
  await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(s));
  const summary=c.PM_SPORTS.map(sport=>({sport,...c.pmPage_(s,{sport}).summary}));console.log(JSON.stringify({out,calls,download_bytes:bytes,cv_index:s.cv.entries.length,prv_index:s.prv.entries.length,d1_products:s.d1.entries.length,summary},null,2));return s;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const args=process.argv.slice(2);const arg=k=>args[args.indexOf(k)+1];if(!args.includes('--out'))throw Error('--out /private/path.json is required');await collect({out:arg('--out'),d1Csv:args.includes('--d1-csv')?arg('--d1-csv'):undefined});}
