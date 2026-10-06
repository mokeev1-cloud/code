/* Готовность ЮЛ к ликвидации: остатки по собственной книге, встречные книги, реестр, динамика за период, вывод и срок. */
(function (root) {
  'use strict';
  var E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var V = root.Engine2 || (typeof require !== 'undefined' ? require('./engine_v2.js') : null);
  var s = E.s, r2 = E.r2, money = E.money, nameKey = E.nameKey, dateShort = E.dateShort, num = E.num;
  var DEBT = { '58': 1, '60': 1, '62': 1, '66': 1, '67': 1, '71': 1, '73': 1, '76': 1 };
  var BLOCK = /запрещ|чуж/i;   // статусы-блокеры; меняется настройкой opts.blockRe
  var mln = function (x) { var v = Math.abs(x); return v >= 1e6 ? (x / 1e6).toFixed(2).replace('.', ',') + ' млн' : (v >= 1000 ? Math.round(x / 1000) + ' тыс.' : money(x) + ' руб.'); };

  // ---------- список ЮЛ: ИНН или наименование → запись реестра ----------
  function resolveList(text, reg) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/^\s*\d+[.)]\s*/, '').trim(); }).filter(Boolean);
    var picked = {};
    var out = lines.map(function (line) {
      var inn = (line.match(/\b(\d{10}|\d{12})\b/) || [])[1];
      if (inn) return { input: line, inn: inn, rec: reg.byInn[inn] || null, candidates: [] };
      var key = nameKey(line), name = s(line).toLowerCase();
      var exact = (reg.all || []).filter(function (r) { return s(r.name).toLowerCase() === name || (r.key.core === key.core && (!key.form || r.key.form === key.form)); });
      var cands = exact.length ? exact : (reg.all || []).filter(function (r) {
        var toks = key.core.split(' ').filter(Boolean);
        return toks.length && toks.every(function (t) { return r.key.core.split(' ').indexOf(t) >= 0; });
      });
      return { input: line, inn: '', rec: null, candidates: cands, fuzzy: !exact.length };
    });
    out.forEach(function (o) { if (o.inn) picked[o.inn] = 1; });
    out.forEach(function (o) {
      if (o.inn || !o.candidates.length) return;
      // при нескольких кандидатах берем того, кого нет в списке отдельной строкой
      var c = o.candidates.filter(function (r) { return !picked[r.inn] && !out.some(function (x) { return x !== o && x.candidates.length === 1 && x.candidates[0] === r; }); });
      var pick = (c.length ? c : o.candidates)[0];
      o.rec = pick; o.inn = pick.inn || ''; o.ambiguous = o.candidates.length > 1 || o.fuzzy;
      if (o.inn) picked[o.inn] = 1;
    });
    return out;
  }

  // ---------- разбор одного ЮЛ ----------
  function analyzeOne(item, merged, reg, opts) {
    var inn = item.inn, rec = item.rec || (inn ? reg.byInn[inn] : null);
    var book = inn ? merged.byInn[inn] : null;
    var r = { input: item.input, name: rec ? rec.name : item.input, inn: inn, status: rec ? rec.status : '', zds: rec ? rec.zds : '', gk: rec ? rec.gk : '',
      note: rec ? rec.note : '', ambiguous: !!item.ambiguous, own: !!book, file: book ? book.file : '', lines: [], mirror: [] };
    var thr = opts.threshold == null ? 100000 : opts.threshold;
    if (book) {
      book.cps.forEach(function (c) {
        Object.keys(c.det || {}).forEach(function (a) {
          var d = c.det[a]; if (Math.abs(d[0]) < 0.005 && Math.abs(d[3]) < 0.005) return;
          var cr = c.inn ? reg.byInn[c.inn] : null;
          r.lines.push({ cp: c.name, cpinn: c.inn, vgo: !!cr, cpstatus: cr ? cr.status : '', acc: a, debt: !!DEBT[a], open: d[0], dt: d[1], kt: d[2], close: d[3] });
        });
      });
    }
    merged.orgs.forEach(function (o) {
      if (o.inn === inn || !inn) return;
      o.cps.forEach(function (c) {
        if (c.inn !== inn) return;
        Object.keys(c.det || {}).forEach(function (a) {
          var d = c.det[a]; if (Math.abs(d[3]) < 0.005 && Math.abs(d[0]) < 0.005) return;
          r.mirror.push({ org: o.name, orginn: o.inn, acc: a, open: d[0], dt: d[1], kt: d[2], close: d[3] });
        });
      });
    });
    var deb = r.lines.filter(function (l) { return l.debt && Math.abs(l.close) >= 0.005; });
    var sum = function (f) { return r2(deb.filter(f).reduce(function (x, l) { return x + l.close; }, 0)); };
    r.vgoDz = sum(function (l) { return l.vgo && l.close > 0; }); r.vgoKz = sum(function (l) { return l.vgo && l.close < 0; });
    r.extDz = sum(function (l) { return !l.vgo && l.close > 0; }); r.extKz = sum(function (l) { return !l.vgo && l.close < 0; });
    r.grossOpen = r2(r.lines.filter(function (l) { return l.debt; }).reduce(function (x, l) { return x + Math.abs(l.open); }, 0));
    r.grossClose = r2(deb.reduce(function (x, l) { return x + Math.abs(l.close); }, 0));
    r.cps = Object.keys(deb.reduce(function (m, l) { m[l.cp] = 1; return m; }, {})).length;
    var ext62 = r.lines.filter(function (l) { return !l.vgo && l.acc === '62'; });
    r.ship = r2(ext62.reduce(function (x, l) { return x + l.dt; }, 0));   // отгрузки внешним покупателям за период
    r.pay = r2(ext62.reduce(function (x, l) { return x + l.kt; }, 0));    // оплаты внешних покупателей за период
    r.totals = book && book.totals ? book.totals : null;
    r.acc03 = r2(r.lines.filter(function (l) { return l.acc === '03'; }).reduce(function (x, l) { return x + l.close; }, 0));
    if (book && book.totals && book.totals['03']) r.acc03 = Math.max(r.acc03, book.totals['03'][3]);
    r.blockers = deb.filter(function (l) { return l.vgo && BLOCK.test(l.cpstatus) && Math.abs(l.close) >= 1; });
    r.extBig = deb.filter(function (l) { return !l.vgo && Math.abs(l.close) >= thr; });
    // динамика
    r.trend = !r.own ? '' : (r.grossOpen < 0.5 ? (r.grossClose < 0.5 ? 'остатков нет' : 'остатки появились') :
      (Math.abs(r.grossClose - r.grossOpen) < Math.max(1, r.grossOpen * 0.005) ? 'без движения' : (r.grossClose < r.grossOpen ? 'снижение ' + Math.round((1 - r.grossClose / r.grossOpen) * 100) + '%' : 'рост ' + Math.round((r.grossClose / r.grossOpen - 1) * 100) + '%')));
    verdict(r, opts);
    return r;
  }

  function monthsToZero(lines) {
    var op = lines.reduce(function (x, l) { return x + Math.abs(l.open); }, 0), cl = lines.reduce(function (x, l) { return x + Math.abs(l.close); }, 0);
    var per = (op - cl) / (PERIOD || 3);
    var m = per > 0.5 ? Math.ceil(cl / per) : null;
    return m && m <= 12 ? m : null;
  }
  var PERIOD = 3;
  function addMonths(d, m) { var x = new Date(d.getFullYear(), d.getMonth() + m + 1, 0); return x; }
  function monthName(d) { return ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'][d.getMonth()] + ' ' + d.getFullYear(); }

  function verdict(r, opts) {
    var base = opts.balanceDate || new Date(), why = [], todo = [], terms = [];
    if (!r.inn) { r.verdict = 'Нет данных'; r.why = 'Нет ИНН в реестре' + (r.ambiguous ? '' : ''); r.todo = 'Уточнить ИНН и базу учета'; r.term = 'не определен'; return; }
    if (!r.own) {
      r.verdict = 'Нет данных';
      var mir = r.mirror.filter(function (m) { return DEBT[m.acc] && Math.abs(m.close) >= 0.005; });
      r.why = 'Нет собственной книги в выгрузках' + (mir.length ? '; в книгах группы за ним: ' + mir.map(function (m) { return m.org + ' сч.' + m.acc + ' ' + money(m.close) + (Math.abs(m.close) > Math.abs(m.open) + 0.5 ? ' (растет)' : ''); }).join('; ') : '');
      r.todo = 'Выгрузить анализ субконто из базы этого ЮЛ'; r.term = 'оценка после выгрузки'; return;
    }
    var stopped = false;
    if (BLOCK.test(r.status)) { why.push('статус ЮЛ «' + r.status + '»'); todo.push('не цель обнуления — вернуться после смены статуса'); terms.push('не ранее ' + monthName(addMonths(base, 4))); stopped = true; }
    // деятельность продолжается: отгрузки внешним (не ВГО) покупателям за период выгрузки — Дт оборот сч. 62
    var shipThr = opts.shipThreshold == null ? 1000 : opts.shipThreshold, paused = false;
    // таблица «Недогруз» (исполнение контрактов), если загружена, заменяет критерий отгрузок
    if (opts.contracts && opts.contracts.orders) prepareContracts(opts.contracts, opts.reg, opts.req);
    var und = opts.contracts ? (opts.contracts.byInn[r.inn] || opts.contracts.byKey[E.nameKey(r.name).core] || []) : null;
    if (und) und = und.filter(function (c) { return c.amount >= shipThr; });
    r.underload = und ? r2(und.reduce(function (x, c) { return x + c.amount; }, 0)) : null;
    if (und && und.length) {
      var gv = und.filter(function (c) { return c.gov; }), ot = und.filter(function (c) { return !c.gov; });
      var sm = function (a) { return a.reduce(function (x, c) { return x + c.amount; }, 0); };
      var late = und.filter(function (c) { return c.term && c.term < base; });
      var terms2 = und.filter(function (c) { return c.term; }).map(function (c) { return c.term; }).sort(function (a, b) { return a - b; });
      why.push('неисполненные контракты: осталось отгрузить ' + mln(r.underload) + ' (' + (gv.length ? 'госконтрактов ' + gv.length + ' на ' + mln(sm(gv)) : '') + (gv.length && ot.length ? ', ' : '') + (ot.length ? 'прочих договоров ' + ot.length + ' на ' + mln(sm(ot)) : '') + ')' +
        (terms2.length ? '; последний срок исполнения ' + dateShort(terms2[terms2.length - 1]) : '') + (late.length ? '; просрочено ' + late.length : '') +
        '; крупнейшие: ' + und.slice().sort(function (a, b) { return b.amount - a.amount; }).slice(0, 3).map(function (c) { return (c.cp || c.contract || '') + ' ' + mln(c.amount); }).join(', '));
      todo.push('исполнить контракты (исполнение не передается); неоплаченную ДЗ по ним можно уступить');
      terms.push(terms2.length ? 'пауза до ' + dateShort(terms2[terms2.length - 1]) + ' (последний срок исполнения)' : 'пауза до исполнения контрактов'); paused = true;
    }
    if (!opts.contracts && r.ship >= shipThr) {
      var buyers = r.lines.filter(function (l) { return !l.vgo && l.acc === '62' && l.dt >= 0.5; });
      why.push('отгрузки внешним покупателям за период ' + mln(r.ship) + ' (' + buyers.map(function (l) { return l.cp; }).join(', ') + ')' + (r.pay > 0.5 ? ', оплаты ' + mln(r.pay) : ''));
      todo.push('завершить отгрузки по действующим договорам (исполнение контракта не передается; неоплаченную ДЗ можно уступить)');
      terms.push('после последней отгрузки; повторить разбор по следующей выгрузке'); paused = true;
    }
    if (r.blockers.length) {
      var byCp = {}; r.blockers.forEach(function (l) { byCp[l.cp] = (byCp[l.cp] || 0) + l.close; });
      why.push('расчеты с ВГО со статусом «Запрещено/Чужой»: ' + Object.keys(byCp).map(function (k) { return k + ' ' + mln(byCp[k]); }).join(', '));
      todo.push('решение по статусу ' + Object.keys(byCp).join(', ')); terms.push('после решения по ' + Object.keys(byCp).join(', ') + ' + 2–3 нед.'); stopped = true;
    }
    // внешние расчеты по контрагенту: встречные зачитываются (заявление о зачете, ст. 410 ГК РФ — подпись контрагента не нужна)
    var thrX = opts.threshold == null ? 100000 : opts.threshold, ext = {};
    r.lines.forEach(function (l) { if (!l.vgo && l.debt && Math.abs(l.close) >= 0.005) { var e = ext[l.cp] = ext[l.cp] || { cp: l.cp, dz: 0, kz: 0 }; if (l.close > 0) e.dz += l.close; else e.kz -= l.close; } });
    ext = Object.keys(ext).map(function (k) { var e = ext[k]; e.net = r2(e.dz - e.kz); e.off = r2(Math.min(e.dz, e.kz)); return e; });
    var extKz = ext.filter(function (e) { return e.net <= -thrX; }), extDz = ext.filter(function (e) { return e.net > 0.5; }), extOff = ext.filter(function (e) { return e.off > 0.5; });
    if (extKz.length) {
      why.push('внешняя КЗ (нужно согласие кредитора): ' + extKz.map(function (e) { return e.cp + ' ' + mln(-e.net); }).join(', '));
      todo.push('погасить внешних кредиторов или перевести долг с согласия кредитора (ветка «Договоры по внешним долгам»)');
      var m = monthsToZero(r.extBig.filter(function (l) { return l.close < 0; })); terms.push(m ? 'по динамике ~' + monthName(addMonths(base, m)) : 'после погашения или перевода долга'); stopped = true;
    }
    var paper = [];   // что закрывается документами текущей датой без подписи сторон вне группы
    if (extOff.length) paper.push('зачет встречных с внешними (' + extOff.length + ', ' + mln(extOff.reduce(function (x, e) { return x + e.off; }, 0)) + ') — заявлением о зачете');
    if (extDz.length) {
      var sum = mln(extDz.reduce(function (x, e) { return x + e.net; }, 0));
      if (opts.assignExternal) paper.push('уступка внешней ДЗ ' + sum + ' + уведомления должникам (ветка «Договоры по внешним долгам»)');
      else { why.push('внешняя ДЗ: ' + extDz.map(function (e) { return e.cp + ' ' + mln(e.net); }).join(', ')); todo.push('взыскать внешнюю ДЗ'); terms.push('после взыскания'); stopped = true; }
    }
    if (Math.abs(r.vgoDz) + Math.abs(r.vgoKz) > 0.5) paper.unshift('свертывание ВГО: ДЗ ' + mln(r.vgoDz) + ', КЗ ' + mln(Math.abs(r.vgoKz)) + ' (ветка «Свертывание ВГО»)');
    if (r.acc03 > 0.5) paper.push('выбытие имущества со сч. 03 (' + mln(r.acc03) + ')');
    r.paper = paper;
    if (stopped || paused) { r.verdict = stopped ? 'Не готово' : 'Пауза'; r.why = why.join('; '); r.todo = todo.concat(paper.length ? ['документы: ' + paper.join('; ')] : []).join('; '); r.term = terms.join('; '); return; }
    if (paper.length) {
      r.verdict = 'Условно готово';
      r.why = 'остатки закрываются документами текущей датой без подписи сторон вне группы';
      r.todo = 'сформировать пакеты: ' + paper.join('; ');
      r.term = 'пакеты — ' + dateShort(opts.docDate || new Date()) + ', далее решение о ликвидации';
      return;
    }
    r.verdict = 'Можно';
    r.why = 'расчетов нет'; r.todo = 'расчеты закрыты'; r.term = 'решение о ликвидации';
  }

  // ---------- план мероприятий по ЮЛ ----------
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }
  function addWork(d, n) { var x = new Date(d); while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() % 6) n--; } return x; }
  function plan(r, opts) {
    var steps = [], add = function (stage, what, where, when, state) { steps.push({ stage: stage, what: what, where: where || '', when: when || '', state: state || '' }); };
    if (!r.own) { add('Данные', r.todo, '', r.term, 'нет данных'); return steps; }
    var start = opts.startDate || new Date();
    // 1. расчистка
    if (BLOCK.test(r.status)) add('Расчистка', 'Решение по статусу ЮЛ «' + r.status + '» в реестре', '', 'до старта', 'блокер');
    if (r.ship >= (opts.shipThreshold == null ? 1000 : opts.shipThreshold)) add('Расчистка', 'Завершить отгрузки внешним покупателям и получить оплату (за период отгружено ' + mln(r.ship) + ')', '', 'после последней отгрузки', 'блокер');
    if (r.blockers.length) add('Расчистка', 'Решение по расчетам с ВГО «Запрещено/Чужой»: ' + r.blockers.map(function (l) { return l.cp; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', '), '', 'до старта', 'блокер');
    if (Math.abs(r.vgoDz) + Math.abs(r.vgoKz) > 0.5) add('Расчистка', 'Свернуть ВГО: зачеты и уступки внутри группы (ДЗ ' + mln(r.vgoDz) + ', КЗ ' + mln(Math.abs(r.vgoKz)) + ')', 'ветка «Свертывание ВГО»', dateShort(addDays(start, -14)), '');
    if (r.extDz > 0.5) add('Расчистка', 'Внешняя ДЗ ' + mln(r.extDz) + ': взыскать или уступить', 'ветка «Договоры по внешним долгам»', dateShort(addDays(start, -7)), r.extBig.some(function (l) { return l.close > 0; }) ? '' : 'мелочь');
    if (r.extKz < -0.5) add('Расчистка', 'Внешняя КЗ ' + mln(Math.abs(r.extKz)) + ': погасить или перевести долг с согласия кредитора', 'ветка «Договоры по внешним долгам»', dateShort(addDays(start, -7)), r.extBig.some(function (l) { return l.close < 0; }) ? 'блокер' : 'мелочь');
    if (r.acc03 > 0.5) add('Расчистка', 'Выбыть имущество со сч. 03 (' + mln(r.acc03) + ')', '', dateShort(addDays(start, -7)), '');
    // расчеты и имущество по итогам счетов организации (формат «Регистр бухгалтерии»): [нач, Дт, Кт, кон]; Дт «+», Кт «−»
    var T = r.totals, close = function (re) { return T ? r2(Object.keys(T).filter(function (a) { return re.test(a); }).reduce(function (x, a) { return x + T[a][3]; }, 0)) : 0; };
    var NOQ = 'не проверено — нужен «Регистр бухгалтерии» (см. «Что есть / чего не хватает»)';
    var chk = function (title, val, fn, none) { if (!T) add('Расчистка', title, '', '', NOQ); else if (Math.abs(val) < 0.5) add('Расчистка', title + ': остатка нет', '', '', 'проверено'); else add.apply(null, fn(val)); };
    chk('Расчеты с работниками (сч. 70, 71, 73)', close(/^(70|71|73)$/), function (v) {
      return ['Расчистка', v < 0 ? 'Погасить задолженность перед работниками (сч. 70/71/73): ' + mln(-v) : 'Вернуть/удержать задолженность работников и подотчетных лиц (сч. 71/73): ' + mln(v), '', dateShort(addDays(start, -10)), ''];
    });
    chk('Налоги и взносы (сч. 68, 69)', close(/^(68|69)$/), function (v) {
      return ['Расчистка', v < 0 ? 'Погасить задолженность по налогам и взносам (сч. 68/69): ' + mln(-v) + ' — до ликвидационного баланса' : 'Вернуть или зачесть переплату по налогам и взносам (сч. 68/69): ' + mln(v), '', dateShort(addDays(start, -10)), ''];
    });
    chk('Деньги на счетах и в кассе (сч. 50, 51, 52, 55, 57)', close(/^(50|51|52|55|57)$/), function (v) {
      return ['Расчистка', 'Деньги ' + mln(v) + ': направить на расчеты с кредиторами; расчетные счета закрыть после ликвидационного баланса', '', dateShort(addDays(start, -3)), ''];
    });
    chk('Имущество и запасы (сч. 01, 04, 08, 10, 20, 21, 26, 41, 43)', close(/^(01|04|08|10|20|21|26|41|43)$/), function (v) {
      return ['Расчистка', 'Имущество и запасы ' + mln(v) + ': реализовать или передать (участнику / по описи ликвидатора)', '', dateShort(addDays(start, -7)), ''];
    });
    chk('Финансовые вложения (сч. 58, 55.03)', close(/^58$/) , function (v) { return ['Расчистка', 'Финансовые вложения ' + mln(v) + ': реализовать или передать участнику', '', dateShort(addDays(start, -7)), '']; });
    // 2. процедура ликвидации (ст. 61–64 ГК РФ, ст. 57–58 ФЗ «Об ООО»)
    var ready = r.verdict === 'Можно' || r.verdict === 'Условно готово', D = ready ? start : null;
    var at = function (fn, txt) { return D ? dateShort(fn(D)) : txt; };
    add('Ликвидация', 'Решение участника о ликвидации, назначение ликвидатора', '', at(function (d) { return d; }, 'Д — после расчистки'));
    add('Ликвидация', 'Уведомление в ИФНС о решении (форма Р15016)', '', at(function (d) { return addWork(d, 3); }, 'Д + 3 раб. дня'));
    add('Ликвидация', 'Публикация в «Вестнике государственной регистрации»; письменное уведомление известных кредиторов', '', at(function (d) { return addWork(d, 10); }, 'Д + ~2 нед.'));
    add('Ликвидация', 'Срок предъявления требований кредиторов (не менее 2 месяцев с публикации)', '', at(function (d) { return addDays(addWork(d, 10), 61); }, 'Д + ~2,5 мес.'));
    add('Ликвидация', 'Промежуточный ликвидационный баланс, уведомление в ИФНС (Р15016)', '', at(function (d) { return addDays(addWork(d, 10), 68); }, 'Д + ~2,5 мес.'));
    add('Ликвидация', 'Расчеты с кредиторами в порядке очередности (ст. 64 ГК РФ)', '', at(function (d) { return addDays(addWork(d, 10), 80); }, 'Д + ~3 мес.'));
    add('Ликвидация', 'Ликвидационный баланс; распределение оставшегося имущества участникам (ст. 58 ФЗ «Об ООО»)', '', at(function (d) { return addDays(addWork(d, 10), 90); }, 'Д + ~3 мес.'));
    add('Ликвидация', 'Заявление о ликвидации (форма Р16001); запись в ЕГРЮЛ', '', at(function (d) { return addDays(addWork(d, 10), 100); }, 'Д + ~3,5 мес.'));
    return steps;
  }

  function analyze(text, merged, reg, req, opts) {
    opts = Object.assign({}, opts, { reg: reg, req: req });
    PERIOD = merged.months || 3;
    try { BLOCK = opts.blockRe ? new RegExp(opts.blockRe, 'i') : /запрещ|чуж/i; } catch (e) { BLOCK = /запрещ|чуж/i; }
    var list = resolveList(text, reg);
    var rows = list.map(function (it, i) { var r = analyzeOne(it, merged, reg, opts); r.n = i + 1; r.plan = plan(r, opts); return r; });
    return { rows: rows, list: list };
  }

  // ---------- Excel ----------
  function buildXlsx(res, opts) {
    var X = E.XLSX, order = { 'Можно': 0, 'Условно готово': 1, 'Пауза': 2, 'Не готово': 3, 'Нет данных': 4 };
    var rows = res.rows.slice().sort(function (a, b) { return (order[a.verdict] - order[b.verdict]) || (a.n - b.n); });
    var a = [['Готовность ЮЛ к ликвидации — остатки на ' + dateShort(opts.balanceDate) + ', реестр ЮЛ'], ['Суммы в рублях: ДЗ «+», КЗ «−». ВГО — контрагент есть в реестре. Сч. 19, 03 и забалансовые не считаются долгом. Порог внешних долгов: ' + money(opts.threshold) + '. Деятельность продолжается, если отгрузки внешним покупателям (Дт 62) за период не меньше ' + money(opts.shipThreshold == null ? 1000 : opts.shipThreshold) + '. Графа реестра «Госконтракты» — справочно.'], [],
      ['№', 'ЮЛ', 'ИНН', 'Статус реестра', 'Госконтракты', 'Вывод', 'ВГО ДЗ', 'ВГО КЗ', 'Внешняя ДЗ', 'Внешняя КЗ', 'Отгрузки внешн. за период (Дт 62)', 'Оплаты внешн. за период (Кт 62)', 'Остаток на начало (валово)', 'Остаток на конец (валово)', 'Динамика', 'Контрагентов', 'Причина', 'Что сделать', 'Срок']];
    rows.forEach(function (r) {
      a.push([r.n, r.name + (r.ambiguous ? ' (сопоставлено по названию: «' + r.input + '»)' : ''), r.inn, r.status, r.gk, r.verdict === 'Можно' ? 'Можно в ликвидацию' : r.verdict,
        r.own ? r.vgoDz : null, r.own ? r.vgoKz : null, r.own ? r.extDz : null, r.own ? r.extKz : null, r.own ? r.ship : null, r.own ? r.pay : null, r.own ? r.grossOpen : null, r.own ? r.grossClose : null, r.trend, r.own ? r.cps : 'нет книги', r.why, r.todo, r.term]);
    });
    var ws = X.utils.aoa_to_sheet(a);
    for (var i = 5; i <= a.length; i++) ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].forEach(function (c) { var x = ws[c + i]; if (x && x.t === 'n') x.z = '#,##0;-#,##0;–'; });
    ws['!cols'] = [4, 34, 12, 16, 13, 18, 13, 14, 13, 12, 14, 14, 14, 14, 14, 10, 50, 55, 26].map(function (w) { return { wch: w }; });
    ws['!autofilter'] = { ref: 'A4:S' + a.length };
    var d = [['ЮЛ', 'ИНН ЮЛ', 'Контрагент / книга', 'ИНН', 'ВГО', 'Статус контрагента', 'Счет', 'Сальдо на начало', 'Дт оборот', 'Кт оборот', 'Сальдо на конец']];
    res.rows.forEach(function (r) {
      r.lines.slice().sort(function (x, y) { return Math.abs(y.close) - Math.abs(x.close); }).forEach(function (l) { d.push([r.name, r.inn, l.cp, l.cpinn, l.vgo ? 'да' : '', l.cpstatus, l.acc, l.open, l.dt, l.kt, l.close]); });
      r.mirror.forEach(function (m) { d.push([r.name, r.inn, 'в книге: ' + m.org, m.orginn, 'зеркало', '', m.acc, m.open, m.dt, m.kt, m.close]); });
    });
    var ws2 = X.utils.aoa_to_sheet(d);
    for (var k = 2; k <= d.length; k++) ['H', 'I', 'J', 'K'].forEach(function (c) { var x = ws2[c + k]; if (x && x.t === 'n') x.z = '#,##0.00;-#,##0.00;–'; });
    ws2['!cols'] = [32, 12, 44, 14, 8, 18, 6, 16, 16, 16, 16].map(function (w) { return { wch: w }; });
    ws2['!autofilter'] = { ref: 'A1:K' + d.length };
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Готовность');
    var pp = [['План мероприятий по ЮЛ. Дата решения о ликвидации для готовых: ' + dateShort(opts.startDate || new Date()) + '. Для остальных — «Д» после расчистки.'], [],
      ['ЮЛ', 'ИНН', 'Вывод', 'Этап', '№', 'Мероприятие', 'Где делается', 'Срок', 'Статус']];
    rows.forEach(function (r) {
      (r.plan || []).forEach(function (s, i) { pp.push([i ? '' : r.name, i ? '' : r.inn, i ? '' : r.verdict, s.stage, i + 1, s.what, s.where, s.when, s.state]); });
      pp.push([]);
    });
    var ws3 = X.utils.aoa_to_sheet(pp);
    ws3['!cols'] = [34, 12, 11, 12, 4, 70, 32, 22, 34].map(function (w) { return { wch: w }; });
    X.utils.book_append_sheet(wb, ws3, 'План мероприятий');
    X.utils.book_append_sheet(wb, ws2, 'Остатки по контрагентам');
    return X.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  // ---------- «Анализ заказов клиентов» (отбор: не отгруженные по заказу, договор подписан) ----------
  // Колонки ищутся по заголовкам. Госконтракт — договор, названный «контракт» или с реестровым номером закупки (18–25 цифр).
  var GOV = /контракт|(^|[^\d])\d{18,25}([^\d]|$)/i;
  function parseOrders(rows) {
    var hdr = -1, c = {}, P = { org: /организац/i, client: /^клиент$/i, order: /^заказ клиента$/i, contract: /^договор$/i, term: /срок исполнения/i,
      left: /осталось отгрузить.*сумм/i, shipped: /^отгружено.*сумм/i, ready: /готов к отгрузке/i, placed: /^размещено у поставщиков/i, notplaced: /^не размещено/i, zno: /осталось оформить зно/i, signed: /подписан/i };
    for (var i = 0; i < Math.min(rows.length, 30) && hdr < 0; i++) {
      var t = {}; (rows[i] || []).forEach(function (v, j) { v = s(v); if (!v) return; Object.keys(P).forEach(function (k) { if (t[k] == null && P[k].test(v)) t[k] = j; }); });
      if (t.left != null && t.org != null && t.contract != null) { hdr = i; c = t; }
    }
    if (hdr < 0) return null;
    var orders = [], g = function (r, k) { return c[k] == null ? 0 : num(r[c[k]]); }, tx = function (r, k) { return c[k] == null ? '' : s(r[c[k]]); };
    for (var k = hdr + 1; k < rows.length; k++) {
      var r = rows[k] || [], org = tx(r, 'org'); if (!org || /^итого/i.test(s(r[0]))) continue;
      if (c.signed != null && !/^да$/i.test(tx(r, 'signed'))) continue;
      var contract = tx(r, 'contract');
      orders.push({ org: org, cp: tx(r, 'client'), order: tx(r, 'order'), contract: contract, term: E.parseDate(tx(r, 'term')), termText: tx(r, 'term'), amount: g(r, 'left'), shipped: g(r, 'shipped'),
        ready: g(r, 'ready'), placed: g(r, 'placed'), notplaced: g(r, 'notplaced'), zno: g(r, 'zno'), gov: GOV.test(contract) });
    }
    var from = ''; for (var q = 0; q < hdr; q++) (rows[q] || []).forEach(function (v) { var m = s(v).match(/Заказ клиента\.Дата\s+Больше или равно\s+"(\d{2}\.\d{2}\.\d{4})/i); if (m) from = m[1]; });
    return { orders: orders, rows: orders.length, cols: c, format: 'orders', from: from };
  }
  // привязка организаций отчета к ЮЛ реестра (по наименованию); идемпотентно
  function prepareContracts(con, reg, req) {
    if (!con || !con.orders || con._reg === reg) return con;
    con._reg = reg; con.byInn = {}; con.byKey = {}; con.unmatched = {};
    var cache = {};
    con.orders.forEach(function (o) {
      var inn = cache[o.org]; if (inn == null) inn = cache[o.org] = V.innByName(o.org, reg, req);
      o.inn = inn;
      if (inn) (con.byInn[inn] = con.byInn[inn] || []).push(o);
      else { var u = con.unmatched[o.org] = con.unmatched[o.org] || { n: 0, amount: 0 }; u.n++; u.amount += o.amount; }
    });
    return con;
  }
  // ---------- колонка «Госконтракты» реестра: завершены / исполняются + комментарий ----------
  function govReport(con, reg, req, opts) {
    opts = opts || {}; var thr = opts.govThreshold == null ? 1000 : opts.govThreshold, base = opts.date || new Date();
    prepareContracts(con, reg, req);
    var rows = (reg.all || []).map(function (rec) {
      var list = rec.inn ? (con.byInn[rec.inn] || []) : [], open = list.filter(function (o) { return o.amount >= 0.5; });
      var gov = open.filter(function (o) { return o.gov; }), oth = open.filter(function (o) { return !o.gov; });
      var sum = function (a, f) { return r2(a.reduce(function (x, o) { return x + (f ? o[f] : o.amount); }, 0)); };
      var late = function (a) { return a.filter(function (o) { return o.term && o.term < base; }); };
      // в отчете есть организация, наименование которой содержит наименование этого ЮЛ, но к реестру не привязана (возможны однофамильцы-юрлица) — не угадываем
      var sus = list.length ? [] : Object.keys(con.unmatched).filter(function (k) { var ct = nameKey(rec.name).core.split(' ').filter(Boolean), kt = nameKey(k).core.split(' '); return ct.length && ct.every(function (t) { return kt.indexOf(t) >= 0; }); });
      var res = { name: rec.name, inn: rec.inn, status: rec.status, was: rec.gk, govLeft: sum(gov), othLeft: sum(oth), govN: gov.length, othN: oth.length };
      var big = gov.slice().sort(function (a, b) { return b.amount - a.amount; }).slice(0, 3);
      if (sus.length) {
        res.gk = ''; res.comment = 'НЕ ОПРЕДЕЛЕНО: в отчете есть организация «' + sus.join('», «') + '» (' + mln(sus.reduce(function (x, k) { return x + con.unmatched[k].amount; }, 0)) + '), не сопоставленная с реестром. Если это данное ЮЛ — добавьте наименование из отчета в «Алиасы контрагента» реестра.';
      } else if (res.govLeft >= thr) {
        res.gk = 'исполняются';
        var near = gov.filter(function (o) { return o.term; }).map(function (o) { return o.term; }).sort(function (a, b) { return a - b; })[0], lt = late(gov);
        var cl = {}; gov.forEach(function (o) { cl[o.cp] = 1; });
        res.comment = 'Осталось исполнить ' + gov.length + ' ГК на ' + mln(res.govLeft) + ' (заказчиков: ' + Object.keys(cl).length + ')' +
          '; готово к отгрузке ' + mln(sum(gov, 'ready')) + ', размещено у поставщиков ' + mln(sum(gov, 'placed')) + ', не размещено ' + mln(sum(gov, 'notplaced')) +
          (near ? '; ближайший срок ' + dateShort(near) : '') + (lt.length ? '; просрочено ' + lt.length + ' на ' + mln(sum(lt)) : '') +
          '. Крупнейшие: ' + big.map(function (o) { return o.cp + ' — ' + mln(o.amount) + (o.term ? ' до ' + dateShort(o.term) : ''); }).join('; ') +
          (oth.length ? '. Прочие договоры: ' + oth.length + ' на ' + mln(sum(oth)) : '') + '. Передать можно только неоплаченную ДЗ, исполнение — нет: ликвидация на паузе' + (con.from ? ' (по заказам с ' + con.from + ')' : '') + '.';
      } else {
        res.gk = rec.gk && /не применимо/i.test(rec.gk) ? rec.gk : 'завершены';
        res.comment = (oth.length ? 'Госконтрактов к исполнению нет. Прочие неисполненные договоры: ' + oth.length + ' на ' + mln(sum(oth)) : 'Неисполненных подписанных договоров нет') + ' (по отчету на ' + dateShort(base) + (con.from ? ', заказы с ' + con.from : '') + ')';
      }
      return res;
    });
    var un = Object.keys(con.unmatched).map(function (k) { return { org: k, n: con.unmatched[k].n, amount: r2(con.unmatched[k].amount) }; }).sort(function (a, b) { return b.amount - a.amount; });
    return { rows: rows, unmatched: un };
  }
  function buildGkXlsx(rep, opts) {
    var X = E.XLSX, a = [['Госконтракты по реестру ЮЛ — по отчету «Анализ заказов клиентов», остатки к отгрузке с НДС'], [],
      ['Наименование', 'ИНН', 'Статус участия', 'Было в реестре', 'Госконтракты', 'Осталось исполнить по ГК, ₽', 'Договоров ГК', 'Прочие договоры, ₽', 'Комментарий']];
    rep.rows.forEach(function (r) { a.push([r.name, r.inn, r.status, r.was, r.gk, r.govLeft || null, r.govN || null, r.othLeft || null, r.comment]); });
    if (rep.unmatched.length) { a.push([], ['Организации отчета, не найденные в реестре ЮЛ (проверьте наименования / алиасы)']); rep.unmatched.forEach(function (u) { a.push([u.org, '', '', '', '', u.amount, u.n]); }); }
    var ws = X.utils.aoa_to_sheet(a); ws['!cols'] = [34, 13, 18, 16, 14, 18, 10, 16, 120].map(function (w) { return { wch: w }; });
    var wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Госконтракты');
    return X.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  // ---------- определение вида загруженного файла по шапке ----------
  function detectKind(rows) {
    var txt = [];
    for (var i = 0; i < Math.min(rows.length, 40); i++) (rows[i] || []).forEach(function (v) { v = s(v); if (v) txt.push(v); });
    var any = function (re) { return txt.some(function (t) { return re.test(t); }); };
    if (any(/осталось отгрузить.*сумм/i) && any(/организац/i)) return 'orders';
    if (any(/Регистр бухгалтерии|Остатки и обороты/i) || any(/кон\.\s*ост\.?\s*Дт/i)) return 'register';
    if (any(/сальдо на конец/i)) return 'book';
    if (any(/^наименование/i) && any(/^инн$/i) && any(/статус/i)) return 'registry';
    var colA = rows.slice(0, 200).some(function (r) { return /^полное наименование$/i.test(s(r && r[0])); });
    if (colA) return 'requisites';
    if (any(/недогруз/i)) return 'orders';
    return null;
  }
  var KIND_NAMES = { orders: 'Недогруз («Анализ заказов клиентов»)', register: 'Регистр бухгалтерии', book: 'Анализ субконто', registry: 'Реестр ЮЛ', requisites: 'Реквизиты' };

  // ---------- панель «Что есть / чего не хватает» ----------
  var HINT_REG = 'Регистр бухгалтерии «Журнал проводок (бухгалтерский и налоговый учет)», таблица «Остатки и обороты» (универсальный отчет / консоль запросов). Группировки: Организация → Счет → Субконто 1 (+ ИНН) → Субконто 2. Период — квартал (например 01.07–30.09), без отбора по организациям. Один файл на базу 1С.';
  function coverage(ctx) {
    var m = ctx.merged, reg = ctx.reg, req = ctx.req, con = ctx.contracts, out = [];
    var orgs = m ? m.orgs : [], withT = orgs.filter(function (o) { return o.totals; });
    var scope = reg ? reg.all.filter(function (r) { return r.inn && /обнул|транзит|консолид/i.test(r.status); }) : [];
    var add = function (id, title, state, detail, hint) { out.push({ id: id, title: title, state: state, detail: detail, hint: hint }); };
    add('registry', 'Реестр ЮЛ (статусы)', reg && reg.all.length ? 'ok' : 'no', reg && reg.all.length ? reg.all.length + ' ЮЛ' : 'не загружен', 'Excel: наименование, статус участия (Обнуляем / Транзит / Запрещено / Чужой / Консолидатор), ИНН, колонки «Название в 1С», «Алиасы контрагента». Ведется вручную.');
    var noReq = req ? scope.filter(function (r) { return !req.byInn[r.inn]; }) : scope;
    add('req', 'Реквизиты ЮЛ', req && req.orgs.length ? (noReq.length ? 'part' : 'ok') : 'no', req ? req.orgs.length + ' ЮЛ' + (noReq.length ? '; нет реквизитов у ' + noReq.length + ' ЮЛ из работы' : '') : 'не загружены', 'Excel в блочном формате: «Полное наименование», ИНН, КПП, адрес, расчетный счет, банк, БИК, руководитель.');
    var noBook = m ? scope.filter(function (r) { return !m.byInn[r.inn]; }) : scope;
    add('debts', 'Долги с контрагентами (с ИНН)', orgs.length ? (noBook.length ? 'part' : 'ok') : 'no', orgs.length ? orgs.length + ' организаций' + (m.date ? ', остатки на ' + dateShort(m.date) : '') + (noBook.length ? '; нет выгрузки по ' + noBook.length + ' ЮЛ реестра (другая база?)' : '') : 'нет выгрузок', HINT_REG + ' Либо «Анализ субконто» по счетам 58/60/62/66/67/76 (колонка ИНН).');
    var cpAll = 0, cpCon = 0; orgs.forEach(function (o) { o.cps.forEach(function (c) { cpAll++; if (c.contracts && c.contracts.length) cpCon++; }); });
    add('contracts', 'Договоры в основании долга', cpCon ? 'ok' : 'no', cpCon ? 'у ' + cpCon + ' из ' + cpAll + ' контрагентов — попадают в договоры уступки' : 'нет (договоры — в субконто 2 регистра)', HINT_REG);
    add('perf', 'Исполнение контрактов (недогруз)', con && con.rows ? 'ok' : 'no', con && con.rows ? con.rows + ' заказов' + (con.from ? ', заказы с ' + con.from : '') + (con.unmatched && Object.keys(con.unmatched).length ? '; не сопоставлено организаций: ' + Object.keys(con.unmatched).length : '') : 'не загружен — используется критерий отгрузок по Дт 62', 'Отчет «Анализ заказов клиентов»: отбор «Не отгруженные по заказу», «Договор.Подписан = Да»; колонки: организация, клиент, договор, срок исполнения, «Осталось отгрузить, сумма с НДС», готов к отгрузке / размещено у поставщиков.');
    var has = function (re) { return withT.some(function (o) { return Object.keys(o.totals).some(function (a) { return re.test(a) && Math.abs(o.totals[a][3]) >= 0.5; }); }); };
    var grp = [['workers', 'Работники и подотчет (70, 71, 73)', /^(70|71|73)$/], ['cash', 'Деньги (50, 51, 52, 55, 57)', /^(50|51|52|55|57)$/], ['property', 'Имущество и запасы (01, 03, 08, 10, 41 …)', /^(01|03|04|08|10|20|21|26|41|43)$/], ['taxes', 'Налоги и взносы (68, 69)', /^(68|69)$/], ['capital', 'Капитал и результаты (80–84)', /^(80|81|82|83|84)$/]];
    grp.forEach(function (g) { add(g[0], g[1], withT.length ? (has(g[2]) ? 'ok' : 'part') : 'no', withT.length ? (has(g[2]) ? 'есть остатки у ' + withT.filter(function (o) { return Object.keys(o.totals).some(function (a) { return g[2].test(a) && Math.abs(o.totals[a][3]) >= 0.5; }); }).length + ' ЮЛ' : 'остатков нет (или не выгружены)') : 'нет — нужен «Регистр бухгалтерии»', HINT_REG); });
    var mm = m ? m.months : 0, withDet = orgs.some(function (o) { return o.cps.some(function (c) { return c.det; }); });
    add('turn', 'Обороты с внешними покупателями (62)', withDet ? (mm === 3 ? 'ok' : 'part') : 'no', withDet ? 'период ' + mm + ' мес.' + (mm === 3 ? '' : ' — для критерия активности лучше квартал') : 'нет', HINT_REG);
    return out;
  }

  // ---------- таблица «Недогруз» (исполнение контрактов) ----------
  // Заголовки ищутся по словам: ИНН организации/поставщика, наименование ЮЛ, контрагент (заказчик), контракт/договор, сумма недогруза (остаток к поставке).
  function parseContracts(rows) {
    var po = parseOrders(rows); if (po) return po;
    var hdr = -1, c = {};
    var P = { inn: /инн/i, org: /организац|поставщик|юр.*лиц|^юл$|исполнитель/i, cp: /заказчик|покупатель|контрагент|получатель/i, contract: /контракт|договор|№/i,
      amount: /недогруз|остат.*(постав|исполн)|не\s*исполн|не\s*отгруж|к\s*поставке|сумма/i };
    for (var i = 0; i < Math.min(rows.length, 30) && hdr < 0; i++) {
      var t = {}; (rows[i] || []).forEach(function (v, j) { v = s(v); if (!v) return; Object.keys(P).forEach(function (k) { if (t[k] == null && P[k].test(v)) t[k] = j; }); });
      if (t.amount != null && (t.org != null || t.inn != null)) { hdr = i; c = t; }
    }
    if (hdr < 0) throw new Error('Недогруз: не найдены колонки «организация/ИНН» и «сумма недогруза»');
    var byInn = {}, byKey = {}, n = 0;
    for (var k = hdr + 1; k < rows.length; k++) {
      var r = rows[k] || [], amt = num(r[c.amount]); if (!(amt > 0.5)) continue;
      var org = s(r[c.org]), inn = c.inn != null ? s(r[c.inn]).replace(/\D/g, '') : '';
      if (/итого/i.test(org)) continue;
      var rec = { org: org, cp: c.cp != null ? s(r[c.cp]) : '', contract: c.contract != null ? s(r[c.contract]) : '', amount: amt };
      if (inn) (byInn[inn] = byInn[inn] || []).push(rec);
      else if (org) { var kk = E.nameKey(org).core; if (kk) (byKey[kk] = byKey[kk] || []).push(rec); }
      n++;
    }
    return { byInn: byInn, byKey: byKey, rows: n, cols: c };
  }

  var api = { resolveList: resolveList, analyze: analyze, buildXlsx: buildXlsx, parseContracts: parseContracts, detectKind: detectKind, kindName: function (k) { return KIND_NAMES[k] || ''; }, coverage: coverage, govReport: govReport, buildGkXlsx: buildGkXlsx, prepareContracts: prepareContracts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EngineLiq = api;
})(this);
