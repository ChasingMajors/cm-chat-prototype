// Synthetic project with n formats; each format has two consistent anchors (1000 packs implied).
export function manyFormats(n){
  const formats=Array.from({length:n},(_,i)=>`FORMAT ${i+1}`),cell=(i,v)=>formats.map((_,j)=>j===i?v:'-');
  const rows=[{id:'base',name:'BASE',familyId:'f',odds:formats.map(()=>'1:1'),eligible:null,serial:null,anchor:false,page:1}];
  formats.forEach((_,i)=>{
    rows.push({id:`a${i}`,name:`SERIAL A ${i+1}`,familyId:'f',odds:cell(i,'1:10'),eligible:10,serial:10,anchor:true,page:1});
    rows.push({id:`b${i}`,name:`SERIAL B ${i+1}`,familyId:'f',odds:cell(i,'1:20'),eligible:5,serial:10,anchor:true,page:1});
  });
  return {version:1,title:`${n} formats`,families:[{id:'f',name:'Base',count:100,cards:[],sectionKind:'Base'}],formats,rows,packTotals:formats.map(()=>null),aliases:[],sources:{},warnings:[],formatConfigs:{},allowScenario:false,oddsBlocking:false};
}
