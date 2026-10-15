import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../', import.meta.url);
for (const file of ['command-center/index.html','command-center/simple-agent/index.html']) {
 const html=fs.readFileSync(new URL(file, root),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 new vm.Script(script);
 const fragment=script.slice(script.indexOf('      function getPublishError'),script.indexOf('      function startPublishCountdown'));
 let output, scheduled=0;
 const ctx=vm.createContext({state:{}, JSON_RETRY_LIMIT:5,JSON_RETRY_DECISION_ATTEMPT:3,
 escapeHtml: s=>String(s).replaceAll('<','&lt;'),startPublishCountdown:()=>scheduled++,
 openPreviewModal:(...args)=>output=args});
 vm.runInContext(fragment,ctx);
 assert.equal(ctx.getPublishError({publish:{error:'GitHub rejected write'}}),'GitHub rejected write');
 ctx.renderPublishFailure({product:{}},1,'<specific failure>');
 assert(output[2].includes('&lt;specific failure>'));assert.equal(scheduled,1);
 ctx.renderPublishFailure({product:{}},1,'Timed out',null,true);
 assert.equal(scheduled,1);assert.equal(output[0],'JSON publish status uncertain');
 assert(script.includes('if (state.publishInFlight) return;'));
 console.log(file+': script syntax, nested errors, escaped failure details, timeout pause passed');
}
