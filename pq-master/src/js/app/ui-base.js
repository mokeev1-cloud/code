/* =====================================================================
   app/ui-base.js — базовые помощники интерфейса.
   ВАЖНО (приватность): всё, что покидает страницу, обязано пройти через
   gate() (сканер утечек) и audit() (журнал с SHA-256). Сырые оригиналы
   отдаются наружу только явными действиями пользователя: «Сохранить копию»,
   «В оригинал», «Словарь» — они не идут через gate, но предупреждают.
   ===================================================================== */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const SEV_LABEL = { err: 'ошибка', warn: 'внимание', info: 'заметка', tip: 'совет', crit: 'критично' };

function toast(msg, kind, ms){
  const d = document.createElement('div'); d.className = kind || ''; d.textContent = msg;
  $('#toast').appendChild(d); setTimeout(() => d.remove(), ms || (kind === 'bad' ? 9000 : 4500));
}
/** Модальное окно. buttons: [[значение, подпись, класс]]. Возвращает Promise значения кнопки (Esc/клик мимо → 'cancel'). */
function modal(html, buttons, opts){
  return new Promise(res => {
    const m = $('#modal'); m.style.maxWidth = (opts && opts.wide) ? '1100px' : '';
    m.innerHTML = html + '<div class="row" style="margin-top:16px;justify-content:flex-end">' + (buttons || [['ok', 'Закрыть', 'pri']]).map(([v, l, cls]) => '<button class="btn ' + (cls || '') + '" data-v="' + v + '">' + l + '</button>').join('') + '</div>';
    $('#modalBg').classList.add('on');
    const done = v => { $('#modalBg').classList.remove('on'); document.removeEventListener('keydown', onKey, true); res(v); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopPropagation(); done('cancel'); } if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){ const pri = $('button.pri[data-v]', m); if (pri){ e.preventDefault(); done(pri.dataset.v); } } };
    document.addEventListener('keydown', onKey, true);
    $$('button[data-v]', m).forEach(b => b.onclick = () => done(b.dataset.v));
    $('#modalBg').onclick = e => { if (e.target.id === 'modalBg') done('cancel'); };
    const f = $('input,select,textarea', m); if (f) setTimeout(() => { f.focus(); if (f.select) f.select(); }, 30);
  });
}
/** Запрос строки у пользователя; null — отмена. (DOM окна живёт до следующего modal, поэтому значение читается после закрытия.) */
async function askText(title, label, value, hint){
  const r = await modal('<h2>' + escHtml(title) + '</h2><label class="small muted">' + escHtml(label) + '</label><input type="text" id="promptVal" style="width:100%;margin-top:4px" value="' + escHtml(value || '') + '">' + (hint ? '<div class="small muted" style="margin-top:6px">' + hint + '</div>' : ''), [['cancel', 'Отмена'], ['ok', 'OK', 'pri']]);
  return r === 'ok' ? $('#promptVal').value : null;
}
function download(name, data, mime){
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function copyText(t){
  try { await navigator.clipboard.writeText(t); return true; }
  catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; }
}
const fmtBytes = n => n < 1024 ? n + ' Б' : n < 1048576 ? (n / 1024).toFixed(1) + ' КБ' : (n / 1048576).toFixed(2) + ' МБ';
const stamp = () => { const d = new Date(); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()); };
const fmtTime = d => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDateTime = d => d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function readFileBytes(f){ return f.arrayBuffer().then(b => new Uint8Array(b)); }
function audit(channel, file, content){
  const bytes = typeof content === 'string' ? te.encode(content) : content;
  S.audit.unshift({ time: new Date().toLocaleString('ru-RU'), channel, file, size: bytes.length, sha: sha256(bytes) });
  if (typeof renderAudit === 'function') renderAudit();
}
function stringsOf(o, acc){
  acc = acc || [];
  if (typeof o === 'string') acc.push(o);
  else if (Array.isArray(o)) o.forEach(x => stringsOf(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)){ acc.push(k); stringsOf(v, acc); }
  return acc;
}
/** Шлюз: всё обезличенное, что покидает страницу, проходит сканер. noOverride — без права обхода (автоматика). */
async function gate(textOrObj, what, opts){
  opts = opts || {};
  const text = typeof textOrObj === 'string' ? textOrObj : stringsOf(textOrObj).join('\n');
  const f = scanLeaks(text, S.cfg, S.dict).concat(typeof dataLeaks === 'function' ? dataLeaks(text) : []);   // + значения из данных книги и прикреплённых файлов
  const crit = f.filter(x => x.sev === 'crit');
  if (!crit.length){ if (f.length && !opts.quiet) toast(what + ': сканер — ' + f.length + ' некритичных предупреждений (см. «Обезличивание»).', 'warn'); return true; }
  if (opts.noOverride){ toast(what + ': заблокировано — сканер нашёл ' + crit.length + ' критичных совпадений.', 'bad'); return false; }
  const items = crit.slice(0, 25).map(x => '<tr><td><span class="sev crit">' + escHtml(x.label) + '</span></td><td class="mono">' + escHtml(text.slice(Math.max(0, x.s - 40), x.s)) + '<mark class="flag">' + escHtml(x.match) + '</mark>' + escHtml(text.slice(x.e, x.e + 40)) + '</td></tr>').join('');
  const r = await modal('<h2>⛔ Сканер нашёл возможную утечку</h2><p>' + escHtml(what) + ': ' + crit.length + ' критичных совпадений. Обычно это значение, не попавшее ни в одну категорию. Добавьте его в чёрный список или через «Добавить выделенное» в разделе «Обезличивание».</p><div class="scroll"><table class="t">' + items + '</table></div>',
    [['cancel', 'Отмена', 'pri'], ['go', 'Я проверил — всё равно выпустить', 'danger']]);
  return r === 'go';
}
function wireDrop(el, handler){
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('hot'); });
  el.addEventListener('dragleave', () => el.classList.remove('hot'));
  el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('hot'); handler(e); });
}
function markTokens(s){ return escHtml(s).replace(/⟦[A-Z]+_\d+⟧/g, m => '<mark class="tk">' + m + '</mark>'); }
/** SVG-шкала оценки 0–100 */
function gaugeSvg(score, size){
  size = size || 112; const r = size / 2 - 9, c = Math.PI * r * 1.5; const v = Math.max(0, Math.min(100, score)) / 100;
  const col = score >= 85 ? 'var(--ok)' : score >= 60 ? 'var(--warn)' : 'var(--bad)';
  return '<svg class="gauge" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="stroke:none;fill:none"><g transform="rotate(135 ' + size / 2 + ' ' + size / 2 + ')">' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke="var(--panel3)" stroke-width="10" fill="none" stroke-dasharray="' + c + ' 999" stroke-linecap="round"/>' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke="' + col + '" stroke-width="10" fill="none" stroke-dasharray="' + (c * v) + ' 999" stroke-linecap="round"/></g>' +
    '<text x="50%" y="52%" text-anchor="middle" style="font-size:' + (size / 3.6) + 'px;font-weight:700;fill:var(--text)">' + score + '</text><text x="50%" y="70%" text-anchor="middle" style="font-size:10px;fill:var(--muted)">из 100</text></svg>';
}
const heatColor = lvl => 'var(--heat' + Math.max(0, Math.min(5, lvl)) + ')';
