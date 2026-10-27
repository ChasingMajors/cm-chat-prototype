/* Authenticated publish receipts only. No authoring or stored credentials. */
(() => {
  'use strict';
  const endpoint='https://script.google.com/macros/s/AKfycbyH90r_uVKKVyEUPAzQv65PlMC7j6LGYxq3s2HWAjBwkpTsLOo8U7KPhBWCD-6ExRjc/exec';
  const keyName='cm_command_center_operator_write_key_v1';
  const labels={awaiting_commit:'Awaiting commit',commit_submitted:'Commit submitted',checks_passed:'Checks passed',pages_deployed:'Pages deployed',live_verified:'Live verified',failed:'Failed',cancelled:'Cancelled',overdue:'Overdue',probe_passed:'Notification probe passed (no deployment)'};
  const terminal=new Set(['live_verified','failed','cancelled','overdue','probe_passed']);
  let timer,busy=false;
  const root=document.createElement('section');root.id='publish-monitor';root.setAttribute('aria-label','Publish status');root.hidden=true;
  const anchor=document.querySelector('main')||document.body;anchor.append(root);
  const text=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
  async function refresh(){
    clearTimeout(timer);
    let key='';try{key=sessionStorage.getItem(keyName)||'';}catch{}
    if(!key){root.replaceChildren();root.hidden=true;return;}
    if(busy)return;busy=true;
    const control=new AbortController(),timeout=setTimeout(()=>control.abort(),25000);
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'publishMonitorStatus',key}),signal:control.signal});
      if(!response.ok)throw Error('Publish status HTTP '+response.status);
      const data=await response.json();if(!data.ok||!Array.isArray(data.jobs))throw Error(data.error||'Publish status unavailable');
      // A lock/logout while the request was outstanding must erase private receipts.
      if(sessionStorage.getItem(keyName)!==key){root.replaceChildren();root.hidden=true;return;}
      root.replaceChildren(text('h2','Publish status'));root.hidden=false;
      const button=text('button','Refresh publish status');button.type='button';button.onclick=refresh;root.append(button);
      if(!data.jobs.length)root.append(text('p','No monitored publish jobs yet.'));
      for(const job of data.jobs.slice().reverse()){
        const article=document.createElement('article');article.append(text('h3',job.code+' · '+(labels[job.state]||'Unverified')));
        article.append(text('p','Job '+job.id+' · SHA '+(job.submitted_sha||'not confirmed')));
        if(job.workflow_run_id)article.append(text('p','Run '+job.workflow_run_id+' / attempt '+job.workflow_attempt+' · Deployment '+(job.deployment_id||'not confirmed')));
        if(job.run_url&&/^https:\/\/github\.com\/ChasingMajors\/chasing-majors-app\/actions\/runs\/\d+$/.test(job.run_url)){
          const a=text('a','Open Actions run');a.href=job.run_url;a.target='_blank';a.rel='noopener noreferrer';article.append(a);
        }
        if(job.error||job.waiting_for||job.monitor_error)article.append(text('p',job.error||job.waiting_for||job.monitor_error));
        if(job.alert_status)article.append(text('p','Failure email: '+job.alert_status));
        article.append(text('p','Search: '+(job.search_state||'not checked')+' (separate from content publication)'));root.append(article);
      }
      if(data.jobs.some(j=>!terminal.has(j.state)))timer=setTimeout(refresh,60000);
    }catch(error){root.hidden=false;root.replaceChildren(text('h2','Publish status unavailable'),text('p',error.name==='AbortError'?'Status request timed out. Publication is not confirmed.':error.message));const retry=text('button','Retry publish status');retry.type='button';retry.onclick=refresh;root.append(retry);}
    finally{clearTimeout(timeout);busy=false;}
  }
  window.addEventListener('focus',refresh);
  window.addEventListener('cm-publish-status-refresh',refresh);
  // Inspect only the shell's lock state; never persist or infer administrator keys.
  new MutationObserver(()=>{let key='';try{key=sessionStorage.getItem(keyName)||'';}catch{}if(!key){clearTimeout(timer);if(root.childNodes.length)root.replaceChildren();if(!root.hidden)root.hidden=true;}}).observe(document.body,{attributes:true,subtree:true,attributeFilter:['hidden']});
  void refresh();
})();
