// Explicit test-product reference supplied by the user, separate from PDF data.
// No numbering is inferred from a color for other uploaded products.
export const referenceSource='User-supplied product configuration and serial-number breakdown';
export const referenceUrl='https://www.dacardworld.com/sports-cards/2025-topps-finest-football-delight-box';
export const finestConfigs={Hobby:{cardsPerPack:10,packsPerBox:6,source:referenceSource},'Breaker Delight':{cardsPerPack:10,packsPerBox:1,source:referenceSource}};
const common={'sky blue':325,purple:250,blue:200,'xfractor purple':150,'xfractor blue':99,green:75,gold:50,orange:25,black:20,red:10,superfractor:1,'purple geometric':150,'blue geometric':99,'green geometric':75,'gold geometric':50,'orange geometric':25,'black geometric':20,'red geometric':10};
const uncommon={'sky blue':250,purple:200,blue:150,'xfractor purple':99,'xfractor blue':75,green:35,gold:25,orange:20,black:15,red:5,superfractor:1,'blue geometric':75,'green geometric':35,'gold geometric':25,'orange geometric':20,'black geometric':15,'red geometric':5};
const rare={'sky blue':150,purple:125,blue:99,'xfractor purple':75,'xfractor blue':49,green:25,gold:20,orange:15,black:10,red:3,superfractor:1,'green geometric':25,'gold geometric':20,'orange geometric':15,'black geometric':10,'red geometric':3};
const insert={'sky blue':150,purple:125,blue:99,green:75,gold:50,orange:25,black:10,red:5,superfractor:1,'orange geometric':25,'black geometric':10,'red geometric':5};
const auto={blue:99,'blue geometric':99,gold:50,'gold geometric':50,orange:25,'orange geometric':25,black:10,'black geometric':10,red:5,'red geometric':5,superfractor:1};
const groups=[['base common',common],['base uncommon',uncommon],['base rare',rare],...['reflash','creators','team finest','power kings','torchers'].map(name=>[name,insert]),...['finest autographs','rookie finest autographs','flashback autographs','finest freshman auto','finest greats autographs'].map(name=>[name,auto])];
export function applyFinestReference(rows) {
  return rows.map(row=>{
    const name=row.name.toLowerCase();let serial;
    for(const [group,map] of groups)if(name===group||name.startsWith(group+' ')){
      const suffix=name.slice(group.length).replace(/\brefractors?\b/g,'').trim().replace(/\s+/g,' ');
      serial=map[suffix];break;
    }
    if(name==='framed white')serial=1;
    if(name==='92 finest refractor')serial=92;
    if(name==='92 finest superfractor'||name==='headliners superfractor')serial=1;
    return serial===undefined?row:{...row,serial,anchor:true,serialSource:referenceSource,serialSourceUrl:referenceUrl};
  });
}
