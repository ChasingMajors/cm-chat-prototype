// Public endpoint configuration only. Credentials stay in sessionStorage and POST bodies.
export const OPERATOR_ENDPOINT='https://script.google.com/macros/s/AKfycbyH90r_uVKKVyEUPAzQv65PlMC7j6LGYxq3s2HWAjBwkpTsLOo8U7KPhBWCD-6ExRjc/exec';
export const OPERATOR_SESSION_KEY='cm_command_center_operator_write_key_v1';
export function createOperatorClient({storage,fetcher=globalThis.fetch,endpoint=OPERATOR_ENDPOINT}={}) {
  if(endpoint!==OPERATOR_ENDPOINT)throw Error('Unapproved operator endpoint.');
  try{storage=storage===undefined?globalThis.sessionStorage:storage;}catch{storage=null;}
  let key='';
  try{key=storage.getItem(OPERATOR_SESSION_KEY)||'';}catch{}
  const clear=()=>{key='';try{storage.removeItem(OPERATOR_SESSION_KEY);}catch{}};
  async function request(action,payload={},timeout=30000){
    if(!key)throw Error('Enter the owner key first.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const r=await fetcher(endpoint+'?requestId='+encodeURIComponent(crypto.randomUUID()),{method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,action,key}),signal:controller.signal});
      if(!r.ok)throw Error('Operator request failed (HTTP '+r.status+').');
      const data=await r.json();
      if(!data.ok){const error=new Error(data.error||'Operator request was rejected.');error.requestRejected=true;if(/operator key|CM_OPERATOR_KEY/i.test(error.message)){clear();error.authRejected=true;}throw error;}
      return data;
    }catch(e){if(e.name==='AbortError')throw Error('The request timed out. Check publication status before trying Publish again.');throw e;}finally{clearTimeout(timer);}
  }
  return {hasKey:()=>!!key,clear,request,async verify(value){if(value!==undefined)key=String(value).trim();try{const result=await request('printRunAdminCapabilities');try{storage.setItem(OPERATOR_SESSION_KEY,key);}catch{}return result;}catch(e){if(e.authRejected)clear();throw e;}}};
}
