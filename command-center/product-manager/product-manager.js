/* Uses Sentinel's existing session-only admin permission. No source credentials. */
(() => {
  'use strict';
  const ENDPOINT='https://script.google.com/macros/s/AKfycbyH90r_uVKKVyEUPAzQv65PlMC7j6LGYxq3s2HWAjBwkpTsLOo8U7KPhBWCD-6ExRjc/exec';
  const KEY='cm_command_center_operator_write_key_v1';
  const $=id=>document.getElementById(id);
  const statuses=['Complete','Partial','Missing','Sync Issue','Not Verified'];
  const fields=['q','year','manufacturer','cv_status','prv_status','filter'];
  let state={},key='',controller,sequence=0,searchTimer;
  const cache=new Map();
  const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
  const number=n=>Number.isInteger(n)?n.toLocaleString():'Not checked';
  const time=s=>s && Number.isFinite(Date.parse(s))?new Date(s).toLocaleString():'Not available';
  function badge(s){return text('span',s,'badge '+s.toLowerCase().replaceAll(' ','-'));}
  function message(value,error=false){$('message').textContent=value;$('message').className=error?'error':'';}
  function readState(){const p=new URLSearchParams(location.search);state={sport:p.get('sport')||'Baseball',sort:p.get('sort')||'product',direction:p.get('direction')||'asc',page:Number(p.get('page'))||1};for(const f of fields)state[f]=p.get(f)||'';state.id=p.get('id')||'';}
  function navigate(patch,replace=false){clearTimeout(searchTimer);state={...state,...patch};const p=new URLSearchParams();for(const [k,v]of Object.entries(state))if(v!==''&&v!==null)p.set(k,String(v));history[replace?'replaceState':'pushState'](null,'','?'+p);void load();}
  function lock(){key='';try{sessionStorage.removeItem(KEY);}catch{}cache.clear();clearTimeout(searchTimer);controller?.abort();sequence++;$('dashboard').hidden=true;$('logout').hidden=true;$('login').hidden=false;for(const id of ['rows','detail-content','summary','sports','page-info','freshness','source-notice'])$(id).replaceChildren();options('year',[],'All years');options('manufacturer',[],'All manufacturers');$('key').value='';message('');$('key').focus();}
  async function request(action,payload,signal){
    const response=await fetch(ENDPOINT+'?requestId='+Date.now()+'-'+Math.random().toString(36).slice(2),{method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,key,...payload}),signal});
    if(!response.ok)throw Error('Operator backend returned HTTP '+response.status+'.');
    const data=await response.json();if(!data.ok)throw Error(data.error||data.message||'Inventory request failed.');return data;
  }
  function options(id,values,all){const select=$(id);select.replaceChildren(new Option(all,''),...values.map(v=>new Option(v,v)));select.value=state[id]||'';}
  function renderOverview(data){
    $('sports').replaceChildren(...data.sports.map(s=>{const b=text('button',s.sport);b.append(text('span',number(s.count)));b.type='button';b.setAttribute('aria-pressed',String(state.sport===s.sport));b.onclick=()=>navigate({sport:s.sport,page:1,id:'',year:'',manufacturer:''});return b;}));
    const metrics=[['Products',data.summary.total],['CV with observed records',data.summary.cv],['PRV with indexed rows',data.summary.prv],['Needs attention',data.summary.attention]];
    $('summary').replaceChildren(...metrics.map(([label,n])=>{const div=text('div','','metric');div.append(text('strong',number(n)),text('span',label));return div;}));
    $('freshness').textContent='Inventory updated '+time(data.generated_at);
    const notices=[];
    for(const [source,info]of Object.entries(data.sources)){if(!info?.ok)notices.push(source.toUpperCase()+': '+(info?.error||'Source not checked'));else if(Date.now()-Date.parse(info.observed_at)>30*3600000)notices.push(source.toUpperCase()+': observation older than 30 hours');}
    if(data.progress?.cv_files_remaining||data.progress?.prv_files_remaining)notices.push('File verification in progress: '+data.progress.cv_files_remaining+' CV / '+data.progress.prv_files_remaining+' PRV files remain.');
    if(data.progress?.manifest_errors?.length)notices.push('Some CV manifests could not be checked: '+data.progress.manifest_errors.join('; '));
    $('source-notice').textContent=notices.join(' · ');$('source-notice').hidden=!notices.length;
    options('year',data.years,'All years');options('manufacturer',data.manufacturers,'All manufacturers');
    for(const f of fields)$(f).value=state[f];
  }
  function renderRows(data){
    state.page=data.page;
    $('rows').replaceChildren(...data.rows.map(r=>{
      const tr=document.createElement('tr');const name=document.createElement('td');const a=text('a',r.product);const p=new URLSearchParams(location.search);p.set('id',r.id);a.href='?'+p;a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();navigate({id:r.id});};name.append(a,text('small',r.code));
      if(r.issues.some(i=>i.kind==='count_review'))name.append(text('small','Source counts need review'));
      const cv=text('td',number(r.cv_count)+(r.cv_source?' ('+r.cv_source+')':''),'count');const prv=text('td',number(r.prv_count)+(r.prv_source?' ('+r.prv_source+')':''),'count');const cs=document.createElement('td'),ps=document.createElement('td');cs.append(badge(r.cv_status));ps.append(badge(r.prv_status));
      tr.append(name,text('td',r.sport),text('td',r.year||'Unknown'),cv,cs,prv,ps);return tr;
    }));
    for(const b of document.querySelectorAll('[data-sort]'))b.parentElement.setAttribute('aria-sort',b.dataset.sort===state.sort?(state.direction==='asc'?'ascending':'descending'):'none');
    $('empty').hidden=data.total!==0;$('page-info').textContent=data.total?((data.page-1)*data.page_size+1)+'–'+Math.min(data.page*data.page_size,data.total)+' of '+number(data.total)+' products':'0 products';
    $('previous').disabled=data.page<=1;$('next').disabled=data.page*data.page_size>=data.total;
  }
  function link(url,label){if(typeof url!=='string'||!url.startsWith('https://'))return text('span','Not available');const a=text('a',label||url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
  function definition(entries){const dl=document.createElement('dl');for(const [k,v]of entries){const dd=document.createElement('dd');dd.append(v instanceof Node?v:text('span',v));dl.append(text('dt',k),dd);}return dl;}
  function renderDetail(data){
    const r=data.product;const root=$('detail-content');root.replaceChildren(text('h2',r.product));root.firstChild.id='detail-name';root.firstChild.tabIndex=-1;
    root.append(definition([['Sport',r.sport],['Year',r.year||'Unknown'],['Identifier',r.code||'Missing'],['Matched by',r.identity_match],['Manufacturer',r.manufacturer||'Unknown']]));
    const grid=text('div','','detail-grid');
    const cv=document.createElement('article');cv.append(text('h3','CV data'),badge(r.cv_status),definition([['Displayed count',number(r.cv_count)+(r.cv_source?' ('+r.cv_source+')':'')],['D1 card rows',number(r.d1_count)],['D1 summary rows (excluded)',number(r.refs.d1.length===1?r.refs.d1[0].product_rows:null)],['Other D1 rows (excluded)',number(r.refs.d1.length===1?r.refs.d1[0].other_rows:null)],['JSON checklist rows',number(r.cv_json_count)],['JSON parallel definitions',number(r.cv_parallel_count)],['D1 checked',time(data.sources.d1?.observed_at)],['JSON file checked',time(r.cv_fact?.observed_at)],['JSON published',data.sources.cv?.revision||'Unknown'],['CV source',link(r.cv_fact?.url||data.sources.cv?.url,'Open published JSON')],['D1 source',link(data.sources.d1?.url,'Open database dashboard')]]),text('p',data.sources.d1?.scope||'D1 import scope is not verified.','footnote'));
    const prv=document.createElement('article');prv.append(text('h3','PRV data'),badge(r.prv_status),definition([['Indexed rows',number(r.prv_count)],['Verified file rows',number(r.prv_fact?.rows)],['Flagged rows',number(r.prv_fact?.flagged_records)],['File checked',time(r.prv_fact?.observed_at)],['Published',data.sources.prv?.revision||'Unknown'],['JSON source',link(r.prv_fact?.url||data.sources.prv?.url,'Open published JSON')]]));grid.append(cv,prv);root.append(grid);
    root.append(text('h3','Data integrity'));const issues=document.createElement('ul');for(const i of r.issues)issues.append(text('li',i.message));if(!r.issues.length)issues.append(text('li','No discrepancies detected by the current checks. Completeness remains unverified.'));root.append(issues,text('p',data.validation,'footnote'),text('p',data.freshness,'footnote'));
    const refs=document.createElement('details');refs.append(text('summary','Source identifiers and original metadata'),text('pre',JSON.stringify(r.refs,null,2)));root.append(refs);root.firstChild.focus();
  }
  async function load(force=false){
    if(!key)return;const version=++sequence;controller?.abort();controller=new AbortController();const signal=controller.signal;const timeout=setTimeout(()=>controller.abort(),30000);
    message('Loading inventory…');$('dashboard').setAttribute('aria-busy','true');$('reload').disabled=true;
    try{
      const payload={...state};delete payload.id;const ck=JSON.stringify(payload);let data=!force&&cache.get(ck);if(!data||Date.now()-data.fetched>60000){data=await request('productManagerList',payload,signal);data.fetched=Date.now();if(cache.size>=20)cache.delete(cache.keys().next().value);cache.set(ck,data);}
      if(version!==sequence)return;renderOverview(data);renderRows(data);$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;$('key').value='';
      if(state.id){const detail=await request('productManagerDetail',{id:state.id,sport:state.sport},signal);if(version!==sequence)return;renderDetail(detail);$('list').hidden=true;$('detail').hidden=false;}else{$('list').hidden=false;$('detail').hidden=true;}
      message('');
    }catch(err){if(version!==sequence)return;const m=err.name==='AbortError'?'Inventory request timed out. Try Reload inventory.':err.message;if(/Invalid operator key|Missing Script Property CM_OPERATOR_KEY/.test(m)){lock();message('Administrator access was rejected. Enter a valid Sentinel key.',true);}else message(m,true);}
    finally{clearTimeout(timeout);if(version===sequence){$('dashboard').setAttribute('aria-busy','false');$('reload').disabled=false;}}
  }
  for(const id of ['cv_status','prv_status'])options(id,statuses,'All statuses');
  $('login-form').onsubmit=e=>{e.preventDefault();key=$('key').value.trim();if(key){try{sessionStorage.setItem(KEY,key);}catch{}void load();}};
  $('filters').onsubmit=e=>e.preventDefault();
  for(const f of fields)$(f).addEventListener(f==='q'?'input':'change',()=>{clearTimeout(searchTimer);const patch={[f]:$(f).value,page:1,id:''};if(f==='q'){state.q=patch.q;sequence++;controller?.abort();searchTimer=setTimeout(()=>navigate(patch,true),350);}else navigate(patch);});
  for(const b of document.querySelectorAll('[data-sort]'))b.onclick=()=>navigate({sort:b.dataset.sort,direction:state.sort===b.dataset.sort&&state.direction==='asc'?'desc':'asc',page:1});
  $('previous').onclick=()=>navigate({page:Math.max(1,state.page-1)});$('next').onclick=()=>navigate({page:state.page+1});$('back').onclick=()=>navigate({id:''});
  $('reset').onclick=()=>navigate(Object.fromEntries([...fields.map(f=>[f,'']),['page',1],['id','']]));
  $('reload').onclick=()=>{cache.clear();void load(true);};$('logout').onclick=lock;
  window.addEventListener('popstate',()=>{readState();void load();});
  readState();try{localStorage.removeItem(KEY);key=sessionStorage.getItem(KEY)||'';}catch{}if(key)void load();
})();
