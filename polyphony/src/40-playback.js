/* ---------- 5. состояние воспроизведения ---------- */

let hist=[],simTime=0,lastFrame=null,paused=true;
let lastMidi=[],marks=[],flashUntil=[];
let cooldown={};
const HIST_STEP=0.025;

function resetTrails(){
  hist=Array.from({length:N},()=>[]);
  lastMidi=new Array(N).fill(null);
  flashUntil=new Array(N).fill(-1);
  marks=[]; cooldown={};
}
function resetPlayback(){ simTime=0; resetTrails(); }

function currentNote(v,t){
  let lo=0,hi=v.length-1,res=null;
  while(lo<=hi){ const m=(lo+hi)>>1; if(v[m].start<=t){res=m;lo=m+1;} else hi=m-1; }
  return res;
}
/* Заглушка громкости: реальной амплитуды из партитуры нет.
   Пока нота держится — голос НЕ гаснет (сустейн), после снятия затухает за
   REL и обрывается совсем: молчащий голос не должен тянуть линию через
   участок, где его нет. При переходе на аудио — заменить на RMS в окне ноты. */
const REL=0.8;
function envelope(v,idx,t){
  if(idx==null) return {midi:null,loud:0};
  const n=v[idx], end=n.start+n.dur;
  if(t>end){
    const age=t-end;
    if(age>REL) return {midi:null,loud:0};      // голос замолчал — точки не пишем
    return {midi:n.midi,loud:0.42*Math.pow(1-age/REL,1.8)};
  }
  const age=t-n.start;
  const atk=Math.min(1,age/0.04);
  const sus=0.5+0.5*Math.exp(-age*2.2);
  return {midi:n.midi,loud:Math.max(0.3,atk*sus)};
}

/* Только два типа событий; «сходное/противоположное/косвенное» движение
   было признано шумом и не воссоздаётся. */
function classifyPair(prevDiff,curDiff,d1,d2){
  if(Math.sign(prevDiff)&&Math.sign(curDiff)&&Math.sign(prevDiff)!==Math.sign(curDiff))
    return 'crossing';
  if(Math.abs(curDiff)<0.6&&(Math.abs(d1)+Math.abs(d2)>0.05)) return 'unison';
  return null;
}

const themeAt=(vi,t)=>ENTRIES.some(e=>e.v===vi&&t>=e.t-0.05&&t<=e.end+0.15);
