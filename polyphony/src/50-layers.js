/* ---------- 6. слои отрисовки ---------- */

function drawGrid(){
  ctx.lineWidth=1;
  ctx.font=`${(U*0.62)|0}px ui-monospace,"SF Mono",Menlo,monospace`;
  ctx.textBaseline='middle';
  for(let m=Math.ceil(LO/12)*12;m<=HI;m+=12){
    const y=toY(m);
    ctx.beginPath();
    ctx.strokeStyle='rgba(150,160,215,0.06)';
    ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    if(!PHONE){
      ctx.fillStyle='rgba(150,160,215,0.20)';
      ctx.fillText('C'+(m/12-1),U*0.5,y-U*0.7);
    }
  }
}

function drawDensity(){
  // лента фактуры внизу: видно, как голоса накапливаются и расходятся
  const base=H-U*1.6, hmax=U*1.5;
  ctx.beginPath(); ctx.moveTo(0,base);
  for(let x=0;x<=W;x+=3){
    const t=simTime-(HEAD_X-x)/SPEED;
    const d=(t<0||t>DURATION)?0:densityAt(t);
    ctx.lineTo(x,base-(d/N)*hmax);
  }
  ctx.lineTo(W,base); ctx.closePath();
  ctx.fillStyle='rgba(150,160,215,0.075)'; ctx.fill();
}

function drawPlayhead(){
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'rgba(255,225,170,0)');
  g.addColorStop(.5,'rgba(255,225,170,0.14)');
  g.addColorStop(1,'rgba(255,225,170,0)');
  ctx.beginPath(); ctx.strokeStyle=g; ctx.lineWidth=1;
  ctx.moveTo(HEAD_X,0); ctx.lineTo(HEAD_X,H-U*2); ctx.stroke();
}

function drawScaleKey(){
  if(TIGHT) return;
  const x=W-U*1.6,y0=H*0.20,y1=H*0.66;
  const g=ctx.createLinearGradient(0,y1,0,y0);
  for(const [p,c] of RAMP) g.addColorStop(p,`rgb(${c.join(',')})`);
  ctx.fillStyle=g; ctx.fillRect(x,y0,3,y1-y0);
  ctx.fillStyle='rgba(150,160,215,0.34)';
  ctx.font=`${(U*0.6)|0}px ui-monospace,Menlo,monospace`;
  ctx.textAlign='right';
  ctx.fillText('высокие',x-U*0.5,y0+4);
  ctx.fillText('низкие',x-U*0.5,y1);
  ctx.textAlign='left';
}
