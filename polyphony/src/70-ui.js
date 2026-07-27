/* ---------- 9. интерфейс ---------- */

const $=id=>document.getElementById(id);
const fmt=t=>`${Math.floor(t/60)}:${String(Math.floor(Math.max(0,t))%60).padStart(2,'0')}`;

function updateHud(){
  const p=clamp(simTime/DURATION,0,1);
  $('bar').style.width=(p*100)+'%';
  $('time').textContent=fmt(simTime)+' / '+fmt(DURATION);
  const d=densityAt(simTime);
  $('dens').textContent=d+' из '+N;
}

let hideT=null;
function wake(){
  document.body.classList.remove('idle');
  clearTimeout(hideT);
  hideT=setTimeout(()=>{ if(!paused||audio.el) document.body.classList.add('idle'); },3200);
}

/* Удержание подсветки экрана: без него телефон гаснет на середине фуги. */
let lock=null;
async function keepAwake(on){
  try{
    if(on&&!lock&&'wakeLock' in navigator){ lock=await navigator.wakeLock.request('screen'); lock.addEventListener('release',()=>lock=null); }
    if(!on&&lock){ await lock.release(); lock=null; }
  }catch(e){ /* file:// или неподдерживаемый браузер — не критично */ }
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&!paused) keepAwake(true); });

function setPaused(p){
  paused=p;
  if(audio.el){ p?audio.el.pause():audio.el.play(); }
  $('play').textContent=p?'▶':'❚❚';
  keepAwake(!p);
  wake();
}

function seekTo(p){
  simTime=clamp(p,0,DURATION);
  resetTrails();
  if(audio.el) audio.el.currentTime=clamp(scoreToAudio(simTime),0,audio.el.duration||1e9);
}

function initUI(){
  SCORES.forEach((s,i)=>{
    const o=document.createElement('option'); o.value=i; o.textContent=s.t; $('score').appendChild(o);
  });
  $('score').onchange=e=>{ loadScore(+e.target.value); $('title').textContent=S.t; setPaused(true); };
  $('play').onclick=()=>setPaused(!paused);
  $('cmode').onclick=()=>{ MODE=(MODE+1)%3; $('cmode').textContent='цвет: '+MODES[MODE]; };
  $('cmode').textContent='цвет: '+MODES[MODE];
  $('recog').onclick=useTranscription;
  $('full').onclick=()=>{
    if(document.fullscreenElement) document.exitFullscreen();
    else (document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen).call(document.documentElement);
  };
  $('track').onpointerdown=e=>{
    const r=$('track').getBoundingClientRect();
    seekTo(((e.clientX-r.left)/r.width)*DURATION);
  };
  $('file').onchange=e=>{ if(e.target.files[0]) loadAudio(e.target.files[0]); };
  addEventListener('dragover',e=>e.preventDefault());
  addEventListener('drop',e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) loadAudio(f); });
  addEventListener('keydown',e=>{
    if(e.code==='Space'){ e.preventDefault(); setPaused(!paused); }
    if(e.code==='ArrowLeft') seekTo(simTime-5);
    if(e.code==='ArrowRight') seekTo(simTime+5);
    if(e.key==='f') $('full').click();
    wake();
  });
  ['pointermove','pointerdown','touchstart'].forEach(ev=>addEventListener(ev,wake,{passive:true}));
  addEventListener('resize',resize);
  addEventListener('orientationchange',()=>setTimeout(resize,120));
}

async function loadAudio(file){
  const st=$('status');
  st.textContent='читаю запись…';
  try{
    const ac=new (window.AudioContext||window.webkitAudioContext)();
    const buf=await ac.decodeAudioData(await file.arrayBuffer());
    audio.buf=buf;
    st.textContent='подгоняю партитуру под запись…';
    await new Promise(r=>setTimeout(r,30));
    const fit=autoAlign(buf);
    audio.k=fit.k; audio.off=fit.off; audio.fitted=true;
    if(audio.el){ audio.el.pause(); URL.revokeObjectURL(audio.el.src); }
    audio.el=new Audio(URL.createObjectURL(file));
    audio.el.onended=()=>setPaused(true);
    st.textContent=`подогнано: темп ×${(1/fit.k).toFixed(3)}, сдвиг ${fit.off.toFixed(2)} с`;
    $('fit').hidden=false; $('recog').hidden=false;
    $('fit').oninput=()=>{ audio.off=fit.off+(+$('fit').value)/100; };
    resetTrails(); setPaused(false);
  }catch(err){
    st.textContent='не удалось прочитать файл: '+err.message;
  }
}


/* Переход на распознанные данные: партитура заменяется тем, что услышано.
   Весь анализ (мотив, события, тональность) пересчитывается на этих нотах. */
function useTranscription(){
  if(!audio.buf) return;
  const st=$('status');
  st.textContent='распознаю высоты…';
  setTimeout(()=>{
    const notes=transcribe(audio.buf,Math.max(N,5),null,[28,96]);
    const V=assignVoices(notes,N);
    const nonEmpty=V.filter(v=>v.length>2);
    if(!nonEmpty.length){ st.textContent='ничего не распознано'; return; }
    S={t:'распознано из записи · '+nonEmpty.length+' голосов (гипотеза)',v:null};
    VOICES=nonEmpty.map(v=>v.sort((a,b)=>a.start-b.start));
    N=VOICES.length;
    DURATION=Math.max(...VOICES.flatMap(v=>v.map(n=>n.start+n.dur)));
    LO=Infinity;HI=-Infinity;
    for(const v of VOICES) for(const n of v){ if(n.midi<LO)LO=n.midi; if(n.midi>HI)HI=n.midi; }
    LO-=2;HI+=2;
    nameVoices(); ENTRIES=findEntries(); analyzeEvents(); analyzeKeys();
    autofit(); resetPlayback();
    audio.k=1; audio.off=0;            // распознано из этой же записи — подгонка не нужна
    $('title').textContent=S.t;
    st.textContent=`распознано ${notes.length} нот · раскладка по голосам — гипотеза, локальных признаков через паузу нет`;
  },30);
}
