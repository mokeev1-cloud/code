/* =====================================================================
   views/anon.js — обезличивание: категории, чёрный список, превью было/стало,
   ручные правки, сканер, выгрузка кода/словаря/пакета/задачи для чата.
   ensureAnon() — ленивый пересчёт S.anon/S.scan (по рабочей версии и настройкам).
   ===================================================================== */
function cfgKey(){ const c = S.cfg; return JSON.stringify([c.cats, c.keepSmall, c.keepPositional, c.cmtDetect, c.blacklist, c.manual, [...c.excluded]]); }
function ensureAnon(force){
  if (!S.work) return null;
  const key = S.work + '\u0001' + cfgKey() + '\u0001' + S.dictSource;
  if (force || S._anonKey !== key){ S.anon = anonymizeM(S.work, S.cfg, S.dict); S.scan = scanLeaks(S.anon.out, S.cfg, S.dict); S._anonKey = key; }
  return S.anon;
}
function recomputeAnon(){ ensureAnon(true); if (curView === 'anon') renderAnon(); }
function renderCats(){
  const groups = [...new Set(CATS.map(c => c.g))];
  let h = '<h2>Категории</h2>';
  for (const g of groups){
    h += '<fieldset><legend>' + g + '</legend>';
    for (const c of CATS.filter(x => x.g === g)) h += '<label class="cat" title="' + (c.locked ? 'Секреты заменяются всегда, отключить нельзя' : '') + '"><input type="checkbox" data-cat="' + c.id + '"' + (S.cfg.cats[c.id] || c.locked ? ' checked' : '') + (c.locked ? ' disabled' : '') + '> ' + c.label + (c.locked ? ' 🔒' : '') + '<span class="cnt" data-cnt="' + c.id + '"></span></label>';
    if (g === 'Литералы') h += '<label class="cat"><input type="checkbox" data-opt="keepSmall"' + (S.cfg.keepSmall ? ' checked' : '') + '> не трогать 0, 1, −1</label><label class="cat"><input type="checkbox" data-opt="keepPositional"' + (S.cfg.keepPositional ? ' checked' : '') + '> не трогать позиции и размеры (FirstN, Range, {n}, Encoding…)</label><label class="cat"><input type="checkbox" data-opt="cmtDetect"' + (S.cfg.cmtDetect ? ' checked' : '') + '> искать пути/адреса в комментариях</label>';
    h += '</fieldset>';
  }
  h += '<div class="small muted">Имена столбцов, таблиц и запросов по умолчанию открыты: без них ИИ хуже понимает логику. Структура данных — не секрет; секретные слова в именах ловит чёрный список.</div>';
  $('#catBox').innerHTML = h;
  $$('[data-cat]', $('#catBox')).forEach(i => i.onchange = () => { S.cfg.cats[i.dataset.cat] = i.checked; recomputeAnon(); });
  $$('[data-opt]', $('#catBox')).forEach(i => i.onchange = () => { S.cfg[i.dataset.opt] = i.checked; recomputeAnon(); });
}
function markHtml(text, spans, useOut, from, to){
  let h = '', p = from;
  spans.forEach((sp, i) => {
    const s = useOut ? sp.os : sp.s, e = useOut ? sp.oe : sp.e;
    if (e <= from || s >= to) return;
    h += escHtml(text.slice(p, s)) + '<mark class="' + (useOut ? 'tk' : 'or') + '" data-i="' + i + '" title="' + escHtml(CAT_LABEL[sp.cat] || sp.cat) + '">' + escHtml(text.slice(s, e)) + '</mark>';
    p = e;
  });
  return h + escHtml(text.slice(p, to));
}
function renderAnon(){
  if (!S.work) return;
  const a = ensureAnon();
  for (const c of CATS){ const el = $('[data-cnt="' + c.id + '"]'); if (el){ const n = a.counts[c.id]; el.textContent = n ? n.n + ' (' + n.u.size + ')' : ''; } }
  const chips = Object.entries(a.counts).sort((x, y) => y[1].n - x[1].n).map(([c, v]) => '<span class="chip">' + escHtml(CAT_LABEL[c] || c) + ': <b>' + v.n + '</b> <span class="muted">(' + v.u.size + ')</span></span>').join('');
  $('#anonSummary').innerHTML = (chips || '<span class="muted small">Замен нет</span>') + '<span class="chip">всего: <b>' + a.spans.length + '</b></span>';
  const sel = $('#anonQuery'); const cur = sel.value;
  sel.innerHTML = '<option value="">Все запросы</option>' + S.A.members.map(m => '<option value="' + escHtml(m.name) + '">' + escHtml(m.name) + '</option>').join('');
  sel.value = S.A.byName.has(cur) ? cur : '';
  renderPanes(); renderScan();
  $('#manualList').innerHTML = S.cfg.manual.length ? S.cfg.manual.map((m, i) => '<div class="row" style="margin:2px 0"><span class="mono">' + escHtml(m) + '</span><button class="link" data-rm-man="' + i + '">убрать</button></div>').join('') : '<span class="muted">—</span>';
  $('#exclList').innerHTML = S.cfg.excluded.size ? [...S.cfg.excluded].map((m, i) => '<div class="row" style="margin:2px 0"><span class="mono">' + escHtml(m) + '</span><button class="link" data-rm-ex="' + i + '">заменять снова</button></div>').join('') : '<span class="muted">—</span>';
  $$('[data-rm-man]').forEach(b => b.onclick = () => { S.cfg.manual.splice(+b.dataset.rmMan, 1); recomputeAnon(); });
  $$('[data-rm-ex]').forEach(b => b.onclick = () => { S.cfg.excluded.delete([...S.cfg.excluded][+b.dataset.rmEx]); recomputeAnon(); });
  $('#dictInfo').innerHTML = 'Меток: <b>' + S.dict.size + '</b> · ' + escHtml(S.dictSource) + '<br><span class="muted">Одно значение — одна метка во всём: коде, диагностике, пакетах.</span>';
}
function renderPanes(){
  const a = S.anon; const q = $('#anonQuery').value; const m = q && S.A.byName.get(q);
  const from = m ? m.start : 0, to = m ? m.end : S.work.length;
  $('#paneOrig').innerHTML = markHtml(S.work, a.spans, false, from, to);
  $('#paneAnon').innerHTML = markHtml(a.out, a.spans, true, m ? mapPos(a.spans, from) : 0, m ? mapPos(a.spans, to) : a.out.length);
}
$('#anonQuery').addEventListener('change', renderPanes);
function renderScan(){
  const f = S.scan || []; const crit = f.filter(x => x.sev === 'crit').length;
  $('#scanBadge').innerHTML = !f.length ? '<span class="badge ok">✔ подозрительного не найдено</span>' : '<span class="badge ' + (crit ? 'bad' : 'warn') + '">' + (crit ? 'критично: ' + crit + ' · ' : '') + 'всего: ' + f.length + '</span>';
  if (!f.length){ $('#scanBox').innerHTML = '<div class="note ok small">Сканер ничего не нашёл. Это не гарантия: просмотрите «Стало» глазами перед отправкой.</div>'; return; }
  const t = S.anon.out;
  $('#scanBox').innerHTML = '<table class="t"><tr><th>Уровень</th><th>Что</th><th>Строка</th><th>Контекст</th><th></th></tr>' + f.slice(0, 300).map((x, i) => '<tr><td><span class="sev ' + x.sev + '">' + SEV_LABEL[x.sev] + '</span></td><td>' + escHtml(x.label) + '</td><td>' + x.line + '</td><td class="mono small">' + escHtml(t.slice(Math.max(0, x.s - 30), x.s)) + '<mark class="flag">' + escHtml(x.match) + '</mark>' + escHtml(t.slice(x.e, x.e + 30)) + '</td><td><button class="link" data-scan-add="' + i + '">обезличить</button></td></tr>').join('') + '</table>';
  $$('[data-scan-add]').forEach(b => b.onclick = () => { const x = f[+b.dataset.scanAdd]; if (!S.cfg.manual.includes(x.match)) S.cfg.manual.push(x.match); recomputeAnon(); toast('Добавлено вручную: ' + x.match); });
}
let popEl = null;
function closePop(){ if (popEl){ popEl.remove(); popEl = null; } }
document.addEventListener('click', e => {
  const mk = e.target.closest('mark[data-i]');
  if (!mk){ if (popEl && !e.target.closest('.pop')) closePop(); return; }
  closePop();
  const sp = S.anon && S.anon.spans[+mk.dataset.i]; if (!sp) return;
  const occ = S.anon.spans.filter(x => x.raw === sp.raw).length;
  popEl = document.createElement('div'); popEl.className = 'pop';
  popEl.innerHTML = '<b>' + escHtml(CAT_LABEL[sp.cat] || sp.cat) + '</b> · <span class="mono">' + escHtml(sp.token) + '</span> · вхождений: ' + occ + '<div class="v mono">' + escHtml(sp.raw) + '</div>' +
    (sp.cat === 'SECRET' ? '<div class="small muted">Секреты заменяются всегда — вернуть нельзя.</div>' : '<button class="btn sm" id="popRevert">↩ Вернуть (не заменять это значение)</button>') + ' <button class="btn sm" id="popClose">Закрыть</button>';
  document.body.appendChild(popEl);
  const r = mk.getBoundingClientRect(); popEl.style.left = Math.min(r.left, innerWidth - 480) + 'px'; popEl.style.top = (r.bottom + 6 + popEl.offsetHeight > innerHeight ? r.top - popEl.offsetHeight - 6 : r.bottom + 6) + 'px';
  $('#popClose').onclick = closePop;
  if ($('#popRevert')) $('#popRevert').onclick = () => {
    if (sp.cat === 'NDA' || sp.cat === 'MAN'){ S.cfg.blacklist = S.cfg.blacklist.filter(x => x.toLowerCase() !== sp.raw.toLowerCase()); S.cfg.manual = S.cfg.manual.filter(x => x !== sp.raw); $('#blacklist').value = S.cfg.blacklist.join('\n'); }
    else S.cfg.excluded.add(sp.raw);
    closePop(); recomputeAnon(); toast('Значение возвращено как есть');
  };
});
$('#addSelBtn').onclick = () => {
  const t = (window.getSelection().toString() || '').replace(/\r?\n/g, ' ').trim();
  if (!t) return toast('Сначала выделите фрагмент в панели «Было» или «Стало»', 'warn');
  if (/[⟦⟧]/.test(t)) return toast('Выделение содержит метку — выделите только открытый текст', 'warn');
  if (t.length < 2) return toast('Слишком короткий фрагмент', 'warn');
  if (!S.cfg.manual.includes(t)) S.cfg.manual.push(t);
  S.cfg.excluded.delete(t); recomputeAnon(); toast('Добавлено в обезличивание: ' + t, 'ok');
};
$('#blApply').onclick = () => { S.cfg.blacklist = $('#blacklist').value.split(/\r?\n/).map(x => x.trim()).filter(x => x.length >= 2); recomputeAnon(); renderDiag(); toast('Чёрный список: ' + S.cfg.blacklist.length + ' записей'); };
$('#profSave').onclick = () => {
  const prof = { format: 'pq-master-profile', cats: S.cfg.cats, keepSmall: S.cfg.keepSmall, keepPositional: S.cfg.keepPositional, cmtDetect: S.cfg.cmtDetect, blacklist: S.cfg.blacklist, manual: S.cfg.manual, excluded: [...S.cfg.excluded], denyPaths: $('#denyPaths').value };
  download('pq-master_профиль.json', JSON.stringify(prof, null, 2), 'application/json');
  toast('Профиль содержит ваш чёрный список — храните его у себя', 'warn');
};
$('#profLoad').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const p = JSON.parse(await f.text()); if (p.format !== 'pq-master-profile') throw new Error('это не профиль Мастера PQ');
    Object.assign(S.cfg.cats, p.cats || {}); ['keepSmall', 'keepPositional', 'cmtDetect'].forEach(k => { if (k in p) S.cfg[k] = !!p[k]; });
    S.cfg.blacklist = p.blacklist || []; S.cfg.manual = p.manual || []; S.cfg.excluded = new Set(p.excluded || []);
    $('#blacklist').value = S.cfg.blacklist.join('\n'); if (p.denyPaths) $('#denyPaths').value = p.denyPaths;
    renderCats(); recomputeAnon(); toast('Профиль загружен', 'ok');
  } catch (err){ toast('Профиль: ' + err.message, 'bad'); }
});
async function loadDictFile(f){ return TokenDict.fromJSON(JSON.parse(await f.text())); }
$('#dictLoad').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { S.dict = await loadDictFile(f); S.dictSource = 'файл ' + f.name; recomputeAnon(); toast('Словарь загружен: ' + S.dict.size + ' меток', 'ok'); }
  catch (err){ toast('Словарь: ' + err.message, 'bad'); }
});
$('#dictReset').onclick = async () => {
  const r = await modal('<h2>Сбросить нумерацию меток?</h2><p>Словарь будет создан заново. Если обезличенный код уже отправлялся, старые метки в ответе ИИ не удастся вернуть без сохранённого старого словаря.</p>', [['cancel', 'Отмена', 'pri'], ['go', 'Сбросить', 'danger']]);
  if (r !== 'go') return; S.dict = new TokenDict(); S.dictSource = 'новый (сброшен)'; recomputeAnon();
};
const outName = (kind, ext) => 'pq_' + kind + '_' + stamp() + '.' + ext;
$('#dlAnonTxt').onclick = async () => { const a = ensureAnon(); if (!a) return; if (!(await gate(a.out, 'Обезличенный код'))) return; const n = outName('обезличено', 'txt'); download(n, a.out, 'text/plain;charset=utf-8'); audit('скачивание', n, a.out); };
$('#copyAnon').onclick = async () => { const a = ensureAnon(); if (!a) return; if (!(await gate(a.out, 'Копирование кода'))) return; await copyText(a.out); audit('буфер обмена', 'код', a.out); toast('Обезличенный код скопирован', 'ok'); };
$('#dlDict').onclick = async () => {
  const r = await modal('<h2>🔐 Словарь замен — секретный файл</h2><p>Словарь содержит все исходные значения: пути, серверы, пароли из строк подключения. <b>Никому его не отправляйте</b>, включая ИИ. Храните рядом с оригиналом книги, в папке, к которой у ИИ нет доступа (и не в папке обмена).</p>', [['cancel', 'Отмена'], ['go', 'Понимаю, скачать', 'pri']]);
  if (r !== 'go') return;
  const base = S.book ? S.book.name.replace(/\.[^.]+$/, '') : 'pq';
  download(base + '_СЛОВАРЬ_НЕ_ОТПРАВЛЯТЬ.json', JSON.stringify(S.dict.toJSON({ book: S.book ? { name: S.book.name, sectionSha256: sha256(S.work) } : null }), null, 2), 'application/json');
};
$('#dbgMode').addEventListener('change', () => $('#sampleRow').classList.toggle('hidden', $('#dbgMode').value !== 'masked'));
$('#sampleFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files){ try { const u8 = await readFileBytes(f); if (/\.xlsx$/i.test(f.name)){ const sh = await readXlsxSheets(u8, 501); if (sh[0]) S.samples.push({ name: f.name, rows: sh[0].rows }); } else S.samples.push({ name: f.name, rows: parseCSV(decodeText(u8).text).rows.slice(0, 501) }); } catch (err){ toast(f.name + ': ' + err.message, 'bad'); } }
  $('#sampleInfo').textContent = S.samples.length ? 'образцов: ' + S.samples.length + ' (в пакет — только маскированные 20 строк и профиль)' : '';
});
$('#dlPkg').onclick = async () => { try { const pkg = buildPackage(); if (!(await gate(pkg, 'Пакет для ИИ'))) return; const t = JSON.stringify(pkg, null, 2); const n = outName('пакет', 'json'); download(n, t, 'application/json'); audit('скачивание', n, t); } catch (err){ toast(err.message, 'bad'); } };
$('#copyPrompt').onclick = async () => { try { const t = buildPromptText(buildPackage()); if (!(await gate(t, 'Задача для чата'))) return; await copyText(t); audit('буфер обмена', 'задача для чата', t); toast('Задача с кодом скопирована — вставьте в чат с ИИ', 'ok'); } catch (err){ toast(err.message, 'bad'); } };
/* ---- Проверка глазами: ровно тот текст, что уйдёт, — по разделам, с находками сканера ---- */
const PKG_PARTS = {
  section: ['Код запросов', 'обезличенный Section1.m — главное содержимое; метки ⟦…⟧ вместо путей, серверов, имён'],
  queries: ['Структура запросов', 'имена-метки, шаги, связи, куда загружаются, строк при последнем обновлении (из метаданных)'],
  lint: ['Замечания линтера', 'советы встроенного анализа по этим запросам'],
  diagnostics: ['Диагностика', 'время шагов из диагностики Power Query, обезличено'],
  debugData: ['Отладочные данные', 'схема столбцов и СИНТЕТИЧЕСКИЕ строки по типам (не ваши данные); в режиме «маскированные» — маскированные образцы'],
  dataChecks: ['Проверка на данных', 'только числа: строк по шагам, дубли ключей, строки без пары, доли пустых — без значений'],
  goal: ['Задача', 'ваш текст задачи (известные значения заменены метками)'],
  book: ['О книге', 'формат и число запросов'],
  environment: ['Среда', 'версия Excel/Power BI и локаль'],
  rules: ['Правила для ИИ', 'как обращаться с метками и отвечать'], privacy: ['Обезличивание', 'какие категории заменены метками'], reply: ['Формат ответа', 'образец патча и запроса']
};
/** Текст с подсветкой: метки ⟦…⟧ и находки сканера (красным) */
function markFinds(text, finds){
  const fs = finds.filter(f => f.s >= 0).sort((a, b) => a.s - b.s); let h = '', p = 0;
  for (const f of fs){ const s = text.indexOf(f.match, Math.max(p, f.s - 2)); if (s < p || s < 0) continue; h += markTokens(text.slice(p, s)) + '<mark class="flag" title="' + escHtml(f.label) + '">' + escHtml(f.match) + '</mark>'; p = s + f.match.length; }
  return h + markTokens(text.slice(p));
}
async function reviewPackage(){
  const pkg = buildPackage(); const json = JSON.stringify(pkg, null, 2); const prompt = buildPromptText(pkg);
  const scan = t => scanLeaks(t, S.cfg, S.dict).concat(dataLeaks(t));
  const fj = scan(json), fp = scan(prompt); const crit = fj.filter(f => f.sev === 'crit').length + fp.filter(f => f.sev === 'crit').length;
  const kb = t => (new Blob([t]).size / 1024).toFixed(1).replace('.', ',') + ' КБ';
  const tokens = new Set(json.match(/⟦[A-Z]+_\d+⟧/g) || []).size;
  const parts = Object.keys(pkg).filter(k => pkg[k] != null && PKG_PARTS[k]);
  const head = '<h2>👁 Что уйдёт наружу</h2><div class="chips"><span class="chip">пакет: <b>' + kb(json) + '</b></span><span class="chip">задача для чата: <b>' + kb(prompt) + '</b></span><span class="chip">меток ⟦…⟧: <b>' + tokens + '</b></span>' +
    '<span class="chip">сканер: <b style="color:' + (crit ? 'var(--bad)' : 'var(--ok)') + '">' + (crit ? crit + ' критичных' : 'чисто') + '</b>' + (fj.length + fp.length - crit ? ', предупреждений ' + (fj.length + fp.length - crit) : '') + '</span>' +
    '<span class="chip">значений из данных: <b style="color:' + (fj.concat(fp).some(f => f.label === 'значение из данных') ? 'var(--bad)' : 'var(--ok)') + '">' + fj.concat(fp).filter(f => f.label === 'значение из данных').length + '</b></span></div>' +
    '<p class="small muted">Ниже — ровно тот текст, который будет скачан или скопирован кнопками этого окна. Красным — находки сканера, синим — метки обезличивания.</p>';
  const sec = '<table class="t small"><tr><th>Раздел</th><th>Что внутри</th><th>Размер</th><th></th></tr>' + parts.map(k => { const t = JSON.stringify(pkg[k], null, 2); const nf = scan(t).length;
    return '<tr><td><b>' + escHtml(PKG_PARTS[k][0]) + '</b></td><td>' + escHtml(PKG_PARTS[k][1]) + '</td><td class="num">' + kb(t) + '</td><td>' + (nf ? '<span class="sev crit">' + nf + '</span> ' : '') + '<button class="link" data-pk="' + k + '">показать</button></td></tr>'; }).join('') + '</table><div id="pkPart"></div>';
  const body = head + '<div class="seg" id="pkTabs"><button data-t="parts" class="on">По разделам</button><button data-t="json">Пакет JSON целиком</button><button data-t="prompt">Задача для чата</button></div><div id="pkBody" style="margin-top:8px"></div>';
  const p = modal(body, [['cancel', 'Закрыть'], ['copy', '⧉ Скопировать задачу'], ['dl', '⬇ Скачать пакет', 'pri']], { wide: true });
  const show = t => { $$('#pkTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    $('#pkBody').innerHTML = t === 'parts' ? sec : '<pre class="code wrap" style="max-height:56vh">' + markFinds(t === 'json' ? json : prompt, t === 'json' ? fj : fp) + '</pre>';
    $$('[data-pk]').forEach(b => b.onclick = () => { const k = b.dataset.pk; const tx = typeof pkg[k] === 'string' ? pkg[k] : JSON.stringify(pkg[k], null, 2); $('#pkPart').innerHTML = '<h3>' + escHtml(PKG_PARTS[k][0]) + '</h3><pre class="code wrap" style="max-height:40vh">' + markFinds(tx, scan(tx)) + '</pre>'; }); };
  $('#pkTabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) show(b.dataset.t); };
  show('parts');
  const r = await p;
  if (r === 'dl'){ if (!(await gate(json, 'Пакет для ИИ'))) return; const n = outName('пакет', 'json'); download(n, json, 'application/json'); audit('скачивание', n, json); }
  if (r === 'copy'){ if (!(await gate(prompt, 'Задача для чата'))) return; await copyText(prompt); audit('буфер обмена', 'задача для чата', prompt); toast('Задача скопирована — вставьте в чат с ИИ', 'ok'); }
}
$('#viewPkg').onclick = () => reviewPackage().catch(err => toast(err.message, 'bad'));
registerView('anon', { render: renderAnon, onShow: renderAnon });
