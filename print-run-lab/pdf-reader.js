import * as pdfjs from './vendor/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
export async function readPdf(data,onProgress=()=>{}) {
  const pdf=await pdfjs.getDocument({data:new Uint8Array(data),isEvalSupported:false}).promise;
  const pages=[];
  try {
    for(let number=1;number<=pdf.numPages;number++) {
      onProgress(number,pdf.numPages);
      const page=await pdf.getPage(number);const content=await page.getTextContent();const groups=[];
      for(const item of content.items) {
        if(!item.str?.trim())continue;
        const y=item.transform[5];let row=groups.find(r=>Math.abs(r.y-y)<2);
        if(!row){row={y,items:[]};groups.push(row);}
        row.items.push({text:item.str.trim(),x:item.transform[4],width:item.width});
      }
      const rows=groups.sort((a,b)=>b.y-a.y).map(r=>({...r,items:r.items.sort((a,b)=>a.x-b.x)})).map(r=>({...r,text:r.items.map(i=>i.text).join(' ')}));
      pages.push({number,rows});page.cleanup();
    }
  }finally{await pdf.destroy();}
  if(!pages.some(p=>p.rows.length))throw Error('No selectable text found. This PDF needs OCR before it can be read.');
  return pages;
}
