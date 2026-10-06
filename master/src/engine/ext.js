/* Ветка «Ликвидация: договоры по внешним долгам»: зачет с внешним контрагентом, уступка внешней ДЗ (+ уведомление должнику),
   перевод внешней КЗ на получателя с согласия кредитора (ст. 391 ГК РФ). Внешний контрагент — тот, кого нет в реестре ЮЛ. */
(function (root) {
  'use strict';
  var TPL = root.EngineTpl || (typeof require !== 'undefined' ? require('./engine_tpl.js') : null);
  var E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var V = root.Engine2 || (typeof require !== 'undefined' ? require('./engine_v2.js') : null);
  var r2 = E.r2, money = E.money, words = E.words, quotes = E.quotes, dateShort = E.dateShort;

  // ---------- подготовка: внешние контрагенты организации ----------
  function prepare(merged, req, reg, opts) {
    var data = V.prepare(merged, req, reg, { orgInn: opts.orgInn, statuses: {}, accounts: opts.accounts });
    var thr = opts.threshold == null ? 1000 : opts.threshold;
    // публичные расчеты (налоговая, казначейство, фонды, таможня) уступать и переводить нельзя
    var PUBLIC = /(^|[\s«"(])(И?ФНС|МИ ФНС|УФК|СФР|ФСС|ПФР|ФТС)([\s»")]|$)|налогов|казначейств|пенсионн|социального страхования|таможн/i;
    data.list = data.list.filter(function (c) { return !(c.inn && reg.byInn[c.inn]) && c.obligations.length; });
    data.list.forEach(function (c) {
      c.pct = 100; c.reason = '';
      if (PUBLIC.test(c.name)) { c.include = false; c.reason = 'публичные расчеты — не уступаются и не переводятся'; return; }
      c.include = c.obligations.some(function (o) { return Math.abs(o.amount) >= thr; });
      if (!c.include) c.reason = 'меньше порога ' + money(thr);
    });
    return data;
  }

  // ---------- план: зачет → уступка ДЗ → перевод КЗ ----------
  function plan(data, opts) {
    var pref = (opts.prefix || 'В') + '-', pad = function (n) { return String(n).padStart(2, '0'); };
    var zachety = [], cessions = [], transfers = [];
    data.list.forEach(function (c) {
      if (!c.include) return;
      var pos = c.obligations.filter(function (o) { return o.amount > 0; }).map(function (o) { return Object.assign({}, o, { rest: o.amount }); });
      var neg = c.obligations.filter(function (o) { return o.amount < 0; }).map(function (o) { return Object.assign({}, o, { rest: -o.amount }); });
      var P = r2(pos.reduce(function (x, o) { return x + o.amount; }, 0)), N = r2(neg.reduce(function (x, o) { return x - o.amount; }, 0));
      var z = r2(Math.min(P, N));
      if (z > 0.004) {
        var codes = function (arr) { return arr.map(function (o) { return o.kind.code; }); };
        var a = V.consume(pos, z, codes(neg)), b = V.consume(neg, z, codes(pos));
        zachety.push({ cp: c, orgClaims: a, cpClaims: b, amount: z, adv: a.concat(b).some(function (x) { return x.kind.adv; }) });
      }
      var rp = pos.filter(function (o) { return o.rest > 0.004; }).map(function (o) { return { acc: o.acc, kind: o.kind, amount: o.rest, contracts: o.contracts }; });
      var rn = neg.filter(function (o) { return o.rest > 0.004; }).map(function (o) { return { acc: o.acc, kind: o.kind, amount: o.rest, contracts: o.contracts }; });
      var sum = function (arr) { return r2(arr.reduce(function (x, o) { return x + o.amount; }, 0)); };
      if (rp.length) cessions.push({ dir: 'ДЗ', cp: c, items: rp, nominal: sum(rp), pct: c.pct });
      if (rn.length) transfers.push({ cp: c, items: rn, nominal: sum(rn) });
    });
    // устойчивая нумерация (см. Engine2.plan): номер операции не меняется, новые — после максимального занятого
    var st = opts.stable || null, orgInn = opts.orgInn || '', cnt = {};
    var alloc = function (t, key) { if (st && st.map && st.map[key]) return st.map[key]; if (cnt[t] == null) cnt[t] = (st && st.floor && st.floor[pref + t]) || 0; return pref + t + '-' + pad(++cnt[t]); };
    zachety.sort(function (a, b) { return b.amount - a.amount; }); zachety.forEach(function (z) { z.key = 'ВЗ|' + orgInn + '|' + z.cp.inn; z.num = alloc('З', z.key); });
    cessions.sort(function (a, b) { return b.nominal - a.nominal; }); cessions.forEach(function (x) { x.key = 'ВЦ|' + orgInn + '|' + x.cp.inn; x.num = alloc('Ц', x.key); x.notice = x.num.replace(/-Ц-(\d+)$/, '-У-$1'); x.price = r2(x.nominal * x.pct / 100); });
    transfers.sort(function (a, b) { return b.nominal - a.nominal; }); transfers.forEach(function (x) { x.key = 'ВП|' + orgInn + '|' + x.cp.inn; x.num = alloc('П', x.key); });
    var s = function (arr, f) { return r2(arr.reduce(function (t, x) { return t + f(x); }, 0)); };
    return { zachety: zachety, cessions: cessions, transfers: transfers, zachetTotal: s(zachety, function (z) { return z.amount; }),
      dzTotal: s(cessions, function (x) { return x.nominal; }), dzPrice: s(cessions, function (x) { return x.price; }), kzTotal: s(transfers, function (x) { return x.nominal; }) };
  }

  // ---------- документы ----------
  var W = [450, 2900, 4300, 1988];
  var rows = function (items) { return V.itemRows(items); };
  function transferDoc(x, date, oldDebtor, newDebtor, creditor, compText, bdate) {
    var d = E.doc(), adv = x.items.some(function (i) { return i.kind.adv; }), loan = x.items.some(function (i) { return i.kind.loan; });
    d.tpl = TPL.ctx.transfer(x, date, oldDebtor, newDebtor, creditor, compText, bdate, rows(x.items), adv, loan);
    d.title('СОГЛАШЕНИЕ № ' + x.num, 'о переводе долга');
    d.placeDate(newDebtor.city(), date);
    d.para(creditor.intro('Кредитор') + ', ' + oldDebtor.intro('Первоначальный должник') + ' и ' + newDebtor.intro('Новый должник') + ', совместно именуемые «Стороны», заключили настоящее соглашение о нижеследующем:');
    d.head('1. Предмет соглашения');
    d.para('1.1. Первоначальный должник переводит, а Новый должник принимает на себя обязательства Первоначального должника перед Кредитором, указанные в пункте 1.2 настоящего соглашения, в общей сумме ' + words(x.nominal) + '.');
    d.para('1.2. Перечень переводимых обязательств (по данным учета на ' + dateShort(bdate) + '):');
    d.grid(['№', 'Основание (договор)', 'Содержание обязательства (требование Кредитора)', 'Сумма, руб.'], rows(x.items), W, ['center', 'left', 'left', 'right']);
    var n = 3;
    d.para('1.' + (n++) + '. Кредитор дает согласие на перевод долга в соответствии со статьей 391 Гражданского кодекса Российской Федерации. Подписание настоящего соглашения Кредитором является таким согласием.');
    if (adv) d.para('1.' + (n++) + '. В части обязательств, возникших из полученной предварительной оплаты, Новый должник обязуется передать Кредитору предварительно оплаченный товар (выполнить работы, оказать услуги) либо возвратить сумму предварительной оплаты по выбору Кредитора (ст. 487 ГК РФ).');
    if (loan) d.para('1.' + (n++) + '. В части обязательств по договорам займа к Новому должнику переходит также обязанность по уплате процентов за пользование займом, начисленных на дату перевода долга, в пределах суммы, указанной в пункте 1.2.');
    d.para('1.' + (n++) + '. С момента подписания настоящего соглашения всеми Сторонами Первоначальный должник выбывает из указанных обязательств, а Новый должник становится должником Кредитора. Новый должник вправе выдвигать против требований Кредитора возражения, основанные на отношениях между Кредитором и Первоначальным должником (ст. 392 ГК РФ).');
    d.head('2. Расчеты между Первоначальным и Новым должником');
    d.para('2.1. За принятие долга Первоначальный должник уплачивает Новому должнику ' + words(x.nominal) + '.');
    d.para('2.2. ' + compText);
    d.head('3. Прочие условия');
    d.para('3.1. Первоначальный должник в течение 3 (трех) рабочих дней с даты подписания настоящего соглашения передает Новому должнику документы, подтверждающие переводимые обязательства: договоры, первичные документы, акт сверки расчетов с Кредитором.');
    d.para('3.2. Первоначальный должник гарантирует, что размер переводимых обязательств соответствует данным его бухгалтерского учета и подтверждается первичными документами.');
    d.para('3.3. Соглашение вступает в силу с момента подписания всеми Сторонами и составлено в трех экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.');
    d.requisites([['Кредитор', creditor], ['Первоначальный должник', oldDebtor], ['Новый должник', newDebtor]]);
    return d;
  }
  function noticeDoc(x, date, cedent, cessionary, debtor) {
    var d = E.doc();
    d.tpl = TPL.ctx.notice(x, date, cedent, cessionary, debtor, rows(x.items));
    d.plain('Исх. № ' + x.notice + ' от ' + dateShort(date));
    d.plain('Кому: ' + debtor.name + (debtor.inn ? ' (ИНН ' + debtor.inn + ')' : ''));
    if (debtor.r && debtor.r['Юридический адрес']) d.plain('Адрес: ' + debtor.r['Юридический адрес']);
    d.title('УВЕДОМЛЕНИЕ', 'об уступке права требования');
    d.para(cedent.name + ' (ИНН ' + cedent.inn + ') уведомляет, что по договору уступки права требования (цессии) № ' + x.num + ' от ' + dateShort(date) +
      ' права требования к Вам по обязательствам, указанным ниже, в общей сумме ' + words(x.nominal) + ' перешли к ' + cessionary.dative() + ' (ИНН ' + cessionary.inn + ').');
    d.grid(['№', 'Основание (договор)', 'Содержание требования', 'Сумма, руб.'], rows(x.items), W, ['center', 'left', 'left', 'right']);
    d.para('С даты получения настоящего уведомления просим исполнять указанные обязательства новому кредитору по следующим реквизитам:');
    cessionary.reqLines().forEach(function (l) { d.plain(l); });
    d.para('Исполнение, произведенное прежнему кредитору после получения настоящего уведомления, не будет считаться надлежащим (ст. 385 ГК РФ).');
    d.plain('');
    d.plain((cedent.posNom || '________________') + '  _______________ / ' + cedent.short + ' /       М.П.');
    return d;
  }

  function buildPackage(pl, data, opts) {
    var zip = new E.JSZip(), tasks = [], files = [], date = opts.date, bdate = data.date || date;
    var org = E.party(data.orgReq, data.org.name, data.org.inn), rcp = E.party(opts.recipient);
    var on = E.safeName(org.name);
    var warnings = [], docs = [];
    var want = function (num) { return !opts.only || opts.only[num]; };
    var rv = function (num) { var r = opts.revOf ? opts.revOf(num) : 1; return r > 1 ? '_ред' + r : ''; };
    var add = function (path, d, meta) { files.push(path); docs.push(Object.assign({ path: path, kind: d.tpl && d.tpl.kind }, meta)); tasks.push(TPL.render(d, opts.templates, warnings).then(function (b) { zip.file(path, b); })); };
    var pcp = function (c) { return E.party(c.org, c.name, c.inn); };
    var pos = function (items) { return items.map(function (i) { return { acc: i.acc, kind: i.kind, amount: Math.abs(i.amount), contracts: i.contracts }; }); };
    pl.zachety.forEach(function (z) {
      if (!want(z.num)) return;
      var other = pcp(z.cp);
      add('1_Зачеты с внешними контрагентами/' + z.num + rv(z.num) + '_' + on + '_' + E.safeName(other.name) + '.docx',
        V.zachetDoc(z.num, date, org, other, pos(z.orgClaims), pos(z.cpClaims), z.amount, z.adv, bdate), { num: z.num });
    });
    pl.cessions.forEach(function (x) {
      x.balanceDate = bdate;
      if (!want(x.num)) return;
      var debtor = pcp(x.cp);
      var pay = opts.payByOffset
        ? 'Обязательство Цессионария по уплате цены прекращается зачетом встречных однородных требований Цессионария к Цеденту по отдельному соглашению.'
        : 'Цена уплачивается Цессионарием путем перечисления денежных средств на расчетный счет Цедента в срок до ' + dateShort(opts.payDate) + '.' + (x.pct < 100 ? ' Разница между размером уступаемых требований и ценой уступки Цеденту не возмещается.' : '');
      var folder = '2_Уступка внешней дебиторки/';
      add(folder + x.num + rv(x.num) + '_' + on + '_к_' + E.safeName(debtor.name) + '.docx', V.cessionDoc(x, date, org, rcp, debtor, pay, { external: true }), { num: x.num });
      add(folder + x.notice + rv(x.num) + '_уведомление_' + E.safeName(debtor.name) + '.docx', noticeDoc(x, date, org, rcp, debtor), { num: x.num, notice: true });
    });
    pl.transfers.forEach(function (x) {
      if (!want(x.num)) return;
      var creditor = pcp(x.cp);
      var comp = opts.payByOffset
        ? 'Обязательство Первоначального должника по уплате указанной суммы прекращается зачетом встречных однородных требований Первоначального должника к Новому должнику по отдельному соглашению.'
        : 'Сумма уплачивается Первоначальным должником путем перечисления денежных средств на расчетный счет Нового должника в срок до ' + dateShort(opts.payDate) + '.';
      add('3_Перевод внешних долгов/' + x.num + rv(x.num) + '_' + E.safeName(creditor.name) + '_' + on + '.docx', transferDoc(x, date, org, rcp, creditor, comp, bdate), { num: x.num });
    });
    return Promise.all(tasks).then(function () { return { zip: zip, files: files, docs: docs, warnings: warnings.concat(V.noContractWarn(pl)) }; });
  }

  function buildXlsx(pl, data, opts) {
    var X = E.XLSX, org = data.orgReq ? quotes(data.orgReq['Полное наименование']) : data.org.name, rn = quotes(opts.recipient['Полное наименование']);
    var a = [['Внешние долги ' + org + ': документы от ' + dateShort(opts.date)], ['Остатки на ' + dateShort(data.date || opts.date) + '. Внешние — контрагенты, которых нет в реестре ЮЛ. Получатель требований и долгов: ' + rn + '.'], [],
      ['№ документа', 'Документ', 'Контрагент', 'ИНН', 'Счет', 'Вид', 'Сумма', 'Итого по документу', 'Цена / компенсация', 'Реквизиты контрагента']];
    var push = function (num, doc, c, items, total, price) {
      items.forEach(function (it, i) { a.push([num, i ? '' : doc, c.name, c.inn, it.acc, it.kind.label, Math.abs(it.amount), i ? null : total, i ? null : price, i ? '' : (c.org ? 'есть' : 'НЕТ')]); });
    };
    pl.zachety.forEach(function (z) { push(z.num, 'соглашение о зачете', z.cp, z.orgClaims.concat(z.cpClaims), z.amount, null); });
    pl.cessions.forEach(function (x) { push(x.num, 'уступка ДЗ + уведомление ' + x.notice, x.cp, x.items, x.nominal, x.price); });
    pl.transfers.forEach(function (x) { push(x.num, 'перевод долга (согласие кредитора)', x.cp, x.items, x.nominal, x.nominal); });
    var last = a.length;
    a.push([]); a.push(['Итого', '', '', '', '', '', '', { f: 'SUM(H5:H' + last + ')' }, { f: 'SUM(I5:I' + last + ')' }]);
    var ws = X.utils.aoa_to_sheet(a);
    for (var R = 5; R <= a.length; R++) ['G', 'H', 'I'].forEach(function (c) { var x = ws[c + R]; if (x && (x.t === 'n' || x.f)) x.z = '#,##0.00'; });
    ws['!cols'] = [10, 30, 40, 13, 6, 30, 16, 16, 16, 12].map(function (w) { return { wch: w }; });
    ws['!autofilter'] = { ref: 'A4:J' + last };
    var wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Внешние долги');
    return X.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  var api = { prepare: prepare, plan: plan, buildPackage: buildPackage, buildXlsx: buildXlsx, transferDoc: transferDoc, noticeDoc: noticeDoc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EngineExt = api;
})(this);
