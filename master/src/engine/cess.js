/* Движок v2: выгрузки «Анализ субконто» нескольких баз (Организация → Контрагент → Счет), уступки по счетам. */
(function (root) {
  'use strict';
  var E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var TPL = root.EngineTpl || (typeof require !== 'undefined' ? require('./engine_tpl.js') : null);
  var s = E.s, r2 = E.r2, num = E.num, money = E.money, words = E.words, quotes = E.quotes, dateShort = E.dateShort;

  var BALANCE_ACC = /^(5[0-9]|6[0-9]|7[0-9])$/;
  var NOT_DEBT = { '19': 'НДС по приобретенным ценностям', '63': 'резерв по сомнительным долгам', '68': 'налоги', '69': 'страховые взносы', '70': 'оплата труда' };

  // ---------- вид требования по счету и знаку сальдо (с точки зрения выбранной организации) ----------
  var ADV = 'требование о передаче предварительно оплаченного товара (работ, услуг) либо о возврате суммы предварительной оплаты (ст. 487 ГК РФ)';
  var LOAN = 'требование о возврате суммы займа и уплате процентов за пользование займом';
  function kind(acc, amount) {
    var pos = amount > 0;   // + Дт: контрагент должен организации; − Кт: организация должна контрагенту
    switch (acc) {
      case '60': return pos ? { code: 'adv', label: 'аванс, выданный поставщику', claim: ADV, basis: 'договор поставки', adv: true }
        : { code: 'trade', label: 'оплата поставленного товара', claim: 'требование об оплате поставленного товара (работ, услуг)', basis: 'договор поставки' };
      case '62': return pos ? { code: 'trade', label: 'оплата отгруженного товара', claim: 'требование об оплате отгруженного товара (работ, услуг)', basis: 'договор поставки' }
        : { code: 'adv', label: 'аванс, полученный от покупателя', claim: ADV, basis: 'договор поставки', adv: true };
      case '58': return pos ? { code: 'loan', label: 'заем выданный', claim: LOAN, basis: 'договор займа', loan: true }
        : { code: 'other', label: 'прочие расчеты', claim: 'денежное требование', basis: 'договор' };
      case '66': case '67': return !pos ? { code: 'loan', label: 'заем полученный', claim: LOAN, basis: 'договор займа', loan: true }
        : { code: 'other', label: 'переплата по займу', claim: 'требование о возврате излишне уплаченных денежных средств', basis: 'договор займа' };
      default: return { code: 'other', label: 'прочие расчеты (сч. ' + acc + ')', claim: 'денежное требование по расчетам', basis: 'договор' };
    }
  }

  // ---------- разбор выгрузки ----------
  function readBook(buf) {
    var X = E.XLSX;
    var wb = X.read(buf, { type: 'array', cellStyles: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var off = ws['!ref'] ? X.utils.decode_range(ws['!ref']).s.r : 0; // лист может начинаться не с 1-й строки
    return { rows: X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }), meta: (ws['!rows'] || []).slice(off) };
  }
  // длина периода отчета в месяцах: «3 квартал 2026», «9 месяцев 2026», «2026 год», «01.01.2026 - 30.09.2026»
  function periodMonths(t) {
    t = String(t);
    if (/квартал/i.test(t)) return 3;
    var m = t.match(/(\d+)\s*месяц/i); if (m) return +m[1];
    if (/полугодие/i.test(t)) return 6;
    m = t.match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) return Math.max(1, Math.round(((+m[6] - +m[3]) * 12 + (+m[5] - +m[2])) + (+m[4] - +m[1] + 1) / 30));
    if (/\d{4}\s*г/.test(t)) return 12;
    return 3;
  }
  function quarterEnd(t) {
    var mm = String(t).match(/(\d+)\s*месяц\S*\s*(\d{4})/i);
    if (mm) return new Date(+mm[2], +mm[1], 0);
    var m = String(t).match(/(\d)\s*квартал\s*(\d{4})/i);
    if (m) { var q = +m[1], y = +m[2]; return new Date(y, q * 3, 0); }
    m = String(t).match(/\d{2}\.\d{2}\.\d{4}\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    return null;
  }
  // Регистр бухгалтерии «Журнал проводок», таблица «Остатки и обороты»: все организации и все счета одним файлом.
  // Группировки: 0 — организация (без ИНН), 1 — счет (субсчет), 2 — «Субконто 1, ИНН», 3 — субконто 2 (договор / документ).
  // «Наименование, 7700000000», «Наименование 7700000000», «Наименование (ИНН 7700000000)», «Наименование ИНН: 7700000000 / КПП …»
  function splitInn(text) {
    var t = s(text), m = t.match(/^(.*?)[\s,;]*\(?\s*ИНН\s*:?\s*(\d{10}|\d{12})\b[^)]*\)?\s*$/i) || t.match(/^(.*?)(?:,\s*|\s+)(\d{10}|\d{12})\s*$/);
    if (m && m[1].trim()) return { name: m[1].replace(/[\s,;]+$/, '').trim(), inn: m[2] };
    return { name: t.replace(/,\s*$/, '').trim(), inn: '' };
  }
  var ARCH = /\(\s*до\s+\d{2}\.\d{2}\.\d{4}\s*\)/i;
  var REG_CP = /^(19|58|60|62|66|67|76)$/; // счета расчетов с контрагентами; 70/71/73/75/80 и прочие — только в итогах по счету
  function isRegister(rows) {
    for (var i = 0; i < Math.min(rows.length, 15); i++) for (var j = 0; j < (rows[i] || []).length; j++) {
      var v = s(rows[i][j]);
      if (/Регистр бухгалтерии|Остатки и обороты/i.test(v) || /кон\.\s*ост\.?\s*Дт/i.test(v)) return true;
    }
    return false;
  }
  function parseRegister(book, fileName) {
    var rows = book.rows, meta = book.meta, title = '', hdr = -1, col = {};
    var pats = { od: /нач.*ост.*дт/i, ok: /нач.*ост.*кт/i, td: /оборот\s*дт/i, tk: /оборот\s*кт/i, cd: /кон.*ост.*дт/i, ck: /кон.*ост.*кт/i };
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
      for (var j = 0; j < (rows[i] || []).length; j++) {
        var v = s(rows[i][j]);
        if (/Период:/i.test(v)) title = v;
        Object.keys(pats).forEach(function (k) { if (col[k] == null && pats[k].test(v.replace(/\s+/g, ' '))) { col[k] = j; hdr = Math.max(hdr, i); } });
      }
    }
    if (col.cd == null || col.ck == null) throw new Error(fileName + ': нет колонок конечного остатка');
    while (hdr + 1 < rows.length && /^субконто/i.test(s((rows[hdr + 1] || [])[0]))) hdr++;
    var g = function (r, k) { return col[k] == null ? 0 : num(r[col[k]]); };
    var orgs = [], org = null, acc = '', a2 = '', cp = null;
    for (var k = hdr + 1; k < rows.length; k++) {
      var r = rows[k] || [], name = s(r[0]), lvl = (meta[k] && meta[k].level) || 0;
      if (lvl === 0) { if (name && !/^итого$/i.test(name)) { var on = splitInn(name); if (ARCH.test(on.name)) on.inn = ''; org = { name: on.name, inn: on.inn, file: fileName, cps: [], totals: {} }; orgs.push(org); } cp = null; continue; }
      if (!org) continue;
      if (lvl === 1) { acc = name; a2 = (acc.match(/^\d{2,3}/) || [''])[0]; cp = null;
        if (a2) { var t = org.totals[a2] = org.totals[a2] || [0, 0, 0, 0];
          t[0] = r2(t[0] + g(r, 'od') - g(r, 'ok')); t[1] = r2(t[1] + g(r, 'td')); t[2] = r2(t[2] + g(r, 'tk')); t[3] = r2(t[3] + g(r, 'cd') - g(r, 'ck')); }
        continue; }
      if (lvl === 2) {
        cp = null; if (!a2) continue;
        var sp = splitInn(name), cname = sp.name, inn = sp.inn;
        if (!cname || !REG_CP.test(a2)) continue;
        var key = inn || ('name:' + cname.toLowerCase());
        org._idx = org._idx || {};
        cp = org._idx[key]; if (!cp) { cp = org._idx[key] = { name: cname, inn: inn, acc: {} }; org.cps.push(cp); }
        cp.acc[a2] = r2((cp.acc[a2] || 0) + g(r, 'cd') - g(r, 'ck'));
        var dd = (cp.det = cp.det || {})[a2] = cp.det[a2] || [0, 0, 0, 0];
        dd[0] = r2(dd[0] + g(r, 'od') - g(r, 'ok')); dd[1] = r2(dd[1] + g(r, 'td')); dd[2] = r2(dd[2] + g(r, 'tk')); dd[3] = r2(dd[3] + g(r, 'cd') - g(r, 'ck'));
        continue;
      }
      // субконто 2: договор (документы с временем проведения пропускаем)
      if (cp && name && /^(58|60|62|66|67|76)$/.test(a2) && !/\d:\d\d:\d\d$/.test(name)) { cp.contracts = cp.contracts || []; if (cp.contracts.indexOf(name) < 0) cp.contracts.push(name); var ba = (cp.cbyacc = cp.cbyacc || {})[a2] = cp.cbyacc[a2] || []; if (ba.indexOf(name) < 0) ba.push(name); }
    }
    orgs.forEach(function (o) { delete o._idx; });
    var end = quarterEnd(title), today = new Date(); today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    // период «по конец года» — остатки фактически на сегодня
    var date = end && end > today ? today : end;
    return { file: fileName, title: title, date: date, months: periodMonths(title), orgs: orgs, register: true,
      note: end && end > today ? 'период отчета заканчивается ' + dateShort(end) + ' — остатки считаются на ' + dateShort(today) : '' };
  }
  var add4 = function (t, f) { for (var i = 0; i < 4; i++) t[i] = r2(t[i] + f[i]); };
  function absorb(tgt, o) {   // та же организация в другой базе 1С: суммируем
    o = JSON.parse(JSON.stringify(o));   // исходные книги не меняем (повторная сборка не задваивает)
    var idx = {}; tgt.cps.forEach(function (c) { idx[c.inn || c.name] = c; });
    o.cps.forEach(function (c) {
      var ex = idx[c.inn || c.name]; if (!ex) { tgt.cps.push(c); idx[c.inn || c.name] = c; return; }
      Object.keys(c.acc).forEach(function (a) { ex.acc[a] = r2((ex.acc[a] || 0) + c.acc[a]); ex.det = ex.det || {}; if (!ex.det[a]) ex.det[a] = [0, 0, 0, 0]; add4(ex.det[a], c.det[a]); });
    });
    tgt.totals = tgt.totals || {}; Object.keys(o.totals || {}).forEach(function (a) { if (!tgt.totals[a]) tgt.totals[a] = [0, 0, 0, 0]; add4(tgt.totals[a], o.totals[a]); });
    tgt.file = tgt.file === o.file ? tgt.file : tgt.file + ' + ' + o.file;
  }
  // Справочник: код региона (первые 2 цифры ИНН) → названия региона и крупных городов. Только для проверки догадок по наименованию.
  var REGION_NAMES = '01 адыгея майкоп;02 башкортостан башкирия уфа;03 бурятия улан-удэ;04 горно-алтайск;05 дагестан махачкала;06 ингушетия магас назрань;07 кабардино-балкария нальчик;08 калмыкия элиста;09 карачаево-черкесия черкесск;10 карелия петрозаводск;11 коми сыктывкар;12 марий йошкар-ола;13 мордовия саранск;14 якутия саха якутск;15 осетия владикавказ;16 татарстан казань челны;17 тыва кызыл;18 удмуртия ижевск;19 хакасия абакан;20 чечня грозный;21 чувашия чебоксары;22 алтайский барнаул;23 краснодарский краснодар сочи;24 красноярский красноярск;25 приморский приморье владивосток;26 ставропольский ставрополь;27 хабаровский хабаровск;28 амурская благовещенск;29 архангельская архангельск;30 астраханская астрахань;31 белгородская белгород;32 брянская брянск;33 владимирская владимир;34 волгоградская волгоград;35 вологодская вологда;36 воронежская воронеж;37 ивановская иваново;38 иркутская иркутск;39 калининградская калининград;40 калужская калуга;41 камчатский камчатка петропавловск;42 кемеровская кемерово новокузнецк;43 кировская киров;44 костромская кострома;45 курганская курган;46 курская курск;47 ленинградская гатчина;48 липецкая липецк;49 магаданская магадан;50 московская подмосковье;51 мурманская мурманск;52 нижегородская нижний новгород;53 новгородская;54 новосибирская новосибирск;55 омская омск;56 оренбургская оренбург;57 орловская орел орёл;58 пензенская пенза;59 пермский пермь;60 псковская псков;61 ростовская ростов;62 рязанская рязань;63 самарская самара тольятти;64 саратовская саратов;65 сахалинская сахалин;66 свердловская екатеринбург;67 смоленская смоленск;68 тамбовская тамбов;69 тверская тверь;70 томская томск;71 тульская тула;72 тюменская тюмень;73 ульяновская ульяновск;74 челябинская челябинск;75 забайкальский чита;76 ярославская ярославль;77 москва;78 петербург спб;79 еврейская биробиджан;83 ненецкий нарьян-мар;86 хмао югра сургут ханты-мансийск;87 чукотка анадырь;89 ямал ямало-ненецкий салехард уренгой;91 крым симферополь;92 севастополь';
  var REGION_STEMS = null;
  function placeStem(t) { return String(t).toLowerCase().replace(/ё/g, 'е').slice(0, 5); }
  function regionOfWord(w) {   // код региона для слова-топонима или null
    if (!REGION_STEMS) { REGION_STEMS = {}; REGION_NAMES.split(';').forEach(function (g) { var p = g.split(' '); p.slice(1).forEach(function (n) { REGION_STEMS[placeStem(n)] = p[0]; }); }); }
    return REGION_STEMS[placeStem(w)] || null;
  }
  // ИНН по наименованию: реестр ЮЛ (точное имя / имя в 1С / алиасы, затем ключ наименования), затем реквизиты.
  // Скобки «(бывш. …)» и форма (ООО/АО) при сравнении не учитываются; если формы нет — ищется по ядру наименования.
  function innByName(name, reg, req) {
    var nk = E.nameKey, key = nk(name);
    function uniq(recs) { var m = {}; (recs || []).forEach(function (x) { if (x.inn) m[x.inn] = x; }); return Object.keys(m).map(function (k) { return m[k]; }); }
    if (reg) {
      var hits = uniq(reg.byName[s(name).toLowerCase()]);
      if (hits.length > 1) hits = hits.filter(function (x) { return x.key && x.key.core === key.core; });
      if (hits.length === 1) return hits[0].inn;
      if (key.core) {
        hits = uniq(reg.byKey[key.form + '|' + key.core]);
        if (hits.length === 1) return hits[0].inn;
        if (!hits.length && !key.form) {
          var any = []; Object.keys(reg.byKey).forEach(function (k) { if (k.split('|')[1] === key.core) any = any.concat(reg.byKey[k]); });
          any = uniq(any); if (any.length === 1) return any[0].inn;
        }
        // лишние слова в наименовании («Регион-Сервис Курск» ↔ «Регион-Сервис»): слова записи реестра входят в наименование;
        // лишнее слово — шум («+», «оп») либо топоним, код региона которого совпадает с началом ИНН кандидата; неизвестное слово — отказ
        var tk = key.core.split(' ').filter(function (t) { return /[a-zа-я0-9]/i.test(t); }), cand = [];
        Object.keys(reg.byKey).forEach(function (k) {
          var ct = k.split('|')[1].split(' ').filter(function (t) { return /[a-zа-я0-9]/i.test(t); });
          if (!ct.length || ct.length >= tk.length || !ct.every(function (t) { return tk.indexOf(t) >= 0; })) return;
          if (key.form && k.split('|')[0] && k.split('|')[0] !== key.form) return;
          var extra = tk.filter(function (t) { return ct.indexOf(t) < 0; });
          reg.byKey[k].forEach(function (rec) {
            if (!rec.inn) return;
            var okx = extra.every(function (w) { var rc = regionOfWord(w); return rc ? rc === rec.inn.slice(0, 2) : /^(оп|тд|тк|кт|ип)$/.test(w); });
            if (okx) cand.push(rec);
          });
        });
        // знаки препинания в ядре («ПМК +») и обратный случай (в реестре лишнее «ОП», «ТД»)
        var cl = tk.join(' ');
        if (cl && cl !== key.core) { var h3 = uniq(reg.byKey[key.form + '|' + cl]); if (!h3.length && !key.form) Object.keys(reg.byKey).forEach(function (k) { if (k.split('|')[1] === cl) h3 = h3.concat(reg.byKey[k]); }); h3 = uniq(h3); if (h3.length === 1) return h3[0].inn; }
        Object.keys(reg.byKey).forEach(function (k) {
          var ct = k.split('|')[1].split(' ').filter(function (t) { return /[a-zа-я0-9]/i.test(t); });
          if (!tk.length || ct.length <= tk.length || !tk.every(function (t) { return ct.indexOf(t) >= 0; })) return;
          if (!ct.filter(function (t) { return tk.indexOf(t) < 0; }).every(function (w) { return /^(оп|тд|тк|кт|ип)$/.test(w); })) return;
          reg.byKey[k].forEach(function (rec) { if (rec.inn) cand.push(rec); });
        });
        cand = uniq(cand); if (cand.length === 1) return cand[0].inn;
      }
    }
    if (req && key.core) {
      var h2 = (req.orgs || []).filter(function (o) { var k2 = nk(o['Полное наименование'] || o['Наименование'] || ''); return o['ИНН'] && k2.core === key.core && (!key.form || !k2.form || k2.form === key.form); });
      if (h2.length === 1) return String(h2[0]['ИНН']);
    }
    return '';
  }
  // ИНН организаций без ИНН (формат «Регистр бухгалтерии») — по реестру ЮЛ, затем по реквизитам
  function fillOrgInn(merged, reg, req) {
    if (!merged || merged._filled) return 0;
    merged._filled = true;
    var n = 0;
    merged.archive = merged.archive || []; merged.multiBase = merged.multiBase || [];
    merged.orgs = merged.orgs.filter(function (o) {
      if (o.inn) return true;
      // архивная копия организации («… (до 31.12.2023)») — к ИНН не привязываем, показываем отдельно
      if (ARCH.test(o.name)) {
        var bal = r2(o.cps.reduce(function (x, c) { return x + Object.keys(c.acc).filter(function (a) { return !(a in NOT_DEBT); }).reduce(function (y, a) { return y + Math.abs(c.acc[a]); }, 0); }, 0));
        merged.archive.push({ name: o.name, file: o.file, balance: bal }); return true;
      }
      var inn = innByName(o.name, reg, req);
      if (!inn) return true;
      var ex = merged.byInn[inn];
      if (ex && ex !== o && ex.totals && o.totals && ex.file !== o.file) {
        if (!ex._copy) { var cp2 = JSON.parse(JSON.stringify(ex)); cp2._copy = true; merged.orgs[merged.orgs.indexOf(ex)] = cp2; merged.byInn[inn] = cp2; ex = cp2; }
        absorb(ex, o); delete merged.byInn['name:' + o.name]; merged.multiBase.push(ex.name); n++; return false; }
      if (ex) return true;
      delete merged.byInn['name:' + o.name]; o.inn = inn; merged.byInn[inn] = o; n++; return true;
    });
    merged.noInn = merged.orgs.filter(function (o) { return !o.inn && !/\(\s*до\s+\d{2}\./i.test(o.name); }).map(function (o) { return o.name; });
    return n;
  }
  function parseBook(book, fileName) {
    var rows = book.rows, meta = book.meta;
    if (isRegister(rows)) return parseRegister(book, fileName);
    var hdr = -1, cDt = -1, cInn = -1, title = '';
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      for (var j = 0; j < rows[i].length; j++) {
        var v = s(rows[i][j]), lv = v.toLowerCase();
        if (/анализ субконто/i.test(v)) title = v;
        if (/сальдо на конец/.test(lv)) { hdr = i; cDt = j; }
        if (lv === 'инн' && cInn < 0) cInn = j;
      }
    }
    if (cDt < 0) throw new Error(fileName + ': нет колонки «Сальдо на конец периода»');
    var hasLevels = meta.some(function (m) { return m && m.level; });
    if (!hasLevels) {
      // одна организация без группировок — старый формат
      var an = E.parseAnalysis(rows);
      return {
        file: fileName, title: title, date: quarterEnd(title), single: true, orgs: [{
          name: an.info.company, inn: '', file: fileName,
          cps: an.cps.map(function (c) { return { name: c.name, inn: c.inn, acc: c.acc }; })
        }]
      };
    }
    var orgs = [], org = null, cp = null;
    for (var k = hdr + 1; k < rows.length; k++) {
      var r = rows[k], name = s(r[0]); if (!name) continue;
      var lvl = (meta[k] && meta[k].level) || 0;
      if (/^(итого|контрагенты|счет|организация)$/i.test(name)) continue;
      var dt = num(r[cDt]), kt = num(r[cDt + 1]);
      var inn = cInn >= 0 ? s(r[cInn]).replace(/\D/g, '') : '';
      if (lvl === 0) { var on = inn ? { name: name, inn: inn } : splitInn(name); org = { name: on.name, inn: on.inn, file: fileName, cps: [] }; orgs.push(org); cp = null; }
      else if (lvl === 1 && org && !inn) { var cn = splitInn(name); cp = { name: cn.name, inn: cn.inn, acc: {} }; org.cps.push(cp); }
      else if (lvl === 1 && org) { cp = { name: name, inn: inn, acc: {} }; org.cps.push(cp); }
      else if (lvl >= 2 && cp) {
        // ниже контрагента могут идти договоры, счета, субсчета и валюты; суммируем только строки счетов одного уровня
        if (!/^\d{2,3}(\.[0-9A-Za-zА-Яа-яЁё]+)*$/.test(name)) {
          if (!/^[A-Z]{3}$/.test(name)) { cp.contracts = cp.contracts || []; if (cp.contracts.indexOf(name) < 0) cp.contracts.push(name); }
          continue;
        }
        if (cp.accLvl == null) cp.accLvl = lvl;
        if (lvl !== cp.accLvl) continue;
        var a = name.split('.')[0]; cp.acc[a] = r2((cp.acc[a] || 0) + dt - kt);
        var dd = (cp.det = cp.det || {})[a] = cp.det[a] || [0, 0, 0, 0];
        dd[0] = r2(dd[0] + num(r[cDt - 4]) - num(r[cDt - 3])); dd[1] = r2(dd[1] + num(r[cDt - 2])); dd[2] = r2(dd[2] + num(r[cDt - 1])); dd[3] = r2(dd[3] + dt - kt);
      }
    }
    return { file: fileName, title: title, date: quarterEnd(title), months: periodMonths(title), orgs: orgs };
  }
  function mergeBooks(books) {
    var byInn = {}, orgs = [], dup = [], multi = [];
    books.forEach(function (b) {
      b.orgs.forEach(function (o) {
        var key = o.inn || ('name:' + o.name);
        if (byInn[key]) {
          // та же организация из другого отчета (например, по работникам): дописываем новых контрагентов, повторы пропускаем
          var tgt = byInn[key], idx = {}, changed = false;
          if (tgt.totals && o.totals && tgt.file !== o.file) {   // «Регистр бухгалтерии» из другой базы 1С — складываем
            if (!tgt._copy) { var c2 = JSON.parse(JSON.stringify(tgt)); c2._copy = true; orgs[orgs.indexOf(tgt)] = c2; byInn[key] = c2; tgt = c2; }
            absorb(tgt, o); multi.push(tgt.name); return;
          }
          tgt.cps.forEach(function (c) { idx[c.inn || c.name] = c; });
          o.cps.forEach(function (c) {
            var ex = idx[c.inn || c.name];
            if (!ex) { tgt.cps.push(c); idx[c.inn || c.name] = c; changed = true; return; }
            Object.keys(c.acc).forEach(function (a) {
              if (a in ex.acc) return;
              ex.acc[a] = c.acc[a]; if (c.det && c.det[a]) { ex.det = ex.det || {}; ex.det[a] = c.det[a]; }
              changed = true;
            });
          });
          if (!changed) dup.push(o.name + ' (' + b.file + ')');
          return;
        }
        byInn[key] = o; orgs.push(o);
      });
    });
    var date = null; books.forEach(function (b) { if (b.date && (!date || b.date > date)) date = b.date; });
    var months = books.reduce(function (x, b) { return Math.max(x, b.months || 3); }, 1);
    return { orgs: orgs, byInn: byInn, dup: dup, date: date, months: months, files: books.map(function (b) { return b.file; }), multiBase: multi, notes: books.filter(function (b) { return b.note; }).map(function (b) { return b.file + ': ' + b.note; }) };
  }

  // ---------- сопоставление и подготовка ----------
  function isDebtAcc(a, opts) {
    if (!BALANCE_ACC.test(a)) return false;
    if (opts.accounts && a in opts.accounts) return opts.accounts[a];
    return !NOT_DEBT[a];
  }
  function listAccounts(merged, orgInn) {
    var o = merged.byInn[orgInn], set = {};
    if (o) o.cps.forEach(function (c) { Object.keys(c.acc).forEach(function (a) { set[a] = true; }); });
    return Object.keys(set).sort();
  }
  function prepare(merged, req, reg, opts) {
    var org = merged.byInn[opts.orgInn];
    if (!org) throw new Error('Организация с ИНН ' + opts.orgInn + ' не найдена в выгрузках');
    var statuses = opts.statuses || {};
    var list = org.cps.map(function (c, idx) {
      var inn = c.inn || '';
      var regRec = inn ? reg.byInn[inn] : null;
      var status = regRec ? regRec.status : '';
      var obligations = [], excludedAcc = [];
      Object.keys(c.acc).sort().forEach(function (a) {
        var v = c.acc[a]; if (Math.abs(v) < 0.005) return;
        if (isDebtAcc(a, opts)) obligations.push({ acc: a, amount: v, kind: kind(a, v), contracts: contractsFor(c, a) });
        else excludedAcc.push(a + ': ' + money(v));
      });
      var net = r2(obligations.reduce(function (x, o) { return x + o.amount; }, 0));
      // встречная книга контрагента: его сальдо с нашей организацией (в его учете), переводим в нашу сторону
      var mirror = null, mo = inn ? merged.byInn[inn] : null;
      if (mo) {
        var mc = mo.cps.filter(function (x) { return x.inn === opts.orgInn; });
        if (mc.length) {
          var mnet = 0, macc = [];
          mc.forEach(function (x) { Object.keys(x.acc).forEach(function (a) { if (isDebtAcc(a, opts) && Math.abs(x.acc[a]) > 0.004) { mnet += x.acc[a]; macc.push(a + ': ' + money(x.acc[a])); } }); });
          mirror = { net: r2(-mnet), accs: macc.join('; '), file: mo.file };
        } else mirror = { net: 0, accs: 'в книге контрагента нашей организации нет', file: mo.file, none: true };
      }
      // НДС с авансов на 76 (76.АВ / 76.ВА): в анализе субконто счет 76 не разбит на субсчета.
      // Признак — суммы нет в книге контрагента, либо она равна НДС от аванса на 60/62 по ставке 10/20/22%.
      var vat = null;
      obligations.forEach(function (o) {
        if (o.acc !== '76') return;
        var without = r2(net - o.amount);
        if (mirror && !mirror.none && Math.abs(without - mirror.net) < 0.01 && Math.abs(net - mirror.net) > 0.01) { vat = o; return; }
        if (!mirror) {
          var adv = obligations.filter(function (x) { return (x.acc === '62' && x.amount < 0 && o.amount > 0) || (x.acc === '60' && x.amount > 0 && o.amount < 0); });
          adv.forEach(function (x) { [10 / 110, 20 / 120, 22 / 122].forEach(function (k) { if (Math.abs(Math.abs(x.amount) * k - Math.abs(o.amount)) < 1) vat = o; }); });
        }
      });
      if (vat) {
        obligations = obligations.filter(function (o) { return o !== vat; });
        excludedAcc.push('76: ' + money(vat.amount) + ' (НДС с авансов, нет в книге контрагента)');
        net = r2(net - vat.amount);
      }
      // консолидатор (единый кредитор группы) всегда в работе
      var inScope = !!(status && (statuses[status.toLowerCase()] || /консолидатор/i.test(status)));
      var reason = !regRec ? 'нет в реестре' : (!inScope ? 'статус «' + status + '»' : (!obligations.length ? 'долга нет (только ' + (excludedAcc.join(', ') || 'нули') + ')' : ''));
      return {
        id: 'c' + idx, name: c.name, inn: inn, status: status, org: inn ? req.byInn[inn] : null,
        obligations: obligations, excludedAcc: excludedAcc.join('; '), net: net, mirror: mirror,
        include: inScope && obligations.length > 0, reason: reason, pct: 100
      };
    });
    return { org: org, orgReq: req.byInn[opts.orgInn], list: list, date: merged.date, files: merged.files, dup: merged.dup };
  }

  // ---------- план: зачеты, уступки, итог с цессионарием ----------
  function consume(items, amount, prefer) {
    // сначала позиции той же природы, что у встречной стороны (товар↔товар, аванс↔аванс, заем↔заем), затем мелкие
    var left = amount, used = [], pr = function (it) { return prefer && prefer.indexOf(it.kind.code) >= 0 ? 0 : 1; };
    items.slice().sort(function (a, b) { return (pr(a) - pr(b)) || (Math.abs(a.amount) - Math.abs(b.amount)); }).forEach(function (it) {
      if (left <= 0.004) return;
      var take = Math.min(Math.abs(it.amount), left);
      used.push({ acc: it.acc, kind: it.kind, amount: r2(take), contracts: it.contracts });
      it.rest = r2(Math.abs(it.amount) - take);
      left = r2(left - take);
    });
    return used;
  }
  function opKey(t, a, b) { return t === 'З' ? 'З|' + (a < b ? a + '|' + b : b + '|' + a) : 'Ц|' + a + '|' + b; }
  function plan(data, opts) {
    var cessInn = opts.cessionary ? opts.cessionary['ИНН'] : '';
    var zachety = [], cessions = [], own = { kz: 0, dz: 0, items: [] };
    data.list.forEach(function (c) {
      if (!c.include) return;
      var pos = c.obligations.filter(function (o) { return o.amount > 0; }).map(function (o) { return Object.assign({}, o, { rest: o.amount }); });
      var neg = c.obligations.filter(function (o) { return o.amount < 0; }).map(function (o) { return Object.assign({}, o, { rest: -o.amount }); });
      var P = r2(pos.reduce(function (x, o) { return x + o.amount; }, 0)), N = r2(neg.reduce(function (x, o) { return x - o.amount; }, 0));
      var z = r2(Math.min(P, N));
      if (z > 0.004) {
        var codes = function (arr) { return arr.map(function (o) { return o.kind.code; }); };
        var a = consume(pos, z, codes(neg)), b = consume(neg, z, codes(pos));
        zachety.push({ cp: c, orgClaims: a, cpClaims: b, amount: z, orgClaimsAll: P, cpClaimsAll: N, adv: a.concat(b).some(function (x) { return x.kind.adv; }) });
      }
      var restPos = pos.filter(function (o) { return o.rest > 0.004; }).map(function (o) { return { acc: o.acc, kind: o.kind, amount: o.rest, contracts: o.contracts }; });
      var restNeg = neg.filter(function (o) { return o.rest > 0.004; }).map(function (o) { return { acc: o.acc, kind: o.kind, amount: o.rest, contracts: o.contracts }; });
      if (c.inn && c.inn === cessInn) {
        own.kz = r2(restNeg.reduce(function (x, o) { return x + o.amount; }, 0));
        own.dz = r2(restPos.reduce(function (x, o) { return x + o.amount; }, 0));
        own.items = restNeg; own.dzItems = restPos; own.cp = c;
        return;
      }
      if (restNeg.length) cessions.push({ dir: 'КЗ', cp: c, items: restNeg, nominal: r2(restNeg.reduce(function (x, o) { return x + o.amount; }, 0)) });
      if (restPos.length) cessions.push({ dir: 'ДЗ', cp: c, items: restPos, nominal: r2(restPos.reduce(function (x, o) { return x + o.amount; }, 0)) });
    });
    zachety.sort(function (a, b) { return b.amount - a.amount; });
    var pref = opts.prefix ? opts.prefix + '-' : '', ext = opts.external || {}, pad = function (n) { return String(n).padStart(2, '0'); };
    // устойчивая нумерация: у операции, уже получавшей номер (opts.stable.map[ключ]), номер сохраняется; новые — после максимального занятого (opts.stable.floor)
    var st = opts.stable || null, orgInn = opts.orgInn || '', cnt = { 'З': 0, 'Ц': 0 };
    var floorOf = function (t) { return (st && st.floor && st.floor[pref + t]) || 0; };
    cnt['З'] = floorOf('З'); cnt['Ц'] = floorOf('Ц');
    var alloc = function (t, key) { return st && st.map && st.map[key] ? st.map[key] : pref + t + '-' + pad(++cnt[t]); };
    zachety.forEach(function (z) { z.key = opKey('З', orgInn, z.cp.inn); });
    zachety.forEach(function (z) { var e = ext[z.cp.inn]; if (e && e.z) { z.num = e.z; z.external = true; } else z.num = alloc('З', z.key); });
    cessions.sort(function (a, b) { return a.dir === b.dir ? b.nominal - a.nominal : (a.dir === 'КЗ' ? -1 : 1); });
    cessions.forEach(function (x) {
      x.key = x.dir === 'КЗ' ? opKey('Ц', x.cp.inn, orgInn) : opKey('Ц', orgInn, x.cp.inn);
      var e = ext[x.cp.inn];
      if (e && e[x.dir]) { x.num = e[x.dir]; x.external = true; } else x.num = alloc('Ц', x.key);
      x.pct = x.cp.pct; x.price = r2(x.nominal * x.pct / 100);
    });
    var kz = cessions.filter(function (x) { return x.dir === 'КЗ'; }), dz = cessions.filter(function (x) { return x.dir === 'ДЗ'; });
    var sum = function (a, f) { return r2(a.reduce(function (t, x) { return t + f(x); }, 0)); };
    var kzNominal = sum(kz, function (x) { return x.nominal; }), dzNominal = sum(dz, function (x) { return x.nominal; });
    var dzPrice = sum(dz, function (x) { return x.price; });
    var debtToCess = r2(own.kz + kzNominal);
    var zc = opts.payDzByOffset ? r2(Math.min(dzPrice + own.dz, debtToCess)) : 0;
    return {
      zachety: zachety, cessions: cessions, own: own, kzNominal: kzNominal, kzPrice: sum(kz, function (x) { return x.price; }),
      dzNominal: dzNominal, dzPrice: dzPrice, debtToCess: debtToCess, zc: zc,
      finalDebt: r2(debtToCess - zc), zachetTotal: sum(zachety, function (z) { return z.amount; }), zcNum: pref + 'ЗЦ-01', zcKey: 'ЗЦ|' + orgInn
    };
  }

  // ---------- документы ----------
  var W_ITEMS = [450, 2900, 4300, 1988];
  // договоры-основания: по счету (формат «Регистр бухгалтерии» — субконто 2), иначе — если у контрагента их немного
  function contractsFor(c, a) {
    var clean = function (l) { return l.filter(function (n) { return n && !/^основной договор$/i.test(n); }); };
    var l = c.cbyacc ? clean(c.cbyacc[a] || []) : clean(c.contracts || []);
    if (!l.length && c.cbyacc) {   // по этому счету договора нет — берем договоры контрагента по другим счетам расчетов, если их немного
      var all = []; Object.keys(c.cbyacc).forEach(function (k) { clean(c.cbyacc[k]).forEach(function (n) { if (all.indexOf(n) < 0) all.push(n); }); });
      if (all.length && all.length <= 2) l = all;
    }
    if (!l.length) { var gen = (c.cbyacc ? c.cbyacc[a] : c.contracts) || []; if (gen.length) l = [gen[0]]; }   // остался только «Основной договор»
    return !c.cbyacc && l.length > 2 ? [] : l;
  }
  function contractText(list) { return list.length <= 2 ? list.join('; ') : list.slice(0, 2).join('; ') + ' и др. (всего ' + list.length + ')'; }
  function basisText(k) { return (k.basis === 'договор' ? 'договор' : k.basis) + ' (по данным бухгалтерского учета)'; }
  function itemRows(items) {
    var rows = items.map(function (it, i) { return [String(i + 1), it.contracts && it.contracts.length ? contractText(it.contracts) : (it.kind.basisFull || basisText(it.kind)), it.kind.claim, money(it.amount)]; });
    var tot = ['', '', 'Итого', money(items.reduce(function (x, o) { return x + o.amount; }, 0))]; tot._bold = true;
    return rows.concat([tot]);
  }
  // o.external — должник вне группы: договор подписывают только Цедент и Цессионарий, должника уведомляют письмом
  function cessionDoc(x, date, cedent, cessionary, debtor, payText, o) {
    o = o || {};
    var d = E.doc(), adv = x.items.some(function (i) { return i.kind.adv; }), loan = x.items.some(function (i) { return i.kind.loan; });
    d.tpl = TPL.ctx.cession(x, date, cedent, cessionary, debtor, payText, o, itemRows(x.items), adv, loan);
    d.title('ДОГОВОР № ' + x.num, 'уступки права требования (цессии)');
    d.placeDate(cessionary.city(), date);
    d.para(cedent.intro('Цедент') + ', с одной стороны, и ' + cessionary.intro('Цессионарий') + ', с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем:');
    d.head('1. Предмет договора');
    d.para('1.1. Цедент уступает, а Цессионарий принимает права требования Цедента к ' + debtor.dative() + ' (ИНН ' + (debtor.inn || '__________') + '), далее — «Должник», по обязательствам, указанным в пункте 1.2 настоящего договора, в общей сумме ' + words(x.nominal) + '.');
    d.para('1.2. Перечень уступаемых требований:');
    d.grid(['№', 'Основание (договор)', 'Содержание требования', 'Сумма, руб.'], itemRows(x.items), W_ITEMS, ['center', 'left', 'left', 'right']);
    var n = 3;
    if (adv) d.para('1.' + (n++) + '. В части требований, возникших из предварительной оплаты, к Цессионарию переходит право требовать от Должника передачи предварительно оплаченного товара (выполнения работ, оказания услуг) либо возврата суммы предварительной оплаты в соответствии со статьей 487 Гражданского кодекса Российской Федерации.');
    if (loan) d.para('1.' + (n++) + '. В части требований по договорам займа к Цессионарию переходят права требования возврата суммы займа и уплаты процентов за пользование займом, начисленных и не уплаченных на дату перехода права, в пределах суммы, указанной в пункте 1.2.');
    d.para('1.' + (n++) + '. Размер уступаемых требований определен по данным бухгалтерского учета Сторон на ' + dateShort(x.balanceDate) + ' и подтверждается ' + (o.external ? 'первичными документами и актом сверки расчетов Цедента с Должником (при наличии)' : 'актом сверки взаимных расчетов Цедента и Должника') + '.');
    d.para('1.' + (n++) + '. Права требования переходят к Цессионарию в том объеме и на тех условиях, которые существовали к моменту перехода права, в момент подписания настоящего договора.');
    d.para('1.' + (n++) + '. Цедент гарантирует, что уступаемые права требования действительны, принадлежат Цеденту, ранее не уступались, не заложены, не прекращены зачетом или иным способом и не находятся под арестом.');
    d.head('2. Цена и порядок расчетов');
    d.para('2.1. За уступаемые права требования Цессионарий уплачивает Цеденту ' + words(x.price) + '.');
    d.para('2.2. ' + payText);
    d.head('3. Права и обязанности Сторон');
    d.para('3.1. Цедент в течение 3 (трех) рабочих дней с даты подписания настоящего договора передает Цессионарию по акту приема-передачи документы, удостоверяющие права требования: договоры, указанные в пункте 1.2, первичные документы (УПД, товарные накладные, акты, платежные поручения), акт сверки расчетов с Должником.');
    d.para('3.2. Цедент отвечает перед Цессионарием за действительность уступаемых требований и не отвечает за их исполнение Должником.');
    d.para(o.external
      ? '3.3. Цедент в течение 5 (пяти) рабочих дней с даты подписания настоящего договора направляет Должнику письменное уведомление об уступке с указанием реквизитов Цессионария. До получения уведомления исполнение Должником Цеденту считается надлежащим (ст. 385 ГК РФ); полученное Цедент передает Цессионарию в течение 3 (трех) рабочих дней.'
      : '3.3. Цедент уведомляет Должника о состоявшейся уступке. Подписание Должником настоящего договора подтверждает получение им уведомления об уступке и размер задолженности, указанный в пункте 1.2. С даты подписания договора Должник исполняет обязательства Цессионарию по его реквизитам.');
    d.head('4. Заключительные положения');
    d.para('4.1. Договор вступает в силу с момента подписания Сторонами и действует до полного исполнения обязательств.');
    d.para('4.2. Споры разрешаются в Арбитражном суде по месту нахождения Цессионария.');
    d.para(o.external ? '4.3. Договор составлен в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.' : '4.3. Договор составлен в трех экземплярах, имеющих равную юридическую силу: для Цедента, Цессионария и Должника.');
    d.requisites([['Цедент', cedent], ['Цессионарий', cessionary]]);
    if (o.external) return d;
    d.plain('Уведомлен об уступке. Задолженность в сумме ' + money(x.nominal) + ' руб. подтверждаю.', { b: 1 });
    d.plain('Должник: ' + debtor.name);
    d.plain((debtor.posNom || '') + '  _______________ / ' + debtor.short + ' /       М.П.');
    return d;
  }
  function zachetDoc(num, date, p1, p2, claims12, claims21, amount, adv, balanceDate, extra) {
    // claims12 — требования Стороны 1 к Стороне 2; claims21 — требования Стороны 2 к Стороне 1
    var d = E.doc();
    var t12 = claims12.reduce(function (x, o) { return x + o.amount; }, 0), t21 = claims21.reduce(function (x, o) { return x + o.amount; }, 0);
    d.tpl = TPL.ctx.zachet(num, date, p1, p2, itemRows(claims12), itemRows(claims21), amount, adv, balanceDate, t12, t21);
    d.title('СОГЛАШЕНИЕ № ' + num, 'о зачете встречных однородных требований');
    d.placeDate(p1.city(), date);
    d.para(p1.intro('Сторона 1') + ', с одной стороны, и ' + p2.intro('Сторона 2') + ', с другой стороны, совместно именуемые «Стороны», заключили настоящее соглашение о нижеследующем:');
    d.para('1. Стороны подтверждают наличие следующих встречных требований по данным учета на ' + dateShort(balanceDate) + ':');
    d.para('1.1. Требования Стороны 1 к Стороне 2:');
    d.grid(['№', 'Основание (договор)', 'Содержание требования', 'Сумма, руб.'], itemRows(claims12), W_ITEMS, ['center', 'left', 'left', 'right']);
    d.para('1.2. Требования Стороны 2 к Стороне 1:');
    d.grid(['№', 'Основание (договор)', 'Содержание требования', 'Сумма, руб.'], itemRows(claims21), W_ITEMS, ['center', 'left', 'left', 'right']);
    var n = 2;
    if (adv) d.para((n++) + '. Стороны пришли к соглашению о прекращении обязательств по передаче товара (выполнению работ, оказанию услуг) в счет предварительной оплаты в части сумм, указанных в пункте 1. Указанные суммы предварительной оплаты подлежат возврату и с даты подписания настоящего соглашения являются денежными обязательствами Сторон.');
    (extra || []).forEach(function (t) { d.para((n++) + '. ' + t); });
    d.para((n++) + '. В соответствии со статьей 410 Гражданского кодекса Российской Федерации Стороны прекращают зачетом встречные однородные денежные требования, указанные в пункте 1 настоящего соглашения, на сумму ' + words(amount) + '.');
    d.para((n++) + '. После проведения зачета задолженность Стороны 2 перед Стороной 1 составляет ' + money(t12 - amount) + ' руб., задолженность Стороны 1 перед Стороной 2 составляет ' + money(t21 - amount) + ' руб.');
    d.para((n++) + '. Стороны подтверждают, что требования, прекращаемые настоящим соглашением, не уступлены третьим лицам, не обременены правами третьих лиц и не оспариваются.');
    d.para((n++) + '. Стороны отразят зачет в бухгалтерском учете на дату подписания настоящего соглашения и в течение 5 (пяти) рабочих дней подпишут акт сверки взаимных расчетов.');
    d.para((n++) + '. Соглашение вступает в силу с момента подписания, составлено в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.');
    d.requisites([['Сторона 1', p1], ['Сторона 2', p2]]);
    return d;
  }
  // требования с точки зрения кредитора: amount всегда положительный
  function pos(items) { return items.map(function (i) { return { acc: i.acc, kind: i.kind, amount: Math.abs(i.amount), contracts: i.contracts }; }); }

  function buildPackage(pl, data, opts) {
    var JSZip = E.JSZip, zip = new JSZip(), tasks = [], files = [];
    var date = opts.date, bdate = data.date || date;
    var comp = E.party(data.orgReq, data.org.name, data.org.inn), cess = E.party(opts.cessionary);
    var cname = E.safeName(comp.name);
    var warnings = [], docs = [];
    // opts.only — {номер: true}: собрать только эти документы; opts.revOf(номер) — редакция (суффикс _редN в имени файла при N > 1)
    var want = function (num) { return !opts.only || opts.only[num]; };
    var rv = function (num) { var r = opts.revOf ? opts.revOf(num) : 1; return r > 1 ? '_ред' + r : ''; };
    var add = function (path, d, meta) { files.push(path); docs.push(Object.assign({ path: path, kind: d.tpl && d.tpl.kind }, meta)); tasks.push(TPL.render(d, opts.templates, warnings).then(function (b) { zip.file(path, b); })); };
    var pcp = function (c) { return E.party(c.org, c.name, c.inn); };
    pl.zachety.forEach(function (z) {
      if (z.external || !want(z.num)) return;
      var other = pcp(z.cp);
      add('1_Зачеты/' + z.num + rv(z.num) + '_' + cname + '_' + E.safeName(other.name) + '.docx',
        zachetDoc(z.num, date, comp, other, pos(z.orgClaims), pos(z.cpClaims), z.amount, z.adv, bdate), { num: z.num });
    });
    var kzNums = [], dzNums = [];
    pl.cessions.forEach(function (x) {
      x.balanceDate = bdate;
      var other = pcp(x.cp);
      var cedent = x.dir === 'КЗ' ? other : comp, debtor = x.dir === 'КЗ' ? comp : other;
      (x.dir === 'КЗ' ? kzNums : dzNums).push(x.num);
      if (x.external || !want(x.num)) return;
      var offZc = x.dir === 'ДЗ' && opts.payDzByOffset ? pl.zcNum : (x.dir === 'КЗ' && opts.offsetCedents && opts.offsetCedents[x.cp.inn]);
      var pay = offZc
        ? 'Обязательство Цессионария по уплате цены прекращается зачетом встречного однородного требования Цессионария к Цеденту по соглашению № ' + offZc + ' от ' + dateShort(date) + '.'
        : 'Цена уплачивается Цессионарием путем перечисления денежных средств на расчетный счет Цедента в срок до ' + dateShort(opts.payDate) + '.' + (x.pct < 100 ? ' Разница между размером уступаемых требований и ценой уступки Цеденту не возмещается.' : '');
      var folder = x.dir === 'КЗ' ? '2_Кредиторы ' + cname + ' уступают требования' : '3_' + cname + ' уступает дебиторку';
      add(folder + '/' + x.num + rv(x.num) + '_' + E.safeName(cedent.name) + '_к_' + E.safeName(debtor.name) + '.docx', cessionDoc(x, date, cedent, cess, debtor, pay), { num: x.num });
    });
    if (opts.payDzByOffset && pl.zc > 0.004 && want(pl.zcNum)) {
      var c12 = [];  // требования цессионария к компании
      if (pl.own.kz > 0.004) pos(pl.own.items).forEach(function (i) { c12.push(i); });
      if (kzNums.length) c12.push({ kind: { basisFull: 'договоры уступки прав требования № ' + kzNums.join(', ') + ' от ' + dateShort(date), claim: 'требования к Стороне 2, приобретенные Стороной 1 по договорам уступки (оплата товара, возврат предварительной оплаты)' }, amount: pl.kzNominal });
      var c21 = [];
      if (dzNums.length) c21.push({ kind: { basisFull: 'договоры уступки прав требования № ' + dzNums.join(', ') + ' от ' + dateShort(date), claim: 'требование об уплате цены уступки прав требования' }, amount: pl.dzPrice });
      if (pl.own.dz > 0.004) pos(pl.own.dzItems || []).forEach(function (i) { c21.push(i); });
      var adv = c12.concat(c21).some(function (i) { return i.kind.adv; });
      add('3_' + cname + ' уступает дебиторку/' + pl.zcNum + rv(pl.zcNum) + '_зачет_' + cname + '_с_' + E.safeName(cess.name) + '.docx',
        zachetDoc(pl.zcNum, date, cess, comp, c12, c21, pl.zc, adv, bdate), { num: pl.zcNum });
    }
    return Promise.all(tasks).then(function () { return { zip: zip, files: files, docs: docs, warnings: warnings.concat(noContractWarn(pl)) }; });
  }
  // требования, у которых в выгрузке не нашлось договора (в тексте — «по данным бухгалтерского учета»)
  function noContractWarn(pl) {
    var n = 0, all = 0, cnt = function (items) { (items || []).forEach(function (i) { all++; if (!i.contracts || !i.contracts.length) n++; }); };
    pl.cessions.forEach(function (x) { cnt(x.items); }); pl.zachety.forEach(function (z) { cnt(z.orgClaims); cnt(z.cpClaims); });
    return n ? ['Договор в основании не найден у ' + n + ' из ' + all + ' требований — указано «по данным бухгалтерского учета» (выгрузите «Регистр бухгалтерии» с субконто «Договоры»)'] : [];
  }

  // ---------- Excel ----------
  function buildXlsx(pl, data, opts, extraSheets) {
    var X = E.XLSX, comp = data.orgReq ? quotes(data.orgReq['Полное наименование']) : data.org.name;
    var cessName = quotes(opts.cessionary['Полное наименование']);
    var fmt = function (ws, cols, from) {
      var rg = X.utils.decode_range(ws['!ref']);
      for (var R = from; R <= rg.e.r; R++) cols.forEach(function (c) { var cell = ws[c + (R + 1)]; if (cell && (cell.t === 'n' || cell.f)) cell.z = '#,##0.00'; });
    };
    var nm = function (c) { return c.org ? quotes(c.org['Полное наименование']) : c.name; };
    // Уступки — строка на каждое требование (счет)
    var a1 = [['Уступки ВГО: ' + comp + ', цессионарий ' + cessName + ', договоры от ' + dateShort(opts.date)],
      ['Остатки на ' + dateShort(data.date || opts.date) + ' (' + data.files.join(', ') + '). Счета — в учете ' + comp + '. Уступает кредитор.'], [],
      ['№ договора', 'Цедент (кредитор)', 'ИНН цедента', 'Должник', 'ИНН должника', 'Счет', 'Вид требования', 'Сумма требования', 'Итого по договору', 'Цена, %', 'Цена', 'Оплата цены', 'Сверка: по книге контрагента', 'Расхождение', 'Статус реестра']];
    pl.cessions.forEach(function (x) {
      var kz = x.dir === 'КЗ';
      x.items.forEach(function (it, i) {
        a1.push([x.num, kz ? nm(x.cp) : comp, kz ? x.cp.inn : data.org.inn, kz ? comp : nm(x.cp), kz ? data.org.inn : x.cp.inn,
          it.acc, it.kind.label, it.amount, i === 0 ? x.nominal : null, i === 0 ? x.pct / 100 : null, i === 0 ? x.price : null,
          i === 0 ? (x.external ? 'договор — в пакете ' + x.num.split('-')[0] : (!kz && opts.payDzByOffset ? 'зачет ' + pl.zcNum : (kz && opts.offsetCedents && opts.offsetCedents[x.cp.inn] ? 'зачет ' + opts.offsetCedents[x.cp.inn] : 'до ' + dateShort(opts.payDate)))) : '',
          i === 0 && x.cp.mirror ? x.cp.mirror.net : (i === 0 ? 'нет книги' : null),
          i === 0 && x.cp.mirror ? r2(x.cp.net - x.cp.mirror.net) : null, i === 0 ? x.cp.status : '']);
      });
    });
    var last = a1.length;
    a1.push([]);
    a1.push(['Итого уступается', '', '', '', '', '', '', { f: 'SUM(H5:H' + last + ')' }, { f: 'SUM(I5:I' + last + ')' }, '', { f: 'SUM(K5:K' + last + ')' }]);
    a1.push([]);
    a1.push(['Расчеты ' + comp + ' с ' + cessName]);
    a1.push(['Собственный долг перед цессионарием (после зачета)', '', '', '', '', '', '', pl.own.kz]);
    a1.push(['+ требования, приобретенные цессионарием (долг компании)', '', '', '', '', '', '', pl.kzNominal]);
    a1.push(['− зачет ' + pl.zcNum + ': цена уступленной дебиторки' + (pl.own.dz ? ' и долг цессионария' : ''), '', '', '', '', '', '', -pl.zc]);
    a1.push(['Долг компании перед цессионарием после всех операций', '', '', '', '', '', '', pl.finalDebt]);
    var ws1 = X.utils.aoa_to_sheet(a1); fmt(ws1, ['H', 'I', 'K', 'M', 'N'], 4);
    for (var R = 5; R <= last; R++) { var pc = ws1['J' + R]; if (pc && pc.t === 'n') pc.z = '0%'; }
    ws1['!cols'] = [9, 40, 12, 40, 12, 6, 30, 16, 16, 7, 16, 13, 16, 13, 16].map(function (w) { return { wch: w }; });
    ws1['!autofilter'] = { ref: 'A4:O' + last };
    // Зачеты
    var a2 = [['Зачеты встречных требований до уступки'], [], ['№', 'Контрагент', 'ИНН', 'Требования ' + comp + ' (счет: сумма)', 'Требования контрагента (счет: сумма)', 'Сумма зачета', 'Аванс?']];
    var desc = function (arr) { return arr.map(function (i) { return i.acc + ' ' + i.kind.label + ': ' + money(Math.abs(i.amount)); }).join('; '); };
    pl.zachety.forEach(function (z) { a2.push([z.num + (z.external ? ' (в пакете ' + z.num.split('-')[0] + ')' : ''), nm(z.cp), z.cp.inn, desc(z.orgClaims), desc(z.cpClaims), z.amount, z.adv ? 'да — с прекращением поставки' : '']); });
    if (pl.zc) a2.push([pl.zcNum, cessName, opts.cessionary['ИНН'], 'цена уступленной дебиторки' + (pl.own.dz ? ' + долг цессионария' : ''), 'собственный долг + приобретенные требования', pl.zc, '']);
    a2.push([]); a2.push(['Итого', '', '', '', '', { f: 'SUM(F4:F' + (a2.length - 1) + ')' }]);
    var ws2 = X.utils.aoa_to_sheet(a2); fmt(ws2, ['F'], 3);
    ws2['!cols'] = [7, 40, 12, 55, 55, 16, 22].map(function (w) { return { wch: w }; });
    // Сверка и исключения
    var a3 = [['Все ВГО-контрагенты ' + comp + ': сверка и решение'], [], ['Контрагент', 'ИНН', 'Статус реестра', 'В работе', 'Причина исключения', 'Сальдо ' + comp + ' (+Дт / −Кт)', 'Счета', 'Не долг (19 и пр.)', 'По книге контрагента', 'Расхождение', 'Книга контрагента', 'Реквизиты']];
    data.list.forEach(function (c) {
      a3.push([c.name, c.inn, c.status, c.include ? 'да' : 'нет', c.include ? '' : c.reason, c.net,
        c.obligations.map(function (o) { return o.acc + ': ' + money(o.amount); }).join('; '), c.excludedAcc,
        c.mirror ? c.mirror.net : null, c.mirror ? r2(c.net - c.mirror.net) : null, c.mirror ? c.mirror.file + (c.mirror.accs ? ' — ' + c.mirror.accs : '') : 'нет в выгрузках',
        c.org ? 'есть' : 'НЕТ']);
    });
    var ws3 = X.utils.aoa_to_sheet(a3); fmt(ws3, ['F', 'I', 'J'], 3);
    ws3['!cols'] = [38, 12, 16, 8, 30, 16, 40, 24, 16, 13, 50, 9].map(function (w) { return { wch: w }; });
    ws3['!autofilter'] = { ref: 'A3:L' + a3.length };
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws1, 'Уступки');
    X.utils.book_append_sheet(wb, ws2, 'Зачеты');
    X.utils.book_append_sheet(wb, ws3, 'Сверка и исключения');
    (extraSheets || []).forEach(function (e) { X.utils.book_append_sheet(wb, e[1], e[0]); });
    return X.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  function runGroup(merged, req, reg, base, orgs) {
    var results = [];
    orgs.forEach(function (o) {
      var opts = Object.assign({}, base, { orgInn: o.inn, prefix: o.prefix, external: {}, offsetCedents: {} });
      orgs.forEach(function (p) { if (p.inn !== o.inn) opts.offsetCedents[p.inn] = p.prefix + '-ЗЦ-01'; });
      results.forEach(function (A) {
        var e = {};
        A.pl.zachety.forEach(function (z) { if (z.cp.inn === o.inn) e.z = z.num; });
        A.pl.cessions.forEach(function (x) { if (x.cp.inn === o.inn) e[x.dir === 'КЗ' ? 'ДЗ' : 'КЗ'] = x.num; });
        opts.external[A.opts.orgInn] = e;
      });
      var data = prepare(merged, req, reg, opts);
      if (base.adjust) base.adjust(data, opts);
      results.push({ data: data, pl: plan(data, opts), opts: opts });
    });
    return results;
  }

  var api = { cessionDoc: cessionDoc, zachetDoc: zachetDoc, consume: consume, runGroup: runGroup, readBook: readBook, splitInn: splitInn, innByName: innByName, parseBook: parseBook, parseRegister: parseRegister, fillOrgInn: fillOrgInn, mergeBooks: mergeBooks, listAccounts: listAccounts, prepare: prepare, plan: plan, buildPackage: buildPackage, buildXlsx: buildXlsx, kind: kind, NOT_DEBT: NOT_DEBT, noContractWarn: noContractWarn, itemRows: itemRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine2 = api;
})(this);
