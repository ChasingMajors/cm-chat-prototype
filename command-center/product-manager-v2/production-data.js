(function(root) {
  'use strict';
  const LIVE='https://app.chasingmajors.com';
  const CV='/data/v1/checklists/products/';
  const PRV='/data/v2/vault/products/';
  const VAULT='/data/v1/vault/products/';
  const RAW='https://raw.githubusercontent.com/ChasingMajors/chasing-majors-app/';
  const API='https://api.github.com/repos/ChasingMajors/chasing-majors-app/contents/data/prv-calculations';
  const sportKey=value=>String(value??'').trim().toLowerCase();
  const owned=(o,key)=>o&&Object.hasOwn(o,key)?o[key]:undefined;
  const refCode=ref=>ref.Code||ref.code;
  function file(name) {
    if(typeof name!=='string'||!/^[A-Za-z0-9_-]+\.json$/.test(name))throw Error('A source file name is invalid.');
    return name;
  }
  function exact(entries,code,sport) {
    return entries.filter(entry=>refCode(entry)===code&&sportKey(entry.sport)===sport);
  }
  function assertRevision(document,revision) {
    if(document.release_sha&&document.release_sha!==revision)throw Error('Production is deploying a new release. Reload the product in a moment.');
  }
  async function load(product,kind,{signal,fetcher=fetch}={}) {
    if(!['cv','prv'].includes(kind))throw Error('Invalid data collection.');
    const refs=product.refs[kind==='cv'?'json':'prv'];
    if(refs.length!==1)throw Error(refs.length?'Source identity is ambiguous.':'No '+kind.toUpperCase()+' source is indexed for this product.');
    const ref=refs[0],code=refCode(ref),sport=sportKey(ref.sport);
    if(!code||!sport)throw Error('The product source is missing its identifier.');
    async function get(url) {
      const response=await fetcher(url,{signal,cache:'no-cache',credentials:'omit'});
      if(!response.ok)throw Error('Production data could not be read (HTTP '+response.status+').');
      return response.json();
    }
    const live=path=>get(LIVE+path);
    const release=await live('/data/publish-release.json');
    const revision=release.release_sha;
    if(!/^[a-f0-9]{40}$/.test(revision??''))throw Error('The production release revision is unavailable.');
    const validate=(data, expected=code)=>{
      if(data?.meta?.code!==expected||sportKey(data.meta.sport)!==sport||!Array.isArray(data.rows))
        throw Error('The returned records do not match the selected product.');
      return data;
    };
    let tables,source,note='';
    if(kind==='cv'){
      const [index,manifest]=await Promise.all([live('/data/v1/checklists/index.json'),live(CV+file(sport+'.json'))]);
      assertRevision(index,revision);
      if(exact(index.index,code,sport).length!==1){
        throw Error('The indexed checklist changed. Reload the inventory and open the product again.');
      }
      const name=owned(manifest.product_map,code),shard=name?await live(CV+file(name)):manifest;
      const p=validate(owned(shard.products,code));
      tables=[{name:'Checklist',rows:p.rows,defaults:{code,sport:p.meta.sport},fields:['player','team','card_no','section','subset','tag']},
        {name:'Parallels',rows:p.parallels||[],defaults:{code},fields:['parallel_name','serial_no','applies_to_section','applies_to_subset']},
        {name:'Product metadata',rows:[p.meta],singleton:true}];
      source='Live production Checklist Vault JSON';
    }else{
      const index=await live('/data/v2/vault/index.json');
      assertRevision(index,revision);
      const matches=exact(index.index,code,sport);
      if(matches.length!==1)throw Error('The indexed Vault source changed. Reload the inventory and open the product again.');
      const p=validate(await live(PRV+file(matches[0].file)));
      tables=[{name:'Vault records',rows:p.rows,defaults:{product_id:code},fields:['set_name','category','section','measurement','serial_limit','checklist_size','notes','source','calculation']},
        {name:'Product metadata',rows:[p.meta],singleton:true}];
      source='Live production Print Run Vault JSON';
      const rawCodes=[...new Set(p.rows.map(row=>row.raw?.code).filter(Boolean))];
      try {
        if(p.calculation_provenance){
          const files=(await get(API+'?ref='+revision)).filter(entry=>entry.type==='file'&&/^[A-Za-z0-9_-]+\.json$/.test(entry.name));
          const candidates=await Promise.all(files.map(entry=>get(RAW+revision+'/data/prv-calculations/'+file(entry.name))));
          const match=candidates.filter(item=>(item.code===code||rawCodes.includes(item.code))&&sportKey(item.meta?.sport)===sport);
          if(match.length!==1)throw Error('A unique calculation input was not found.');
          const input=match[0];
          for(const [field,rows] of Object.entries(input)){
            if(Array.isArray(rows)&&rows.length&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row))){
              tables.push({name:'Input · '+field.replaceAll('_',' '),rows,inputField:field});
            }
          }
          const settings=Object.fromEntries(Object.entries(input).filter(([field])=>!tables.some(table=>table.inputField===field)));
          tables.push({name:'Calculation settings',rows:[settings],singleton:true});
        } else if(rawCodes.length<=1) {
          const rawCode=rawCodes[0]||code;
          const rawIndex=await live('/data/v1/vault/index.json');
          assertRevision(rawIndex,revision);
          if(exact(rawIndex.index,rawCode,sport).length!==1)throw Error('A unique source export was not found.');
          const manifest=await live(VAULT+'all.json');
          const name=owned(manifest.product_map,rawCode);
          const shard=name?await live(VAULT+file(name)):manifest;
          const raw=validate(owned(shard.products,rawCode),rawCode);
          tables.push({name:'Vault source export',rows:raw.rows,defaults:{code:rawCode},fields:['setType','setLine','printRun','serial','subSetSize','notes','cmURL']});
        } else throw Error('Records span multiple source exports.');
      }catch(error){
        if(signal?.aborted)throw error;
        note='The separately authored source could not be matched. The published Vault records are available.';
      }
    }
    if((await live('/data/publish-release.json')).release_sha!==revision)
      throw Error('Production changed while this product was loading. Reload the product to continue.');
    return {ok:true,source,revision,note,publishAvailable:false,tables};
  }

  async function activity(signal,fetcher=fetch) {
    const response=await fetcher(LIVE+'/data/recent.json',{signal,cache:'no-cache',credentials:'omit'});
    if(!response.ok)throw Error('Recent activity is unavailable.');
    const {items}=await response.json();
    const result=new Map();
    for(const item of items??[]){
      if(!item.code||!item.sport||!Number.isFinite(Date.parse(item.updated_at)))continue;
      const key=sportKey(item.sport)+'\t'+item.code;
      if((result.get(key)??'')<item.updated_at)result.set(key,item.updated_at);
    }
    return result;
  }

  function decorate(row,recent){
    const latest=recent.get(sportKey(row.sport)+'\t'+row.code);
    return {...row,last_updated:row.last_updated||latest||null,
      last_verified:row.last_verified||[row.cv_fact?.observed_at,row.prv_fact?.observed_at].filter(Boolean).sort().pop()||null};
  }
  const api={load,activity,decorate};
  if(typeof module==='object')module.exports=api;else root.PMProductionData=api;
})(globalThis);
