'use strict';
/* ===== Мастер предпродажной подготовки юрлиц — интерфейс. Часть A: состояние, прием файлов, параметры, расчет ===== */
Engine.libs({ XLSX: XLSX, JSZip: JSZip, petrovich: petrovich });
var $ = function (id) { return document.getElementById(id); };
var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
var M = Engine.money;
var mln = function (x) { return Math.abs(x) >= 1e6 ? (x / 1e6).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' млн' : Engine.money(x) + ' ₽'; };
var num = function (v) { return Number(String(v).replace(/\s/g, '').replace(',', '.')) || 0; };
var isoOf = function (d) { return Case.isoDate(d); };
var addDays = function (d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
var TODAY = new Date();
var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ---------- значки ---------- */
var ICO = {
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  doc: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  building: '<path d="M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16"/><path d="M16 9h2a2 2 0 012 2v10"/><path d="M8 7h4M8 11h4M8 15h4M2 21h20"/>',
  link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>',
  filter: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
  out: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a10 10 0 1117.4 0"/>',
  swap: '<path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/>',
  stamp: '<path d="M5 22h14"/><path d="M5 18h14a1 1 0 011 1v3H4v-3a1 1 0 011-1z"/><path d="M15 14V9a3 3 0 10-6 0v5"/><path d="M5 18v-2a2 2 0 012-2h10a2 2 0 012 2v2"/>',
  pack: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
function ico(n) { return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICO[n] || '') + '</svg>'; }
function hydrate(root) { (root || document).querySelectorAll('[data-ico]').forEach(function (e) { if (!e.firstChild) e.innerHTML = ico(e.dataset.ico); }); }

/* ---------- состояние ---------- */
var S = { books: [], merged: null, reg: null, req: null, contracts: null, files: [], skipped: [], case: Case.create(), dirty: false, tpl: {}, group: null, exts: null, built: null, reco: null,
  liq: null, liqOpts: null, vSel: '', xSel: '', step: 1, pickUser: {}, filter: 'all', flt: '', demo: false, pending: null, lastIssue: null };
var MANUAL = {}, XMAN = {};
var P = {
  cessInn: '', date: isoOf(TODAY), payDate: isoOf(addDays(TODAY, 60)), payDz: true, keepDates: true, pk: {}, statuses: {}, accounts: {}, accountsTouched: false,
  rcpInn: '', xdate: isoOf(TODAY), xpay: isoOf(addDays(TODAY, 60)), xthr: '1 000', xoff: false,
  lthr: '100 000', lship: '1 000', lstart: isoOf(addDays(TODAY, 30)), lblock: 'запрещ|чуж', lassign: true, lsts: {}
};
var BIND = [['pCess', 'cessInn'], ['pDate', 'date'], ['pPay', 'payDate'], ['pPayDz', 'payDz', 1], ['pKeepDates', 'keepDates', 1], ['pRcp', 'rcpInn'], ['pXDate', 'xdate'], ['pXPay', 'xpay'], ['pXThr', 'xthr'],
  ['pXOff', 'xoff', 1], ['pLThr', 'lthr'], ['pLShip', 'lship'], ['pLStart', 'lstart'], ['pLBlock', 'lblock'], ['pLAssign', 'lassign', 1]];
function toDom() { BIND.forEach(function (b) { var el = $(b[0]); if (!el) return; if (b[2]) el.checked = !!P[b[1]]; else el.value = P[b[1]]; }); }
function fromDom() { BIND.forEach(function (b) { var el = $(b[0]); if (el) P[b[1]] = b[2] ? el.checked : el.value; }); }
var DEFAULT_ST = { 'транзит': 1, 'обнуляем': 1, 'обнуляем приоритет': 1, 'консолидатор': 1 };

function hk(s) {   // ключ ручных решений: ИНН и наименования в настройках явно не хранятся
  var a = 0x811c9dc5, b = 0x9747b28c; s = String(s);
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a ^= c; a = Math.imul(a, 16777619) >>> 0; b ^= (c + i) & 0xffff; b = Math.imul(b, 2246822519) >>> 0; b ^= b >>> 13; }
  return a.toString(16) + b.toString(16);
}
// префикс номеров: варианты от короткого к длинному («О», «ОА», «ОР», «ОРГ»…); итоговый — первый, не занятый другой организацией
function prefixCands(name) {
  var w = String(name).replace(/["«»]/g, '').replace(/(^|\s)(ООО|АО|ЗАО|ПАО|ИП)(?=\s|$)/g, ' ').trim().split(/\s+/).filter(Boolean), a = (w[0] || 'X'), U = function (t) { return t.toUpperCase(); }, o = [];
  if (a.length <= 3) o.push(U(a)); else o.push(U(a[0]));
  if (w[1]) o.push(U(a[0] + w[1][0]));
  o.push(U(a.slice(0, 2)), U(a.slice(0, 3)));
  if (w[1]) o.push(U(a[0] + w[1].slice(0, 2)));
  return o.filter(function (x, i, r) { return r.indexOf(x) === i; });
}
function defPrefix(name) { return prefixCands(name)[0]; }
function assignPrefixes(orgs, used) {   // orgs: [{inn, name}] → {inn: префикс}; used — уже занятые префиксы
  var res = {}, taken = {}, rest = orgs.slice(); Object.keys(used || {}).forEach(function (k) { taken[used[k]] = (taken[used[k]] || 0) + 1; });
  for (var lvl = 0; lvl < 8 && rest.length; lvl++) {
    var cnt = {}; rest.forEach(function (o) { var c = prefixCands(o.name)[Math.min(lvl, prefixCands(o.name).length - 1)]; cnt[c] = (cnt[c] || 0) + 1; });
    var next = [];
    rest.forEach(function (o) { var c = prefixCands(o.name)[Math.min(lvl, prefixCands(o.name).length - 1)]; if (cnt[c] === 1 && !taken[c]) { res[o.inn] = c; taken[c] = 1; } else next.push(o); });
    rest = next;
  }
  rest.forEach(function (o, i) { var b = prefixCands(o.name)[0], n = 2; while (taken[b + n]) n++; res[o.inn] = b + n; taken[b + n] = 1; });
  return res;
}
function prefixOf(inn) { return (P.pk[inn] && P.pk[inn].prefix) || (S.merged && S.merged.byInn[inn] ? defPrefix(S.merged.byInn[inn].name) : 'X'); }

/* ---------- уведомления, скачивание ---------- */
function toast(text, kind, ms) {
  var box = $('toasts'); while (box.children.length >= 3) box.firstChild.remove();
  var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = text; box.appendChild(t);
  setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(function () { t.remove(); }, 450); }, ms || 4200);
}
function save(data, name, type) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function markDirty(on) { S.dirty = on !== false; $('caseBox').classList.toggle('dirty', S.dirty); backup(); }

