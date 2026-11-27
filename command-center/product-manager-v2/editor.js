(() => {
  'use strict';
  const M = window.PMEditorModel;
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const button = (label, action) => {
    const node = el('button', label);
    node.type = 'button';
    node.onclick = action;
    return node;
  };
  const search = (label, action) => {
    const node = el('input');
    node.type = 'search'; node.placeholder = label; node.setAttribute('aria-label',label);
    if (action) node.oninput = () => action(node.value);
    return node;
  };
  const friendly = field => ({card_no:'Card number', player:'Player', setLine:'Set / parallel', setType:'Classification', printRun:'Print run', serial_limit:'Serial limit', subSetSize:'Checklist size', odds_denominator:'Odds denominator'})[field] ??
    field.replaceAll('_',' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./, c=>c.toUpperCase());
  function dialog(title) {
    const node=el('dialog');
    const header=el('header');
    header.append(el('h2',title),button('Close',()=>node.close()));
    node.append(header);
    document.body.append(node);
    node.addEventListener('close',()=>node.remove(),{once:true});
    return node;
  }
  function structured(value, commit) {
    const modal=dialog('Edit cell');
    function control(initial, key, root=false) {
      const row=el('fieldset');
      row.append(el('legend',key));
      let type=M.kind(initial);
      if (type==='undefined') type='absent';
      const select=el('select');
      select.setAttribute('aria-label',key+' type');
      for(const t of ['string','number','boolean','null','object','array',...(root?['absent']:[])]) select.add(new Option(t,t));
      select.value=type;
      const contents=el('div',undefined,'structured');
      let read;
      function render(v) {
        contents.replaceChildren();
        if (type==='object'||type==='array') {
          const children=[];
          function append(k,item) {
            const child=control(item,String(k));
            const entry=el('div',undefined,'structured-entry');
            const name=el('input'); name.value=k; name.setAttribute('aria-label','Property name');
            const itemState={name,child};
            if(type==='object') entry.append(name);
            entry.append(child.node,button('Remove',()=>{children.splice(children.indexOf(itemState),1);entry.remove();}));
            contents.insertBefore(entry,contents.lastChild);
            children.push(itemState);
          }
          contents.append(button(type==='object'?'Add property':'Add item',()=>append(type==='object'?'':children.length,null)));
          for(const [k,item] of Object.entries(v ?? {})) append(k,item);
          read=()=> {
            if(type==='array') return children.map(item=>item.child.read());
            const keys=new Set();
            return Object.fromEntries(children.map(({name,child})=>{
              const key=name.value;
              if(!key.trim()||keys.has(key)||['__proto__','constructor','prototype'].includes(key)) throw Error('Use unique, valid property names.');
              keys.add(key); return [key,child.read()];
            }));
          };
        } else if (type==='boolean') {
          const input=el('select'); input.append(new Option('True','true'),new Option('False','false'));
          input.setAttribute('aria-label',key+' value'); input.value=String(v??false);
          contents.append(input); read=()=>input.value==='true';
        } else if (type==='null'||type==='absent') read=()=>type==='null'?null:undefined;
        else {
          const input=el('input'); input.value=v??''; input.setAttribute('aria-label',key+' value');
          if(type==='number') {input.type='number';input.step='any';}
          contents.append(input); read=()=>M.parse(input.value,type);
        }
      }
      select.onchange=()=>{type=select.value;render(null);};
      row.append(select,contents);render(initial);
      return {node:row, read:()=>read()};
    }
    const field=control(value,'Value',true), note=el('p',undefined,'error');
    modal.append(field.node,note,button('Apply',()=>{try {commit(field.read());modal.close();}catch(error){note.textContent=error.message;}}));
    modal.showModal();
  }

  function mount(root, dataset, options) {
    const drafts=new Map(dataset.tables.map(table=>[table.name,new M.Draft(table.rows,table.defaults)]));
    const toolbar=el('div',undefined,'editor-tools'), tools2=el('div',undefined,'editor-tools secondary-tools');
    const caption=el('p',undefined,'editor-note');
    caption.setAttribute('role','status');
    const holder=el('div',undefined,'sheet-window');
    const table=el('table',undefined,'editor-sheet');
    const head=el('thead'), body=el('tbody'), group=el('colgroup');
    table.append(group,head,body); holder.append(table);
    const tabs=el('div',undefined,'tabs');
    root.replaceChildren(tabs,toolbar,tools2,caption,holder);
    let active=dataset.tables[0]?.name, query='', sort='', desc=false, anchor=null, cursor=null;
    let columnQuery=new Map(), hidden=new Set(), widths=new Map(), visible=[], view=[], draft, template, pinned=null;
    let allFields=[], singleton=false;
    const rowHeight=36, overscan=8;
    const full = search('Search records', value=>{query=value;refresh();});
    const undo=button('Undo',()=>{draft.undo();refresh();}), redo=button('Redo',()=>{draft.redo();refresh();});
    const add=button('Add record',()=>{
      const [key]=draft.add([Object.fromEntries(allFields.filter(f=>!M.protectedField(f)&&typeof template[f]==='string').map(f=>[f,'']))]);
      query=''; full.value=''; columnQuery.clear(); sort=''; refresh();
      focusCell(key,visible.find(f=>!M.protectedField(f)));
    });
    const duplicate=button('Duplicate',()=>{
      const selected=new Set(selection().rows.map(r=>r.key));
      draft.add(view.filter(r=>selected.has(r.key)).map(r=>r.data)); refresh();
    });
    const remove=button('Delete',()=>{draft.remove(new Set(selection().rows.map(r=>r.key)));anchor=cursor=null;refresh();});
    const review=button('Review changes',()=>options.review(
      [...drafts].flatMap(([name,d])=>d.changes().map(e=>({...e,table:name})))
    ));
    review.className='primary';
    toolbar.append(full,add,duplicate,remove,undo,redo,review);
    const columns=el('details');
    columns.append(el('summary','Columns'));
    const filter=button('Filter column',()=>columnDialog('Filter column', (field,value)=>{
      if(value) columnQuery.set(field,value); else columnQuery.delete(field);
      refresh();
    }));
    const bulk=button('Bulk edit',()=>{
      const range=selection();
      if(!range.rows.length) return;
      const field=range.fields.length===1?range.fields[0]:null;
      if(!field||M.protectedField(field)) { caption.textContent='Select cells in a single editable column.';return; }
      structured(range.rows[0].data[field], value=>{
        draft.update(range.rows.map(row=>({key:row.key,field,value})));refresh();
      });
    });
    const find=button('Find and replace',()=>columnDialog('Find and replace',(field,value,replacement)=>{
      if(!value) throw Error('Enter text to find.');
      if(M.protectedField(field)) throw Error('This field is protected.');
      draft.update(view.filter(row=>typeof row.data[field]==='string'&&row.data[field].includes(value))
        .map(row=>({key:row.key,field,value:row.data[field].replaceAll(value,replacement)})));
      refresh();
    },true));
    tools2.append(filter,columns,bulk,find);
    function columnDialog(title, apply, replace=false) {
      const modal=dialog(title), select=el('select'), value=search(replace?'Find text':'Contains text');
      select.setAttribute('aria-label','Column');
      for(const field of visible.filter(f=>!replace||!M.protectedField(f))) select.add(new Option(friendly(field),field));
      if(cursor&&visible.includes(cursor.field)) select.value=cursor.field;
      const setValue=()=>{if(!replace)value.value=columnQuery.get(select.value)||'';};
      select.onchange=setValue;setValue();
      const replacement=search('Replacement text'), error=el('p',undefined,'error');
      modal.append(select,value);
      if(replace) modal.append(replacement);
      modal.append(error,button(replace?'Replace in filtered rows':'Apply filter',()=>{
        try {apply(select.value,value.value,replacement.value);modal.close();}catch(e){error.textContent=e.message;}
      }));
      modal.showModal();value.focus();
    }
    function switchTable(name) {
      active=name; draft=drafts.get(active);
      const data=dataset.tables.find(t=>t.name===name);
      singleton=!!data.singleton;add.disabled=singleton;
      allFields=[...new Set([...(data.fields||[]),...draft.schema])];
      for(const field of allFields) draft.schema.add(field);
      allFields.sort((a,b)=>Number(M.protectedField(a))-Number(M.protectedField(b)));
      template={};
      for(const row of draft.base) for(const [field,value] of Object.entries(row.data)) if (template[field]==null&&value!=null) template[field]=value;
      anchor=cursor=null; query=''; full.value=''; sort=''; columnQuery=new Map();hidden=new Set();widths=new Map();holder.scrollTop=0;
      for(const b of tabs.children) b.setAttribute('aria-pressed',String(b.dataset.table===name));
      refresh();
    }
    function selection() {
      const first=view.findIndex(r=>r.key===anchor?.key), last=view.findIndex(r=>r.key===cursor?.key);
      const start=visible.indexOf(anchor?.field), end=visible.indexOf(cursor?.field);
      if (first<0||last<0||start<0||end<0) return {rows:[], fields:[],first:-1,last:-1,start:-1,end:-1};
      return {rows:view.slice(Math.min(first,last),Math.max(first,last)+1),fields:visible.slice(Math.min(start,end),Math.max(start,end)+1),
        first:Math.min(first,last),last:Math.max(first,last),start:Math.min(start,end),end:Math.max(start,end)};
    }
    function refresh() {
      visible=allFields.filter(f=>!hidden.has(f));
      const needle=query.toLowerCase();
      view=draft.rows.filter(row=>(!needle||Object.values(row.data).some(v=>M.display(v).toLowerCase().includes(needle)))&&
        [...columnQuery].every(([field,term])=>M.display(row.data[field]).toLowerCase().includes(term.toLowerCase())));
      if(sort) view.sort((a,b)=>{
        const x=a.data[sort],y=b.data[sort];
        const comparison=typeof x==='number'&&typeof y==='number'?x-y:M.display(x).localeCompare(M.display(y),undefined,{numeric:true});
        return desc?-comparison:comparison;
      });
      const row=el('tr'); row.append(el('th','#'));
      group.replaceChildren(el('col',undefined,'row-number-column'));
      for(const field of visible) {
        const col=el('col'); col.style.width=(widths.get(field)||170)+'px'; group.append(col);
        const th=el('th');
        if(field===sort) th.setAttribute('aria-sort',desc?'descending':'ascending');
        th.append(button(friendly(field)+(columnQuery.has(field)?' · Filtered':''),()=>{
          desc=sort===field?!desc:false;sort=field;refresh();
        }));
        const resize=el('input',undefined,'column-resize');
        resize.type='range'; resize.min=90; resize.max=520; resize.value=widths.get(field)||170;
        resize.setAttribute('aria-label','Width of '+friendly(field));
        resize.oninput=()=>{widths.set(field,Number(resize.value));col.style.width=resize.value+'px';};
        th.append(resize); row.append(th);
      }
      head.replaceChildren(row);
      while(columns.children.length>1) columns.lastChild.remove();
      for(const field of allFields) {
        const label=el('label'), input=el('input');input.type='checkbox';input.checked=!hidden.has(field);
        input.onchange=()=>{
          if(!input.checked&&visible.length===1){input.checked=true;return;}
          if(input.checked)hidden.delete(field);else hidden.add(field);
          refresh();
        };
        label.append(input,document.createTextNode(friendly(field)));columns.append(label);
      }
      const changes=[...drafts.values()].reduce((sum,item)=>sum+item.changes().length,0);
      caption.textContent=view.length.toLocaleString()+' of '+draft.rows.length.toLocaleString()+' records · '+changes+' changed';
      undo.disabled=!draft.past.length;redo.disabled=!draft.future.length;review.disabled=!changes;
      options.dirty(changes>0);
      renderBody();
    }
    function renderBody() {
      if(pinned) return;
      const first=Math.min(Math.max(0,view.length-1),Math.max(0,Math.floor(holder.scrollTop/rowHeight)-overscan));
      const last=Math.min(view.length,first+Math.ceil(holder.clientHeight/rowHeight)+2*overscan+2);
      const range=selection(), rows=[];
      function spacer(n) {
        const tr=el('tr',undefined,'sheet-spacer'),td=el('td');
        tr.setAttribute('aria-hidden','true'); td.colSpan=visible.length+1;
        td.style.height=n*rowHeight+'px';tr.append(td);return tr;
      }
      if(first)rows.push(spacer(first));
      for(let i=first;i<last;i++) {
        const row=view[i], tr=el('tr');tr.dataset.key=row.key;
        tr.append(el('th',String(i+1),'row-number'));
        for(let j=0;j<visible.length;j++){
          const field=visible[j],value=row.data[field],td=el('td',M.display(value));
          td.dataset.field=field; td.title=M.display(value);
          td.tabIndex=cursor?.key===row.key&&cursor?.field===field||!cursor&&i===first&&j===0?0:-1;
          if(!M.equal(value,draft.original.get(row.key)?.[field])) td.classList.add('changed');
          if(i>=range.first&&i<=range.last&&j>=range.start&&j<=range.end) td.classList.add('selected');
          if(M.protectedField(field)) td.classList.add('protected');
          tr.append(td);
        }
        rows.push(tr);
      }
      if(last<view.length)rows.push(spacer(view.length-last));
      body.replaceChildren(...rows);
      const hasSelection=range.rows.length>0;
      duplicate.disabled=remove.disabled=singleton||!hasSelection;bulk.disabled=!hasSelection;
    }
    function focusCell(key,field,extend=false) {
      const index=view.findIndex(r=>r.key===key);
      if (index<0||!field) return;
      cursor={key,field};
      if(!extend||!anchor) anchor=cursor;
      const top=index*rowHeight, height=holder.clientHeight-head.offsetHeight;
      if(top<holder.scrollTop) holder.scrollTop=top;
      if(top+rowHeight>holder.scrollTop+height)holder.scrollTop=top+rowHeight-height;
      renderBody();
      body.querySelector('tr[data-key="'+key+'"] td[data-field="'+CSS.escape(field)+'"]')?.focus({preventScroll:true});
    }
    function edit(cell, inline=false) {
      const field=cell.dataset.field, key=cell.parentElement.dataset.key;
      if(M.protectedField(field)) return;
      const row=draft.rows.find(r=>r.key===key), value=row.data[field];
      const save=value=>{draft.update([{key,field,value}]);refresh();focusCell(key,field);};
      const type=M.kind(value===undefined?template[field]:value);
      if(!inline||!['number','string'].includes(type)) {structured(value,save);return;}
      const input=el('input'); input.value=M.display(value);input.setAttribute('aria-label',friendly(field));
      let closed=false;
      const finish=(commit,refocus=true)=>{
        if(closed)return;
        let parsed;
        if(commit)try{parsed=M.parse(input.value,type);}catch(e){caption.textContent=e.message;input.focus();return;}
        closed=true;pinned=null;
        if(commit)draft.update([{key,field,value:parsed}]);
        refresh();
        if(refocus) focusCell(key,field);
      };
      pinned=input;cell.replaceChildren(input);input.focus();input.select();
      input.onblur=()=>finish(false,false);
      input.onkeydown=e=>{
        if(e.key==='Escape'){e.stopPropagation();finish(false);}
        if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();e.stopPropagation();finish(true);
          if(!pinned) move(e.key==='Enter'?1:0,e.key==='Tab'?(e.shiftKey?-1:1):0,e.shiftKey&&e.key==='Enter',e.key==='Tab');}
      };
    }
    function move(dy,dx,extend=false,wrap=false) {
      let i=Math.max(0,view.findIndex(r=>r.key===cursor?.key))+dy;
      let j=Math.max(0,visible.indexOf(cursor?.field))+dx;
      if(wrap&&j>=visible.length){j=0;i++;}
      if(wrap&&j<0){j=visible.length-1;i--;}
      i=Math.max(0,Math.min(view.length-1,i));j=Math.max(0,Math.min(visible.length-1,j));
      if(view[i])focusCell(view[i].key,visible[j],extend);
    }
    body.onclick=e=>{
      const cell=e.target.closest('td[data-field]');
      if(!cell||e.target.tagName==='INPUT')return;
      cursor={key:cell.parentElement.dataset.key,field:cell.dataset.field};
      if(!e.shiftKey||!anchor)anchor=cursor;
      const range=selection(), rows=new Set(range.rows.map(row=>row.key));
      let previous=body.querySelector('td[tabindex="0"]');
      if(previous)previous.tabIndex=-1;
      for(const item of body.querySelectorAll('td[data-field]')){
        item.classList.toggle('selected',rows.has(item.parentElement.dataset.key)&&range.fields.includes(item.dataset.field));
      }
      cell.tabIndex=0;cell.focus({preventScroll:true});
      duplicate.disabled=remove.disabled=singleton||!range.rows.length;bulk.disabled=!range.rows.length;
    };
    body.ondblclick=e=>{const cell=e.target.closest('td[data-field]');if(cell)edit(cell,true);};
    holder.addEventListener('scroll',()=>{
      const active=document.activeElement, keep=body.contains(active)&&active.matches('td[data-field]');
      renderBody();
      if(keep&&cursor) body.querySelector('tr[data-key="'+cursor.key+'"] td[data-field="'+CSS.escape(cursor.field)+'"]')?.focus({preventScroll:true});
    });
    holder.onkeydown=e=>{
      const td=e.target.closest('td[data-field]');
      if(!td||e.target.tagName==='INPUT')return;
      cursor={key:td.parentElement.dataset.key,field:td.dataset.field};
      if(!anchor)anchor=cursor;
      const arrows={ArrowDown:[1,0],ArrowUp:[-1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
      if(arrows[e.key]){e.preventDefault();move(...arrows[e.key],e.shiftKey);}
      if(e.key==='Tab'){
        const row=view.findIndex(item=>item.key===cursor.key), col=visible.indexOf(cursor.field);
        if(e.shiftKey?row===0&&col===0:row===view.length-1&&col===visible.length-1) return;
        e.preventDefault();move(0,e.shiftKey?-1:1,false,true);
      }
      if(e.key==='Enter'||e.key==='F2'){e.preventDefault();edit(td,e.key==='Enter');}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?draft.redo():draft.undo();refresh();if(cursor)focusCell(cursor.key,cursor.field);}
    };
    holder.oncopy=e=>{
      if(!e.clipboardData||e.target.tagName==='INPUT')return;
      const range=selection();
      if(!range.rows.length)return;
      e.preventDefault();e.clipboardData.setData('text/plain',M.writeClipboard(range.rows.map(r=>range.fields.map(f=>M.display(r.data[f])))));
    };
    holder.onpaste=e=>{
      if(!e.clipboardData||!cursor||e.target.tagName==='INPUT')return;
      e.preventDefault();
      try {
        const matrix=M.readClipboard(e.clipboardData.getData('text/plain'));
        const range=selection(),start=range.start,first=range.first;
        if(first<0||start<0)return;
        const single=matrix.length===1&&matrix[0].length===1;
        const fieldCount=single?range.fields.length:Math.max(...matrix.map(r=>r.length));
        const rowCount=single?range.rows.length:matrix.length;
        const fields=visible.slice(start,start+fieldCount);
        if(fields.length!==fieldCount||fields.some(M.protectedField))throw Error('Paste must fit within editable columns.');
        const edits=[], added=[];
        for(let i=0;i<rowCount;i++){
          if(!view[first+i]&&(singleton||query||columnQuery.size||sort))throw Error('Clear search, filters and sorting to paste new records.');
          const row=view[first+i], record={};
          (single?fields.map(()=>matrix[0][0]):matrix[i]).forEach((value,j)=>{
            const field=fields[j],old=row?.data[field]??template[field]??'';
            const type=M.kind(old);
            const parsed=value==='null'&&typeof old!=='string'?null:M.parse(value,type);
            if(row)edits.push({key:row.key,field,value:parsed});else record[field]=parsed;
          });
          if(!row)added.push(record);
        }
        if(added.length) {
          draft.add(added, edits);
        } else draft.update(edits);
        refresh();focusCell(cursor.key,cursor.field);
      }catch(error){caption.textContent=error.message;}
    };
    for(const data of dataset.tables) {const b=button(data.name,()=>switchTable(data.name));b.dataset.table=data.name;tabs.append(b);}
    if(dataset.tables.length<2)tabs.hidden=true;
    if(active) switchTable(active); else root.replaceChildren(el('p','No editable record collections were returned.'));
  }
  window.PMEditor={mount,dialog};
})();
