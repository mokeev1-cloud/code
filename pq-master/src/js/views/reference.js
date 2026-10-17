/* =====================================================================
   views/reference.js — справочник функций M (данные: m/reference.js).
   ===================================================================== */
const REFV = { cat: '', sel: 'Table.SelectRows' };
function renderReference(){
  $('#refCats').innerHTML = '<button data-c="" class="' + (REFV.cat ? '' : 'on') + '">все</button>' + M_REF_CATS.map(([c, n]) => '<button data-c="' + c + '" class="' + (REFV.cat === c ? 'on' : '') + '">' + c + ' ' + n + '</button>').join('');
  const q = ($('#refSearch').value || '').toLowerCase();
  const list = [...M_REF.values()].filter(f => (!REFV.cat || f.cat === REFV.cat) && (!q || f.name.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q)));
  $('#refList').innerHTML = list.map(f => '<li data-f="' + f.name + '" class="' + (f.name === REFV.sel ? 'on' : '') + '" title="' + escHtml(f.desc) + '"><span class="nm">' + escHtml(f.name) + '</span><span class="ic">' + escHtml(f.ret) + '</span></li>').join('') || '<li class="muted">ничего не найдено</li>';
  const f = M_REF.get(REFV.sel);
  if (!f){ $('#refDetail').innerHTML = ''; return; }
  const sig = '<span class="fnn">' + escHtml(f.name) + '</span>(' + f.params.map(p => (p.optional ? '<span class="muted">optional</span> ' : '') + '<span class="p">' + escHtml(p.name) + '</span> as <span class="t">' + escHtml(p.type) + '</span>').join(', ') + ') as <span class="t">' + escHtml(f.ret) + '</span>';
  const inSandbox = !!MLIB[f.name];
  const usedIn = S.A ? S.A.members.filter(m => m.calls.some(c => c.fn === f.name)).map(m => m.name) : [];
  $('#refDetail').innerHTML = '<div class="page-h"><h1>' + escHtml(f.name) + '</h1><span class="badge">' + escHtml(f.cat) + '</span>' + (inSandbox ? '<span class="badge ok" title="Функцию можно вычислять в песочнице">есть в песочнице</span>' : '<span class="badge" title="Только справка">нет в песочнице</span>') + '</div>' +
    '<div class="sig">' + sig + '</div><p style="font-size:15px">' + escHtml(f.desc) + '</p>' +
    (f.params.length ? '<h3>Параметры</h3><table class="t"><tr><th>Имя</th><th>Тип</th><th></th></tr>' + f.params.map(p => '<tr><td class="mono">' + escHtml(p.name) + '</td><td class="mono">' + escHtml(p.type) + '</td><td>' + (p.optional ? '<span class="badge">необязательный</span>' : '') + '</td></tr>').join('') + '</table>' : '') +
    (f.example ? '<h3>Пример</h3><pre class="code wrap">' + highlightM(f.example) + '</pre><div class="row"><button class="btn sm" id="refCopy">⧉ Копировать пример</button>' + (inSandbox ? '<button class="btn sm" id="refTry">▶ В песочницу</button>' : '') + '</div>' : '') +
    (usedIn.length ? '<h3>Используется в книге</h3><div>' + usedIn.map(n => '<button class="link" data-q="' + escHtml(n) + '">' + escHtml(n) + '</button>').join(', ') + '</div>' : '') +
    '<p class="small muted" style="margin-top:20px">Справочник — офлайн-подмножество стандартной библиотеки Power Query (' + M_REF.size + ' функций). Полная документация — learn.microsoft.com/powerquery-m (откройте сами: страница не обращается к сети).</p>';
  if ($('#refCopy')) $('#refCopy').onclick = async () => { await copyText(f.example); toast('Пример скопирован'); };
  if ($('#refTry')) $('#refTry').onclick = () => { showView('sandbox'); sbEnsureEditor(); SB.exprView.dispatch({ changes: { from: 0, to: SB.exprView.state.doc.length, insert: f.example } }); sbEval(); };
  $$('[data-q]', $('#refDetail')).forEach(b => b.onclick = () => openInEditor(b.dataset.q));
}
$('#refCats').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b){ REFV.cat = b.dataset.c; renderReference(); } });
$('#refList').addEventListener('click', e => { const li = e.target.closest('[data-f]'); if (li){ REFV.sel = li.dataset.f; renderReference(); } });
$('#refSearch').addEventListener('input', () => { const q = $('#refSearch').value.toLowerCase(); const first = [...M_REF.values()].find(f => f.name.toLowerCase().includes(q)); if (first && q) REFV.sel = first.name; renderReference(); });
function openReference(name){ REFV.sel = name; REFV.cat = ''; $('#refSearch').value = ''; showView('reference'); renderReference(); }
registerView('reference', { render: renderReference, alwaysRender: true });
