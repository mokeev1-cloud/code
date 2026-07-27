/* ---------- запуск ---------- */
initUI();
resize();
loadScore(0);
$('title').textContent=S.t;
setPaused(true);
requestAnimationFrame(frame);