/* ---------- настройки (без явных ИНН и наименований) ---------- */
function settingsObj() {
  var o = { v: 2, p: {}, pk: {}, cess: hk(P.cessInn), rcp: hk(P.rcpInn), statuses: P.statuses, accounts: P.accounts, accountsTouched: P.accountsTouched, lsts: P.lsts, manual: {}, xman: XMAN };
  BIND.forEach(function (b) { if (b[1] !== 'cessInn' && b[1] !== 'rcpInn') o.p[b[1]] = P[b[1]]; });
  Object.keys(P.pk).forEach(function (i) { o.pk[hk(i)] = { on: P.pk[i].on, prefix: P.pk[i].prefix }; });
  Object.keys(MANUAL).forEach(function (k) { if (MANUAL[k] && MANUAL[k].include !== undefined) o.manual[k] = { include: MANUAL[k].include }; });
  return o;
}
function applySettings(o) {
  if (!o || !o.p) return;
  Object.keys(o.p).forEach(function (k) { if (k in P) P[k] = o.p[k]; });
  ['statuses', 'accounts', 'lsts'].forEach(function (k) { if (o[k]) P[k] = o[k]; });
  P.accountsTouched = !!o.accountsTouched;
  Object.keys(o.manual || {}).forEach(function (k) { MANUAL[k] = Object.assign(MANUAL[k] || {}, o.manual[k]); });
  XMAN = Object.assign(XMAN, o.xman || {});
  S.pending = { cess: o.cess, rcp: o.rcp, pk: o.pk || {} };
  toDom();
}
// хэши из настроек → ИНН из загруженных данных
function resolveHashes() {
  var pd = S.pending; if (!pd) return;
  var inns = {}; if (S.merged) S.merged.orgs.forEach(function (o) { if (o.inn) inns[o.inn] = 1; }); if (S.req) Object.keys(S.req.byInn).forEach(function (i) { inns[i] = 1; });
  Object.keys(inns).forEach(function (i) {
    var h = hk(i);
    if (pd.cess && h === pd.cess && !P.cessInn) P.cessInn = i;
    if (pd.rcp && h === pd.rcp && !P.rcpInn) P.rcpInn = i;
    if (pd.pk[h] && S.merged && S.merged.byInn[i]) P.pk[i] = { on: pd.pk[h].on, prefix: pd.pk[h].prefix };
  });
}
var LAST_SET = '';
try { var _s = localStorage.getItem('master-settings'); if (_s) { applySettings(JSON.parse(_s)); LAST_SET = _s; } } catch (e) { }
setInterval(function () { try { var s = JSON.stringify(settingsObj()); if (s !== LAST_SET) { localStorage.setItem('master-settings', s); LAST_SET = s; } } catch (e) { } }, 2000);

