/* =====================================================================
   views/ai.js — «Ответ ИИ»: обратная подстановка меток, проверки, diff,
   принятие в рабочую версию (далее — обычное «Сохранить»).
   parseAiInput / mergeIntoBase / syntaxIssues — общие функции (их использует
   и оптимизатор, и самотест).
   ===================================================================== */
const aiDict = () => S.aiDict || S.dict;
function parseAiInput(raw){
  const t = raw.replace(/^﻿/, '').trim();
  const tryPatch = s => { try { const o = JSON.parse(s); if (o && typeof o === 'object' && (o.kind === 'patch' || o.members || o.section)) return o; } catch { /* не JSON */ } return null; };
  let p = t.startsWith('{') && tryPatch(t); if (p) return { type: 'patch', obj: p };
  const fences = [...t.matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  for (const f of fences) if (/^json$/i.test(f[1])){ p = tryPatch(f[2]); if (p) return { type: 'patch', obj: p }; }
  if (fences.length){
    const mf = fences.filter(f => /^(m|powerquery|pq|powerqueryformula)$/i.test(f[1]));
    const use = mf.length ? mf : fences.filter(f => !/^json$/i.test(f[1]));
    if (use.length) return { type: 'code', code: use.map(f => f[2]).join('\n') };
  }
  return { type: 'code', code: t };
}
const normWs = s => s.replace(/\s+/g, ' ').trim();
function mergeIntoBase(base, newMembers, removeSet, dropMissing){
  const sec = parseSection(base); const nl = /\r\n/.test(base) ? '\r\n' : '\n';
  const nm = new Map(newMembers.map(x => [x.name, x.expr]));
  let out = '', last = 0;
  for (const m of sec.members){
    if (removeSet.has(m.name) || (dropMissing && !nm.has(m.name))){ out += base.slice(last, m.start); let e = m.end; const after = /^[ \t]*\r?\n(?:[ \t]*\r?\n)?/.exec(base.slice(e)); if (after) e += after[0].length; last = e; continue; }
    if (nm.has(m.name)){ const ex = nm.get(m.name), old = base.slice(m.exprStart, m.exprEnd); const same = ex === old || normWs(ex) === normWs(old);
      out += base.slice(last, m.exprStart) + (same ? old : safeExprEnd(/^\s/.test(ex) ? ex : ' ' + ex, nl)) + base.slice(m.exprEnd, m.end); last = m.end; nm.delete(m.name); }
  }
  out += base.slice(last);
  if (nm.size){ out = out.replace(/\s*$/, ''); for (const [name, ex] of nm) out += nl + nl + 'shared ' + mQuoteName(name) + ' =' + safeExprEnd(/^\s/.test(ex) ? ex : ' ' + ex, nl) + ';'; out += nl; }
  return out;
}
function syntaxIssues(code){
  const toks = lexM(code); const iss = []; const st = []; const last = toks[toks.length - 1];
  if (last && (last.t === 'str' || last.t === 'qid') && !/"$/.test(last.v.slice(last.t === 'qid' ? 2 : 1))) iss.push('незакрытая строка или #"имя" в конце текста');
  if (last && last.t === 'cmt' && last.v.startsWith('/*') && !last.v.endsWith('*/')) iss.push('незакрытый комментарий /* … */');
  for (const t of toks){ if (t.t !== 'op') continue; if ('([{'.includes(t.v)) st.push(t.v); else if (')]}'.includes(t.v)){ const o = st.pop(); if (!o || '([{'.indexOf(o) !== ')]}'.indexOf(t.v)){ iss.push('несогласованная скобка «' + t.v + '» около символа ' + t.s); break; } } }
  if (st.length) iss.push('не закрыто скобок: ' + st.length);
  return iss;
}
function renderAiInputs(){
  const d = aiDict();
  $('#buildDictInfo').innerHTML = d && d.size ? 'меток: <b>' + d.size + '</b>' + (S.aiDict ? ' (из файла)' : ' <span class="muted">(словарь сеанса)</span>') : '<span class="muted">пуст — загрузите словарь, сохранённый при обезличивании</span>';
  if (!S.work) return;
  $('#singleTargetRow').innerHTML = 'Если в ответе одно выражение без «shared Имя =», это запрос: <select id="singleTarget"><option value="">— выберите —</option>' + parseSection(S.work).members.map(m => '<option>' + escHtml(m.name) + '</option>').join('') + '<option value="__new">новый запрос…</option></select> <input type="text" id="singleNew" placeholder="имя нового запроса" class="hidden">';
  const st = $('#singleTarget'); st.onchange = () => $('#singleNew').classList.toggle('hidden', st.value !== '__new');
}
$('#buildDictFile').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { S.aiDict = await loadDictFile(f); renderAiInputs(); toast('Словарь: ' + S.aiDict.size + ' меток', 'ok'); } catch (err){ toast(err.message, 'bad'); } });
$('#aiFile').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; $('#aiText').value = await f.text(); $('#aiFileInfo').textContent = f.name; });

