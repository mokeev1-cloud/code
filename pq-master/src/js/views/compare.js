/* =====================================================================
   views/compare.js — сравнение двух версий (файлы или рабочая ↔ исходная).
   ===================================================================== */
async function loadCmp(which, f){
  try { const b = await loadBookFromBytes(f.name, await readFileBytes(f)); S[which] = { name: f.name, text: b.origSection }; renderCompare(); }
  catch (err){ toast(err.message, 'bad'); }
}
$('#cmpAFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadCmp('cmpA', f); });
$('#cmpBFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadCmp('cmpB', f); });
$('#cmpOrig').onclick = () => { if (!S.book) return toast('Откройте книгу', 'warn'); S.cmpA = { name: S.book.name + ' (исходная)', text: S.book.origSection }; S.cmpB = { name: 'рабочая версия', text: S.work, live: true }; renderCompare(); };
function stepNames(memberText){ try { const a = analyzeSection('section S;\r\n' + memberText, {}); const m = a.members[0]; return m && m.steps ? m.steps.steps.map(s => s.name) : []; } catch { return []; } }
function renderCompare(){
  const A = S.cmpA || (S.work ? { name: 'рабочая версия', text: S.work, live: true } : null);
  const B = S.cmpB && S.cmpB.live ? { name: S.cmpB.name, text: S.work } : S.cmpB;
  $('#cmpAName').textContent = A ? A.name : '—'; $('#cmpBName').textContent = B ? B.name : '—';
  if (!A || !B){ $('#cmpResult').innerHTML = '<div class="note small">Выберите две версии или нажмите «Рабочая ↔ исходная».</div>'; return; }
  const c = compareSections(A.text, B.text);
  let h = '<div class="card"><div class="chips"><span class="chip">изменено: <b>' + c.changed.length + '</b></span><span class="chip">только в Б: <b>' + c.added.length + '</b></span><span class="chip">только в А: <b>' + c.removed.length + '</b></span><span class="chip">совпадают: <b>' + c.same.length + '</b></span></div></div>';
  for (const x of c.changed){ const sa = stepNames(x.old), sb = stepNames(x.text); const addS = sb.filter(s => !sa.includes(s)), remS = sa.filter(s => !sb.includes(s));
    h += '<div class="card"><h3 style="margin:0 0 6px">✎ ' + escHtml(x.name) + '</h3>' + (addS.length || remS.length ? '<div class="small">' + (addS.length ? 'новые шаги: <b>' + addS.map(escHtml).join(', ') + '</b> ' : '') + (remS.length ? 'убраны шаги: <b>' + remS.map(escHtml).join(', ') + '</b>' : '') + '</div>' : '') + '<div class="diff">' + diffHtml(lineDiff(x.old, x.text)) + '</div></div>'; }
  for (const x of c.added) h += '<div class="card"><h3 style="margin:0 0 6px">＋ только в Б: ' + escHtml(x.name) + '</h3><pre class="code">' + highlightM(x.text) + '</pre></div>';
  for (const x of c.removed) h += '<div class="card"><h3 style="margin:0 0 6px">－ только в А: ' + escHtml(x.name) + '</h3><pre class="code">' + highlightM(x.old) + '</pre></div>';
  $('#cmpResult').innerHTML = h;
}
registerView('compare', { render: renderCompare, alwaysRender: true });
