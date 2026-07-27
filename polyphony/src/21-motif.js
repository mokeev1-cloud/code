/* --------- разбор смысла ИЗ НОТ, без сведений о произведении ---------
   Никаких допущений вида «тема — это то, что первый голос играет соло»:
   это импортированное знание о форме, а не вывод из материала. Вместо этого
   ищем контур, который статистически не мог возникнуть случайно И ведёт себя
   как имитируемый: звучит в большинстве голосов, передаётся от голоса к
   голосу вразбивку по времени, заявлен рано и не является заполнителем.
   Проверено: при отборе по одной лишь частоте побеждает хроматический ход
   (129 «проведений» в Ricercar) — то есть частота темы не опознаёт. */

let MOTIF=null;

const ivseq=v=>v.slice(1).map((n,i)=>n.midi-v[i].midi);
function connected(v,i,L){
  for(let k=0;k<L;k++){
    const a=v[i+k],b=v[i+k+1];
    if(b.start-(a.start+a.dur)>a.dur*1.5+0.35) return false;
  }
  return true;
}
function grams(L){
  const c=new Map();
  for(const v of VOICES){
    const iv=ivseq(v);
    for(let i=0;i+L<=iv.length;i++){
      if(!connected(v,i,L)) continue;
      const k=iv.slice(i,i+L).join(',');
      c.set(k,(c.get(k)||0)+1);
    }
  }
  return c;
}
/* Порог случайности считаем по СВОЕМУ же материалу: перемешиваем интервалы
   внутри голосов (распределение сохраняется, порядок разрушается). */
function nullMax(L,R=6){
  let s=0,seed=12345;
  const rnd=()=>((seed=seed*1103515245+12345&0x7fffffff)/0x7fffffff);
  for(let r=0;r<R;r++){
    const c=new Map();
    for(const v of VOICES){
      const iv=ivseq(v);
      for(let i=iv.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; [iv[i],iv[j]]=[iv[j],iv[i]]; }
      for(let i=0;i+L<=iv.length;i++){
        const k=iv.slice(i,i+L).join(',');
        c.set(k,(c.get(k)||0)+1);
      }
    }
    let m=0; for(const x of c.values()) if(x>m) m=x;
    s+=m;
  }
  return s/R;
}
/* Проведения: одному интервалу разрешено уехать — так устроен тональный
   ответ, где первый шаг правится под гармонию. */
function occurrences(pat){
  const L=pat.length,res=[];
  for(let vi=0;vi<N;vi++){
    const v=VOICES[vi],iv=ivseq(v);
    for(let i=0;i+L<=iv.length;){
      if(connected(v,i,L)){
        const d=[];
        for(let k=0;k<L;k++) d.push(Math.abs(iv[i+k]-pat[k]));
        d.sort((a,b)=>a-b);
        const rest=d.slice(0,L-1);
        const restAvg=rest.length?rest.reduce((s,x)=>s+x,0)/rest.length:0;
        if(d[L-1]<=2.5&&(L<2||(rest[rest.length-1]<=1.01&&restAvg<=0.35))){
          res.push({v:vi,t:v[i].start,end:v[i+L].start+v[i+L].dur});
          i+=L; continue;
        }
      }
      i++;
    }
  }
  return res.sort((a,b)=>a.t-b.t);
}
function imitationScore(pat,occ){
  if(occ.length<3) return 0;
  const vs=new Set(occ.map(o=>o.v));
  const cover=vs.size/N;
  if(cover<0.7) return 0;                                   // не общий материал
  let hand=0;
  for(let i=1;i<occ.length;i++) if(occ[i].v!==occ[i-1].v) hand++;
  hand/=Math.max(1,occ.length-1);                           // передаётся из голоса в голос
  const early=Math.max(0.15,1-Math.min(1,occ[0].t/(DURATION*0.15)));
  const perMin=occ.length/(DURATION/60);
  const glut=1/(1+Math.max(0,perMin-8)/4);                  // штраф заполнителю
  return cover*hand*early*glut*pat.length;
}
function findMotif(){
  let best=null;
  for(let L=3;L<=14;L++){
    const c=grams(L);
    if(!c.size) break;
    const top=[...c.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
    if(top[0][1]<4) break;
    const nul=Math.max(nullMax(L),0.01);
    for(const [key,cnt] of top){
      if(cnt<4||cnt/nul<3) continue;
      const pat=key.split(',').map(Number);
      const occ=occurrences(pat);
      const sc=imitationScore(pat,occ);
      if(!best||sc>best.score) best={score:sc,pat,occ,cnt,ratio:cnt/nul,L};
    }
  }
  return best;
}
function findEntries(){
  MOTIF=findMotif();
  return MOTIF?MOTIF.occ:[];
}

/* Плотность фактуры: сколько голосов звучит. Драматургия BWV 849 — это
   накопление к пятиголосной стретте; без этого слоя её просто не видно. */
let DENS=null; const DENS_HZ=10;
function buildDensity(){
  const n=Math.ceil(DURATION*DENS_HZ)+2;
  DENS=new Uint8Array(n);
  const on=new Uint8Array(n);
  for(const v of VOICES){
    on.fill(0);
    // сначала отмечаем занятость ОДНОГО голоса, иначе наложения внутри
    // голоса считались бы за два звучащих голоса
    for(const nt of v){
      const a=Math.max(0,Math.floor(nt.start*DENS_HZ));
      const b=Math.min(n-1,Math.floor((nt.start+nt.dur)*DENS_HZ));
      for(let i=a;i<=b;i++) on[i]=1;
    }
    for(let i=0;i<n;i++) DENS[i]+=on[i];
  }
}
const densityAt=t=>DENS?DENS[clamp(Math.round(t*DENS_HZ),0,DENS.length-1)]:0;