/** Ядро проверки ответа ИИ (без UI) — используется видом и самотестом */
function checkAiAnswer(base, raw, dict, opts){
  opts = opts || {};
  const nlBase = /\r\n/.test(base); const fixNl = s => nlBase && !/\r\n/.test(s) ? s.replace(/\n/g, '\r\n') : s;
  const restoreAll = []; const R = s => { const r = restoreTokens(s, dict); restoreAll.push(r); return r.out; };
  const res = { errors: [], warns: [], notes: '', newSection: null, used: 0 };
  let members = [], remove = new Set(), dropMissing = false;
  const inp = parseAiInput(raw);
  if (inp.type === 'patch'){
    const o = inp.obj; res.notes = [o.summary, o.notes].filter(Boolean).join(' · ');
    if (o.section){ const code = fixNl(R(String(o.section))); members = parseSection(code).members.map(m => ({ name: m.name, expr: code.slice(m.exprStart, m.exprEnd) })); dropMissing = true; }
    const unq = n => n.replace(/^#"(.*)"$/, (x, y) => y.replace(/""/g, '"'));
    for (const [k, v] of Object.entries(o.members || {})) members.push({ name: unq(R(k)), expr: fixNl(R(String(v))).replace(/;\s*$/, '') });
    for (const k of o.remove || []) remove.add(unq(R(String(k))));
  } else {
    const code = fixNl(R(inp.code)); const sec = parseSection(code);
    if (sec.members.length){ members = sec.members.map(m => ({ name: m.name, expr: code.slice(m.exprStart, m.exprEnd) })); dropMissing = sec.hasHeader || !!opts.dropMissing; }
    else { if (!opts.single){ res.needTarget = true; return res; } members = [{ name: opts.single, expr: code.replace(/;\s*$/, '') }]; }
  }
  const unknown = restoreAll.flatMap(r => r.unknown), near = restoreAll.flatMap(r => r.nearMiss), stray = restoreAll.reduce((a, r) => a + r.stray, 0);
  const used = new Set(); restoreAll.forEach(r => r.used.forEach(x => used.add(x))); res.used = used.size;
  if (unknown.length) res.errors.push('Метки, которых нет в словаре: ' + [...new Set(unknown.map(u => u.token))].join(', ') + '. ИИ придумал или исказил метку, либо загружен не тот словарь.');
  if (near.length) res.errors.push('Похоже на искажённые метки: ' + [...new Set(near.map(u => u.text))].slice(0, 20).join(', ') + '. Исправьте на точный вид ⟦КАТ_N⟧.');
  if (stray) res.warns.push('Одиночных скобок ⟦ или ⟧: ' + stray + ' — проверьте, не обрезана ли метка.');
  for (const mm of members){ const iss = syntaxIssues(mm.expr); if (iss.length) res.warns.push('«' + mm.name + '»: ' + iss.join('; ')); }
  res.newSection = mergeIntoBase(base, members, remove, dropMissing);
  return res;
}
async function runAiCheck(){
  const out = $('#buildResult'); S.aiNew = null; S.aiChanged = []; $('#acceptBtn').disabled = true; $('#acceptEditBtn').disabled = true; $('#aiVerifyBtn').disabled = true; $('#dlSectionBtn').disabled = true;
  if (!S.work){ out.innerHTML = '<div class="note bad">Сначала откройте исходную книгу.</div>'; return; }
  const raw = $('#aiText').value; if (!raw.trim()){ out.innerHTML = '<div class="note warn">Вставьте ответ ИИ или загрузите файл.</div>'; return; }
  const sel = $('#singleTarget') ? $('#singleTarget').value : '';
  const single = sel === '__new' ? ($('#singleNew').value || '').trim() : sel;
  const r = checkAiAnswer(S.work, raw, aiDict(), { dropMissing: $('input[name=missing]:checked').value === 'drop', single });
  if (r.needTarget){ out.innerHTML = '<div class="note warn">В ответе одно выражение без «shared Имя =». Выберите справа, какой запрос оно заменяет.</div>'; return; }
  const book = S.book; const cmp = compareSections(S.work, r.newSection);
  let h = (r.notes ? '<div class="note small"><b>Комментарий ИИ:</b> ' + escHtml(r.notes) + '</div>' : '') + '<div class="small">Меток восстановлено: <b>' + r.used + '</b> уникальных.</div>' +
    '<div class="chips"><span class="chip">изменено: <b>' + cmp.changed.length + '</b></span><span class="chip">добавлено: <b>' + cmp.added.length + '</b></span><span class="chip">удалено: <b>' + cmp.removed.length + '</b></span><span class="chip">без изменений: <b>' + cmp.same.length + '</b></span></div>';
  const meta = book.meta || {};
  for (const x of cmp.removed){ const md = meta[x.name] || {}; if (metaVal(md.FillEnabled) || metaVal(md.FillToDataModelEnabled)) r.warns.push('Удаляется запрос «' + x.name + '», который загружался на лист или в модель: таблица перестанет обновляться. Если это переименование — переименуйте обратно.'); }
  if (cmp.added.length && book.family === 'excel') r.warns.push('Новые запросы появятся в Excel как «только подключение». Загрузить на лист: Данные → Запросы и подключения → правый клик → Загрузить в….');
  if (book.container === 'pbi-schema' && (cmp.added.length || cmp.removed.length)) r.errors.push('.pbit (DataModelSchema): добавлять и удалять запросы нельзя — только менять существующие.');
  const lits = newLiterals(S.work, r.newSection);
  if (lits.length){ const risky = lits.filter(x => x.risky); if (risky.length) r.warns.push('В новом коде появились новые пути/адреса: ' + risky.map(x => x.v).slice(0, 10).join(', ') + '. Проверьте их.');
    h += '<details><summary>Новые литералы (' + lits.length + ')</summary><table class="t">' + lits.map(x => '<tr><td class="mono">' + escHtml(x.v) + '</td><td>' + escHtml(x.kind) + '</td><td>' + (x.risky ? '<span class="sev warn">проверить</span>' : '') + '</td></tr>').join('') + '</table></details>'; }
  const A2 = analyzeSection(r.newSection, meta); const before = S.opt.score, after = optimizeSection(r.newSection, A2, lintSection(A2)).score;
  h += '<div class="small">Оценка оптимизатора: ' + before + ' → <b style="color:' + (after >= before ? 'var(--ok)' : 'var(--bad)') + '">' + after + '</b></div>';
  for (const c of cmp.changed) h += '<div class="card"><div class="card-h"><h3 style="margin:0">✎ ' + escHtml(c.name) + '</h3><span class="sp"></span><span class="small" data-aiv="' + escHtml(c.name) + '"></span></div><div class="diff">' + diffHtml(lineDiff(c.old, c.text)) + '</div></div>';
  for (const c of cmp.added) h += '<div class="card"><h3 style="margin:0">＋ ' + escHtml(c.name) + '</h3><div class="diff">' + diffHtml(lineDiff('', c.text)) + '</div></div>';
  for (const c of cmp.removed) h += '<div class="card"><h3 style="margin:0">－ ' + escHtml(c.name) + '</h3><div class="diff">' + diffHtml(lineDiff(c.old, '')) + '</div></div>';
  const head = r.errors.map(e => '<div class="note bad">⛔ ' + escHtml(e) + '</div>').join('') + r.warns.map(w => '<div class="note warn small">' + escHtml(w) + '</div>').join('');
  if (!r.errors.length){ S.aiNew = r.newSection; S.aiChanged = cmp.changed.map(c => c.name).concat(cmp.added.map(c => c.name)); $('#acceptBtn').disabled = $('#acceptEditBtn').disabled = !(cmp.changed.length + cmp.added.length + cmp.removed.length); $('#aiVerifyBtn').disabled = !cmp.changed.length; $('#dlSectionBtn').disabled = false;
    out.innerHTML = '<div class="note ' + (r.warns.length ? 'warn' : 'ok') + '">' + (cmp.changed.length + cmp.added.length + cmp.removed.length ? '✔ Проверки пройдены' + (r.warns.length ? ' с предупреждениями' : '') + '. Нажмите «Принять в рабочую версию», затем сохраните книгу (Ctrl+S — копия, Ctrl+Shift+S — в оригинал).' : 'Изменений относительно рабочей версии нет.') + '</div>' + head + h; }
  else out.innerHTML = head + h;
}
$('#checkBtn').onclick = () => runAiCheck().catch(err => { console.error(err); toast(err.message, 'bad'); });
$('#acceptBtn').onclick = () => { if (!S.aiNew) return; setWork(S.aiNew, 'ai', 'Ответ ИИ принят'); S.aiNew = null; $('#acceptBtn').disabled = $('#acceptEditBtn').disabled = $('#aiVerifyBtn').disabled = true; toast('Принято в рабочую версию. Сохраните книгу: Ctrl+S или «В оригинал».', 'ok', 6000); };
$('#acceptEditBtn').onclick = () => { if (!S.aiNew) return; const first = (S.aiChanged || [])[0]; setWork(S.aiNew, 'ai', 'Ответ ИИ принят'); S.aiNew = null; $('#acceptBtn').disabled = $('#acceptEditBtn').disabled = $('#aiVerifyBtn').disabled = true; if (first) openInEditor(first); toast('Принято (откат — «История правок»). Правьте и сохраняйте: Ctrl+S — копия, Ctrl+Shift+S — в оригинал с резервной копией.', 'ok', 7000); };
/** Сверка ответа ИИ на данных этого компьютера: изменённые запросы до и после */
async function aiVerifyOnData(){
  if (!S.aiNew) return; const sec = S.aiNew; const names = [...$$('[data-aiv]')].map(x => x.dataset.aiv);
  $('#aiVerifyBtn').disabled = true; await dataPrepare();
  for (const n of names){
    const cell = $('[data-aiv="' + CSS.escape(n) + '"]'); if (!cell) continue; cell.innerHTML = '⏳ вычисление…'; await new Promise(r => setTimeout(r, 0));
    const a = dataRunQuery(S.work, n, new Map()), b = dataRunQuery(sec, n, new Map());
    const rows = x => { const f = x.steps[x.steps.length - 1]; return f && f.rows != null ? fmtN(f.rows) : '—'; };
    if (a.error && a.error.need || b.error && b.error.need) cell.innerHTML = '<span class="pqx-rec warn">🔌 нужен источник</span> <button class="link" data-go="data">прикрепить в «Проверке на данных»</button>';
    else if (b.error) cell.innerHTML = '<span class="pqx-rec warn">✖ после правки ошибка</span> ' + escHtml(b.error.message.slice(0, 120));
    else if (a.error) cell.innerHTML = '<span class="pqx-rec ok">✓ раньше была ошибка, теперь ' + rows(b) + ' строк</span>';
    else { const c = tableCompare(a.value, b.value); cell.innerHTML = '<span class="pqx-rec ' + (c.same ? 'ok' : 'warn') + '">' + (c.same ? '✓ на данных тот же результат' : '≠ результат изменился') + '</span> <span class="muted">' + rows(a) + ' → ' + rows(b) + ' строк' + (c.note ? ' · ' + escHtml(c.note) : '') + ' · ' + (a.ms / 1000).toFixed(2).replace('.', ',') + ' → ' + (b.ms / 1000).toFixed(2).replace('.', ',') + ' с в браузере</span>'; }
  }
  $$('[data-go]', $('#buildResult')).forEach(x => x.onclick = () => showView(x.dataset.go));
  $('#aiVerifyBtn').disabled = false;
}
$('#aiVerifyBtn').onclick = () => aiVerifyOnData().catch(e => { console.error(e); toast(e.message, 'bad'); $('#aiVerifyBtn').disabled = false; });
$('#dlSectionBtn').onclick = () => { if (S.aiNew) download('Section1.m', S.aiNew, 'text/plain;charset=utf-8'); };
registerView('ai', { render: renderAiInputs, alwaysRender: true });
