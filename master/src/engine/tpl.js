/* Шаблоны договоров (Word .docx с метками {{…}}): заполнение, контексты по видам документов, «рыбы» по умолчанию.
   Метки: {{Цедент.Наименование}}; условный текст {{если АВАНС}}…{{/если}} (внутри одного абзаца; {{если НЕ X}});
   строки таблицы: строка, где есть {{п.№}} {{п.Основание}} {{п.Содержание}} {{п.Сумма}}, повторяется для каждого требования.
   Нумерация пунктов «1.», «1.1.» после удаления условных абзацев выравнивается автоматически. */
(function (root) {
  'use strict';
  var E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var s = E.s, money = E.money, words = E.words, dateShort = E.dateShort, dateLong = E.dateLong;

  var KINDS = {
    cession: { file: '1 Договор уступки (внутригрупповой).docx', title: 'Договор уступки права требования — должник внутри группы (подписывают цедент, цессионарий, должник)' },
    cessionExt: { file: '2 Договор уступки (внешний должник).docx', title: 'Договор уступки права требования — внешний должник (подписывают цедент и цессионарий, должнику — уведомление)' },
    notice: { file: '3 Уведомление должнику об уступке.docx', title: 'Уведомление должнику об уступке' },
    zachet: { file: '4 Соглашение о зачете.docx', title: 'Соглашение о зачете встречных требований (и зачет цены уступки)' },
    transfer: { file: '5 Соглашение о переводе долга.docx', title: 'Соглашение о переводе долга (с согласием кредитора)' }
  };

  // ---------- XML ----------
  function xe(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function xu(t) { return String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  var RT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

  // правки текста абзаца с учетом разбиения на runs: edits = [{start, end, rep}], не пересекаются
  function applyEdits(pxml, edits) {
    var runs = [], m, text = '';
    RT.lastIndex = 0;
    while ((m = RT.exec(pxml))) { var tx = xu(m[1]); runs.push({ idx: m.index, len: m[0].length, open: m[0].slice(0, m[0].indexOf('>') + 1), s: text.length, e: text.length + tx.length }); text += tx; }
    var outs = runs.map(function () { return ''; }), ri = 0, ei = 0;
    edits = edits.slice().sort(function (a, b) { return a.start - b.start; });
    for (var i = 0; i < text.length; i++) {
      while (ri < runs.length - 1 && i >= runs[ri].e) ri++;
      while (ei < edits.length && i >= edits[ei].end) ei++;
      var ed = edits[ei];
      if (ed && i >= ed.start && i < ed.end) { if (i === ed.start) outs[ri] += ed.rep; continue; }
      outs[ri] += text[i];
    }
    // правка в пустом конце абзаца (start == длина текста)
    edits.forEach(function (ed) { if (ed.start >= text.length && ed.end > ed.start - 1 && ed.start === text.length && ed.rep && runs.length) outs[runs.length - 1] += ed.rep; });
    var out = pxml;
    for (var k = runs.length - 1; k >= 0; k--) {
      var r = runs[k], body = xe(outs[k]).split('\n').join('</w:t><w:br/><w:t xml:space="preserve">');
      out = out.slice(0, r.idx) + '<w:t xml:space="preserve">' + body + '</w:t>' + out.slice(r.idx + r.len);
    }
    return out;
  }
  function paraText(pxml) { var t = '', m; RT.lastIndex = 0; while ((m = RT.exec(pxml))) t += xu(m[1]); return t; }
  function plain(xml) { return xu(xml.replace(/<[^>]+>/g, '')); }

  // ---------- заполнение абзаца ----------
  function fillPara(pxml, st) {
    var text = paraText(pxml); if (text.indexOf('{{') < 0) return pxml;
    var toks = [], re = /\{\{([^{}]*)\}\}/g, m;
    while ((m = re.exec(text))) toks.push({ start: m.index, end: m.index + m[0].length, name: m[1].replace(/\s+/g, ' ').trim() });
    var edits = [], stack = [], removed = false, hidden = [];
    toks.forEach(function (t) {
      var mc = t.name.match(/^если\s+(НЕ\s+)?(.+)$/i);
      if (mc) { stack.push({ t: t, neg: !!mc[1], flag: mc[2].trim() }); return; }
      if (/^\/если$/i.test(t.name)) {
        var o = stack.pop(); if (!o) return;
        var v = st.flags[o.flag.toUpperCase()];
        if (v === undefined) { st.missing[o.flag] = 1; v = false; }
        if (o.neg) v = !v;
        if (v) { edits.push({ start: o.t.start, end: o.t.end, rep: '' }); edits.push({ start: t.start, end: t.end, rep: '' }); }
        else { edits.push({ start: o.t.start, end: t.end, rep: '' }); hidden.push([o.t.start, t.end]); removed = true; }
        return;
      }
      t.isVar = true;
    });
    toks.forEach(function (t) {
      if (!t.isVar || hidden.some(function (h) { return t.start >= h[0] && t.end <= h[1]; })) return;
      var v = st.vars[t.name];
      if (v === undefined || v === null) { st.missing[t.name] = 1; v = '______'; }
      edits.push({ start: t.start, end: t.end, rep: String(v) });
    });
    // условный блок внутри которого стоят метки: правки внутри скрытого участка пересекаются с общей — убираем вложенные
    edits = edits.filter(function (e) { return !hidden.some(function (h) { return (e.start >= h[0] && e.end <= h[1]) && !(e.start === h[0] && e.end === h[1]) && e.rep === ''; }) || hidden.some(function (h) { return e.start === h[0]; }); });
    var out = applyEdits(pxml, edits);
    if (removed && paraText(out).replace(/\s+/g, '') === '' && !/<w:drawing|<w:pict|<w:tbl/.test(out)) return '';
    return out;
  }
  function fillXml(xml, st) { return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, function (p) { return fillPara(p, st); }); }

  // строки таблиц с {{п.*}} повторяются по числу требований
  function expandRows(xml, st) {
    return xml.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, function (row) {
      var mm = plain(row).match(/\{\{\s*(п\d*)\./); if (!mm) return row;
      var key = mm[1], items = (st.tables && st.tables[key]) || [];
      return items.map(function (it) {
        var rv = {}; rv[key + '.№'] = it[0]; rv[key + '.Основание'] = it[1]; rv[key + '.Содержание'] = it[2]; rv[key + '.Сумма'] = it[3];
        var st2 = { vars: Object.assign({}, st.vars, rv), flags: st.flags, missing: st.missing };
        return fillXml(row, st2);
      }).join('');
    });
  }

  // нумерация: «N.» и «N.M.» в начале абзацев вне таблиц
  function renumber(xml) {
    var tbls = [];
    xml = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, function (t) { tbls.push(t); return '\u0001' + (tbls.length - 1) + '\u0002'; });
    var top = 0, sub = 0;
    xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, function (p) {
      var t = paraText(p), m;
      if ((m = t.match(/^(\s*)(\d+)\.(\d+)\.(\s)/))) { sub++; var rep = top + '.' + sub; return applyEdits(p, [{ start: m[1].length, end: m[1].length + m[2].length + 1 + m[3].length, rep: rep }]); }
      if ((m = t.match(/^(\s*)(\d+)\.(\s)/))) { top++; sub = 0; return applyEdits(p, [{ start: m[1].length, end: m[1].length + m[2].length, rep: String(top) }]); }
      return p;
    });
    return xml.replace(/\u0001(\d+)\u0002/g, function (_, i) { return tbls[+i]; });
  }

  // ctx: { vars, flags, tables } → { bytes, missing: [...] }
  function fill(bytes, ctx) {
    var flags = {}; Object.keys(ctx.flags || {}).forEach(function (k) { flags[k.toUpperCase()] = !!ctx.flags[k]; });
    var st = { vars: ctx.vars || {}, flags: flags, tables: ctx.tables || {}, missing: {} };
    return E.JSZip.loadAsync(bytes).then(function (z) {
      var names = Object.keys(z.files).filter(function (n) { return /^word\/(document|header\d*|footer\d*)\.xml$/.test(n); });
      return Promise.all(names.map(function (n) {
        return z.file(n).async('string').then(function (xml) {
          var out = n === 'word/document.xml' ? renumber(fillXml(expandRows(xml, st), st)) : fillXml(xml, st);
          z.file(n, out);
        });
      })).then(function () { return z.generateAsync({ type: 'uint8array' }); });
    }).then(function (b) { return { bytes: b, missing: Object.keys(st.missing) }; });
  }
  // d.tpl — контекст, который builder документа прикладывает к себе; templates — {kind: bytes}
  function render(d, templates, warnings) {
    if (d.tpl && templates && templates[d.tpl.kind]) {
      return fill(templates[d.tpl.kind], d.tpl).then(function (r) {
        r.missing.forEach(function (m) { warnings.push('Шаблон «' + KINDS[d.tpl.kind].file + '»: нет данных для метки {{' + m + '}} — оставлено «______»'); });
        return r.bytes;
      }).catch(function (e) { warnings.push('Шаблон «' + KINDS[d.tpl.kind].file + '» не применен (' + e.message + ') — использован встроенный текст'); return E.docxBlob(d); });
    }
    return E.docxBlob(d);
  }

  // ---------- контексты (данные для меток) ----------
  function pv(pre, p, role) {
    var r = p.r || {}, o = {}, set = function (k, v) { o[pre + '.' + k] = v; };
    set('Наименование', p.name || '________________'); set('ИНН', p.inn || '__________'); set('КПП', s(r['Код КПП']));
    set('Адрес', s(r['Юридический адрес']).replace(/\s+,/g, ',')); set('Город', p.city()); set('Вводная', p.intro(role || pre));
    set('Должность', p.posNom || '________________'); set('Должность.Р', p.posGen || '________________'); set('ФИО', p.fio || '________________');
    set('ФИО.Р', p.fioGen || p.fio || '________________'); set('Подпись', p.short); set('Дательный', p.dative());
    set('Реквизиты', p.reqLines().join('\n')); set('МП', p.ip ? '' : 'М.П.');
    set('Банк', s(r['Банк'])); set('БИК', s(r['БИК'])); set('Расчетный счет', s(r['Расчетный счет'])); set('Корр.счет', s(r['Корр.счет']));
    return o;
  }
  function split(rows) { return { items: rows.slice(0, -1), total: rows[rows.length - 1][3] }; }
  function merge() { var o = {}; [].slice.call(arguments).forEach(function (x) { Object.keys(x).forEach(function (k) { o[k] = x[k]; }); }); return o; }

  var ctx = {
    cession: function (x, date, cedent, cessionary, debtor, payText, o, rows, adv, loan) {
      var t = split(rows);
      return { kind: o && o.external ? 'cessionExt' : 'cession', tables: { 'п': t.items }, flags: { АВАНС: adv, ЗАЙМ: loan },
        vars: merge(pv('Цедент', cedent, 'Цедент'), pv('Цессионарий', cessionary, 'Цессионарий'), pv('Должник', debtor, 'Должник'), {
          'Номер': x.num, 'Дата': dateShort(date), 'Дата.Прописью': dateLong(date), 'Город': cessionary.city(), 'Сумма': money(x.nominal), 'Сумма.Прописью': words(x.nominal),
          'Цена': money(x.price), 'Цена.Прописью': words(x.price), 'Порядок расчетов': payText, 'Дата баланса': dateShort(x.balanceDate), 'Итого': t.total }) };
    },
    notice: function (x, date, cedent, cessionary, debtor, rows) {
      var t = split(rows), r = debtor.r || {};
      return { kind: 'notice', tables: { 'п': t.items }, flags: { АДРЕС: !!r['Юридический адрес'] },
        vars: merge(pv('Цедент', cedent, 'Цедент'), pv('Цессионарий', cessionary, 'Цессионарий'), pv('Должник', debtor, 'Должник'), {
          'Исх. №': x.notice, 'Номер договора': x.num, 'Дата': dateShort(date), 'Сумма': money(x.nominal), 'Сумма.Прописью': words(x.nominal), 'Итого': t.total }) };
    },
    zachet: function (num, date, p1, p2, rows12, rows21, amount, adv, balanceDate, t12, t21) {
      var a = split(rows12), b = split(rows21);
      return { kind: 'zachet', tables: { 'п1': a.items, 'п2': b.items }, flags: { АВАНС: adv },
        vars: merge(pv('Сторона 1', p1, 'Сторона 1'), pv('Сторона 2', p2, 'Сторона 2'), {
          'Номер': num, 'Дата': dateShort(date), 'Дата.Прописью': dateLong(date), 'Город': p1.city(), 'Дата баланса': dateShort(balanceDate), 'Сумма': money(amount), 'Сумма.Прописью': words(amount),
          'Остаток.Сторона 2': money(t12 - amount), 'Остаток.Сторона 1': money(t21 - amount), 'Итого1': a.total, 'Итого2': b.total }) };
    },
    transfer: function (x, date, oldDebtor, newDebtor, creditor, compText, bdate, rows, adv, loan) {
      var t = split(rows);
      return { kind: 'transfer', tables: { 'п': t.items }, flags: { АВАНС: adv, ЗАЙМ: loan },
        vars: merge(pv('Кредитор', creditor, 'Кредитор'), pv('Первоначальный должник', oldDebtor, 'Первоначальный должник'), pv('Новый должник', newDebtor, 'Новый должник'), {
          'Номер': x.num, 'Дата': dateShort(date), 'Дата.Прописью': dateLong(date), 'Город': newDebtor.city(), 'Дата баланса': dateShort(bdate), 'Сумма': money(x.nominal), 'Сумма.Прописью': words(x.nominal),
          'Порядок расчетов': compText, 'Итого': t.total }) };
    }
  };

  // ---------- «рыбы» по умолчанию (по тем же текстам, что и встроенные документы) ----------
  var W = [500, 2800, 4338, 2000], AL = ['center', 'left', 'left', 'right'], HEAD = ['№', 'Основание (договор)', 'Содержание требования', 'Сумма, руб.'];
  function itemsTable(d, key, tot, head) { d.grid(head || HEAD, [['{{' + key + '.№}}', '{{' + key + '.Основание}}', '{{' + key + '.Содержание}}', '{{' + key + '.Сумма}}'], (function () { var r = ['', '', 'Итого', '{{' + tot + '}}']; r._bold = true; return r; })()], W, AL); }
  var DEFAULT_BUILD = {
    cession: function (ext) {
      var d = E.doc();
      d.title('ДОГОВОР № {{Номер}}', 'уступки права требования (цессии)');
      d.placeText('г. {{Город}}\t{{Дата.Прописью}}');
      d.para('{{Цедент.Вводная}}, с одной стороны, и {{Цессионарий.Вводная}}, с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем:');
      d.head('1. Предмет договора');
      d.para('1.1. Цедент уступает, а Цессионарий принимает права требования Цедента к {{Должник.Дательный}} (ИНН {{Должник.ИНН}}), далее — «Должник», по обязательствам, указанным в пункте 1.2 настоящего договора, в общей сумме {{Сумма.Прописью}}.');
      d.para('1.2. Перечень уступаемых требований:');
      itemsTable(d, 'п', 'Итого');
      d.para('{{если АВАНС}}1.3. В части требований, возникших из предварительной оплаты, к Цессионарию переходит право требовать от Должника передачи предварительно оплаченного товара (выполнения работ, оказания услуг) либо возврата суммы предварительной оплаты в соответствии со статьей 487 Гражданского кодекса Российской Федерации.{{/если}}');
      d.para('{{если ЗАЙМ}}1.4. В части требований по договорам займа к Цессионарию переходят права требования возврата суммы займа и уплаты процентов за пользование займом, начисленных и не уплаченных на дату перехода права, в пределах суммы, указанной в пункте 1.2.{{/если}}');
      d.para('1.5. Размер уступаемых требований определен по данным бухгалтерского учета Сторон на {{Дата баланса}} и подтверждается ' + (ext ? 'первичными документами и актом сверки расчетов Цедента с Должником (при наличии)' : 'актом сверки взаимных расчетов Цедента и Должника') + '.');
      d.para('1.6. Права требования переходят к Цессионарию в том объеме и на тех условиях, которые существовали к моменту перехода права, в момент подписания настоящего договора.');
      d.para('1.7. Цедент гарантирует, что уступаемые права требования действительны, принадлежат Цеденту, ранее не уступались, не заложены, не прекращены зачетом или иным способом и не находятся под арестом.');
      d.head('2. Цена и порядок расчетов');
      d.para('2.1. За уступаемые права требования Цессионарий уплачивает Цеденту {{Цена.Прописью}}.');
      d.para('2.2. {{Порядок расчетов}}');
      d.head('3. Права и обязанности Сторон');
      d.para('3.1. Цедент в течение 3 (трех) рабочих дней с даты подписания настоящего договора передает Цессионарию по акту приема-передачи документы, удостоверяющие права требования: договоры, указанные в пункте 1.2, первичные документы (УПД, товарные накладные, акты, платежные поручения), акт сверки расчетов с Должником.');
      d.para('3.2. Цедент отвечает перед Цессионарием за действительность уступаемых требований и не отвечает за их исполнение Должником.');
      d.para(ext
        ? '3.3. Цедент в течение 5 (пяти) рабочих дней с даты подписания настоящего договора направляет Должнику письменное уведомление об уступке с указанием реквизитов Цессионария. До получения уведомления исполнение Должником Цеденту считается надлежащим (ст. 385 ГК РФ); полученное Цедент передает Цессионарию в течение 3 (трех) рабочих дней.'
        : '3.3. Цедент уведомляет Должника о состоявшейся уступке. Подписание Должником настоящего договора подтверждает получение им уведомления об уступке и размер задолженности, указанный в пункте 1.2. С даты подписания договора Должник исполняет обязательства Цессионарию по его реквизитам.');
      d.head('4. Заключительные положения');
      d.para('4.1. Договор вступает в силу с момента подписания Сторонами и действует до полного исполнения обязательств.');
      d.para('4.2. Споры разрешаются в Арбитражном суде по месту нахождения Цессионария.');
      d.para(ext ? '4.3. Договор составлен в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.' : '4.3. Договор составлен в трех экземплярах, имеющих равную юридическую силу: для Цедента, Цессионария и Должника.');
      d.requisitesTpl([['Цедент', 'Цедент'], ['Цессионарий', 'Цессионарий']]);
      if (!ext) {
        d.plain('Уведомлен об уступке. Задолженность в сумме {{Сумма}} руб. подтверждаю.', { b: 1 });
        d.plain('Должник: {{Должник.Наименование}}');
        d.plain('{{Должник.Должность}}  _______________ / {{Должник.Подпись}} /       М.П.');
      }
      return d;
    },
    notice: function () {
      var d = E.doc();
      d.plain('Исх. № {{Исх. №}} от {{Дата}}');
      d.plain('Кому: {{Должник.Наименование}} (ИНН {{Должник.ИНН}})');
      d.plain('{{если АДРЕС}}Адрес: {{Должник.Адрес}}{{/если}}');
      d.title('УВЕДОМЛЕНИЕ', 'об уступке права требования');
      d.para('{{Цедент.Наименование}} (ИНН {{Цедент.ИНН}}) уведомляет, что по договору уступки права требования (цессии) № {{Номер договора}} от {{Дата}} права требования к Вам по обязательствам, указанным ниже, в общей сумме {{Сумма.Прописью}} перешли к {{Цессионарий.Дательный}} (ИНН {{Цессионарий.ИНН}}).');
      itemsTable(d, 'п', 'Итого');
      d.para('С даты получения настоящего уведомления просим исполнять указанные обязательства новому кредитору по следующим реквизитам:');
      d.plain('{{Цессионарий.Реквизиты}}');
      d.para('Исполнение, произведенное прежнему кредитору после получения настоящего уведомления, не будет считаться надлежащим (ст. 385 ГК РФ).');
      d.plain('');
      d.plain('{{Цедент.Должность}}  _______________ / {{Цедент.Подпись}} /       М.П.');
      return d;
    },
    zachet: function () {
      var d = E.doc();
      d.title('СОГЛАШЕНИЕ № {{Номер}}', 'о зачете встречных однородных требований');
      d.placeText('г. {{Город}}\t{{Дата.Прописью}}');
      d.para('{{Сторона 1.Вводная}}, с одной стороны, и {{Сторона 2.Вводная}}, с другой стороны, совместно именуемые «Стороны», заключили настоящее соглашение о нижеследующем:');
      d.para('1. Стороны подтверждают наличие следующих встречных требований по данным учета на {{Дата баланса}}:');
      d.para('1.1. Требования Стороны 1 к Стороне 2:');
      itemsTable(d, 'п1', 'Итого1');
      d.para('1.2. Требования Стороны 2 к Стороне 1:');
      itemsTable(d, 'п2', 'Итого2');
      d.para('{{если АВАНС}}2. Стороны пришли к соглашению о прекращении обязательств по передаче товара (выполнению работ, оказанию услуг) в счет предварительной оплаты в части сумм, указанных в пункте 1. Указанные суммы предварительной оплаты подлежат возврату и с даты подписания настоящего соглашения являются денежными обязательствами Сторон.{{/если}}');
      d.para('3. В соответствии со статьей 410 Гражданского кодекса Российской Федерации Стороны прекращают зачетом встречные однородные денежные требования, указанные в пункте 1 настоящего соглашения, на сумму {{Сумма.Прописью}}.');
      d.para('4. После проведения зачета задолженность Стороны 2 перед Стороной 1 составляет {{Остаток.Сторона 2}} руб., задолженность Стороны 1 перед Стороной 2 составляет {{Остаток.Сторона 1}} руб.');
      d.para('5. Стороны подтверждают, что требования, прекращаемые настоящим соглашением, не уступлены третьим лицам, не обременены правами третьих лиц и не оспариваются.');
      d.para('6. Стороны отразят зачет в бухгалтерском учете на дату подписания настоящего соглашения и в течение 5 (пяти) рабочих дней подпишут акт сверки взаимных расчетов.');
      d.para('7. Соглашение вступает в силу с момента подписания, составлено в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.');
      d.requisitesTpl([['Сторона 1', 'Сторона 1'], ['Сторона 2', 'Сторона 2']]);
      return d;
    },
    transfer: function () {
      var d = E.doc();
      d.title('СОГЛАШЕНИЕ № {{Номер}}', 'о переводе долга');
      d.placeText('г. {{Город}}\t{{Дата.Прописью}}');
      d.para('{{Кредитор.Вводная}}, {{Первоначальный должник.Вводная}} и {{Новый должник.Вводная}}, совместно именуемые «Стороны», заключили настоящее соглашение о нижеследующем:');
      d.head('1. Предмет соглашения');
      d.para('1.1. Первоначальный должник переводит, а Новый должник принимает на себя обязательства Первоначального должника перед Кредитором, указанные в пункте 1.2 настоящего соглашения, в общей сумме {{Сумма.Прописью}}.');
      d.para('1.2. Перечень переводимых обязательств (по данным учета на {{Дата баланса}}):');
      itemsTable(d, 'п', 'Итого', ['№', 'Основание (договор)', 'Содержание обязательства (требование Кредитора)', 'Сумма, руб.']);
      d.para('1.3. Кредитор дает согласие на перевод долга в соответствии со статьей 391 Гражданского кодекса Российской Федерации. Подписание настоящего соглашения Кредитором является таким согласием.');
      d.para('{{если АВАНС}}1.4. В части обязательств, возникших из полученной предварительной оплаты, Новый должник обязуется передать Кредитору предварительно оплаченный товар (выполнить работы, оказать услуги) либо возвратить сумму предварительной оплаты по выбору Кредитора (ст. 487 ГК РФ).{{/если}}');
      d.para('{{если ЗАЙМ}}1.5. В части обязательств по договорам займа к Новому должнику переходит также обязанность по уплате процентов за пользование займом, начисленных на дату перевода долга, в пределах суммы, указанной в пункте 1.2.{{/если}}');
      d.para('1.6. С момента подписания настоящего соглашения всеми Сторонами Первоначальный должник выбывает из указанных обязательств, а Новый должник становится должником Кредитора. Новый должник вправе выдвигать против требований Кредитора возражения, основанные на отношениях между Кредитором и Первоначальным должником (ст. 392 ГК РФ).');
      d.head('2. Расчеты между Первоначальным и Новым должником');
      d.para('2.1. За принятие долга Первоначальный должник уплачивает Новому должнику {{Сумма.Прописью}}.');
      d.para('2.2. {{Порядок расчетов}}');
      d.head('3. Прочие условия');
      d.para('3.1. Первоначальный должник в течение 3 (трех) рабочих дней с даты подписания настоящего соглашения передает Новому должнику документы, подтверждающие переводимые обязательства: договоры, первичные документы, акт сверки расчетов с Кредитором.');
      d.para('3.2. Первоначальный должник гарантирует, что размер переводимых обязательств соответствует данным его бухгалтерского учета и подтверждается первичными документами.');
      d.para('3.3. Соглашение вступает в силу с момента подписания всеми Сторонами и составлено в трех экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.');
      d.requisitesTpl([['Кредитор', 'Кредитор'], ['Первоначальный должник', 'Первоначальный должник'], ['Новый должник', 'Новый должник']]);
      return d;
    }
  };
  // все «рыбы»: { kind: Promise<Uint8Array> }
  function defaults() {
    var o = {};
    o.cession = E.docxBlob(DEFAULT_BUILD.cession(false)); o.cessionExt = E.docxBlob(DEFAULT_BUILD.cession(true));
    o.notice = E.docxBlob(DEFAULT_BUILD.notice()); o.zachet = E.docxBlob(DEFAULT_BUILD.zachet()); o.transfer = E.docxBlob(DEFAULT_BUILD.transfer());
    return o;
  }
  // вид шаблона по имени файла («1 …», «2 …») либо по содержимому
  function detect(name, bytes) {
    var m = String(name).match(/^\s*([1-5])[\s._)-]/);
    var byNum = m ? ['cession', 'cessionExt', 'notice', 'zachet', 'transfer'][+m[1] - 1] : null;
    if (byNum) return Promise.resolve(byNum);
    return E.JSZip.loadAsync(bytes).then(function (z) { return z.file('word/document.xml').async('string'); }).then(function (xml) {
      var t = plain(xml);
      if (/Новый должник/.test(t) && /Первоначальный должник/.test(t)) return 'transfer';
      if (/Сторона 1/.test(t) && /Сторона 2/.test(t)) return 'zachet';
      if (/УВЕДОМЛЕНИЕ/.test(t)) return 'notice';
      if (/Цессионарий/.test(t)) return /Уведомлен об уступке|Должник\.Подпись/.test(t) ? 'cession' : 'cessionExt';
      return null;
    }).catch(function () { return null; });
  }
  var TOKEN_HELP = [
    ['Для каждой стороны (Цедент, Цессионарий, Должник, Сторона 1, Сторона 2, Кредитор, Первоначальный должник, Новый должник)', '{{Сторона.Наименование}} {{.ИНН}} {{.КПП}} {{.Адрес}} {{.Город}} {{.Вводная}} (наименование + «в лице … на основании Устава») {{.Должность}} {{.Должность.Р}} {{.ФИО}} {{.ФИО.Р}} {{.Подпись}} (Иванов И.И.) {{.Дательный}} {{.Реквизиты}} (блок строк) {{.МП}} {{.Банк}} {{.БИК}} {{.Расчетный счет}} {{.Корр.счет}}'],
    ['Документ', '{{Номер}} {{Дата}} {{Дата.Прописью}} {{Город}} {{Сумма}} {{Сумма.Прописью}} {{Цена}} {{Цена.Прописью}} {{Порядок расчетов}} {{Дата баланса}} {{Итого}} {{Исх. №}} {{Номер договора}} {{Остаток.Сторона 1}} {{Остаток.Сторона 2}} {{Итого1}} {{Итого2}}'],
    ['Таблица требований', 'строка таблицы с {{п.№}} {{п.Основание}} {{п.Содержание}} {{п.Сумма}} повторяется для каждого требования (в соглашении о зачете — {{п1.…}} и {{п2.…}})'],
    ['Условный текст', '{{если АВАНС}}…{{/если}}, {{если ЗАЙМ}}…{{/если}}, {{если АДРЕС}}…{{/если}}, {{если НЕ АВАНС}}…{{/если}} — в пределах одного абзаца; пункты «1.3.» перенумеровываются автоматически']
  ];

  var api = { KINDS: KINDS, fill: fill, render: render, ctx: ctx, defaults: defaults, detect: detect, DEFAULT_BUILD: DEFAULT_BUILD, TOKEN_HELP: TOKEN_HELP, paraText: paraText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EngineTpl = api;
})(typeof window !== 'undefined' ? window : globalThis);