/* ---------- страховочная копия дела (по желанию пользователя) ---------- */
function backup() {
  try { if ($('cBackup') && $('cBackup').checked) localStorage.setItem('master-case-backup', JSON.stringify(caseJson())); } catch (e) { }
}

/* ---------- прием файлов ---------- */
function logFile(name, kind, bad, note) {
  S.files = S.files.filter(function (f) { return f.name !== name; });
  S.files.push({ name: name, kind: kind, bad: !!bad, note: note || '' });
  renderFiles();
}
function renderFiles() {
  $('fileList').innerHTML = S.files.map(function (f) { return '<span class="fchip' + (f.bad ? ' bad' : '') + '"><i>' + esc(f.kind) + '</i>' + esc(f.name) + (f.note ? ' <small>' + esc(f.note) + '</small>' : '') + '</span>'; }).join('');
}
function addBook(name, bytes) {
  var bk = Engine2.parseBook(Engine2.readBook(bytes), name);
  S.books = S.books.filter(function (b) { return b.file !== name; }); S.books.push(bk);
  S.merged = Engine2.mergeBooks(S.books); S.demo = false;
}
function setReq(bytes) { S.req = Engine.parseRequisites(Engine.readRows(bytes)); }
function setReg(bytes) { S.reg = Engine.parseRegistry(Engine.readRows(bytes)); }
function setOrders(name, bytes) {
  S.contracts = EngineLiq.parseContracts(Engine.readRows(bytes));
  $('pOrdersSt').textContent = name + ' — ' + (S.contracts.format === 'orders' ? 'заказов с неотгруженным остатком: ' : 'строк с недогрузом: ') + S.contracts.rows + (S.contracts.from ? ' (заказы с ' + S.contracts.from + ')' : '') + '. Критерий отгрузок по Дт 62 отключен.';
  $('lGk').disabled = !S.reg;
}
async function ingestXlsx(f) {
  var bytes = new Uint8Array(await f.arrayBuffer()), kind = null;
  try { kind = EngineLiq.detectKind(Engine.readRows(bytes, 60)); } catch (e) { kind = null; }
  if (!kind) { logFile(f.name, 'не распознан', true, 'нужна шапка: реестр — «Наименование / Статус участия / ИНН»; реквизиты — блоки «Полное наименование»; выгрузка 1С — «Остатки и обороты» или «Сальдо на конец»; недогруз — «Осталось отгрузить»'); return; }
  if (kind === 'register' || kind === 'book') addBook(f.name, bytes);
  else if (kind === 'requisites') setReq(bytes);
  else if (kind === 'registry') setReg(bytes);
  else if (kind === 'orders') setOrders(f.name, bytes);
  logFile(f.name, EngineLiq.kindName(kind));
}
async function ingestJson(f) {
  var o = JSON.parse(await f.text());
  if (o && o.docs && o.v) { loadCase(o, f.name); logFile(f.name, 'дело', false, Object.keys(o.docs).length + ' докум.'); }
  else if (o && o.p) { applySettings(o); logFile(f.name, 'настройки'); }
  else logFile(f.name, 'json не распознан', true);
}
async function ingestFiles(list) {
  list = [].slice.call(list).filter(function (f) { return f.name.indexOf('~$') !== 0; });
  if (!list.length) return;
  for (var i = 0; i < list.length; i++) {
    var f = list[i], ext = ((f.name.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase();
    try {
      if (ext === 'json') await ingestJson(f);
      else if (ext === 'docx') { await addTemplate(f.name, new Uint8Array(await f.arrayBuffer())); logFile(f.name, 'шаблон'); }
      else if (ext === 'xlsx' || ext === 'xls') await ingestXlsx(f);
      else logFile(f.name, 'не распознан', true);
    } catch (e) { logFile(f.name, 'ошибка', true, e.message); }
  }
  afterIngest();
}

function autoDefaults() {
  if (S.reg && S.req) {
    var c = Object.keys(S.reg.byInn).filter(function (k) { return /консолидатор/i.test(S.reg.byInn[k].status) && S.req.byInn[k]; })[0];
    if (c) { if (!P.cessInn) P.cessInn = c; if (!P.rcpInn) P.rcpInn = c; }
  }
  if (S.reg) Object.keys(S.reg.byInn).forEach(function (k) { var s = (S.reg.byInn[k].status || '').toLowerCase(); if (s && !(s in P.statuses)) P.statuses[s] = !!DEFAULT_ST[s]; });
  if (S.reg) (S.reg.all || []).forEach(function (r) { var s = (r.status || '').toLowerCase(); if (s && !(s in P.lsts)) P.lsts[s] = /обнул/.test(s); });
  if (S.merged) {
    var orgs = S.merged.orgs.filter(function (o) { return o.inn; });
    var used = {}; Object.keys(P.pk).forEach(function (i) { if (S.merged.byInn[i]) used[i] = P.pk[i].prefix; });
    var fresh = orgs.filter(function (o) { return !P.pk[o.inn]; }), pf = assignPrefixes(fresh, used);
    fresh.forEach(function (o) { P.pk[o.inn] = { on: null, prefix: pf[o.inn] }; });
    if (!orgs.some(function (o) { return P.pk[o.inn].on !== null; })) pkgAuto();   // пакет еще не выбирали
    orgs.forEach(function (o) { if (P.pk[o.inn].on === null) P.pk[o.inn].on = false; });
    if (!P.accountsTouched) {
      var all = {}; orgs.forEach(function (o) { Engine2.listAccounts(S.merged, o.inn).filter(function (a) { return /^\d{2}$/.test(a); }).forEach(function (a) { all[a] = 1; }); });
      Object.keys(all).forEach(function (a) { if (!(a in P.accounts)) P.accounts[a] = !Engine2.NOT_DEBT[a]; });
    }
  }
}
function pkgAuto() {
  var orgs = S.merged.orgs.filter(function (o) { return o.inn; }), any = false;
  orgs.forEach(function (o) {
    var st = S.reg && S.reg.byInn[o.inn] ? String(S.reg.byInn[o.inn].status || '').toLowerCase() : '';
    var on = /обнул/.test(st); any = any || on; P.pk[o.inn] = { on: on, prefix: (P.pk[o.inn] && P.pk[o.inn].prefix) || defPrefix(o.name) };
  });
  if (!any && orgs.length) { var f = orgs.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); })[0]; P.pk[f.inn].on = true; }
}
function afterIngest() {
  if (S.merged && S.reg && !S.merged._filled && S.merged.orgs.some(function (o) { return !o.inn; })) Engine2.fillOrgInn(S.merged, S.reg, S.req);
  resolveHashes(); autoDefaults(); renderParams(); renderCoverage(); S.liq = null; recomputeAll(); renderCase();
  if (S.step === 1 && ready()) $('dockMsg').innerHTML = 'Данные загружены. <b>Перейдите к параметрам →</b>';
}
function ready() { return !!(S.merged && S.reg && S.req && P.cessInn && S.req.byInn[P.cessInn]); }

