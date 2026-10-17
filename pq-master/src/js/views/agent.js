/* =====================================================================
   views/agent.js — режим агента: папка обмена (File System Access API),
   исходящие пакеты (через gate без права обхода в автоматике), входящие
   патчи/запросы/сообщения от Claude Code, журнал аудита.
   ===================================================================== */
$('#fsaSupport').innerHTML = 'showDirectoryPicker' in window ? '<span class="badge ok">Браузер поддерживает папку обмена</span>' : '<span class="badge warn">Этот браузер не умеет работать с папками (нужен Chrome или Edge). Используйте ручной обмен: «Пакет для ИИ» в разделе «Обезличивание» и «Загрузить ответ» ниже.</span>';
$('#pickExch').onclick = async () => {
  if (!('showDirectoryPicker' in window)) return toast('Нужен Chrome или Edge', 'warn');
  try { S.exch = await window.showDirectoryPicker({ id: 'pqm-exchange', mode: 'readwrite' }); for (const d of ['inbox', 'outbox', 'processed']) await exchDir(d);
    $('#exchState').innerHTML = 'папка: <b>' + escHtml(S.exch.name) + '</b> · inbox/ outbox/ processed/ готовы'; toast('Папка обмена подключена', 'ok'); }
  catch (err){ if (err.name !== 'AbortError') toast(err.message, 'bad'); }
};
$('#writeKit').onclick = async () => { if (!S.exch) return toast('Сначала выберите папку обмена', 'warn'); for (const [p, c] of Object.entries(kitFiles())) await writeFileIn(S.exch, p, c); toast('Записаны CLAUDE.md, .claude/settings.json, ПРОЧТИ.txt', 'ok'); };
$('#dlKit').onclick = async () => {
  const entries = []; for (const [p, c] of Object.entries(kitFiles())) entries.push(await zipFinalizeNew(zipNewEntry('pq-exchange/' + p, te.encode(c), true)));
  for (const d of ['inbox', 'outbox', 'processed']) entries.push(zipNewEntry('pq-exchange/' + d + '/', new Uint8Array(0), false));
  download('pq-master-exchange-kit.zip', new Blob([zipWrite(entries)]), 'application/zip');
};
async function sendPackage(dbgOverride, auto){
  if (!S.A){ toast('Нет открытой книги', 'warn'); return false; }
  if (dbgOverride) $('#dbgMode').value = dbgOverride;
  const pkg = buildPackage();
  if (!(await gate(pkg, 'Пакет в папку обмена', { noOverride: !!auto }))) return false;
  const txt = JSON.stringify(pkg, null, 2);
  if (S.exch){ const ob = await exchDir('outbox'); await writeFileIn(ob, 'package-' + pkg.id + '.json', txt); await writeFileIn(ob, 'section-' + pkg.id + '.m', pkg.section); audit('outbox', 'package-' + pkg.id + '.json', txt); S.outLog.unshift(fmtTime(new Date()) + ' → outbox/package-' + pkg.id + '.json (' + fmtBytes(txt.length) + ')'); }
  else { const n = outName('пакет', 'json'); download(n, txt, 'application/json'); audit('скачивание', n, txt); S.outLog.unshift(fmtTime(new Date()) + ' → скачан ' + n); }
  $('#outLog').innerHTML = S.outLog.slice(0, 12).map(escHtml).join('<br>');
  return true;
}
$('#sendPkg').onclick = () => sendPackage().catch(err => toast(err.message, 'bad'));
function receiveInbound(name, text, source){
  let obj = null; try { obj = JSON.parse(text); } catch { /* текстовый ответ */ }
  const kind = obj && obj.kind ? String(obj.kind) : obj && (obj.members || obj.section) ? 'patch' : 'code';
  const item = { id: Math.random().toString(36).slice(2), name, source, kind, obj, text, time: fmtTime(new Date()), status: 'новое' };
  S.inbox.unshift(item); renderInbox(); toast('Входящее от агента: ' + name, 'ok');
  if (kind === 'request' && $('#autoReqs').checked && obj && (obj.what || []).includes('package'))
    sendPackage(obj.debugData === 'masked' ? 'masked' : obj.debugData === 'none' ? 'none' : 'schema', true).then(ok => { item.status = ok ? 'выполнено автоматически' : 'заблокировано сканером'; renderInbox(); });
}
function renderInbox(){
  $('#inboxBox').innerHTML = S.inbox.length ? S.inbox.map(it => {
    let body = '';
    if (it.kind === 'patch') body = '<div class="small">' + escHtml(String((it.obj && it.obj.summary) || 'патч')) + '</div><div class="small muted">запросов: ' + Object.keys((it.obj && it.obj.members) || {}).length + (it.obj && it.obj.section ? ' + section' : '') + '</div><button class="btn pri sm" data-ib="open" data-id="' + it.id + '">Проверить в «Ответ ИИ»</button>';
    else if (it.kind === 'request') body = '<div class="small">Агент просит: <b>' + escHtml((it.obj.what || []).join(', ')) + '</b>' + (it.obj.debugData ? ' · данные: ' + escHtml(String(it.obj.debugData)) : '') + '</div>' + (it.obj.note ? '<div class="small muted">' + escHtml(String(it.obj.note)) + '</div>' : '') + '<button class="btn pri sm" data-ib="req" data-id="' + it.id + '">Выполнить (через сканер)</button>';
    else if (it.kind === 'message') body = '<div class="small" style="white-space:pre-wrap">' + escHtml(String(it.obj.text || '')) + '</div>';
    else body = '<pre class="code wrap" style="max-height:140px">' + escHtml(it.text.slice(0, 1200)) + '</pre><button class="btn pri sm" data-ib="open" data-id="' + it.id + '">Проверить в «Ответ ИИ»</button>';
    return '<div class="inbox-item"><div class="row small" style="margin-top:0"><b>' + escHtml(it.name) + '</b><span class="muted">' + it.time + ' · ' + escHtml(it.source) + ' · ' + escHtml(it.kind) + '</span><span class="sp"></span><span class="badge">' + escHtml(it.status) + '</span><button class="link" data-ib="del" data-id="' + it.id + '">скрыть</button></div>' + body + '</div>';
  }).join('') : '<div class="muted small">Пока пусто.</div>';
  $$('[data-ib]', $('#inboxBox')).forEach(b => b.onclick = async () => {
    const it = S.inbox.find(x => x.id === b.dataset.id); if (!it) return;
    if (b.dataset.ib === 'del'){ S.inbox = S.inbox.filter(x => x !== it); renderInbox(); return; }
    if (b.dataset.ib === 'open'){ $('#aiText').value = it.text; $('#aiFileInfo').textContent = it.name; showView('ai'); it.status = 'открыто'; renderInbox(); runAiCheck().catch(err => toast(err.message, 'bad')); return; }
    if (b.dataset.ib === 'req'){ const ok = await sendPackage(it.obj.debugData === 'masked' ? 'masked' : it.obj.debugData === 'none' ? 'none' : 'schema'); it.status = ok ? 'выполнено' : 'отменено'; renderInbox(); }
  });
}
$('#manualIn').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) receiveInbound(f.name, await f.text(), 'вручную'); });
$('#checkInbox').onclick = () => pollInbox().catch(err => toast('inbox: ' + err.message, 'bad'));
setInterval(() => { if (S.exch && $('#watchInbox').checked) pollInbox().catch(() => { /* папка могла стать недоступной */ }); }, 3000);
function renderAudit(){
  $('#auditBox').innerHTML = S.audit.length ? '<table class="t"><tr><th>Время</th><th>Канал</th><th>Файл</th><th>Размер</th><th>SHA-256</th></tr>' + S.audit.map(a => '<tr><td>' + escHtml(a.time) + '</td><td>' + escHtml(a.channel) + '</td><td>' + escHtml(a.file) + '</td><td>' + fmtBytes(a.size) + '</td><td class="mono small">' + a.sha + '</td></tr>').join('') + '</table>' : '<div class="muted small">Ничего не выпускалось.</div>';
}
$('#dlAudit').onclick = () => download('pq-master_аудит_' + stamp() + '.csv', toCSV([['Время', 'Канал', 'Файл', 'Байт', 'SHA-256'], ...S.audit.map(a => [a.time, a.channel, a.file, a.size, a.sha])], ';'), 'text/csv');
registerView('agent', { render: () => {}, onShow: () => { renderInbox(); renderAudit(); } });
