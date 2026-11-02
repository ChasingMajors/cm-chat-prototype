import {validateArtifact,validateCatalog} from './project-schema.js';
export {validateCatalog};
const base=new URL('../data/print-run-lab/v1/',import.meta.url);
export async function loadCatalog(fetcher=fetch){const r=await fetcher(new URL('index.json',base),{cache:'no-store'});if(!r.ok)throw Error('Published projects could not be loaded (HTTP '+r.status+').');return validateCatalog(await r.json());}
export async function loadPublished(entry,fetcher=fetch){
  validateCatalog({schema_version:1,projects:[entry]});
  const r=await fetcher(new URL(entry.path,base));if(!r.ok)throw Error('This published revision is not available yet. Refresh the list and try again.');
  const buffer=await r.arrayBuffer();if(buffer.byteLength>4*1024*1024)throw Error('Published revision exceeds 4 MB.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==entry.sha256)throw Error('Published revision failed its integrity check. The current view was kept.');
  const a=validateArtifact(JSON.parse(new TextDecoder().decode(buffer)));if(a.project_id!==entry.id||a.revision_id!==entry.revision_id||a.published_at!==entry.published_at||a.project.title!==entry.title||a.model.version!==entry.model.version||a.model.engine_sha256!==entry.model.engine_sha256)throw Error('Published revision does not match the catalog.');return a;
}
