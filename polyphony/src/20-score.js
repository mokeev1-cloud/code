/* ---------- 2. партитура и её разбор ---------- */

let S=null;              // текущая партитура
let VOICES=[],N=0,DURATION=0,LO=0,HI=0;
let ENTRIES=[];          // проведения темы: {v,t,end}
let SUBJ_LEN=0;

/* Имена голосов тоже выводим из нот — по измеренному регистру, а не из
   таблицы «сопрано/альт/тенор/бас», которая была бы внешним допущением. */
let VNAME=[];
function nameVoices(){
  const med=VOICES.map(v=>{
    const m=v.map(n=>n.midi).sort((a,b)=>a-b);
    return m[m.length>>1];
  });
  const order=[...med.keys()].sort((a,b)=>med[b]-med[a]);
  VNAME=new Array(N);
  order.forEach((vi,pos)=>{
    VNAME[vi]= N<=2 ? ['верхний','нижний'][pos]
             : pos===0 ? 'верхний'
             : pos===N-1 ? 'нижний'
             : (N===3?'средний':'средний '+pos);
  });
}
const voiceName=i=>VNAME[i]||('голос '+(i+1));

function loadScore(idx){
  S=SCORES[idx];
  VOICES=S.v.map(v=>v.map(n=>({midi:n[0],start:n[1],dur:n[2]})));
  N=VOICES.length;
  DURATION=Math.max(...VOICES.flatMap(v=>v.map(n=>n.start+n.dur)));
  LO=Infinity;HI=-Infinity;
  for(const v of VOICES) for(const n of v){ if(n.midi<LO)LO=n.midi; if(n.midi>HI)HI=n.midi; }
  LO-=2;HI+=2;
  nameVoices();
  ENTRIES=findEntries();
  analyzeEvents();
  analyzeKeys();
  buildDensity();
  autofit();
  resetPlayback();
}
