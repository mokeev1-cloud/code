/* Бухгалтеру: проводки для «Операции (бухгалтерский учет)» и сводка по группе организаций. */
(function (root) {
  'use strict';
  var E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var r2 = E.r2, money = E.money, quotes = E.quotes, dateShort = E.dateShort;

  // субсчет по счету и стороне (asset = требование организации, liability = долг организации)
  function sub(acc, asset) {
    switch (acc) {
      case '60': return asset ? '60.02' : '60.01';
      case '62': return asset ? '62.01' : '62.02';
      case '58': return '58.03';
      case '66': return '66.03';
      case '67': return '67.03';
      case '76': return '76.09';
      default: return acc;
    }
  }
  function nm(c) { return c.name + (c.inn ? ' (ИНН ' + c.inn + ')' : ''); }
  function shortOrg(r) { return r.data.org.name; }

  function pair(assets, liabs, limit, push) {
    // assets/liabs: [{acc, amount, k, d}] — гасим попарно до limit
    var a = assets.map(function (x) { return Object.assign({ left: x.amount }, x); });
    var l = liabs.map(function (x) { return Object.assign({ left: x.amount }, x); });
    var i = 0, j = 0, left = limit;
    while (i < a.length && j < l.length && left > 0.004) {
      var amt = r2(Math.min(a[i].left, l[j].left, left));
      if (amt > 0.004) push(l[j], a[i], amt);
      a[i].left = r2(a[i].left - amt); l[j].left = r2(l[j].left - amt); left = r2(left - amt);
      if (a[i].left <= 0.004) i++;
      if (l[j].left <= 0.004) j++;
    }
  }

  function postings(r) {
    var pl = r.pl, data = r.data, opts = r.opts, rows = [];
    var org = shortOrg(r), date = dateShort(opts.date);
    var cessRow = data.list.filter(function (c) { return c.inn === opts.cessionary['ИНН']; })[0];
    var cessName = cessRow ? nm(cessRow) : quotes(opts.cessionary['Полное наименование']) + ' (ИНН ' + opts.cessionary['ИНН'] + ')';
    var BASE = 'договор с контрагентом (действующий)';
    var cessContract = function (num) { return 'Договор уступки ' + num + ' от ' + date; };
    var add = function (doc, text, dt, dtK, dtD, kt, ktK, ktD, sum, note) {
      rows.push([org, date, doc, text, dt, dtK, dtD, kt, ktK, ktD, r2(sum), note || '']);
    };
    // 1. зачеты с контрагентами
    pl.zachety.forEach(function (z) {
      var cp = nm(z.cp);
      var assets = z.orgClaims.map(function (o) { return { acc: o.acc, amount: o.amount }; });
      var liabs = z.cpClaims.map(function (o) { return { acc: o.acc, amount: o.amount }; });
      pair(assets, liabs, z.amount, function (l, a, amt) {
        add(z.num, 'Зачет встречных требований, соглашение ' + z.num, sub(l.acc, false), cp, BASE, sub(a.acc, true), cp, BASE, amt,
          (l.acc === '62' || a.acc === '60') ? 'аванс: проверить НДС с аванса (76.АВ — принять к вычету / 76.ВА — восстановить)' : '');
      });
    });
    // 2. кредиторы уступили требования к организации — меняется кредитор
    pl.cessions.filter(function (x) { return x.dir === 'КЗ'; }).forEach(function (x) {
      var cp = nm(x.cp);
      x.items.forEach(function (it) {
        add(x.num, 'Замена кредитора по договору уступки ' + x.num + ': ' + cp + ' → ' + cessName, sub(it.acc, false), cp, BASE, '76.09', cessName, cessContract(x.num), it.amount,
          it.acc === '62' ? 'аванс покупателя: НДС с аванса (76.АВ) остается до отгрузки или возврата' : '');
      });
    });
    // 3. организация уступила дебиторку
    pl.cessions.filter(function (x) { return x.dir === 'ДЗ'; }).forEach(function (x) {
      var cp = nm(x.cp);
      add(x.num, 'Уступка права требования к ' + cp + ': цена', '76.09', cessName, cessContract(x.num), '91.01', 'Уступка прав требования', '', x.price,
        'НДС не начисляется: цена не превышает сумму требования (п. 1 ст. 155 НК РФ)');
      x.items.forEach(function (it) {
        add(x.num, 'Уступка права требования к ' + cp + ': списание требования', '91.02', 'Уступка прав требования', '', sub(it.acc, true), cp, BASE, it.amount,
          it.acc === '60' ? 'выданный аванс: восстановить НДС, принятый к вычету (Дт 76.ВА Кт 68.02)' : '');
      });
    });
    // 4. зачет с цессионарием
    if (pl.zc > 0.004) {
      var kzNums = pl.cessions.filter(function (x) { return x.dir === 'КЗ'; }).map(function (x) { return x.num; });
      var dzNums = pl.cessions.filter(function (x) { return x.dir === 'ДЗ'; }).map(function (x) { return x.num; });
      var liabs = [];
      if (pl.kzNominal > 0.004) liabs.push({ acc: '76.09', amount: pl.kzNominal, d: 'договоры уступки ' + kzNums.join(', ') });
      (pl.own.items || []).forEach(function (o) { liabs.push({ acc: sub(o.acc, false), amount: o.amount, d: BASE }); });
      var assets = [];
      if (pl.dzPrice > 0.004) assets.push({ acc: '76.09', amount: pl.dzPrice, d: 'договоры уступки ' + dzNums.join(', ') });
      (pl.own.dzItems || []).forEach(function (o) { assets.push({ acc: sub(o.acc, true), amount: o.amount, d: BASE }); });
      pair(assets, liabs, pl.zc, function (l, a, amt) {
        add(pl.zcNum, 'Зачет с цессионарием, соглашение ' + pl.zcNum, l.acc, cessName, l.d, a.acc, cessName, a.d, amt,
          l.acc === '62.02' ? 'аванс цессионария переведен в денежный долг (п. 2 соглашения)' : '');
      });
    }
    return rows;
  }

  function summaryAoa(results) {
    var X = E.XLSX;
    var head = ['', ''].concat(results.map(shortOrg));
    var col = function (f) { return results.map(f); };
    var cnt = function (r, f) { return r.pl.cessions.filter(f).length; };
    var own = function (r, f) { return r.pl.cessions.filter(function (x) { return !x.external && f(x); }).length; };
    var excl = function (r, re) { return r.data.list.filter(function (c) { return !c.include && re.test(c.reason) && Math.abs(c.net) > 0.005; }); };
    var diffs = function (r) { return r.data.list.filter(function (c) { return c.include && c.mirror && !c.mirror.none && Math.abs(c.net - c.mirror.net) > 0.01; }); };
    var ops = function (r) { var s = {}; postings(r).forEach(function (p) { s[p[2]] = 1; }); return Object.keys(s).length; };
    var a = [
      ['Уступки ВГО на ' + dateShort(results[0].opts.date) + ': сводка для бухгалтерии'],
      ['Цессионарий (новый единый кредитор): ' + quotes(results[0].opts.cessionary['Полное наименование']) + '. Остатки — анализ субконто на ' + dateShort(results[0].data.date) + '. В работе статусы реестра: ' + Object.keys(results[0].opts.statuses).filter(function (k) { return results[0].opts.statuses[k]; }).join(', ') + '.'],
      [], head,
      ['Документы', 'Соглашений о зачете с контрагентами'].concat(col(function (r) { return r.pl.zachety.filter(function (z) { return !z.external; }).length; })),
      ['', 'Договоров: кредиторы уступают требования к организации'].concat(col(function (r) { return own(r, function (x) { return x.dir === 'КЗ'; }); })),
      ['', 'Договоров: организация уступает дебиторку'].concat(col(function (r) { return own(r, function (x) { return x.dir === 'ДЗ'; }); })),
      ['', 'Соглашение о зачете с цессионарием'].concat(col(function (r) { return r.pl.zc > 0.004 ? r.pl.zcNum : '—'; })),
      ['', 'Операции по документам другой организации группы'].concat(col(function (r) { return r.pl.zachety.filter(function (z) { return z.external; }).map(function (z) { return z.num; }).concat(r.pl.cessions.filter(function (x) { return x.external; }).map(function (x) { return x.num; })).join(', ') || '—'; })),
      ['Суммы, руб.', 'Зачтено с контрагентами'].concat(col(function (r) { return r.pl.zachetTotal; })),
      ['', 'Уступлено кредиторами (долг организации)'].concat(col(function (r) { return r.pl.kzNominal; })),
      ['', 'Уступлено организацией (дебиторка)'].concat(col(function (r) { return r.pl.dzNominal; })),
      ['', 'Долг перед цессионарием до операций'].concat(col(function (r) { var c = r.data.list.filter(function (x) { return x.inn === r.opts.cessionary['ИНН']; })[0]; return c ? -c.net : 0; })),
      ['', 'Долг перед цессионарием после операций'].concat(col(function (r) { return r.pl.finalDebt; })),
      ['', 'Прочих ВГО-кредиторов и дебиторов после операций'].concat(col(function () { return 0; })),
      ['1С', 'Операций (бухгалтерский учет) завести'].concat(col(ops)),
      ['Не взято в работу', 'Статус «Запрещено» / «Чужой» / нет в реестре'].concat(col(function (r) { return excl(r, /статус|реестр/).map(function (c) { return c.name + ' ' + money(c.net); }).join('; ') || '—'; })),
      ['', 'Только НДС (сч. 19, НДС с авансов на 76)'].concat(col(function (r) { return r.data.list.filter(function (c) { return /(^|; )19:|НДС/.test(c.excludedAcc || '') && (c.include || /долга нет/.test(c.reason)); }).length + ' контрагентов'; })),
      ['Сверить до подписания', 'Расхождения с книгой контрагента'].concat(col(function (r) { return diffs(r).map(function (c) { return c.name + ': ' + money(c.net) + ' / у них ' + money(c.mirror.net); }).join('; ') || 'нет'; })),
      [],
      ['Порядок в 1С'],
      ['1', 'Создать договоры с цессионарием «Договор уступки №… от ' + dateShort(results[0].opts.date) + '» (вид договора «Прочее»), по одному на каждый договор цессии.'],
      ['2', 'По каждому документу из листа «Проводки 1С» завести одну «Операцию (бухгалтерский учет)» с датой ' + dateShort(results[0].opts.date) + ' — строки сгруппированы по номеру документа.'],
      ['3', 'Порядок: сначала зачеты (З), затем замена кредитора (Ц — долг организации), затем уступка дебиторки (Ц — через 91), последним зачет с цессионарием (ЗЦ).'],
      ['4', 'Субсчета 60.01/60.02, 62.01/62.02, 76.09 выбраны по знаку сальдо. Проверить по ОСВ с субсчетами; НДС с авансов (76.АВ/76.ВА) скорректировать по данным учета — см. примечания к строкам.'],
      ['5', 'После проведения: ОСВ по 60, 62, 76 — у ВГО-контрагентов в работе сальдо 0, кроме цессионария; акт сверки с цессионарием на сумму «Долг после операций».']
    ];
    var ws = X.utils.aoa_to_sheet(a);
    for (var R = 10; R <= 15; R++) results.forEach(function (_, i) { var c = ws[X.utils.encode_cell({ r: R - 1, c: 2 + i })]; if (c && c.t === 'n') c.z = '#,##0.00'; });
    ws['!cols'] = [{ wch: 22 }, { wch: 52 }].concat(results.map(function () { return { wch: 48 }; }));
    return ws;
  }

  // opts.only — {номер документа: true}: проводки только по выпускаемым документам (чтобы не задвоить уже проведенное);
  // opts.notes — {номер: пометка} (например, «перевыпуск, ред. 2: прежнюю редакцию, если проведена, сторнировать»)
  function buildAccountantXlsx(results, opts) {
    opts = opts || {};
    var X = E.XLSX, wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, summaryAoa(results), 'Сводка');
    var head = ['Организация', 'Дата', 'Документ (одна операция)', 'Содержание', 'Дт', 'Субконто Дт: контрагент', 'Субконто Дт: договор', 'Кт', 'Субконто Кт: контрагент', 'Субконто Кт: договор', 'Сумма', 'Примечание'];
    var a = [['Проводки для «Операции (бухгалтерский учет)» — по одной операции на документ'], [], head];
    results.forEach(function (r) {
      postings(r).forEach(function (p) {
        if (opts.only && !opts.only[p[2]]) return;
        if (opts.notes && opts.notes[p[2]]) p[11] = (p[11] ? p[11] + '; ' : '') + opts.notes[p[2]];
        a.push(p);
      });
    });
    var ws = X.utils.aoa_to_sheet(a);
    for (var i = 4; i <= a.length; i++) { var c = ws['K' + i]; if (c && c.t === 'n') c.z = '#,##0.00'; }
    ws['!cols'] = [14, 11, 12, 46, 7, 36, 30, 7, 36, 30, 16, 50].map(function (w) { return { wch: w }; });
    ws['!autofilter'] = { ref: 'A3:L' + a.length };
    X.utils.book_append_sheet(wb, ws, 'Проводки 1С');
    return X.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  var api = { postings: postings, buildAccountantXlsx: buildAccountantXlsx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EngineAcc = api;
})(this);
