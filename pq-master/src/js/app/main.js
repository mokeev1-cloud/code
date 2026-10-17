/* =====================================================================
   app/main.js — запуск: тема, состояние меню, первый рендер.
   ===================================================================== */
(function init(){
  applyTheme();
  if (pqmSettings().sbCollapsed) $('#app').classList.add('sb-collapsed');
  if (typeof CM === 'undefined') toast('Редактор не загрузился: встроенный CodeMirror недоступен', 'bad');
  renderCats();
  document.body.classList.add('nobook');
  emitState('init');
  showView('home');
})();
