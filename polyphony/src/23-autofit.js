/* ---------- 3. автоподгонка визуала под материал и экран ---------- */

let SPEED=55,HIST_SEC=7,HEAD_X=0;
function autofit(){
  if(!VOICES.length) return;
  // медианный интервал между атаками — «пульс» материала
  const iois=[];
  for(const v of VOICES) for(let i=1;i<v.length;i++){
    const d=v[i].start-v[i-1].start;
    if(d>0.02&&d<3) iois.push(d);
  }
  iois.sort((a,b)=>a-b);
  const beat=iois.length?iois[iois.length>>1]:0.3;
  // окно истории — музыкальное, а не пиксельное: ~24 доли материала
  HIST_SEC=clamp(beat*24,3.5,9);
  HEAD_X=W*(PHONE?0.74:0.82);
  // скорость подбирается так, чтобы шлейф ровно заполнял место слева от головы
  SPEED=Math.max(18,(HEAD_X-U*1.5)/HIST_SEC);
}
