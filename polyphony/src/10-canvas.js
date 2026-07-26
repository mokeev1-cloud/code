/* ---------- 1. холст, метрики, адаптив ---------- */

const cv=document.getElementById('stage');
const ctx=cv.getContext('2d');
let W=0,H=0,DPR=1,PHONE=false,TIGHT=false,U=12;

function resize(){
  DPR=clamp(devicePixelRatio||1,1,2.5);
  W=cv.clientWidth||innerWidth; H=cv.clientHeight||innerHeight;
  cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  PHONE = Math.min(W,H)<520;
  TIGHT = W<820;
  // единица типографики от меньшей стороны: одинаково читаемо на телефоне и мониторе
  U = clamp(Math.min(W,H)/44, 11, 19);
  document.documentElement.style.setProperty('--u', U+'px');
  autofit();
}