/* ---------- «Что есть / чего не хватает» ---------- */
function renderCoverage() {
  var con = S.contracts && S.reg ? EngineLiq.prepareContracts(S.contracts, S.reg, S.req) : S.contracts;
  var rows = EngineLiq.coverage({ merged: S.merged, reg: S.reg, req: S.req, contracts: con });
  var ic = { ok: '✔', part: '◐', no: '✖' };
  $('cov').innerHTML = rows.map(function (r, i) {
    return '<div class="cv"><span class="ic ' + r.state + '">' + ic[r.state] + '</span><span>' + esc(r.title) + ' <span class="muted small">' + esc(r.detail) + '</span></span><span></span><button class="q" type="button" data-i="' + i + '">?</button><div class="cvh" id="cvh' + i + '">' + esc(r.hint) + '</div></div>';
  }).join('');
  [].forEach.call($('cov').querySelectorAll('.q'), function (b) { b.onclick = function () { $('cvh' + b.dataset.i).classList.toggle('on'); }; });
  var d = S.merged && S.merged.date;
  $('anInfo').innerHTML = S.merged ? 'Организаций в выгрузках: <b>' + S.merged.orgs.length + '</b>' + (d ? ' · остатки на <b>' + Engine.dateShort(d) + '</b>' : '') +
    (S.merged.dup && S.merged.dup.length ? ' · повторы пропущены: ' + S.merged.dup.length : '') +
    ((S.merged.notes || []).length ? '<br>' + S.merged.notes.map(esc).join('<br>') : '') +
    (S.merged.orgs.some(function (o) { return !o.inn; }) && !S.merged._filled ? '<br>В выгрузке «Регистр бухгалтерии» у организаций нет ИНН — загрузите реестр ЮЛ, ИНН подберется по наименованию.' : '') +
    ((S.merged.noInn || []).length ? '<br><b class="bad">Не найден ИНН (нет в реестре): ' + S.merged.noInn.map(esc).join(', ') + '</b>' : '') +
    ((S.merged.archive || []).length ? '<br>Архивные копии организаций (в работу не берутся): ' + S.merged.archive.map(function (a) { return esc(a.name) + (a.balance > 1 ? ' — <b>есть остатки ' + M(a.balance) + '</b>' : ''); }).join('; ') : '') +
    ((S.merged.multiBase || []).length ? '<br>Организации из нескольких баз (остатки сложены): ' + S.merged.multiBase.map(esc).join(', ') : '') : '';
}

