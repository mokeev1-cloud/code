/* ---------- события, общие для любой музыки, а не только для фуги ----------
   Пороги берутся из перцентилей САМОГО материала, а не константами: то, что
   для фуги длинная нота, для хорала обычная. Абсолютные пороги дали 24 «точки
   покоя» в минуту и 164 «педали» — то есть шум вместо событий. */
let CAD=[],SEQ=[],PED=[];
const pct=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,(b.length*p)|0)];};

function analyzeEvents(){
  const durs=[],ons=[];
  for(const v of VOICES) for(const n of v){ durs.push(n.dur); ons.push(n.start); }
  ons.sort((a,b)=>a-b);
  const rate=ons.length/DURATION;

  /* Точка покоя — пунктуация музыки: длинные ноты в большинстве голосов И
     реальная остановка движения после них. Второе условие обязательно.
     У Баха каденции часто перекрыты новым вступлением, поэтому внутри фуги
     их находится мало — это свойство материала, а не промах детектора. */
  const long=pct(durs,0.93), g=new Map();
  for(let vi=0;vi<N;vi++) for(const n of VOICES[vi]){
    if(n.dur<long) continue;
    const k=Math.round(n.start/0.3);
    if(!g.has(k)) g.set(k,new Set());
    g.get(k).add(vi);
  }
  CAD=[];
  for(const k of [...g.keys()].sort((a,b)=>a-b)){
    const t=k*0.3;
    if(g.get(k).size<Math.max(2,Math.round(N*0.6))) continue;
    let after=0;
    for(const o of ons) if(o>t&&o<=t+1.2) after++;
    if(after/1.2>rate*0.75) continue;
    if(CAD.length&&t-CAD[CAD.length-1]<3) continue;
    CAD.push(t);
  }

  /* Секвенция — двигатель развития в любой тональной музыке: фигура тут же
     повторяется от другой ступени. */
  SEQ=[];
  for(let vi=0;vi<N;vi++){
    const v=VOICES[vi], iv=v.slice(1).map((n,i)=>n.midi-v[i].midi);
    for(let i=0;i<iv.length;){
      let hit=null;
      for(let L=6;L>=3;L--){
        if(i+2*L>=iv.length) continue;
        let same=true;
        for(let k=0;k<L-1;k++) if(iv[i+k]!==iv[i+L+k]){same=false;break;}
        if(!same) continue;
        const sh=v[i+L].midi-v[i].midi;
        if(sh===0||Math.abs(sh)>5) continue;
        let r=2;
        while(i+(r+1)*L<iv.length){
          let ok=v[i+r*L].midi-v[i+(r-1)*L].midi===sh;
          for(let k=0;k<L-1&&ok;k++) if(iv[i+k]!==iv[i+r*L+k]) ok=false;
          if(!ok) break; r++;
        }
        hit={L,r}; break;
      }
      if(hit){
        SEQ.push({v:vi,t:v[i].start,end:v[Math.min(i+hit.r*hit.L,v.length-1)].start,n:hit.r});
        i+=hit.r*hit.L;
      } else i++;
    }
  }

  /* Педаль — выдержанный тон под движущимися голосами. */
  const vlong=Math.max(pct(durs,0.985),1.5);
  PED=[];
  for(let vi=0;vi<N;vi++) for(const n of VOICES[vi]){
    if(n.dur<vlong) continue;
    let mv=0;
    for(let j=0;j<N;j++){ if(j===vi) continue;
      for(const m of VOICES[j]) if(m.start>n.start&&m.start<n.start+n.dur) mv++; }
    if(mv>=8) PED.push({v:vi,t:n.start,end:n.start+n.dur,midi:n.midi});
  }
}
