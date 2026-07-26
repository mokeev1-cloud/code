/* ---------- распознавание высот и голосов из записи ----------
   Без нейросети: модель basic-pitch весит 1.76 МБ и тянет браузерный tfjs,
   а из file:// это ещё и упрётся в CORS. Здесь — гармоническая заметность с
   итеративным вычитанием: берём самый сильный кандидат, вычитаем его
   гармоники и ищем следующий, иначе октава забивает основной тон. */
function transcribe(buf,K,onProgress,range){
  const sr=buf.sampleRate, x=buf.getChannelData(0);
  const NW=4096, HOP=1024, bins=NW/2;
  const win=new Float32Array(NW);
  for(let i=0;i<NW;i++) win[i]=0.5-0.5*Math.cos(2*Math.PI*i/NW);
  const re=new Float32Array(NW), im=new Float32Array(NW);
  const frames=Math.floor((x.length-NW)/HOP);
  const fps=sr/HOP;
  // при распознавании ЧУЖОЙ записи диапазон партитуры неприменим
  const pmin=range?range[0]:Math.max(24,LO-2), pmax=range?range[1]:Math.min(100,HI+2);
  const binOf=p=>440*Math.pow(2,(p-69)/12)*NW/sr;
  const tracks=[];                 // [{p,frames:[...]}] незавершённые
  const notes=[];
  let active=[];

  for(let f=0;f<frames;f++){
    const o=f*HOP;
    for(let i=0;i<NW;i++){ re[i]=x[o+i]*win[i]; im[i]=0; }
    fft(re,im);
    const mag=new Float32Array(bins);
    for(let b=0;b<bins;b++) mag[b]=Math.sqrt(re[b]*re[b]+im[b]*im[b]);
    let tot=0; for(let b=2;b<bins;b++) tot+=mag[b];
    const picked=[];
    if(tot>1e-4){
      const res=Float32Array.from(mag);
      for(let k=0;k<K;k++){
        let bp=-1,bs=0;
        for(let p=pmin;p<=pmax;p++){
          let sal=0;
          for(let h=1;h<=6;h++){
            const b=Math.round(binOf(p)*h);
            if(b>=bins) break;
            let m=0;
            for(let d=-1;d<=1;d++) if(res[b+d]>m) m=res[b+d];
            sal+=m/h;
          }
          if(sal>bs){bs=sal;bp=p;}
        }
        if(bp<0||bs<tot*0.035) break;
        picked.push(bp);
        for(let h=1;h<=6;h++){          // вычитаем гармоники найденного тона
          const b=Math.round(binOf(bp)*h);
          if(b>=bins) break;
          for(let d=-2;d<=2;d++) if(b+d>=0&&b+d<bins) res[b+d]*=0.15;
        }
      }
    }
    // сборка кадров в ноты: тон должен продержаться несколько кадров
    const next=[];
    for(const p of picked){
      let m=active.find(a=>Math.abs(a.p-p)<=1&&!a.used);
      if(m){ m.used=true; m.n++; m.last=f; m.p=p; next.push(m); }
      else next.push({p,start:f,last:f,n:1});
    }
    for(const a of active){
      if(a.used) continue;
      if(f-a.last<=2){ next.push(a); continue; }
      if(a.n>=3) notes.push({midi:a.p,start:a.start/fps,dur:(a.last-a.start+1)/fps});
    }
    for(const a of next) a.used=false;
    active=next;
    if(onProgress&&(f%50===0)) onProgress(f/frames);
  }
  for(const a of active) if(a.n>=3) notes.push({midi:a.p,start:a.start/fps,dur:(a.last-a.start+1)/fps});
  return notes.sort((a,b)=>a.start-b.start);
}

/* Раскладка нот по голосам. Измерено: на ИДЕАЛЬНЫХ нотах из партитуры этот
   класс методов восстанавливает 38-65% принадлежности — локальных признаков
   через паузу просто нет. Поэтому результат честно помечается как гипотеза. */
function assignVoices(notes,K){
  const st=new Array(K).fill(null), en=new Array(K).fill(0);
  const out=[];
  for(const n of notes){
    let bi=0,bc=Infinity;
    for(let i=0;i<K;i++){
      // пустой голос должен стоить дёшево, иначе первые два забирают всё
      let c = st[i]==null ? 3 : Math.abs(n.midi-st[i])+1.6*Math.max(0,n.start-en[i]);
      // голоса держат регистровый порядок: ниже по номеру — выше по звуку
      for(let j=0;j<K;j++){
        if(j===i||st[j]==null) continue;
        if((j<i&&st[j]<n.midi)||(j>i&&st[j]>n.midi)) c+=2.5;
      }
      if(c<bc){bc=c;bi=i;}
    }
    st[bi]=n.midi; en[bi]=n.start+n.dur; out.push(bi);
  }
  const V=Array.from({length:K},()=>[]);
  notes.forEach((n,i)=>V[out[i]].push(n));
  return V;
}
