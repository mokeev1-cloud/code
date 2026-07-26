/* ---------- тональный центр фрагмента ----------
   Скользящее окно по классам высот, взвешенным длительностью, и корреляция
   с профилями Крумхансл-Кесслер. Общий алгоритм для любой тональной музыки,
   применяется ко всем пьесам одинаково. */
const KK_MAJ=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KK_MIN=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
let KEYS=[];
function corr(a,b){
  const n=12, ma=a.reduce((s,x)=>s+x,0)/n, mb=b.reduce((s,x)=>s+x,0)/n;
  let num=0,da=0,db=0;
  for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb; num+=x*y; da+=x*x; db+=y*y;}
  return num/(Math.sqrt(da*db)||1);
}
function analyzeKeys(win=8,hop=3){
  KEYS=[];
  for(let t=0;t<DURATION;t+=hop){
    const h=new Array(12).fill(0);
    for(const v of VOICES) for(const n of v){
      if(n.start+n.dur<t||n.start>t+win) continue;
      const ov=Math.min(n.start+n.dur,t+win)-Math.max(n.start,t);
      if(ov>0) h[((n.midi%12)+12)%12]+=ov;
    }
    let best=null;
    for(let pc=0;pc<12;pc++){
      const rot=p=>p.slice(12-pc).concat(p.slice(0,12-pc));
      for(const [prof,mode] of [[KK_MAJ,'dur'],[KK_MIN,'moll']]){
        const c=corr(h,rot(prof));
        if(!best||c>best.c) best={c,pc,mode};
      }
    }
    KEYS.push({t,pc:best.pc,mode:best.mode,conf:best.c});
  }
}
const NOTE_RU=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function keyAt(t){
  if(!KEYS.length) return null;
  let k=KEYS[0];
  for(const x of KEYS) if(x.t<=t) k=x; else break;
  return k;
}
/* Фон — поле тональности, градиентом, как золотая таймлиния Luce:
   цвет тоники по Скрябину, приглушённый до фона. */
function drawKeyField(){
  if(!KEYS.length) return;
  const g=ctx.createLinearGradient(0,0,W,0);
  for(let x=0;x<=W;x+=Math.max(24,W/24)){
    const t=simTime-(HEAD_X-x)/SPEED;
    const k=keyAt(clamp(t,0,DURATION));
    if(!k) continue;
    const c=SCRIABIN[k.pc], a=clamp((k.conf-0.4)*0.34,0.03,0.17)*(k.mode==='moll'?0.75:1);
    g.addColorStop(clamp(x/W,0,1),`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a.toFixed(3)})`);
  }
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  const k=keyAt(simTime);
  if(k){
    ctx.font=`${(U*0.66)|0}px ui-monospace,Menlo,monospace`;
    ctx.fillStyle='rgba(200,212,255,0.5)';
    ctx.textAlign='right';
    ctx.fillText(NOTE_RU[k.pc]+' '+k.mode,W-U*0.8,H-U*3.2);
    ctx.textAlign='left';
  }
}
