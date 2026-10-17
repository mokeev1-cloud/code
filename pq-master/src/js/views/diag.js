/* =====================================================================
   views/diag.js — загрузка и обезличивание диагностики/трассировок,
   визуализация времени. Сырые строки хранятся только в S.diag (в памяти).
   ===================================================================== */
async function addDiagFiles(files){
  for (const f of files){
    try {
      const u8 = await readFileBytes(f);
      if (/\.xlsx$/i.test(f.name)){ for (const sh of await readXlsxSheets(u8)) if (sh.rows.length) S.diag.push(mkDiagTable(f.name + ' › ' + sh.name, sh.rows, ';')); }
      else {
        const text = decodeText(u8).text; const first = text.split(/\r?\n/, 1)[0] || '';
        const tabular = /\.(csv|tsv)$/i.test(f.name) || ((first.match(/[;,\t]/g) || []).length >= 2 && !/^\s*[{[]/.test(first) && !/: (Information|Error|Warning|Verbose)/.test(first));
        if (tabular){ const p = parseCSV(text); S.diag.push(mkDiagTable(f.name, p.rows, p.delim)); }
        else S.diag.push({ kind: 'trace', name: f.name, text });
      }
    } catch (err){ toast(f.name + ': ' + err.message, 'bad'); }
  }
  showView('diag'); renderDiag(); emitState('diag');
}
function mkDiagTable(name, rows, delim){
  const H = rows[0] || [];
  return { kind: 'table', name, rows, delim, modes: H.map((h, i) => classifyDiagColumn(h, rows.slice(1, 400).map(r => r[i]))) };
}
function renderDiag(){
  let h = '';
  S.diag.forEach((d, di) => {
    h += '<div class="card"><div class="card-h"><h2>' + escHtml(d.name) + '</h2><span class="badge">' + (d.kind === 'table' ? (d.rows.length - 1) + ' строк · ' + (d.rows[0] || []).length + ' столбцов' : 'трассировка · ' + fmtBytes(d.text.length)) + '</span><span class="sp"></span><button class="btn pri" data-ddl="' + di + '">⬇ Обезличенный файл</button><button class="btn danger" data-drm="' + di + '">Убрать</button></div>';
    if (d.kind === 'table'){
      const H = d.rows[0] || [];
      h += '<details><summary>Столбцы и режимы</summary><table class="t"><tr><th>Столбец</th><th>Пример значений</th><th>Режим</th></tr>' + H.map((c, i) => { const ex = d.rows.slice(1).map(r => r[i]).filter(v => v != null && v !== '').slice(0, 2).map(v => String(v).slice(0, 60));
        return '<tr><td>' + escHtml(String(c)) + '</td><td class="mono small">' + escHtml(ex.join(' │ ')) + '</td><td><select data-dm="' + di + ':' + i + '">' + DIAG_MODES.map(([v, l]) => '<option value="' + v + '"' + (d.modes[i] === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td></tr>'; }).join('') + '</table></details>';
      const an = anonymizeTable(d.rows.slice(0, 16), d.modes, S.cfg, S.dict);
      h += '<h3>Предпросмотр (обезличено, первые 15 строк)</h3><div class="scroll"><table class="t mono small">' + an.map((r, ri) => '<tr>' + r.map(v => (ri ? '<td>' : '<th>') + markTokens(String(v == null ? '' : v).slice(0, 140)) + (ri ? '</td>' : '</th>')).join('') + '</tr>').join('') + '</table></div>';
    } else h += '<h3>Предпросмотр (обезличено, первые 40 строк)</h3><pre class="code wrap" style="max-height:40vh">' + markTokens(anonymizeTrace(d.text.split(/\r?\n/).slice(0, 40).join('\n'), S.cfg, S.dict)) + '</pre>';
    h += '</div>';
  });
  $('#diagFiles').innerHTML = h;
  $$('[data-dm]').forEach(s => s.onchange = () => { const [di, i] = s.dataset.dm.split(':').map(Number); S.diag[di].modes[i] = s.value; renderDiag(); });
  $$('[data-drm]').forEach(b => b.onclick = () => { S.diag.splice(+b.dataset.drm, 1); renderDiag(); emitState('diag'); });
  $$('[data-ddl]').forEach(b => b.onclick = async () => {
    const d = S.diag[+b.dataset.ddl];
    const out = d.kind === 'table' ? toCSV(anonymizeTable(d.rows, d.modes, S.cfg, S.dict), d.delim) : anonymizeTrace(d.text, S.cfg, S.dict);
    if (!(await gate(out, 'Диагностика'))) return;
    const n = outName('диагностика', d.kind === 'table' ? 'csv' : 'txt'); download(n, out, 'text/plain;charset=utf-8'); audit('скачивание', n, out);
    toast('Словарь мог пополниться новыми метками — сохраните его заново, если понадобится обратная подстановка', 'warn');
  });
  renderDiagViz();
}
function renderDiagViz(){
  let best = null;
  for (const d of S.diag.filter(x => x.kind === 'table')){ const rows = $('#vizAnon').checked ? anonymizeTable(d.rows, d.modes, S.cfg, S.dict) : d.rows; const v = diagVizData(rows); if (v && (!best || v.top.length > best.v.top.length)) best = { d, v }; }
  $('#diagVizCard').classList.toggle('hidden', !best);
  if (!best) return;
  const v = best.v; const max = Math.max(...v.top.map(a => a.d), 1e-9);
  let h = '<div class="small muted">Источник: ' + escHtml(best.d.name) + '. Время — сумма «Exclusive Duration» (или конец − начало) по шагам.</div><h3>Самые долгие шаги</h3><table class="t">' +
    v.top.map(a => '<tr><td style="width:40%">' + markTokens(a.key) + '</td><td style="width:45%"><div class="bar" style="width:' + (a.d / max * 100).toFixed(1) + '%"></div></td><td class="mono">' + a.d.toFixed(3) + ' с</td><td class="small muted">' + a.n + ' соб.</td></tr>').join('') + '</table>';
  if (v.perQ.length){ const mq = Math.max(...v.perQ.map(x => x[1]), 1e-9); h += '<h3>По запросам</h3><table class="t">' + v.perQ.map(([q, d]) => '<tr><td style="width:40%">' + markTokens(String(q)) + '</td><td style="width:45%"><div class="bar" style="width:' + (d / mq * 100).toFixed(1) + '%;background:var(--ok)"></div></td><td class="mono">' + d.toFixed(3) + ' с</td></tr>').join('') + '</table>'; }
  if (v.tl.length > 1){ const t0 = v.tl[0].ts, t1 = Math.max(...v.tl.map(x => x.te)); const span = Math.max(1, t1 - t0);
    h += '<h3>Временная шкала (' + v.tl.length + ' событий)</h3><div class="scroll" style="max-height:40vh">' + v.tl.map(x => '<div class="row small" style="flex-wrap:nowrap;margin:2px 0"><span style="width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(x.label) + '">' + markTokens(x.label) + '</span><div style="flex:1;position:relative;height:12px;background:var(--panel2);border-radius:3px"><div class="bar" style="position:absolute;left:' + ((x.ts - t0) / span * 100).toFixed(2) + '%;width:' + Math.max(0.3, (x.te - x.ts) / span * 100).toFixed(2) + '%;height:12px"></div></div></div>').join('') + '</div>'; }
  $('#diagViz').innerHTML = h;
}
$('#vizAnon').addEventListener('change', renderDiagViz);
wireDrop($('#diagDrop'), e => addDiagFiles([...e.dataTransfer.files]));
$('#diagFile').addEventListener('change', e => { addDiagFiles([...e.target.files]); e.target.value = ''; });
registerView('diag', { render: () => {}, onShow: renderDiag });
