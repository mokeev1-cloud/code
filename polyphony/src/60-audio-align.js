/* ---------- 8. аудио: загрузка записи и автоподгонка ---------- */

const audio={el:null,k:1,off:0,fitted:false,buf:null};
const audioToScore=at=>(at-audio.off)*audio.k;
const scoreToAudio=st=>st/audio.k+audio.off;

function fft(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1) j^=bit;
    j^=bit;
    if(i<j){ [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cr=1,ci=0;
      for(let k=0;k<len/2;k++){
        const ur=re[i+k],ui=im[i+k];
        const vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci;
        const vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;
        re[i+k]=ur+vr; im[i+k]=ui+vi;
        re[i+k+len/2]=ur-vr; im[i+k+len/2]=ui-vi;
        const nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr;
      }
    }
  }
}

/* Огибающая атак записи: спектральный поток. Для многоголосной фактуры он
   надёжнее энергии — новая нота видна, даже когда громкость не растёт. */
function onsetEnvelope(buf,hz){
  const sr=buf.sampleRate, x=buf.getChannelData(0);
  const NW=1024,HOP=512,bins=NW/2;
  const win=new Float32Array(NW);
  for(let i=0;i<NW;i++) win[i]=0.5-0.5*Math.cos(2*Math.PI*i/NW);
  const frames=Math.floor((x.length-NW)/HOP);
  const out=new Float32Array(Math.ceil(buf.duration*hz)+2);
  let prev=new Float32Array(bins);
  const re=new Float32Array(NW),im=new Float32Array(NW);
  for(let f=0;f<frames;f++){
    const o=f*HOP;
    for(let i=0;i<NW;i++){ re[i]=x[o+i]*win[i]; im[i]=0; }
    fft(re,im);
    let flux=0;
    for(let b=0;b<bins;b++){
      const mag=Math.sqrt(re[b]*re[b]+im[b]*im[b]);
      const d=mag-prev[b];
      if(d>0) flux+=d;
      prev[b]=mag;
    }
    const idx=Math.floor((o/sr)*hz);
    if(idx<out.length&&flux>out[idx]) out[idx]=flux;
  }
  return out;
}

function scoreEnvelope(hz){
  const out=new Float32Array(Math.ceil(DURATION*hz)+2);
  for(const v of VOICES) for(const n of v){
    const i=Math.floor(n.start*hz);
    if(i<out.length) out[i]+=1;
  }
  return out;
}

function normalize(a){
  let m=0,s=0;
  for(const x of a) s+=x;
  const mean=s/a.length;
  const b=new Float32Array(a.length);
  for(let i=0;i<a.length;i++){ b[i]=a[i]-mean; m+=b[i]*b[i]; }
  m=Math.sqrt(m)||1;
  for(let i=0;i<b.length;i++) b[i]/=m;
  return b;
}

/* Партитурная огибающая — это одиночные импульсы, а спектральный поток записи
   размазан по нескольким кадрам. Без сглаживания корреляция ловит случайные
   совпадения: сдвиг на доли секунды обнуляет произведение. Сглаживаем обе. */
function smooth(a,rad){
  const out=new Float32Array(a.length);
  for(let i=0;i<a.length;i++){
    let s=0,w=0;
    for(let d=-rad;d<=rad;d++){
      const j=i+d; if(j<0||j>=a.length) continue;
      const k=1-Math.abs(d)/(rad+1); s+=a[j]*k; w+=k;
    }
    out[i]=s/(w||1);
  }
  return out;
}

/* Перерастяжка партитуры под темп записи. Точечная выборка Sv[round(i*k)]
   при k>1 просто выбрасывает часть атак — берём максимум по всему интервалу. */
function warp(Sv,k,len){
  const R=new Float32Array(len);
  for(let i=0;i<len;i++){
    const a=Math.floor(i*k), b=Math.max(a+1,Math.floor((i+1)*k));
    let m=0;
    for(let j=a;j<b&&j<Sv.length;j++) if(Sv[j]>m) m=Sv[j];
    R[i]=m;
  }
  return R;
}

/* Автоподгонка: партитура и запись почти никогда не совпадают ни по темпу,
   ни по началу. Перебираем масштаб темпа и сдвиг, максимизируя корреляцию
   огибающих атак; затем уточняем вокруг найденного максимума.
   Это TODO-2 (cross-correlation по onset-таймингам). */
function autoAlign(buf,onProgress){
  const HZ=25, maxOff=Math.round(20*HZ);
  const A=normalize(smooth(onsetEnvelope(buf,HZ),2));
  const Sv=smooth(scoreEnvelope(HZ),2);

  function scan(ks,step){
    let best={score:-1e9,k:1,off:0};
    ks.forEach((k,ki)=>{
      const len=Math.min(A.length,Math.floor(Sv.length/k));
      if(len<HZ*10) return;
      const Rn=normalize(warp(Sv,k,len));
      for(let off=-maxOff;off<=maxOff;off+=step){
        let s=0;
        for(let i=0;i<len;i++){
          const ai=i+off;
          if(ai>=0&&ai<A.length) s+=Rn[i]*A[ai];
        }
        if(s>best.score) best={score:s,k,off};
      }
      if(onProgress) onProgress((ki+1)/ks.length);
    });
    return best;
  }

  const coarse=[]; for(let k=0.70;k<=1.45;k+=0.03) coarse.push(k);
  let b=scan(coarse,2);
  const fine=[]; for(let k=Math.max(0.6,b.k-0.04);k<=b.k+0.04;k+=0.005) fine.push(k);
  const b2=scan(fine,1);
  if(b2.score>b.score) b=b2;
  return {score:b.score,k:b.k,off:b.off/HZ};
}
