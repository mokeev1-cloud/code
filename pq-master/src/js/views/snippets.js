/* =====================================================================
   views/snippets.js — галерея сниппетов и форма параметров (данные: opt/snippets.js).
   Вставка: новым запросом (setWork) или в позицию курсора редактора.
   ===================================================================== */
let SNIP_SEL = null;
function renderSnippets(){
  $('#snipGallery').innerHTML = SNIPPETS.map(s => '<div class="snip' + (s.id === SNIP_SEL ? ' on' : '') + '" data-sn="' + s.id + '"><span class="ic">' + s.icon + '</span><b>' + escHtml(s.title) + '</b><div>' + escHtml(s.desc) + '</div></div>').join('');
  $$('[data-sn]', $('#snipGallery')).forEach(x => x.onclick = () => selectSnippet(x.dataset.sn));
  renderSnipForm();
}
function selectSnippet(id){ SNIP_SEL = id; renderSnippets(); }
function snipValues(sn){ const v = {}; for (const f of sn.fields) v[f.k] = ($('#snf-' + f.k) || {}).value; return v; }
function renderSnipForm(){
  const sn = SNIPPETS.find(s => s.id === SNIP_SEL);
  if (!sn){ $('#snipForm').innerHTML = '<div class="muted">Выберите шаблон слева.</div>'; return; }
  const qs = S.A ? S.A.members.map(m => m.name) : [];
  const field = f => {
    if (f.type === 'select') return '<select id="snf-' + f.k + '">' + f.opts.map(([v, l]) => '<option value="' + v + '"' + (v === f.def ? ' selected' : '') + '>' + escHtml(l) + '</option>').join('') + '</select>';
    if (f.type === 'query') return qs.length ? '<select id="snf-' + f.k + '">' + qs.map(n => '<option>' + escHtml(n) + '</option>').join('') + '</select>' : '<input type="text" id="snf-' + f.k + '" value="Запрос1">';
    return '<input type="' + (f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text') + '" id="snf-' + f.k + '" value="' + escHtml(f.def || '') + '" style="width:100%">';
  };
  $('#snipForm').innerHTML = '<h2>' + sn.icon + ' ' + escHtml(sn.title) + '</h2><p class="small muted">' + escHtml(sn.desc) + '</p><div class="form-grid">' + sn.fields.map(f => '<span class="small">' + escHtml(f.label) + '</span>' + field(f)).join('') + '<span class="small">Имя запроса</span><input type="text" id="snfName" value="' + escHtml(S.work ? freeQueryName(S.work, sn.name) : sn.name) + '"></div>' +
    '<h3>Код</h3><pre class="code wrap" id="snipPrev" style="max-height:40vh"></pre>' +
    '<div class="row"><button class="btn pri" id="snipAdd"' + (S.work ? '' : ' disabled') + '>Добавить как новый запрос</button><button class="btn" id="snipIns"' + (S.work ? '' : ' disabled') + '>Вставить в редактор</button><button class="btn" id="snipCopy">⧉ Копировать</button></div>' + (S.work ? '' : '<div class="small muted">Откройте книгу, чтобы добавлять запросы.</div>');
  const upd = () => { try { $('#snipPrev').innerHTML = highlightM(sn.gen(snipValues(sn))); } catch (e){ $('#snipPrev').textContent = e.message; } };
  $$('#snipForm input, #snipForm select').forEach(x => x.addEventListener('input', upd)); upd();
  $('#snipCopy').onclick = async () => { await copyText(sn.gen(snipValues(sn))); toast('Код скопирован'); };
  $('#snipAdd').onclick = () => { try { const nm = $('#snfName').value.trim(); setWork(addQuery(S.work, nm, sn.gen(snipValues(sn))), 'snippet', 'Сниппет «' + sn.title + '» → «' + nm + '»'); openInEditor(nm); } catch (e){ toast(e.message, 'bad'); } };
  $('#snipIns').onclick = async () => {
    const code = sn.gen(snipValues(sn));
    if (!ED.view || !ED.query){ return toast('Откройте запрос в редакторе', 'warn'); }
    showView('editor'); const p = ED.view.state.selection.main.head; ED.view.dispatch({ changes: { from: p, insert: code }, selection: { anchor: p + code.length } }); ED.view.focus();
    toast('Вставлено в «' + ED.query + '» — не забудьте «Применить»', 'ok');
  };
}
registerView('snippets', { render: renderSnippets, alwaysRender: true });
