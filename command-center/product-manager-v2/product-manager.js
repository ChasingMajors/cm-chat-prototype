(() => {
  'use strict';
  const endpoint='https://script.google.com/macros/s/AKfycbyH90r_uVKKVyEUPAzQv65PlMC7j6LGYxq3s2HWAjBwkpTsLOo8U7KPhBWCD-6ExRjc/exec';
  const keyName='cm_command_center_operator_write_key_v1';
  const $=id=>document.getElementById(id);
  const el=(tag,value,cls)=>{
    const node=document.createElement(tag);
    if(value!==undefined)node.textContent=value;
    if(cls)node.className=cls;
    return node;
  };
  const btn=(label,action)=>{
    const button=el('button',label);
    button.type='button';button.onclick=action;return button;
  };
  const count=n=>Number.isInteger(n)?n.toLocaleString():'—';
  const time=value=>Date.parse(value)?new Date(value).toLocaleString():'—';
  const badge=value=>el('span',value,'badge '+value.toLowerCase().replaceAll(' ','-'));
  const tabs=[['overview','Overview'],['cv','CV Data'],['prv','PRV Data'],['sources','Sources'],['history','History']];
  const columns=[['product','Product'],['sport','Sport'],['year','Year'],['cv_json_count','CV JSON'],['d1_count','CV D1'],['cv_status','CV status'],['prv_count','PRV rows'],['prv_status','PRV status'],['last_updated','Last updated'],['last_verified','Last checked'],['hermes_status','Hermes'],[null,'']];
  const fields=['q','year','manufacturer','filter'];
  const drafts=new Map();
  let key='',state,controller,revision=0,searchTimer,list,detail;
  let recent=new Map(), sportInventory;
  const pending=()=>[...drafts.values()].some(d=>d.dirty);
  function message(value,error=false){ $('message').textContent=value;$('message').className=error?'error':''; }
  function readState(){
    const p=new URLSearchParams(location.search);
    state={sport:p.get('sport')||'Baseball',sort:p.get('sort')||'product',direction:p.get('direction')||'asc',page:Number(p.get('page'))||1,id:p.get('id')||'',tab:p.get('tab')||'overview'};
    if(!tabs.some(t=>t[0]===state.tab))state.tab='overview';
    for(const f of fields)state[f]=p.get(f)||'';
  }
  function navigate(patch,replace=false){
    clearTimeout(searchTimer);state={...state,...patch};
    const p=new URLSearchParams();
    for(const [k,v] of Object.entries(state))if(v)p.set(k,String(v));
    history[replace?'replaceState':'pushState'](null,'','?'+p);
    void load();
  }
  function lock(){
    if(pending()&&!window.confirm('Discard all unpublished drafts and lock Product Manager?'))return;
    key='';drafts.clear();list=detail=sportInventory=null;recent.clear();
    try{sessionStorage.removeItem(keyName);}catch{}
    controller?.abort();revision++;clearTimeout(searchTimer);
    for(const dialog of document.querySelectorAll('dialog'))dialog.close();
    for(const id of ['rows','detail-content','summary','sports','workspace-tabs','detail-name','detail-meta','page-info','freshness','source-notice','year','manufacturer'])$(id).replaceChildren();
    $('dashboard').hidden=$('logout').hidden=true;$('login').hidden=$('page-header').hidden=false;$('key').value='';$('key').focus();message('');
  }
  async function request(action,payload={},signal){
    if(!['productManagerList','productManagerDetail'].includes(action))throw Error('Unsupported read action.');
    const response=await fetch(endpoint+'?requestId='+crypto.randomUUID(),{
      method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,key,...payload}),signal
    });
    if(!response.ok)throw Error('Operator backend returned HTTP '+response.status+'.');
    const data=await response.json();
    if(!data.ok){const err=Error(data.error||'Operator request failed.');err.conflict=data.conflict;throw err;}
    return data;
  }
  function options(id,values,label){
    $(id).replaceChildren(new Option(label,''),...values.map(v=>new Option(v,v)));
    $(id).value=state[id]||'';
  }
  function renderList(data){
    $('sports').replaceChildren(...data.sports.map(s=>{
      const b=btn(s.sport,()=>navigate({sport:s.sport,page:1,id:'',year:'',manufacturer:''}));
      b.append(el('span',count(s.count)));b.setAttribute('aria-pressed',String(state.sport===s.sport));return b;
    }));
    $('summary').replaceChildren(...[['Products',data.summary.total],['With CV data',data.summary.cv],['With PRV data',data.summary.prv],['Need attention',data.summary.attention]].map(([label,n])=>{
      const item=el('div',undefined,'metric');item.append(el('strong',count(n)),el('span',label));return item;
    }));
    $('inventory-columns').replaceChildren(...columns.map(([field,label])=>{
      const th=el('th');th.scope='col';
      if(field){
        if(state.sort===field)th.setAttribute('aria-sort',state.direction==='asc'?'ascending':'descending');
        th.append(btn(label+(state.sort===field?(state.direction==='asc'?' ↑':' ↓'):''),()=>navigate({sort:field,direction:state.sort===field&&state.direction==='asc'?'desc':'asc',page:1})));
      }else{th.append(el('span','Action','sr-only'));}
      return th;
    }));
    $('rows').replaceChildren(...data.rows.map(row=>{
      const tr=el('tr'), name=el('td');
      const a=el('a',row.product);const p=new URLSearchParams(location.search);p.set('id',row.id);p.set('tab','overview');
      a.href='?'+p;
      a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();navigate({id:row.id,tab:'overview'});};
      name.append(a);
      if(row.issues.some(i=>i.kind==='count_review'))name.append(el('div','Counts need review','more'));
      const cv=el('td'),prv=el('td'),action=el('td');
      cv.append(badge(row.cv_status));prv.append(badge(row.prv_status));
      action.append(btn('Manage',()=>navigate({id:row.id,tab:'overview'})));
      tr.append(name,el('td',row.sport),el('td',row.year||'—'),el('td',count(row.cv_json_count),'count'),
        el('td',count(row.d1_count),'count'),cv,el('td',count(row.prv_count),'count'),prv,
        el('td',time(row.last_updated)),el('td',time(row.last_verified)),el('td',row.hermes_status||'—'),action);
      return tr;
    }));
    const notices=Object.entries(data.sources).flatMap(([name,source])=>!source?.ok?[name.toUpperCase()+': '+(source?.error||'Unavailable')]:[]);
    if(data.progress?.cv_files_remaining||data.progress?.prv_files_remaining)notices.push('Inventory file checks are in progress.');
    $('source-notice').textContent=notices.join(' · ');$('source-notice').hidden=!notices.length;
    $('freshness').textContent='Inventory snapshot '+time(data.generated_at);
    $('empty').hidden=!!data.total;
    $('page-info').textContent=data.total?((data.page-1)*data.page_size+1)+'–'+Math.min(data.page*data.page_size,data.total)+' of '+count(data.total)+' products':'0 products';
    $('previous').disabled=data.page<=1;$('next').disabled=data.page*data.page_size>=data.total;
    options('year',data.years,'All years');options('manufacturer',data.manufacturers,'All manufacturers');
    $('filter').value=state.filter;if(document.activeElement!==$('q'))$('q').value=state.q;
  }
  function details(rows){
    const dl=el('dl',undefined,'facts');
    for(const [key,value] of rows){
      const dd=el('dd');dd.append(value instanceof Node?value:document.createTextNode(value??'—'));
      dl.append(el('dt',key),dd);
    }
    return dl;
  }
  function safeLink(url,label){
    if(typeof url!=='string'||!url.startsWith('https://'))return '—';
    const link=el('a',label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';return link;
  }
  function renderProduct(data){
    const r=data.product;
    $('detail-name').textContent=r.product;
    $('detail-meta').textContent=[r.sport,r.year,'Updated '+time(r.last_updated)].filter(Boolean).join(' · ');
    $('workspace-tabs').replaceChildren(...tabs.map(([id,label])=>{
      const button=btn(label,()=>navigate({tab:id}));
      button.setAttribute('aria-pressed',String(id===state.tab));return button;
    }));
    const index=list?.rows.findIndex(row=>row.id===r.id)??-1;
    for(const [id,step] of [['product-previous',-1],['product-next',1]]){
      const candidate=list?.rows[index+step];
      const control=$(id);
      const otherPage=list&&index>=0&&(step<0?list.page>1:list.page*list.page_size<list.total);
      control.disabled=index<0||(!candidate&&!otherPage);
      control.onclick=async()=>{
        if(candidate){navigate({id:candidate.id});return;}
        control.disabled=true;
        try{
          const next=await loadInventory(listInput(list.page+step));
          navigate({page:next.page,id:next.rows[step<0?next.rows.length-1:0].id});
        }catch(error){message(error.message,true);}finally{control.disabled=false;}
      };
    }
    const root=$('detail-content');
    if(state.tab==='overview'){
      const statuses=details([['CV status',badge(r.cv_status)],['CV JSON rows',count(r.cv_json_count)],['CV D1 rows',count(r.d1_count)],['PRV status',badge(r.prv_status)],
        ['PRV rows',count(r.prv_count)],['Last file check',time(r.last_verified)],['Hermes',r.hermes_status]]);
      const issues=el('ul');
      for(const i of r.issues)issues.append(el('li',i.message));
      root.replaceChildren(el('h3','Production data'),statuses,el('h3','Inventory checks'),
        r.issues.length?issues:el('p','No discrepancies were observed during the available checks.'));
    }else if(state.tab==='sources'){
      root.replaceChildren(el('h3','Published sources'),details([
        ['Product identifier',r.code],['Identity match',r.identity_match],['CV JSON',safeLink(r.cv_fact?.url||data.sources.cv?.url,'Published checklist')],
        ['CV JSON revision',data.sources.cv?.revision],['D1',safeLink(data.sources.d1?.url,'Database inventory')],['D1 checked',time(data.sources.d1?.observed_at)],
        ['PRV JSON',safeLink(r.prv_fact?.url||data.sources.prv?.url,'Published Vault records')],['PRV revision',data.sources.prv?.revision]]),el('p',data.freshness,'workspace-note'));
    }
    $('draft-state').hidden=![...drafts.entries()].some(([id,d])=>id.startsWith(r.id+'\t')&&d.dirty);
  }
  function listInput(page=state.page){
    const {sport,sort,direction,q,year,manufacturer,filter}=state;
    return {sport,sort,direction,page,q,year,manufacturer,filter};
  }

  function changeList(changes){
    const ol=el('ol',undefined,'change-list');
    for(const c of changes){
      const li=el('li');
      li.append(el('strong',c.table+' · '+(c.before===undefined?'Add':c.after===undefined?'Delete':'Edit')+' record '+(Number(c.key)+1)));
      const fields=[...new Set([...Object.keys(c.before||{}),...Object.keys(c.after||{})])];
      const diff=fields.filter(f=>!PMEditorModel.equal(c.before?.[f],c.after?.[f])).map(f=>
        f+'\n  Before: '+(c.before?.[f]===undefined?'—':PMEditorModel.display(c.before[f]))+'\n  After:  '+(c.after?.[f]===undefined?'—':PMEditorModel.display(c.after[f])));
      li.append(el('pre',diff.join('\n')));
      ol.append(li);
    }
    return ol;
  }
  function review(dataset,changes,input){
    const dialog=PMEditor.dialog('Review local changes');
    dialog.append(el('p',changes.length+' affected records · source release '+dataset.revision.slice(0,12),'workspace-note'));
    if(input.kind==='prv') dialog.append(el('p','Changes to print runs, odds, or eligibility may affect calculated estimates. Review related records before publication.','notice'));
    dialog.append(changeList(changes),el('p','Production publishing is disabled. These changes stay in this browser tab.','notice'));
    dialog.showModal();
  }
  async function loadInventory(input,signal,force=false){
    const nativeSort=['product','sport','year','cv_count','cv_status','prv_count','prv_status'];
    const localSort=!nativeSort.includes(input.sort);
    const localFilter=['partial','recent'].includes(input.filter);
    const status=input.filter==='missing_cv'?{cv_status:'Missing'}:input.filter==='missing_prv'?{prv_status:'Missing'}:{};
    const {filter,...params}=input;
    if(!localSort&&!localFilter){
      const result=await request('productManagerList',{...params,...status,filter:['attention','missing','sync'].includes(filter)?filter:''},signal);
      return {...result,rows:result.rows.map(row=>PMProductionData.decorate(row,recent))};
    }
    const group={...params,page:1,sort:'product',direction:'asc',...status,
      filter:['attention','missing','sync'].includes(filter)?filter:''};
    const cacheKey=JSON.stringify(group);
    if(force||sportInventory?.key!==cacheKey||Date.now()-sportInventory.loadedAt>60_000){
      const first=await request('productManagerList',group,signal);
      const rows=[...first.rows], pages=Math.ceil(first.total/first.page_size);
      for(let from=2;from<=pages;from+=4){
        const batch=await Promise.all(Array.from({length:Math.min(4,pages-from+1)},(_,i)=>
          request('productManagerList',{...group,page:from+i},signal)));
        rows.push(...batch.flatMap(page=>page.rows));
      }
      sportInventory={key:cacheKey,loadedAt:Date.now(),first,rows:[...new Map(rows.map(row=>[row.id,row])).values()]};
    }
    const first=sportInventory.first;
    let rows=sportInventory.rows.map(row=>PMProductionData.decorate(row,recent));
    if(filter==='partial')rows=rows.filter(row=>row.cv_status==='Partial'||row.prv_status==='Partial');
    if(filter==='recent')rows=rows.filter(row=>row.last_updated&&Date.now()-Date.parse(row.last_updated)<=7*86400000);
    rows.sort((a,b)=>{
      const x=a[input.sort],y=b[input.sort];
      if(x==null)return y==null?0:1;
      if(y==null)return -1;
      const n=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true});
      return input.direction==='desc'?-n:n;
    });
    const total=rows.length,page=Math.min(input.page,Math.max(1,Math.ceil(total/first.page_size)));
    return {...first,rows:rows.slice((page-1)*first.page_size,page*first.page_size),total,page};
  }
  async function load(force=false){
    if(!key)return;
    controller?.abort();controller=new AbortController();
    const operation=++revision,signal=controller.signal;
    const timer=setTimeout(()=>controller.abort(),30000);
    const input=listInput(), cacheKey=JSON.stringify(input);
    const valid=()=>operation===revision;
    $('dashboard').setAttribute('aria-busy','true');message(state.id?'Loading product…':'Loading inventory…');
    try{
      if(force||list?.cacheKey!==cacheKey){
        if(force||!list)recent=await PMProductionData.activity(signal).catch(()=>new Map());
        const data=await loadInventory(input,signal,force);
        if(!valid())return;
        list={...data,cacheKey};renderList(data);
      }
      $('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;$('key').value='';
      $('list').hidden=!!state.id;$('detail').hidden=!state.id;$('page-header').hidden=!!state.id;
      if(state.id){
        const params={id:state.id,sport:state.sport};
        if(force||detail?.product.id!==state.id){
          $('detail-content').replaceChildren();
          const result=await request('productManagerDetail',params,signal);
          if(!valid())return;
          detail={...result,product:PMProductionData.decorate(result.product,recent)};
        }
        renderProduct(detail);
        const root=$('detail-content');
        if(state.tab==='history'){
          root.replaceChildren(el('h3','Publication history'),el('p','Publication history will appear when the shared manual publisher is connected.'));
        }else if(state.tab==='cv'||state.tab==='prv'){
          const kind=state.tab,id=params.id+'\t'+kind;
          let entry=drafts.get(id);
          if(!entry){
            root.replaceChildren(el('p','Loading product records…'));
            const data=await PMProductionData.load(detail.product,kind,{signal});
            if(!valid())return;
            const wrapper=el('div'), grid=el('div');
            const note=el('p',data.source+' · Release '+data.revision.slice(0,12),'workspace-note');
            wrapper.append(note);if(data.note)wrapper.append(el('p',data.note,'notice'));
            wrapper.append(grid);root.replaceChildren(wrapper);
            entry={wrapper,dirty:false};
            drafts.set(id,entry);
            PMEditor.mount(grid,data,{dirty(value){entry.dirty=value;if(state.id===params.id)$('draft-state').hidden=![...drafts].some(([key,d])=>key.startsWith(params.id+'\t')&&d.dirty);},
              review(changes){review(data,changes,{...params,kind});}});
          } else root.replaceChildren(entry.wrapper);
        }
      }
      if(valid())message('');
    }catch(error){
      if(!valid())return;
      if(/invalid operator key|missing script property cm_operator_key/i.test(error.message)){
        lock();message('Administrator access was rejected.',true);
      }else {
        message(error.name==='AbortError'?'The request timed out. Reload to retry.':error.message,true);
        if(state.id&&['cv','prv','history'].includes(state.tab))$('detail-content').replaceChildren(btn('Retry',()=>load(true)));
      }
    }finally{
      clearTimeout(timer);
      if(valid())$('dashboard').setAttribute('aria-busy','false');
    }
  }
  $('login-form').onsubmit=e=>{
    e.preventDefault();key=$('key').value.trim();if(!key)return;
    try{sessionStorage.setItem(keyName,key);}catch{}
    void load();
  };
  $('filters').onsubmit=e=>e.preventDefault();
  for(const field of fields)$(field).addEventListener(field==='q'?'input':'change',()=>{
    clearTimeout(searchTimer);
    const patch={[field]:$(field).value,page:1,id:''};
    if(field==='q')searchTimer=setTimeout(()=>navigate(patch,true),320);else navigate(patch);
  });
  $('previous').onclick=()=>navigate({page:Math.max(1,list.page-1)});
  $('next').onclick=()=>navigate({page:list.page+1});
  $('reset').onclick=()=>navigate({...Object.fromEntries(fields.map(f=>[f,''])),page:1,id:''});
  $('back').onclick=()=>navigate({id:'',tab:'overview'});
  $('reload').onclick=()=>load(true);$('logout').onclick=lock;
  window.addEventListener('beforeunload',e=>{if(pending()){e.preventDefault();e.returnValue='';}});
  window.addEventListener('popstate',()=>{readState();void load();});
  readState();
  try{localStorage.removeItem(keyName);key=sessionStorage.getItem(keyName)||'';if(key)void load();}catch{}
})();