/* ---------- параметры: интерфейс ---------- */
function orgOpts(sel, withEmpty) {
  var l = S.req ? S.req.orgs.filter(function (o) { return o['ИНН']; }).sort(function (a, b) { return a['Полное наименование'].localeCompare(b['Полное наименование'], 'ru'); }) : [];
  return (withEmpty ? '<option value="">— выберите —</option>' : '') + l.map(function (o) { return '<option value="' + o['ИНН'] + '"' + (o['ИНН'] === sel ? ' selected' : '') + '>' + esc(Engine.quotes(o['Полное наименование'])) + ' (' + o['ИНН'] + ')</option>'; }).join('');
}
function chipsHtml(map, attr, hintFn) {
  return Object.keys(map).sort().map(function (k) { return '<label><input type="checkbox" ' + attr + '="' + esc(k) + '"' + (map[k] ? ' checked' : '') + '> ' + esc(k) + (hintFn ? hintFn(k) : '') + '</label>'; }).join('') || '';
}
function renderParams() {
  $('pCess').innerHTML = orgOpts(P.cessInn, true); $('pRcp').innerHTML = orgOpts(P.rcpInn, true);
  toDom();
  var orgs = S.merged ? S.merged.orgs.filter(function (o) { return o.inn; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); }) : [];
  $('pkgRows').innerHTML = orgs.map(function (o) {
    var r = S.reg && S.reg.byInn[o.inn], st = r ? r.status : '';
    var dup = orgs.some(function (x) { return x.inn !== o.inn && P.pk[x.inn] && P.pk[x.inn].on && P.pk[o.inn] && P.pk[o.inn].on && P.pk[x.inn].prefix === P.pk[o.inn].prefix; });
    return '<tr><td><input type="checkbox" data-pk="' + o.inn + '"' + (P.pk[o.inn] && P.pk[o.inn].on ? ' checked' : '') + '></td><td>' + esc(o.name) + '</td><td>' + o.inn + '</td><td>' + (st ? '<span class="tag ' + (/обнул/i.test(st) ? 'b' : /запрещ|чуж/i.test(st) ? 'w' : 'n') + '">' + esc(st) + '</span>' : '<span class="muted">нет в реестре</span>') +
      '</td><td><input data-pf="' + o.inn + '" value="' + esc((P.pk[o.inn] || {}).prefix || '') + '" style="width:80px"' + (dup ? ' title="Префикс совпадает с другой организацией пакета"' : '') + '>' + (dup ? ' <span class="tag w">повтор</span>' : '') + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="muted">Загрузите выгрузки и реестр.</td></tr>';
  var sts = {}; Object.keys(P.statuses).forEach(function (k) { sts[k] = P.statuses[k]; });
  $('pSts').innerHTML = chipsHtml(sts, 'data-st') || '<span class="muted">появятся после загрузки реестра</span>';
  var accs = {}; Object.keys(P.accounts).forEach(function (k) { accs[k] = P.accounts[k]; });
  $('pAccs').innerHTML = chipsHtml(accs, 'data-acc', function (a) { return Engine2.NOT_DEBT[a] ? ' <span class="muted">(' + Engine2.NOT_DEBT[a] + ')</span>' : ''; }) || '<span class="muted">появятся после загрузки выгрузок</span>';
  $('lSts').innerHTML = chipsHtml(P.lsts, 'data-lst');
}
function wireParams() {
  BIND.forEach(function (b) { $(b[0]).onchange = function () { fromDom(); if (b[1] === 'cessInn' && !P.rcpInn) { P.rcpInn = P.cessInn; renderParams(); } recomputeAll(); }; });
  $('pkgRows').onchange = function (e) {
    var t = e.target;
    if (t.dataset.pk) { P.pk[t.dataset.pk].on = t.checked; renderParams(); recomputeAll(); }
    if (t.dataset.pf) { P.pk[t.dataset.pf].prefix = t.value.trim() || 'X'; renderParams(); recomputeAll(); }
  };
  $('pSts').onchange = function (e) { if (e.target.dataset.st) { P.statuses[e.target.dataset.st] = e.target.checked; recomputeAll(); } };
  $('pAccs').onchange = function (e) { if (e.target.dataset.acc) { P.accounts[e.target.dataset.acc] = e.target.checked; P.accountsTouched = true; recomputeAll(); } };
  $('lSts').onchange = function (e) { if (e.target.dataset.lst) P.lsts[e.target.dataset.lst] = e.target.checked; };
  $('pkgAuto').onclick = function () { if (!S.merged) return; pkgAuto(); renderParams(); recomputeAll(); };
  $('pkgAll').onclick = function () { if (!S.merged) return; Object.keys(P.pk).forEach(function (i) { P.pk[i].on = true; }); renderParams(); recomputeAll(); };
  $('pkgNone').onclick = function () { Object.keys(P.pk).forEach(function (i) { P.pk[i].on = false; }); renderParams(); recomputeAll(); };
  $('sSave').onclick = function () { save(JSON.stringify(settingsObj(), null, 1), 'Настройки Мастера.json', 'application/json'); };
  $('sLoad').onchange = function () { var f = this.files[0]; if (!f) return; f.text().then(function (t) { try { applySettings(JSON.parse(t)); resolveHashes(); renderParams(); recomputeAll(); $('sMsg').textContent = 'Настройки загружены.'; } catch (e) { $('sMsg').innerHTML = '<span class="bad">Не удалось прочитать файл настроек.</span>'; } }); };
  $('sReset').onclick = function () { try { localStorage.removeItem('master-settings'); } catch (e) { } $('sMsg').textContent = 'Сохраненные настройки удалены; обновите страницу.'; };
  $('pOrders').onchange = function () { var f = this.files[0]; if (!f) return; f.arrayBuffer().then(function (b) { try { setOrders(f.name, new Uint8Array(b)); renderCoverage(); S.liq = null; } catch (e) { S.contracts = null; $('pOrdersSt').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; } }); };
}

/* ---------- расчет ---------- */
function pkgInns() {
  if (!S.merged) return [];
  return Case.orderOrgs(S.case, Object.keys(P.pk).filter(function (i) { return P.pk[i].on && S.merged.byInn[i]; }));
}
function baseOpts() {
  return {
    accounts: JSON.parse(JSON.stringify(P.accounts)), statuses: JSON.parse(JSON.stringify(P.statuses)), cessionary: S.req.byInn[P.cessInn],
    date: Engine.parseDate(P.date), payDate: Engine.parseDate(P.payDate), payDzByOffset: P.payDz,
    adjust: function (data, op) {
      data.list.forEach(function (c) {
        var m = MANUAL[hk(op.orgInn + ':' + c.inn + ':' + c.name)]; if (!m) return;
        if (m.include !== undefined) c.include = m.include && c.obligations.length > 0;
        if (m.org !== undefined) c.org = m.org ? S.req.byInn[m.org] : null;
      });
    }
  };
}
function buildExt(inn, stable) {
  var xo = { orgInn: inn, recipient: S.req.byInn[P.rcpInn], date: Engine.parseDate(P.xdate), payDate: Engine.parseDate(P.xpay), threshold: num(P.xthr), payByOffset: P.xoff, prefix: 'В' + prefixOf(inn), stable: stable };
  var data = EngineExt.prepare(S.merged, S.req, S.reg, xo);
  data.list.forEach(function (c) { var k = hk(inn + ':' + c.inn + ':' + c.name); if (k in XMAN) c.include = XMAN[k] && c.obligations.length > 0; });
  return { org: data.org, data: data, pl: EngineExt.plan(data, xo), opts: xo };
}
function tplBytes() { var o = {}; Object.keys(S.tpl).forEach(function (k) { o[k] = S.tpl[k].bytes; }); return o; }
function tplHashes() { var o = {}; Object.keys(S.tpl).forEach(function (k) { o[k] = S.tpl[k].hash; }); return o; }
function pickDefaults() {
  S.pick = {};
  S.reco.rows.forEach(function (w) {
    if (!w.op) return;
    var d = w.state === 'new' || w.state === 'changed';
    S.pick[w.id] = w.id in S.pickUser ? S.pickUser[w.id] : d;
    if (w.state === 'conflict') S.pick[w.id] = false;
  });
}
function recomputeAll() {
  S.group = S.exts = S.built = S.reco = null; S.pick = {};
  if (ready()) {
    var inns = pkgInns();
    if (inns.length) {
      try {
        var stable = Case.stable(S.case), base = baseOpts(); base.stable = stable;
        S.group = Engine2.runGroup(S.merged, S.req, S.reg, base, inns.map(function (i) { return { inn: i, prefix: prefixOf(i) }; }));
        S.exts = P.rcpInn && S.req.byInn[P.rcpInn] ? inns.map(function (i) { return buildExt(i, stable); }) : [];
        S.built = Case.collect({ group: S.group, exts: S.exts, tplHash: tplHashes(), orgInns: inns });
        S.reco = Case.reconcile(S.case, S.built);
        pickDefaults();
      } catch (e) { console.error(e); toast('Ошибка расчета: ' + e.message, 'bad', 7000); }
    }
  }
  if (!S.reco && Object.keys(S.case.docs).length) S.reco = Case.reconcile(S.case, { ops: [], scope: {} });   // данных нет — показываем реестр дела
  renderAll();
}
