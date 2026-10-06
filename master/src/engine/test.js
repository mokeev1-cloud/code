/* Самопроверка движка на синтетических (выдуманных) данных. Запуск: EngineTest.run().then(console.log) */
(function (root) {
  'use strict';
  var E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var V = root.Engine2 || (typeof require !== 'undefined' ? require('./engine_v2.js') : null);
  var A = root.EngineAcc || (typeof require !== 'undefined' ? require('./engine_acc.js') : null);
  var L = root.EngineLiq || (typeof require !== 'undefined' ? require('./engine_liq.js') : null);

  // ---------- синтетический набор ----------
  var INN = { A: '1000000001', B: '1000000002', G: '1000000003', D: '1000000004', Z: '1000000005', K: '1000000009', X: '2000000001', Y: '2000000002' };
  function cp(name, inn, accs) {
    // accs: { '60': [начало, Дт оборот, Кт оборот, конец] } — сальдо со знаком: + Дт, − Кт
    var c = { name: name, inn: inn, acc: {}, det: {} };
    Object.keys(accs).forEach(function (a) { c.det[a] = accs[a].slice(); c.acc[a] = accs[a][3]; });
    return c;
  }
  function dataset() {
    var orgs = [
      { name: 'Организация А ООО', inn: INN.A, file: 'синтетика.xlsx', cps: [
        cp('Консолидатор ООО', INN.K, { '60': [100, 0, 0, 100], '62': [-1000, 0, 0, -1000] }),
        cp('Контрагент В ООО', INN.G, { '62': [300, 0, 0, 300], '60': [-50, 0, 0, -50] }),
        cp('Контрагент Г ООО', INN.D, { '60': [-200, 0, 0, -200] }),
        cp('Организация Б ООО', INN.B, { '62': [-120, 0, 0, -120], '60': [-30, 0, 0, -30] }),
        cp('Покупатель Внешний ООО', INN.X, { '62': [60, 20, 40, 40] }),
        cp('Контрагент Запрет ООО', INN.Z, { '60': [-70, 0, 0, -70] }),
        cp('Поставщик Внешний ООО', INN.Y, { '60': [-25, 0, 0, -25] })] },
      { name: 'Организация Б ООО', inn: INN.B, file: 'синтетика.xlsx', cps: [
        cp('Организация А ООО', INN.A, { '60': [120, 0, 0, 120], '62': [30, 0, 0, 30] }),
        cp('Консолидатор ООО', INN.K, { '60': [-500, 0, 0, -500], '62': [80, 0, 0, 80] }),
        cp('Контрагент В ООО', INN.G, { '62': [60, 0, 0, 60] })] },
      { name: 'Консолидатор ООО', inn: INN.K, file: 'синтетика.xlsx', cps: [
        cp('Организация А ООО', INN.A, { '62': [-100, 0, 0, -100], '60': [1000, 0, 0, 1000] }),
        cp('Организация Б ООО', INN.B, { '62': [500, 0, 0, 500], '60': [-80, 0, 0, -80] })] }
    ];
    var byInn = {}; orgs.forEach(function (o) { byInn[o.inn] = o; });
    var merged = { orgs: orgs, byInn: byInn, dup: [], date: new Date(2030, 2, 31), months: 3, files: ['синтетика.xlsx'] };
    var regRows = [['Наименование', 'Статус участия', 'ИНН', 'ЗДС', 'Исполнение гос. контрактов', 'Название в 1С'],
      ['ООО "Организация А"', 'Обнуляем', INN.A, 'Да', 'завершено', 'Организация А ООО'],
      ['ООО "Организация Б"', 'Обнуляем', INN.B, 'Да', 'завершено', 'Организация Б ООО'],
      ['ООО "Контрагент В"', 'Транзит', INN.G, 'Да', 'завершено', 'Контрагент В ООО'],
      ['ООО "Контрагент Г"', 'Обнуляем приоритет', INN.D, 'Да', 'завершено', 'Контрагент Г ООО'],
      ['ООО "Контрагент Запрет"', 'Запрещено', INN.Z, 'Да', 'завершено', 'Контрагент Запрет ООО'],
      ['Консолидатор', 'Консолидатор', INN.K, 'Да', '', 'Консолидатор ООО']];
    var reqRows = [];
    [['Общество с ограниченной ответственностью "Организация А"', INN.A, 'Тестов Иван Иванович'], ['Общество с ограниченной ответственностью "Организация Б"', INN.B, 'Тестова Анна Сергеевна'],
      ['Общество с ограниченной ответственностью "Контрагент В"', INN.G, 'Пробный Петр Петрович'], ['Общество с ограниченной ответственностью "Контрагент Г"', INN.D, 'Условный Олег Олегович'],
      ['Общество с ограниченной ответственностью "Консолидатор"', INN.K, 'Примеров Илья Ильич']].forEach(function (x) {
      reqRows.push([x[0], null], [null, null], ['Полное наименование', x[0]], ['Юридический адрес', '000000, г Энск, ул Примерная, д. 1'], ['ИНН', x[1]],
        ['Код КПП', '000000000'], ['Расчетный счет', '40702810000000000000'], ['Банк', 'АО "Пример-Банк"'], ['БИК', '000000000'], ['Корр.счет', '30101810000000000000'], ['Директор', x[2]]);
    });
    return { merged: merged, reg: E.parseRegistry(regRows), req: E.parseRequisites(reqRows) };
  }

  // ---------- проверки ----------
  function sub(acc, asset) { return ({ '60': asset ? '60.02' : '60.01', '62': asset ? '62.01' : '62.02', '58': '58.03', '66': '66.03', '67': '67.03', '76': '76.09' })[acc] || acc; }
  function run() {
    var out = [], ok = function (name, cond, info) { out.push({ test: name, ok: !!cond, info: info || '' }); };
    var d = dataset();
    var base = { statuses: { 'транзит': 1, 'обнуляем': 1, 'обнуляем приоритет': 1 }, cessionary: d.req.byInn[INN.K],
      date: new Date(2030, 2, 31), payDate: new Date(2030, 4, 31), payDzByOffset: true };
    var res = V.runGroup(d.merged, d.req, d.reg, base, [{ inn: INN.A, prefix: 'А' }, { inn: INN.B, prefix: 'Б' }]);
    var a = res[0], b = res[1];
    ok('Запрещенный контрагент исключен', !a.data.list.filter(function (c) { return c.inn === INN.Z; })[0].include);
    ok('Внешний контрагент (нет в реестре) исключен', !a.data.list.filter(function (c) { return c.inn === INN.X; })[0].include);
    ok('Консолидатор в работе без галочки статуса', a.data.list.filter(function (c) { return c.inn === INN.K; })[0].include);
    ok('Зачет со встречным контрагентом (Контрагент В, 50)', a.pl.zachety.some(function (z) { return z.cp.inn === INN.G && Math.abs(z.amount - 50) < 0.01; }));
    var link = a.pl.cessions.filter(function (x) { return x.cp.inn === INN.B; })[0];
    var mirror = b.pl.cessions.filter(function (x) { return x.cp.inn === INN.A; })[0];
    ok('Операция между двумя организациями пакета оформлена один раз', link && mirror && mirror.external && mirror.num === link.num, link ? link.num : '');
    // после проводок у всех контрагентов в работе остаток 0, кроме консолидатора; результат по 91 = 0
    res.forEach(function (r) {
      var bal = {}, nm = function (c) { return c.name + (c.inn ? ' (ИНН ' + c.inn + ')' : ''); };
      r.data.list.forEach(function (c) { if (c.include) c.obligations.forEach(function (o) { var k = nm(c) + '|' + sub(o.acc, o.amount > 0); bal[k] = (bal[k] || 0) + o.amount; }); });
      var p91 = 0;
      A.postings(r).forEach(function (p) {
        if (!/^91/.test(p[4])) bal[p[5] + '|' + p[4]] = (bal[p[5] + '|' + p[4]] || 0) + p[10]; else p91 -= p[10];
        if (!/^91/.test(p[7])) bal[p[8] + '|' + p[7]] = (bal[p[8] + '|' + p[7]] || 0) - p[10]; else p91 += p[10];
      });
      var cons = 0, bad = [];
      Object.keys(bal).forEach(function (k) { var v = Math.round(bal[k] * 100) / 100; if (k.indexOf('ИНН ' + INN.K) >= 0) cons += v; else if (Math.abs(v) > 0.01) bad.push(k + '=' + v); });
      ok('Проводки ' + r.data.org.name + ': прочие ВГО в ноль', !bad.length, bad.join('; '));
      ok('Проводки ' + r.data.org.name + ': у консолидатора ровно итоговый долг', Math.abs(Math.round(cons * 100) / 100 + r.pl.finalDebt) < 0.01, 'консолидатор ' + cons + ', итог ' + r.pl.finalDebt);
      ok('Проводки ' + r.data.org.name + ': результат по 91 = 0', Math.abs(p91) < 0.01, String(p91));
    });
    // ликвидация
    var liq = L.analyze('ООО "Организация А"\nОрганизация Б ООО\n1000000099', d.merged, d.reg, d.req, { threshold: 100, shipThreshold: 10, assignExternal: true, balanceDate: d.merged.date });
    var va = liq.rows[0], vb = liq.rows[1], vn = liq.rows[2];
    ok('Ликвидация: отгрузки внешнему покупателю — в причинах', /отгрузки/.test(va.why), va.why);
    ok('Ликвидация: расчеты с «Запрещено» блокируют', /Запрещено/.test(va.why), va.why);
    ok('Ликвидация: только ВГО-расчеты — условно готово (пакет без подписей внешних)', vb.verdict === 'Условно готово', vb.why);
    ok('Ликвидация: неизвестный ИНН — нет данных', vn.verdict === 'Нет данных', vn.why);
    ok('Ликвидация: план мероприятий с процедурой (Р15016 … Р16001)', vb.plan && vb.plan.some(function (s) { return /Р15016/.test(s.what); }) && vb.plan.some(function (s) { return /Р16001/.test(s.what); }), (vb.plan || []).length + ' шагов');
    ok('Ликвидация: анализ не формирует документы', !liq.group, '');
    var con = L.parseContracts([['Исполнение контрактов'], ['Организация', 'ИНН', 'Заказчик', 'Контракт', 'Недогруз, руб.'], ['Организация Б ООО', INN.B, 'Заказчик Тестовый', 'К-1', 500], ['Итого', '', '', '', 500]]);
    var liq2 = L.analyze('Организация Б ООО', d.merged, d.reg, d.req, { threshold: 100, shipThreshold: 10, assignExternal: true, balanceDate: d.merged.date, contracts: con });
    var ord = L.parseContracts([['Анализ заказов клиентов'], ['Отбор:', '', 'Заказ клиента.Дата Больше или равно "01.01.2030 0:00:00"'], ['Договор.Подписан', 'Клиент', 'Заказ клиента', 'Договор', 'Срок исполнения', 'Заказ клиента.Организация', 'Осталось отгрузить, сумма с НДС', 'Готов к отгрузке, сумма с НДС'],
      ['Да', 'Заказчик Тестовый', 'Заказ 1', 'Контракт № 0123456789012345678 от 01.01.2030', '30.06.2030', 'Организация Б (бывш. Старое имя) ООО', 5000, 1000],
      ['Да', 'Заказчик Второй', 'Заказ 2', 'Договор поставки № 5', '30.06.2030', 'Организация Б ООО', 700, 0], ['Да', 'Заказчик', 'Заказ 3', 'Договор № 6', '', 'Неизвестная Организация ООО', 10, 0], ['Итого']]);
    var gk = L.govReport(ord, d.reg, d.req, { date: new Date(2030, 2, 31) }), gb = gk.rows.filter(function (x) { return x.inn === INN.B; })[0];
    ok('Недогруз («Анализ заказов клиентов»): организация по наименованию, госконтракт отличается от договора', ord.format === 'orders' && ord.from === '01.01.2030' && gb && gb.govN === 1 && gb.othN === 1 && gb.gk === 'исполняются' && gk.unmatched.length === 1, gb ? gb.gk + ' ' + gb.govN + '/' + gb.othN : 'нет');
    ok('Госконтракты: ЮЛ без остатков — «завершены»', gk.rows.filter(function (x) { return x.inn === INN.A; })[0].gk === 'завершены', '');
    ok('Ликвидация: недогруз по контрактам — пауза (исполнение не передается)', con.rows === 1 && liq2.rows[0].verdict === 'Пауза' && /неисполненные контракты/.test(liq2.rows[0].why), liq2.rows[0].verdict);
    // формат «Регистр бухгалтерии — остатки и обороты» (организация без ИНН, «Субконто 1, ИНН»)
    (function () {
      var XL = E.XLSX, aoa = [['Параметры:', '', 'Период: 01.07.2030 - 30.09.2030'], ['', '', 'Тип объекта: Регистр бухгалтерии'],
        ['Организация', '', '', '', 'Нач. остаток', '', 'Обороты', '', 'Кон. остаток', '', 'Количество записей'],
        ['Счет', '', '', '', 'Сумма нач. ост. Дт', 'Сумма нач. ост. Кт', 'Сумма оборот Дт', 'Сумма оборот Кт', ' Суммакон. ост. Дт', ' Суммакон. ост. Кт', ''],
        ['Субконто 1, ИНН'], ['Субконто 2'],
        ['Организация А ООО', '', '', '', '', '', 300, 300, '', '', 3],
        ['62.01', '', '', '', 100, '', 200, 50, 250, '', 2], ['Контрагент В ООО, ' + INN.G, '', '', '', 100, '', 200, 50, 250, '', 2], ['Договор поставки № 7 от 01.01.2030', '', '', '', 100, '', 200, 50, 250, '', 2],
        ['70', '', '', '', '', 10, '', '', '', 10, 1], ['Тестов Иван Иванович, ', '', '', '', '', 10, '', '', '', 10, 1],
        ['03.01', '', '', '', 70, '', '', '', 70, '', 1], ['Имущество, ', '', '', '', 70, '', '', '', 70, '', 1],
        ['Организация (до 31.12.2020) ООО', '', '', '', '', '', '', '', '', '', 1], ['60.01', '', '', '', '', 5, '', '', '', 5, 1], ['Контрагент Г ООО, ' + INN.D, '', '', '', '', 5, '', '', '', 5, 1],
        ['Итого']];
      var lv = [0, 1, 0, 0, 0, 0, 0, 1, 2, 3, 1, 2, 1, 2, 0, 1, 2, 0];
      var ws = XL.utils.aoa_to_sheet(aoa); ws['!rows'] = lv.map(function (l) { return { level: l }; });
      var wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, ws, 'Лист_1');
      var bk = V.parseBook(V.readBook(new Uint8Array(XL.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }))), 'регистр.xlsx');
      var m = V.mergeBooks([bk]); V.fillOrgInn(m, d.reg, d.req);
      var o = m.byInn[INN.A], c = o && o.cps.filter(function (x) { return x.inn === INN.G; })[0];
      ok('Регистр бухгалтерии: организация найдена по наименованию, контрагент по ИНН', !!c && c.acc['62'] === 250 && c.det['62'][1] === 200, o ? o.cps.length + ' контрагентов' : 'нет организации');
      ok('Регистр бухгалтерии: 70 — не в контрагентах, 03 — в итогах; договор из субконто 2', o && o.cps.length === 1 && o.totals['03'][3] === 70 && c.contracts[0] === 'Договор поставки № 7 от 01.01.2030', '');
      var an = L.analyze(INN.A, m, d.reg, d.req, { threshold: 100, shipThreshold: 10, assignExternal: true, balanceDate: m.date || new Date(2030, 2, 31), startDate: new Date(2030, 3, 1) }).rows[0];
      ok('План: проверки по итогам счетов (работники, имущество) при наличии «Регистра бухгалтерии»', an.plan.some(function (s) { return /работниками/.test(s.what) && /Погасить/.test(s.what); }) && an.plan.some(function (s) { return /Выбыть имущество/.test(s.what); }) && !an.plan.some(function (s) { return /не проверено/.test(s.state) && /работниками/.test(s.what); }), an.plan.map(function (s) { return s.what; }).slice(0, 4).join(' | '));
      var pd = V.prepare(m, d.req, d.reg, { orgInn: INN.A, statuses: { 'транзит': 1, 'обнуляем': 1, 'консолидатор': 1 } }), cx = pd.list.filter(function (x) { return x.inn === INN.G; })[0];
      ok('Договор-основание из субконто 2 попадает в обязательство (для текста договора уступки)', cx && cx.obligations[0] && cx.obligations[0].contracts[0] === 'Договор поставки № 7 от 01.01.2030', cx ? JSON.stringify(cx.obligations[0].contracts) : 'нет');
      var cv = L.coverage({ merged: m, reg: d.reg, req: d.req, contracts: null }), cvm = {}; cv.forEach(function (r) { cvm[r.id] = r.state; });
      ok('«Что есть / чего не хватает»: данные из регистра есть, недогруза нет', cvm.registry === 'ok' && cvm.debts !== 'no' && cvm.perf === 'no' && cvm.workers === 'ok' && cvm.contracts === 'ok', JSON.stringify(cvm));
      var dk = [[['Наименование ', 'Статус участия', 'ИНН']], [['Полное наименование', 'Организация А ООО']], [['Параметры:', 'Регистр бухгалтерии'], ['Организация', 'Кон. остаток']], [['Организация', 'Сальдо на конец периода']], [['Договор', 'Заказ клиента.Организация', 'Осталось отгрузить, сумма с НДС']], [['чужой файл']]].map(function (r) { return L.detectKind(r); }).join(',');
      ok('Определение вида файла по шапке', dk === 'registry,requisites,register,book,orders,', dk);
      ok('Регистр бухгалтерии: архивная копия «(до …)» не привязана к ИНН', m.archive.length === 1 && m.archive[0].balance === 5 && bk.months === 3, m.archive.length + '');
      // вторая база: организация с ИНН в той же ячейке — остатки складываются с первой базой
      var aoa2 = aoa.slice(0, 6).concat([['Организация А ООО, ' + INN.A, '', '', '', '', '', 100, '', '', '', 1], ['62.01', '', '', '', '', '', 100, '', 100, '', 1], ['Контрагент В ООО, ' + INN.G, '', '', '', '', '', 100, '', 100, '', 1], ['Итого']]);
      var ws2 = XL.utils.aoa_to_sheet(aoa2); ws2['!rows'] = [0, 1, 0, 0, 0, 0, 0, 1, 2, 0].map(function (l) { return { level: l }; });
      var wb2 = XL.utils.book_new(); XL.utils.book_append_sheet(wb2, ws2, 'Лист_1');
      var bk2 = V.parseBook(V.readBook(new Uint8Array(XL.write(wb2, { type: 'array', bookType: 'xlsx', cellStyles: true }))), 'регистр2.xlsx');
      var m2 = V.mergeBooks([bk, bk2]); V.fillOrgInn(m2, d.reg, d.req);
      var c2 = m2.byInn[INN.A] && m2.byInn[INN.A].cps.filter(function (x) { return x.inn === INN.G; })[0];
      ok('Регистр бухгалтерии: ИНН организации из ячейки; две базы складываются', bk2.orgs[0].inn === INN.A && bk2.orgs[0].name === 'Организация А ООО' && c2 && c2.acc['62'] === 350 && c.acc['62'] === 250, c2 ? String(c2.acc['62']) : 'нет');
    })();
    (function () {
      var t = [['Организация А ООО, 1000000001', '1000000001'], ['Организация А ООО 1000000001', '1000000001'], ['Организация А ООО (ИНН 1000000001)', '1000000001'],
        ['Организация А ООО ИНН: 1000000001 / КПП 100001001', '1000000001'], ['Тестов Иван Иванович, 100000000001', '100000000001'], ['Оценочные обязательства, ', ''], ['Организация 2030 ООО', '']];
      var bad = t.filter(function (x) { var r = V.splitInn(x[0]); return r.inn !== x[1] || !r.name || /\d{10}/.test(r.name); });
      ok('Наименование с ИНН в одной ячейке разбирается (организация и контрагент)', !bad.length, bad.map(function (x) { return x[0]; }).join('; '));
    })();
    // ветка «Договоры по внешним долгам»
    var X = root.EngineExt || (typeof require !== 'undefined' ? require('./engine_ext.js') : null);
    var xo = { orgInn: INN.A, recipient: d.req.byInn[INN.K], date: new Date(2030, 2, 31), payDate: new Date(2030, 4, 31), prefix: 'В', threshold: 0 };
    var xd = X.prepare(d.merged, d.req, d.reg, xo), xp = X.plan(xd, xo);
    ok('Внешние долги: в работе только контрагенты вне реестра', xd.list.every(function (c) { return !d.reg.byInn[c.inn]; }) && xd.list.length === 2, xd.list.map(function (c) { return c.name; }).join(', '));
    ok('Внешние долги: ДЗ — уступка с уведомлением, КЗ — перевод долга', xp.cessions.length === 1 && xp.transfers.length === 1 && xp.cessions[0].notice, xp.cessions.map(function (x) { return x.num; }).concat(xp.transfers.map(function (x) { return x.num; })).join(', '));
    return X.buildPackage(xp, xd, xo).then(function (xpk) {
      ok('Внешние долги: документы собираются (договор, уведомление, перевод)', xpk.files.length === 3, xpk.files.length + ' док.');
      X.buildXlsx(xp, xd, xo);
      return Promise.all(res.map(function (r) { return V.buildPackage(r.pl, r.data, r.opts); }));
    }).then(function (pk) {
      ok('Пакеты документов собираются', pk.every(function (p) { return p.files.length > 0; }), pk.map(function (p) { return p.files.length; }).join(' + ') + ' док.');
      try { A.buildAccountantXlsx(res); V.buildXlsx(a.pl, a.data, a.opts); L.buildXlsx(liq, { balanceDate: d.merged.date, threshold: 100 }); ok('Excel-выгрузки собираются', true); }
      catch (e) { ok('Excel-выгрузки собираются', false, e.message); }
      return out;
    });
  }
  var api = { run: run, dataset: dataset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EngineTest = api;
})(this);
