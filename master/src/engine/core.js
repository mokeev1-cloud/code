/* Движок: разбор «Анализа субконто», реквизитов и реестра, расчет уступок, Excel и договоры Word. */
(function (root) {
  'use strict';
  var XLSX, JSZip, petrovich;
  function libs(l) { XLSX = l.XLSX; JSZip = l.JSZip; petrovich = l.petrovich; }

  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var ACC_RE = /^\d{2}(\.[0-9A-Za-zА-Яа-яЁё]+)*$/;
  var CUR_RE = /^[A-Z]{3}$/;

  // ---------- общие помощники ----------
  function s(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function num(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return v; var n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function money(x) {
    var neg = x < 0; x = Math.abs(r2(x));
    var int = Math.floor(x), kop = Math.round((x - int) * 100);
    if (kop === 100) { int += 1; kop = 0; }
    return (neg ? '-' : '') + String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + (kop < 10 ? '0' : '') + kop;
  }
  function plural(n, one, few, many) { n = Math.abs(n) % 100; if (n >= 11 && n <= 14) return many; n %= 10; return n === 1 ? one : (n >= 2 && n <= 4 ? few : many); }
  var U_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  var U_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  var TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  var TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  var HUND = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  function triad(n, fem) {
    var out = [], h = Math.floor(n / 100), t = Math.floor(n % 100 / 10), u = n % 10;
    if (h) out.push(HUND[h]);
    if (t === 1) out.push(TEENS[u]); else { if (t) out.push(TENS[t]); if (u) out.push((fem ? U_F : U_M)[u]); }
    return out.join(' ');
  }
  function intWords(n) {
    if (n === 0) return 'ноль';
    var groups = [[1e9, false, ['миллиард', 'миллиарда', 'миллиардов']], [1e6, false, ['миллион', 'миллиона', 'миллионов']], [1e3, true, ['тысяча', 'тысячи', 'тысяч']]];
    var out = [];
    groups.forEach(function (g) {
      var k = Math.floor(n / g[0]); n -= k * g[0];
      if (k) out.push(triad(k, g[1]) + ' ' + plural(k, g[2][0], g[2][1], g[2][2]));
    });
    if (n) out.push(triad(n, false));
    return out.join(' ');
  }
  function words(x) {
    x = r2(x); var rub = Math.floor(x), kop = Math.round((x - rub) * 100);
    if (kop === 100) { rub += 1; kop = 0; }
    var w = intWords(rub); w = w.charAt(0).toUpperCase() + w.slice(1);
    return money(x) + ' (' + w + ') ' + plural(rub, 'рубль', 'рубля', 'рублей') + ' ' + (kop < 10 ? '0' : '') + kop + ' ' + plural(kop, 'копейка', 'копейки', 'копеек');
  }
  function dateLong(d) { return '«' + String(d.getDate()).padStart(2, '0') + '» ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' г.'; }
  function dateShort(d) { return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); }
  function parseDate(v) {
    if (v instanceof Date) return v;
    var m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = String(v || '').match(/(\d{2})\.(\d{2})\.(\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    return null;
  }
  function quotes(t) {
    t = s(t); var out = '', open = 0;
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (ch === '"') { if (i === 0 || ' («'.indexOf(t[i - 1]) >= 0) { out += '«'; open++; } else { out += '»'; open--; } }
      else out += ch;
    }
    while (open-- > 0) out += '»';
    return out;
  }

  // ---------- сопоставление наименований ----------
  var FORMS = [
    ['общество с ограниченной ответственностью', 'ооо'], ['публичное акционерное общество', 'пао'],
    ['непубличное акционерное общество', 'ао'], ['закрытое акционерное общество', 'зао'],
    ['открытое акционерное общество', 'оао'], ['акционерное общество', 'ао'], ['индивидуальный предприниматель', 'ип']];
  var FORM_ABBR = { 'ооо': 1, 'ао': 1, 'зао': 1, 'пао': 1, 'оао': 1, 'ип': 1 };
  function nameKey(name) {
    var t = s(name).toLowerCase().replace(/ё/g, 'е').replace(/!+/g, ' ');
    t = t.replace(/\(.*?\)/g, ' ').replace(/производственное объединение/g, ' по ');
    var form = '';
    FORMS.forEach(function (f) { if (t.indexOf(f[0]) >= 0) { form = form || f[1]; t = t.split(f[0]).join(' '); } });
    var toks = t.replace(/[«»"'`.,()\-–—*]/g, ' ').split(/\s+/).filter(Boolean);
    var rest = [];
    toks.forEach(function (w) { if (FORM_ABBR[w]) { form = form || w; } else rest.push(w); });
    rest.sort();
    return { form: form, core: rest.join(' ') };
  }

  // ---------- реквизиты ----------
  function readRows(buf, maxRows) {   // maxRows — читать только начало листа (определение вида файла)
    var wb = XLSX.read(buf, maxRows ? { type: 'array', cellDates: true, sheetRows: maxRows } : { type: 'array', cellDates: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  }
  function parseRequisites(rows) {
    var orgs = [], cur = null;
    rows.forEach(function (r) {
      var k = s(r[0]).replace(/:$/, ''), v = r[1];
      if (k === 'Полное наименование') { cur = { 'Полное наименование': s(v) }; orgs.push(cur); return; }
      if (cur && k && v != null && s(v) !== '') cur[k] = s(v);
    });
    var byInn = {};
    orgs.forEach(function (o) { if (o['ИНН']) { var inn = o['ИНН'].replace(/\D/g, ''); o['ИНН'] = inn; if (!byInn[inn] || Object.keys(byInn[inn]).length < Object.keys(o).length) byInn[inn] = o; } o._key = nameKey(o['Полное наименование']); });
    return { orgs: orgs, byInn: byInn };
  }

  // ---------- реестр юрлиц ----------
  function parseRegistry(rows) {
    if (!rows || !rows.length) return { byInn: {}, byName: {}, byKey: {}, all: [] };
    var head = rows[0].map(function (h) { return s(h).toLowerCase(); });
    var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
    var cName = col(/^наименование/), cInn = col(/^инн/), cStatus = col(/статус/), c1c = col(/1с/), cAlias = col(/алиас/),
      cZds = col(/^здс/), cGk = col(/гос/), cNote = col(/^примечание/), cCom = col(/^комментарий/);
    var byInn = {}, byName = {}, byKey = {}, all = [];
    var add = function (map, k, rec) { if (!k) return; map[k] = map[k] || []; if (map[k].indexOf(rec) < 0) map[k].push(rec); };
    rows.slice(1).forEach(function (r) {
      var inn = s(r[cInn]).replace(/\D/g, '');
      var rec = { inn: inn, name: s(r[cName]), status: cStatus >= 0 ? s(r[cStatus]) : '', key: nameKey(r[cName]),
        zds: cZds >= 0 ? s(r[cZds]) : '', gk: cGk >= 0 ? s(r[cGk]) : '',
        note: [cNote >= 0 ? s(r[cNote]) : '', cCom >= 0 ? s(r[cCom]) : ''].filter(Boolean).join('; ') };
      if (rec.name) all.push(rec);
      if (!inn) return;
      byInn[inn] = rec;
      [r[cName], c1c >= 0 ? r[c1c] : null].concat(cAlias >= 0 && r[cAlias] ? String(r[cAlias]).split(/[;,\n]/) : []).forEach(function (n) {
        n = s(n); if (!n) return;
        add(byName, n.toLowerCase(), rec);
        var kk = nameKey(n); if (kk.core) add(byKey, kk.form + '|' + kk.core, rec);
      });
    });
    return { byInn: byInn, byName: byName, byKey: byKey, all: all };
  }

  // ---------- анализ субконто ----------
  function parseAnalysis(rows) {
    var info = { company: s(rows[0] && rows[0][0]), period: '', dateTo: null, hasInn: false, accounts: {} };
    var hdr = -1, cInd = -1, cDt = -1, cInn = -1, cName = 0, marks = {};
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var r = rows[i];
      for (var j = 0; j < r.length; j++) {
        var v = s(r[j]), lv = v.toLowerCase();
        if (/анализ субконто/i.test(v) || /\d{2}\.\d{2}\.\d{4}\s*-\s*\d{2}\.\d{2}\.\d{4}/.test(v)) {
          var m = v.match(/(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/); if (m) { info.period = m[0]; info.dateTo = m[2]; }
        }
        if (/сальдо на конец/.test(lv)) { hdr = i; cDt = j; }
        if (/^показа/.test(lv)) cInd = j;
        if (lv === 'инн') { cInn = j; info.hasInn = true; }
        if (/^кз вго$/.test(lv)) marks.kz = j;
        if (/^дз вго$/.test(lv)) marks.dz = j;
      }
    }
    if (cDt < 0) throw new Error('В файле не найдена колонка «Сальдо на конец периода». Это точно «Анализ субконто»?');
    var start = hdr + 2;
    var cps = [], cur = null;
    for (var k = start; k < rows.length; k++) {
      var row = rows[k], a = s(row[cName]), ind = cInd >= 0 ? s(row[cInd]) : 'БУ';
      var dt = num(row[cDt]), kt = num(row[cDt + 1]);
      if (ind && ind !== 'БУ') continue;
      if (!a) continue;
      if (/^итого/i.test(a)) continue;
      if (ACC_RE.test(a)) { if (cur) { var acc = a.split('.')[0]; cur.acc[acc] = (cur.acc[acc] || 0) + dt - kt; info.accounts[acc] = true; cur.rows.push(k); } continue; }
      if (CUR_RE.test(a)) { if (cur) cur.rows.push(k); continue; }
      cur = { row: k, name: a, inn: cInn >= 0 ? s(row[cInn]).replace(/\D/g, '') : '', net: dt - kt, acc: {}, rows: [k], markKz: 0, markDz: 0 };
      cps.push(cur);
    }
    // ручная разметка «КЗ ВГО» / «ДЗ ВГО»: сумма может стоять на соседней строке — ищем контрагента с тем же сальдо
    if (marks.kz != null || marks.dz != null) {
      var byRow = {}; cps.forEach(function (c) { c.rows.forEach(function (rr) { byRow[rr] = c; }); });
      for (var q = start; q < rows.length; q++) {
        ['kz', 'dz'].forEach(function (kind) {
          var col = marks[kind]; if (col == null) return;
          var val = num(rows[q][col]); if (!val) return;
          var best = null;
          for (var d = 0; d <= 8 && !best; d++) {
            [q - d, q + d].forEach(function (rr) {
              var c = byRow[rr]; if (!best && c && Math.abs(Math.abs(c.net) - Math.abs(val)) < 0.01) best = c;
            });
          }
          if (!best) for (var d2 = 0; d2 <= 8 && !best; d2++) { if (byRow[q - d2]) best = byRow[q - d2]; }
          if (best) { if (kind === 'kz') best.markKz += val; else best.markDz += val; }
        });
      }
      info.hasMarks = true;
    }
    return { info: info, cps: cps };
  }

  // ---------- сборка данных ----------
  function resolve(an, req, reg, opts) {
    var orgs = req.orgs;
    function uniq(recs) { var m = {}; (recs || []).forEach(function (x) { m[x.inn] = x; }); return Object.keys(m).map(function (k) { return m[k]; }); }
    // ИНН по реестру: точное имя из 1С, при неоднозначности — сверка по ключу наименования
    function regInn(name) {
      var key = nameKey(name);
      var hits = uniq(reg.byName[s(name).toLowerCase()]);
      if (hits.length > 1) hits = hits.filter(function (x) { return x.key.core === key.core; });
      if (hits.length === 1) return hits[0].inn;
      if (!key.core) return '';
      hits = uniq(reg.byKey[key.form + '|' + key.core]);
      if (hits.length === 1) return hits[0].inn;
      if (!hits.length && !key.form) {
        var any = [];
        Object.keys(reg.byKey).forEach(function (k) { if (k.split('|')[1] === key.core) any = any.concat(reg.byKey[k]); });
        any = uniq(any); if (any.length === 1) return any[0].inn;
      }
      return '';
    }
    function findOrgByName(name) {
      var key = nameKey(name);
      if (!key.core) return null;
      var hits = orgs.filter(function (o) { return o._key.core === key.core && (!key.form || !o._key.form || o._key.form === key.form); });
      if (hits.length === 1) return hits[0];
      hits = hits.filter(function (o) { return o._key.form === key.form; });
      return hits.length === 1 ? hits[0] : null;
    }
    var company = findOrgByName(an.info.company);
    var included = opts.accounts;
    var list = an.cps.map(function (c) {
      var amount = 0, accs = [];
      Object.keys(c.acc).sort().forEach(function (a) {
        if (included[a] === false) return;
        if (Math.abs(c.acc[a]) > 0.004) { amount += c.acc[a]; accs.push(a + ': ' + money(c.acc[a])); }
      });
      var inn = c.inn || regInn(c.name);
      var org = inn ? req.byInn[inn] : null;
      if (!org) org = findOrgByName(c.name);
      if (!inn && org) inn = org['ИНН'] || '';
      var inReg = !!(inn && reg.byInn[inn]);
      var marked = !!(c.markKz || c.markDz);
      var vgo = an.info.hasMarks ? marked : inReg;
      if (an.info.hasMarks && an.info.hasInn && inReg) vgo = true;
      return {
        id: 'r' + c.row, name: c.name, inn: inn, org: org, net: r2(amount), accs: accs.join('; '),
        status: inReg ? reg.byInn[inn].status : '', vgo: vgo,
        include: vgo, pct: 100, inPackage: true
      };
    });
    return { company: company, list: list, period: an.info.period, info: an.info };
  }

  function plan(data, opts) {
    var company = data.company, cess = opts.cessionary;
    var rows = [], out = [];
    data.list.forEach(function (c) {
      if (!c.vgo || !c.include || Math.abs(c.net) < 0.005) return;
      var kz = c.net < 0;
      var cedent = kz ? c : { name: company && company['Полное наименование'], inn: company && company['ИНН'], org: company };
      var debtor = kz ? { name: company && company['Полное наименование'], inn: company && company['ИНН'], org: company } : c;
      var nominal = Math.abs(c.net);
      var r = {
        src: c, kind: kz ? 'КЗ' : 'ДЗ', cedent: cedent, debtor: debtor, nominal: nominal,
        pct: c.pct, price: r2(nominal * c.pct / 100), note: '', inPackage: c.inPackage
      };
      if (cess && cedent.inn && cedent.inn === cess['ИНН']) { r.skip = 'уже у цессионария — не уступается'; }
      else if (cess && debtor.inn && debtor.inn === cess['ИНН']) { r.skip = 'долг самого цессионария — гасится зачетом'; }
      if (!r.skip && !c.org) r.note = 'нет реквизитов';
      rows.push(r);
    });
    rows.sort(function (a, b) { return a.kind === b.kind ? b.nominal - a.nominal : (a.kind === 'КЗ' ? -1 : 1); });
    var n = 0;
    rows.forEach(function (r) { if (!r.skip && r.inPackage) { n++; r.num = 'Ц-' + String(n).padStart(2, '0'); } });
    var own = rows.filter(function (r) { return r.kind === 'КЗ' && r.skip && r.cedent.inn === (cess && cess['ИНН']); }).reduce(function (a, r) { return a + r.nominal; }, 0);
    var kzCess = rows.filter(function (r) { return r.kind === 'КЗ' && !r.skip; });
    var dzCess = rows.filter(function (r) { return r.kind === 'ДЗ' && !r.skip; });
    var sum = function (a, f) { return r2(a.reduce(function (x, r) { return x + f(r); }, 0)); };
    var debtToCess = r2(own + sum(kzCess, function (r) { return r.nominal; }));
    var dzPrice = sum(dzCess.filter(function (r) { return r.inPackage; }), function (r) { return r.price; });
    var zachet = opts.payDzByOffset ? Math.min(dzPrice, debtToCess) : 0;
    return {
      rows: rows, own: own, kzNominal: sum(kzCess, function (r) { return r.nominal; }), kzPrice: sum(kzCess, function (r) { return r.price; }),
      dzNominal: sum(dzCess, function (r) { return r.nominal; }), dzPrice: dzPrice, debtToCess: debtToCess, zachet: r2(zachet),
      finalDebt: r2(debtToCess - zachet), count: n
    };
  }

  // ---------- сторона договора ----------
  var DATIVE = [['Общество с ограниченной ответственностью', 'Обществу с ограниченной ответственностью'],
    ['Публичное акционерное общество', 'Публичному акционерному обществу'], ['Непубличное акционерное общество', 'Непубличному акционерному обществу'],
    ['Закрытое акционерное общество', 'Закрытому акционерному обществу'], ['Акционерное общество', 'Акционерному обществу']];
  function party(org, fallbackName, inn) {
    var r = org || {};
    var p = { r: r, inn: (r['ИНН'] || inn || ''), name: quotes(r['Полное наименование'] || s(fallbackName).replace(/\s*!+\s*$/, '') || '') };
    p.ip = /^ИП\s/.test(p.name) || /^Индивидуальный предприниматель/i.test(p.name) || p.inn.length === 12;
    var fio = null, posNom = null, posGen = null;
    [['Генеральный директор', 'Генеральный директор', 'Генерального директора'], ['Директор', 'Директор', 'Директора'],
      ['Руководитель', 'Генеральный директор', 'Генерального директора']].some(function (k) {
      if (r[k[0]]) { fio = r[k[0]]; posNom = k[1]; posGen = k[2]; return true; } return false;
    });
    if (p.ip) {
      fio = p.name.replace(/^ИП\s+/, '').replace(/^Индивидуальный предприниматель\s+/i, '');
      if (!/^Индивидуальный предприниматель/.test(p.name)) p.name = 'Индивидуальный предприниматель ' + fio;
      posNom = 'Индивидуальный предприниматель';
    }
    p.posNom = posNom; p.posGen = posGen; p.fio = fio; p.gender = 'male'; p.short = '________________';
    var parts = fio ? s(fio).split(' ') : [];
    if (parts.length === 3) {
      var who = { last: parts[0], first: parts[1], middle: parts[2] };
      try {
        var g = petrovich(Object.assign({}, who), 'genitive'); p.gender = g.gender || 'male';
        p.fioGen = [g.last, g.first, g.middle].join(' ');
        var dd = petrovich(Object.assign({}, who), 'dative'); p.fioDat = [dd.last, dd.first, dd.middle].join(' ');
      } catch (e) { p.fioGen = fio; p.fioDat = fio; }
      p.short = parts[0] + ' ' + parts[1][0] + '.' + parts[2][0] + '.';
    }
    p.intro = function (role) {
      if (p.ip) return p.name + ' (ИНН ' + p.inn + '), именуем' + (p.gender === 'female' ? 'ая' : 'ый') + ' в дальнейшем «' + role + '»';
      var who = p.fioGen ? p.posGen + ' ' + p.fioGen : '________________________________';
      return p.name + ', именуемое в дальнейшем «' + role + '», в лице ' + who + ', ' + (p.gender === 'female' ? 'действующей' : 'действующего') + ' на основании Устава';
    };
    p.dative = function () {
      if (p.ip && p.fioDat) return 'Индивидуальному предпринимателю ' + p.fioDat;
      for (var i = 0; i < DATIVE.length; i++) if (p.name.indexOf(DATIVE[i][0]) === 0) return DATIVE[i][1] + p.name.slice(DATIVE[i][0].length);
      return p.name;
    };
    p.reqLines = function () {
      var L = [p.name, (p.inn ? 'ИНН ' + p.inn : 'Рег. номер: ______________') + (r['Код КПП'] ? ' / КПП ' + r['Код КПП'] : '')];
      if (r['Юридический адрес']) L.push('Адрес: ' + s(r['Юридический адрес']).replace(/\s+,/g, ','));
      if (r['Расчетный счет']) L.push('р/с ' + r['Расчетный счет']);
      if (r['Банк']) L.push(quotes(r['Банк']));
      if (r['БИК']) L.push('БИК ' + r['БИК'] + (r['Корр.счет'] ? ', к/с ' + r['Корр.счет'] : ''));
      if (!org) { L.push('Адрес: ______________________________'); L.push('Банковские реквизиты: ______________________________'); }
      return L;
    };
    p.city = function () {
      var m = s(r['Юридический адрес']).match(/(?:^|[\s,])(?:г\.?|город|Город)\s+([А-ЯЁ][а-яё\-]+)/);
      return m ? m[1] : '____________';
    };
    return p;
  }

  // ---------- DOCX ----------
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function run(t, o) {
    o = o || {};
    var pr = (o.b ? '<w:b/>' : '') + (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '');
    return String(t).split('\t').map(function (part, i) {
      return (i ? '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:tab/></w:r>' : '') +
        (part ? '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(part) + '</w:t></w:r>' : '');
    }).join('');
  }
  function P(runs, o) {
    o = o || {};
    var ppr = '';
    if (o.tabRight) ppr += '<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>';
    ppr += '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 60 : o.after) + '"/>';
    if (o.indent) ppr += '<w:ind w:firstLine="567"/>';
    ppr += '<w:jc w:val="' + (o.align || 'both') + '"/>';
    if (typeof runs === 'string' && runs.indexOf('<w:') !== 0) runs = run(runs, o);
    return '<w:p><w:pPr>' + ppr + '</w:pPr>' + runs + '</w:p>';
  }
  function doc() {
    var body = [];
    return {
      title: function (a, b) { body.push(P(run(a, { b: 1, sz: 26 }), { align: 'center', after: 0 })); body.push(P(run(b, { b: 1 }), { align: 'center', after: 0 })); },
      placeDate: function (city, d) { body.push(P(run('г. ' + city + '\t' + dateLong(d)), { tabRight: 1, before: 200, after: 200, align: 'left' })); },
      placeText: function (t) { body.push(P(run(t), { tabRight: 1, before: 200, after: 200, align: 'left' })); },
      para: function (t) { body.push(P(t, { indent: 1 })); },
      head: function (t) { body.push(P(run(t, { b: 1 }), { align: 'center', before: 120 })); },
      plain: function (t, o) { body.push(P(run(t, o), { align: 'left' })); },
      // таблица с рамками: widths в twips, aligns — 'left'|'right'|'center'
      grid: function (head, rows, widths, aligns) {
        var b = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (k) { return '<w:' + k + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>'; }).join('') + '</w:tblBorders>';
        var tr = function (cells, bold) {
          return '<w:tr>' + cells.map(function (c, i) {
            return '<w:tc><w:tcPr><w:tcW w:w="' + widths[i] + '" w:type="dxa"/></w:tcPr>' +
              P(run(c == null ? '' : c, { b: bold ? 1 : 0, sz: 20 }), { align: bold ? 'center' : ((aligns && aligns[i]) || 'left'), after: 0 }) + '</w:tc>';
          }).join('') + '</w:tr>';
        };
        body.push('<w:tbl><w:tblPr><w:tblW w:w="' + widths.reduce(function (a, x) { return a + x; }, 0) + '" w:type="dxa"/>' + b +
          '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
          widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>' + tr(head, true) +
          rows.map(function (r) { return tr(r, r._bold); }).join('') + '</w:tbl>');
        body.push(P('', { after: 60 }));
      },
      requisites: function (parties) {
        body.push(P(run('Реквизиты и подписи Сторон', { b: 1 }), { align: 'center', before: 120 }));
        var w = Math.floor(9638 / parties.length);
        var cell = function (content) { return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/></w:tcPr>' + content + '</w:tc>'; };
        var row1 = parties.map(function (pp) {
          return cell(P(run(pp[0], { b: 1 }), { align: 'left', after: 40 }) + pp[1].reqLines().map(function (l) { return P(run(l, { sz: 20 }), { align: 'left', after: 0 }); }).join(''));
        }).join('');
        var row2 = parties.map(function (pp) {
          var x = pp[1];
          return cell(P('', { after: 0 }) + P(run(x.posNom || '________________'), { align: 'left', after: 0 }) + P('', { after: 0 }) +
            P(run('_______________ / ' + x.short + ' /'), { align: 'left', after: 0 }) + P(run(x.ip ? '' : 'М.П.'), { align: 'left', after: 0 }));
        }).join('');
        body.push('<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
          parties.map(function () { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid><w:tr>' + row1 + '</w:tr><w:tr>' + row2 + '</w:tr></w:tbl>');
      },
      // «рыба» блока подписей: parties = [[подпись роли, префикс меток]]
      requisitesTpl: function (parties) {
        body.push(P(run('Реквизиты и подписи Сторон', { b: 1 }), { align: 'center', before: 120 }));
        var w = Math.floor(9638 / parties.length);
        var cell = function (content) { return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/></w:tcPr>' + content + '</w:tc>'; };
        var row1 = parties.map(function (pp) { return cell(P(run(pp[0], { b: 1 }), { align: 'left', after: 40 }) + P(run('{{' + pp[1] + '.Реквизиты}}', { sz: 20 }), { align: 'left', after: 0 })); }).join('');
        var row2 = parties.map(function (pp) {
          return cell(P('', { after: 0 }) + P(run('{{' + pp[1] + '.Должность}}'), { align: 'left', after: 0 }) + P('', { after: 0 }) +
            P(run('_______________ / {{' + pp[1] + '.Подпись}} /'), { align: 'left', after: 0 }) + P(run('{{' + pp[1] + '.МП}}'), { align: 'left', after: 0 }));
        }).join('');
        body.push('<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
          parties.map(function () { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid><w:tr>' + row1 + '</w:tr><w:tr>' + row2 + '</w:tr></w:tbl>');
      },
      xml: function () {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          body.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="850" w:bottom="1020" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>';
      }
    };
  }
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  function docxBlob(d, type) {
    var z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    z.file('word/styles.xml', STYLES);
    z.file('word/document.xml', d.xml());
    return z.generateAsync({ type: type || 'uint8array' });
  }

  // ---------- тексты договоров ----------
  function cessionDoc(num, date, cedent, cessionary, debtor, nominal, price, payText, basis) {
    var d = doc();
    d.title('ДОГОВОР № ' + num, 'уступки права требования (цессии)');
    d.placeDate(cessionary.city(), date);
    d.para(cedent.intro('Цедент') + ', с одной стороны, и ' + cessionary.intro('Цессионарий') + ', с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем:');
    d.head('1. Предмет договора');
    d.para('1.1. Цедент уступает, а Цессионарий принимает право требования к ' + debtor.dative() + ' (ИНН ' + (debtor.inn || '__________') + '), далее — «Должник», уплаты задолженности ' + (basis || 'по договору № ______ от ____________') + ' (далее — «Основной договор») в сумме ' + words(nominal) + '.');
    d.para('1.2. Право требования переходит к Цессионарию в том объеме и на тех условиях, которые существовали к моменту перехода права, в том числе право на неуплаченные проценты и неустойки, если иное не установлено настоящим договором. Право требования переходит к Цессионарию в момент подписания настоящего договора.');
    d.para('1.3. Цедент гарантирует, что уступаемое право требования действительно, принадлежит Цеденту, ранее не уступалось, не заложено, не прекращено зачетом или иным способом и не находится под арестом.');
    d.head('2. Цена и порядок расчетов');
    d.para('2.1. За уступаемое право требования Цессионарий уплачивает Цеденту ' + words(price) + '.');
    d.para('2.2. ' + payText);
    d.head('3. Права и обязанности Сторон');
    d.para('3.1. Цедент в течение 3 (трех) рабочих дней с даты подписания настоящего договора передает Цессионарию по акту приема-передачи документы, удостоверяющие право требования: Основной договор, первичные документы (УПД, товарные накладные, акты), акт сверки расчетов с Должником.');
    d.para('3.2. Цедент отвечает перед Цессионарием за действительность уступаемого требования и не отвечает за его исполнение Должником.');
    d.para('3.3. Цедент уведомляет Должника о состоявшейся уступке. Подписание Должником настоящего договора подтверждает получение им уведомления об уступке и размер задолженности, указанный в пункте 1.1. С даты подписания договора Должник исполняет обязательство Цессионарию по его реквизитам.');
    d.head('4. Заключительные положения');
    d.para('4.1. Договор вступает в силу с момента подписания Сторонами и действует до полного исполнения обязательств.');
    d.para('4.2. Споры разрешаются в Арбитражном суде по месту нахождения Цессионария.');
    d.para('4.3. Договор составлен в трех экземплярах, имеющих равную юридическую силу: для Цедента, Цессионария и Должника.');
    d.requisites([['Цедент', cedent], ['Цессионарий', cessionary]]);
    d.plain('Уведомлен об уступке. Задолженность в сумме ' + money(nominal) + ' руб. подтверждаю.', { b: 1 });
    d.plain('Должник: ' + debtor.name);
    d.plain((debtor.posNom || '') + '  _______________ / ' + debtor.short + ' /       М.П.');
    return d;
  }
  function zachetDoc(num, date, p1, p2, debt21, debt12, amount, basis21, basis12) {
    var d = doc();
    d.title('СОГЛАШЕНИЕ № ' + num, 'о зачете встречных однородных требований');
    d.placeDate(p1.city(), date);
    d.para(p1.intro('Сторона 1') + ', с одной стороны, и ' + p2.intro('Сторона 2') + ', с другой стороны, совместно именуемые «Стороны», заключили настоящее соглашение о нижеследующем:');
    d.para('1. Стороны подтверждают наличие следующих встречных однородных денежных требований:');
    d.para('1.1. Задолженность Стороны 2 перед Стороной 1 ' + basis21 + ' в сумме ' + words(debt21) + '.');
    d.para('1.2. Задолженность Стороны 1 перед Стороной 2 ' + basis12 + ' в сумме ' + words(debt12) + '.');
    d.para('2. В соответствии со статьей 410 Гражданского кодекса Российской Федерации Стороны прекращают зачетом встречные однородные требования, указанные в пункте 1 настоящего соглашения, на сумму ' + words(amount) + '.');
    d.para('3. После проведения зачета:');
    d.para('– задолженность Стороны 2 перед Стороной 1 составляет ' + money(debt21 - amount) + ' руб.;');
    d.para('– задолженность Стороны 1 перед Стороной 2 составляет ' + money(debt12 - amount) + ' руб.');
    d.para('4. Стороны подтверждают, что требования, прекращаемые настоящим соглашением, не уступлены третьим лицам, не обременены правами третьих лиц и не оспариваются.');
    d.para('5. Стороны отразят зачет в бухгалтерском учете на дату подписания настоящего соглашения и в течение 5 (пяти) рабочих дней подпишут акт сверки взаимных расчетов.');
    d.para('6. Соглашение вступает в силу с момента подписания, составлено в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.');
    d.requisites([['Сторона 1', p1], ['Сторона 2', p2]]);
    return d;
  }
  function safeName(t) { return s(t).replace(/Общество с ограниченной ответственностью/g, 'ООО').replace(/Акционерное общество/g, 'АО').replace(/[\\/:*?"<>|«»]/g, '').slice(0, 40).trim(); }

  function buildPackage(pl, data, opts) {
    var date = opts.date, zip = new JSZip(), tasks = [], files = [];
    var cess = party(opts.cessionary), comp = party(data.company);
    var kzNums = [], dzNums = [];
    pl.rows.forEach(function (r) {
      if (r.skip || !r.inPackage || !r.num) return;
      var cedent = r.kind === 'КЗ' ? party(r.src.org, r.src.name, r.src.inn) : comp;
      var debtor = r.kind === 'КЗ' ? comp : party(r.src.org, r.src.name, r.src.inn);
      var pay;
      if (r.kind === 'ДЗ' && opts.payDzByOffset) pay = 'Обязательство Цессионария по уплате цены прекращается зачетом встречного однородного требования Цессионария к Цеденту по соглашению № ЗЦ-01 от ' + dateShort(date) + '.';
      else pay = 'Цена уплачивается Цессионарием путем перечисления денежных средств на расчетный счет Цедента в срок до ' + dateShort(opts.payDate) + '.' + (r.pct < 100 ? ' Разница между размером уступаемого требования и ценой уступки Цеденту не возмещается.' : '');
      (r.kind === 'КЗ' ? kzNums : dzNums).push(r.num);
      var d = cessionDoc(r.num, date, cedent, cess, debtor, r.nominal, r.price, pay);
      var fname = (r.kind === 'КЗ' ? '1_Кредиторы_уступают_долг_' + safeName(comp.name) : '2_' + safeName(comp.name) + '_уступает_ДЗ') + '/' + r.num + '_' + safeName(cedent.name) + '_' + safeName(debtor.name) + '.docx';
      files.push(fname);
      tasks.push(docxBlob(d).then(function (b) { zip.file(fname, b); }));
    });
    if (opts.payDzByOffset && pl.zachet > 0.005) {
      var separate = pl.rows.filter(function (r) { return r.kind === 'КЗ' && !r.skip && !r.inPackage; })
        .map(function (r) { return ', по договору уступки прав требования с ' + quotes(r.src.org ? r.src.org['Полное наименование'] : r.src.name.replace(/\s*!+\s*$/, '')) + ' № ______ от ____________'; }).join('');
      var basis21 = 'по договорам поставки и займа' + (kzNums.length ? ', а также по требованиям, приобретенным Стороной 1 по договорам уступки прав требования № ' + kzNums.join(', ') + ' от ' + dateShort(date) : '') + separate + ',';
      var basis12 = 'по уплате цены уступки прав требования по договорам цессии № ' + dzNums.join(', ') + ' от ' + dateShort(date);
      var zd = zachetDoc('ЗЦ-01', date, cess, comp, pl.debtToCess, pl.dzPrice, pl.zachet, basis21, basis12);
      var zf = '2_' + safeName(comp.name) + '_уступает_ДЗ/ЗЦ-01_зачет_с_' + safeName(cess.name) + '.docx';
      files.push(zf);
      tasks.push(docxBlob(zd).then(function (b) { zip.file(zf, b); }));
    }
    var blank = party(null, '______________________________', '');
    blank.intro = function (role) { return '______________________________ (ИНН __________), именуемое в дальнейшем «' + role + '», в лице ________________________, действующего на основании Устава'; };
    tasks.push(docxBlob(cessionDoc('____', date, blank, blank, blank, 0, 0, 'Цена уплачивается Цессионарием путем перечисления денежных средств на расчетный счет Цедента в срок до ____________.')).then(function (b) { zip.file('0_Шаблон_договора_цессии.docx', b); }));
    return Promise.all(tasks).then(function () { return { zip: zip, files: files }; });
  }

  // ---------- Excel ----------
  function buildXlsx(pl, data, opts) {
    var comp = data.company, cess = opts.cessionary;
    var title = 'Уступки ВГО-долга ' + s(comp && comp['Полное наименование']) + ' на ' + dateShort(opts.date);
    var head = ['№ договора', 'Вид', 'Цедент (кредитор)', 'ИНН цедента', 'Должник', 'ИНН должника', 'Цессионарий', 'Номинал', 'Цена, %', 'Цена', 'Оплата', 'Счета (сальдо: + Дт / − Кт)', 'Статус реестра', 'Примечание'];
    var aoa = [[title], ['Остатки: ' + (data.period || '') + '. Уступает всегда кредитор. Цессионарий: ' + s(cess && cess['Полное наименование'])], [], head];
    var payTxt = function (r) { return r.kind === 'ДЗ' && opts.payDzByOffset ? 'зачет ЗЦ-01' : 'до ' + dateShort(opts.payDate); };
    pl.rows.forEach(function (r) {
      aoa.push([r.skip ? '—' : (r.num || 'вне пакета'), r.kind === 'КЗ' ? 'долг компании' : 'долг перед компанией',
        quotes(r.kind === 'КЗ' ? (r.src.org ? r.src.org['Полное наименование'] : r.src.name.replace(/\s*!+\s*$/, '')) : comp['Полное наименование']),
        r.kind === 'КЗ' ? r.src.inn : comp['ИНН'],
        quotes(r.kind === 'КЗ' ? comp['Полное наименование'] : (r.src.org ? r.src.org['Полное наименование'] : r.src.name.replace(/\s*!+\s*$/, ''))),
        r.kind === 'КЗ' ? comp['ИНН'] : r.src.inn,
        r.skip ? '' : quotes(cess['Полное наименование']), r.nominal, r.skip ? null : r.pct / 100, r.skip ? null : r.price,
        r.skip ? '' : payTxt(r), r.src.accs, r.src.status, r.skip || r.note]);
    });
    var first = 5, last = aoa.length;
    aoa.push([]);
    aoa.push(['Итого уступается (номинал)', '', '', '', '', '', '', { f: 'SUMIFS(H' + first + ':H' + last + ',A' + first + ':A' + last + ',"<>—")' }, '', { f: 'SUM(J' + first + ':J' + last + ')' }]);
    aoa.push([]);
    aoa.push(['Долг перед цессионарием до сделки', '', '', '', '', '', '', pl.own]);
    aoa.push(['+ приобретенные требования к компании (КЗ)', '', '', '', '', '', '', pl.kzNominal]);
    aoa.push(['− зачет цены уступленной ДЗ (ЗЦ-01)', '', '', '', '', '', '', -pl.zachet]);
    aoa.push(['Долг компании перед цессионарием после', '', '', '', '', '', '', pl.finalDebt]);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var range = XLSX.utils.decode_range(ws['!ref']);
    for (var R = 3; R <= range.e.r; R++) {
      ['H', 'J'].forEach(function (c) { var cell = ws[c + (R + 1)]; if (cell && (cell.t === 'n' || cell.f)) cell.z = '#,##0.00'; });
      var pc = ws['I' + (R + 1)]; if (pc && pc.t === 'n') pc.z = '0%';
    }
    ws['!cols'] = [10, 18, 42, 13, 42, 13, 30, 17, 8, 17, 14, 40, 12, 26].map(function (w) { return { wch: w }; });
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 13 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 13 } }];
    ws['!autofilter'] = { ref: 'A4:N' + last };
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Уступки');
    var aoa2 = [['Контрагент (1С)', 'ИНН', 'Найден в реквизитах', 'ВГО', 'Сальдо (+ Дт / − Кт)', 'Счета']];
    data.list.forEach(function (c) { if (c.vgo || Math.abs(c.net) > 0.005 && c.inn) aoa2.push([c.name, c.inn, c.org ? quotes(c.org['Полное наименование']) : 'нет', c.vgo ? 'да' : '', c.net, c.accs]); });
    var ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    for (var i = 2; i <= aoa2.length; i++) { var c5 = ws2['E' + i]; if (c5) c5.z = '#,##0.00'; }
    ws2['!cols'] = [40, 13, 50, 6, 18, 50].map(function (w) { return { wch: w }; });
    ws2['!autofilter'] = { ref: 'A1:F' + aoa2.length };
    XLSX.utils.book_append_sheet(wb, ws2, 'Контрагенты');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  var api = {
    libs: libs, readRows: readRows, parseRequisites: parseRequisites, parseRegistry: parseRegistry, parseAnalysis: parseAnalysis,
    resolve: resolve, plan: plan, buildPackage: buildPackage, buildXlsx: buildXlsx, money: money, words: words, quotes: quotes,
    dateShort: dateShort, parseDate: parseDate, party: party, nameKey: nameKey,
    doc: doc, docxBlob: docxBlob, safeName: safeName, P: P, run: run, esc: esc, s: s, r2: r2, num: num, dateLong: dateLong,
    get XLSX() { return XLSX; }, get JSZip() { return JSZip; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(this);
