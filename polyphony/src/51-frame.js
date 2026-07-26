/* ---------- 7. кадр ---------- */

function frame(now){
  requestAnimationFrame(frame);
  if(!lastFrame) lastFrame=now;
  let dt=(now-lastFrame)/1000; lastFrame=now;
  if(dt>0.25) dt=0.25;

  // если загружена запись — время ведёт она, партитура подтянута под неё
  if(audio.el&&!audio.el.paused){
    const st=audioToScore(audio.el.currentTime);
    if(Math.abs(st-simTime)>0.4) resetTrails();
    simTime=st;
  } else if(!paused){
    simTime+=dt;
    if(simTime>DURATION+2){ simTime=0; resetTrails(); }
  }

  ctx.fillStyle='rgba(5,6,15,0.17)';
  ctx.fillRect(0,0,W,H);

  drawKeyField();
  drawGrid(); drawDensity(); drawPlayhead();

  const cur=VOICES.map(v=>envelope(v,currentNote(v,simTime),simTime));
  const theme=VOICES.map((_,i)=>cur[i].midi!=null&&themeAt(i,simTime));
  const anyTheme=theme.some(Boolean);

  const running=(audio.el&&!audio.el.paused)||!paused;
  if(running){
    for(let i=0;i<N;i++){
      if(cur[i].midi==null) continue;
      const a=hist[i],l=a[a.length-1];
      // храним midi, а не y: при повороте экрана шлейф не съезжает
      if(!l||simTime-l.t>=HIST_STEP)
        // разрыв: голос молчал — прямую через паузу не тянем
        a.push({t:simTime,midi:cur[i].midi,loud:cur[i].loud,th:theme[i],
                brk:!!l&&simTime-l.t>HIST_STEP*2.5});
    }
    for(let i=0;i<N;i++)
      // возраст ДОЛЖЕН лежать в [0,HIST_SEC] — иначе после петли точки «из будущего» тянут полосы
      hist[i]=hist[i].filter(p=>{const a=simTime-p.t;return a>=0&&a<=HIST_SEC;});

    for(let i=0;i<N;i++) for(let j=i+1;j<N;j++){
      if(cur[i].midi==null||cur[j].midi==null||lastMidi[i]==null||lastMidi[j]==null) continue;
      const c=classifyPair(lastMidi[i]-lastMidi[j],cur[i].midi-cur[j].midi,
                           cur[i].midi-lastMidi[i],cur[j].midi-lastMidi[j]);
      if(!c) continue;
      const key=c+i+'-'+j;
      if(cooldown[key]&&simTime-cooldown[key]<0.6) continue;
      cooldown[key]=simTime;
      flashUntil[i]=flashUntil[j]=simTime+0.7;   // вспыхивает пара, а не все голоса
      marks.push({t:simTime,kind:c,a:cur[i].midi,b:cur[j].midi});
    }
    marks=marks.filter(m=>simTime-m.t<HIST_SEC);
  }

  /* шлейфы. Когда тема звучит — остальные голоса уходят в фон: это и есть
     главное высказывание картинки. */
  for(let i=0;i<N;i++){
    const arr=hist[i]; ctx.lineCap='round';
    for(let k=1;k<arr.length;k++){
      const p0=arr[k-1],p1=arr[k];
      const age=simTime-p1.t,a=Math.max(0,1-age/HIST_SEC);
      const x1=HEAD_X-age*SPEED;
      if(x1<-20||p1.brk) continue;
      const dim=(anyTheme&&!p1.th)?0.4:1;
      ctx.beginPath();
      ctx.moveTo(HEAD_X-(simTime-p0.t)*SPEED,toY(p0.midi));
      ctx.lineTo(x1,toY(p1.midi));
      ctx.lineWidth=(p1.th?6.5:1.8)+a*U*(p1.th?0.55:0.3)+p1.loud*(p1.th?4:2);
      ctx.strokeStyle=pitchColor(p1.midi,(p1.th?0.25:0.03)+p1.loud*(p1.th?0.5:0.25),
                                 (p1.th?0.22+a*0.7:0.05+a*0.42)*dim);
      ctx.stroke();
      if(p1.th){
        // узкое ядро внутри утолщения: градиент вдоль сегмента от высоты к белому
        const gx=ctx.createLinearGradient(HEAD_X-(simTime-p0.t)*SPEED,toY(p0.midi),x1,toY(p1.midi));
        gx.addColorStop(0,pitchColor(p0.midi,0.55,a*0.5));
        gx.addColorStop(1,`rgba(255,250,235,${0.35+a*0.62})`);
        ctx.strokeStyle=gx;
        ctx.lineWidth=1.4+p1.loud*1.6;
        ctx.stroke();
      }
    }
  }

  /* --- события материала: покой, педаль, секвенция --- */
  const xOf=t=>HEAD_X-(simTime-t)*SPEED;
  ctx.font=`600 ${(U*0.62)|0}px ui-monospace,Menlo,monospace`;

  for(const t of CAD){
    const x=xOf(t); if(x<-U*6||x>W+U*6) continue;
    const g=ctx.createLinearGradient(x-U*1.2,0,x+U*1.2,0);
    g.addColorStop(0,'rgba(255,214,140,0)');
    g.addColorStop(.5,'rgba(255,214,140,0.16)');
    g.addColorStop(1,'rgba(255,214,140,0)');
    ctx.fillStyle=g; ctx.fillRect(x-U*1.2,0,U*2.4,H-U*2);
    ctx.fillStyle='rgba(255,224,168,0.8)'; ctx.textAlign='center';
    ctx.fillText('покой',x,U*1.6); ctx.textAlign='left';
  }

  for(const p of PED){
    const x0=xOf(p.t),x1e=xOf(p.end);
    if(x1e<-U*4||x0>W+U*4) continue;
    const y=toY(p.midi);
    ctx.strokeStyle='rgba(180,205,255,0.5)'; ctx.lineWidth=1.2;
    ctx.setLineDash([2,4]);
    ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1e,y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='rgba(190,212,255,0.75)';
    ctx.fillText('педаль',x0+U*0.3,y+U*1.1);
  }

  let seqLab=null;
  for(const q of SEQ){
    const x0=xOf(q.t),x1e=xOf(q.end);
    if(x1e<0||x0>W) continue;
    const y=toY(VOICES[q.v][currentNote(VOICES[q.v],Math.max(q.t,Math.min(simTime,q.end)))||0].midi);
    ctx.strokeStyle='rgba(160,185,240,0.34)'; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(x0,y-U*1.5); ctx.lineTo(x1e,y-U*1.5);
    ctx.moveTo(x0,y-U*1.5); ctx.lineTo(x0,y-U*1.1);
    ctx.moveTo(x1e,y-U*1.5); ctx.lineTo(x1e,y-U*1.1);
    ctx.stroke();
    if(x1e<=HEAD_X&&(!seqLab||x1e>seqLab.x)) seqLab={x:(x0+x1e)/2,y:y-U*1.9,n:q.n};
  }
  if(seqLab){
    ctx.fillStyle='rgba(178,200,245,0.8)'; ctx.textAlign='center';
    ctx.fillText('секвенция ×'+seqLab.n,seqLab.x,seqLab.y); ctx.textAlign='left';
  }

  /* События говорят светом и формой — цвет занят высотой.
     Унисон — вспышка белого света: два голоса стали одним.
     Перекрест — линии, буквально меняющиеся местами. Обе подписаны:
     без подписи форму приходится угадывать. */
  ctx.font=`600 ${(U*0.66)|0}px ui-monospace,Menlo,monospace`;
  ctx.textAlign='center';
  for(const m of marks){
    const age=simTime-m.t, a=Math.max(0,1-age/HIST_SEC), x=HEAD_X-age*SPEED;
    if(x<-U*8) continue;
    const ya=toY(m.a), yb=toY(m.b), lab=Math.max(0,1-age/2.5);
    if(m.kind==='unison'){
      const y=(ya+yb)/2, r=U*(1.4+(1-a)*3.4);
      const g=ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,`rgba(255,255,255,${a})`);
      g.addColorStop(.25,`rgba(255,250,225,${a*0.72})`);
      g.addColorStop(.6,`rgba(255,238,190,${a*0.26})`);
      g.addColorStop(1,'rgba(255,238,190,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,6.29); ctx.fill();
      ctx.beginPath(); ctx.fillStyle=`rgba(255,255,255,${a})`;
      ctx.arc(x,y,U*0.3,0,6.29); ctx.fill();
      if(lab>0){
        ctx.fillStyle=`rgba(255,252,238,${lab})`;
        ctx.fillText('унисон',x,y-r-U*0.35);
      }
    }else{
      // две линии, меняющиеся местами: сам жест и есть перекрест
      const w=U*1.5;
      ctx.lineWidth=2.4; ctx.lineCap='round';
      ctx.strokeStyle=`rgba(255,255,255,${a*0.95})`;
      ctx.shadowColor='rgba(190,215,255,0.9)'; ctx.shadowBlur=U*0.9;
      ctx.beginPath();
      ctx.moveTo(x-w,ya); ctx.lineTo(x+w,yb);
      ctx.moveTo(x-w,yb); ctx.lineTo(x+w,ya);
      ctx.stroke();
      ctx.shadowBlur=0;
      if(lab>0){
        ctx.fillStyle=`rgba(226,238,255,${lab})`;
        ctx.fillText('перекрест',x,Math.min(ya,yb)-U*0.6);
      }
    }
  }
  ctx.textAlign='left';

  /* головы */
  for(let i=0;i<N;i++){
    if(cur[i].midi==null) continue;
    const y=toY(cur[i].midi);
    const boost=Math.max(0,(flashUntil[i]-simTime)/0.7);
    const dim=(anyTheme&&!theme[i])?0.45:1;
    const r=(U*0.22)+cur[i].loud*U*0.8+boost*U*0.3+(theme[i]?U*0.25:0);
    if(theme[i]){
      ctx.beginPath();
      ctx.strokeStyle=`rgba(255,236,190,${0.30+cur[i].loud*0.35})`;
      ctx.lineWidth=1.4; ctx.arc(HEAD_X,y,r+U*0.5,0,6.29); ctx.stroke();
    }
    ctx.beginPath();
    ctx.fillStyle=pitchColor(cur[i].midi,0.08+cur[i].loud*0.75+boost*0.3,dim);
    ctx.shadowColor=pitchColor(cur[i].midi,0.55,1);
    ctx.shadowBlur=(4+cur[i].loud*30+boost*22)*dim;
    ctx.arc(HEAD_X,y,r,0,6.29); ctx.fill();
    ctx.shadowBlur=0;
  }

  /* подпись темы — единственный постоянный текст на холсте */
  ctx.font=`600 ${(U*0.72)|0}px ui-monospace,Menlo,monospace`;
  for(let i=0;i<N;i++){
    if(!theme[i]) continue;
    ctx.fillStyle='rgba(255,238,198,0.9)';
    ctx.fillText('тема · '+voiceName(i),HEAD_X+U*1.1,toY(cur[i].midi)-U*0.95);
  }

  drawScaleKey();
  if(running) for(let i=0;i<N;i++) lastMidi[i]=cur[i].midi;
  updateHud();
}
