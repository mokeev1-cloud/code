/* «Дело» — реестр выпущенных документов и сверка нового расчета с тем, что уже выпускалось и подписывалось.
   Зачем: документов сотни, подписание идет неделями, данные 1С меняются. Движок каждый раз считает план «с нуля»;
   этот модуль держит память: у каждой операции (зачет, уступка, перевод долга…) есть устойчивый ключ, номер, редакция и статус.
   Новый расчет сверяется с реестром: новые / без изменений / изменились (перевыпуск с той же нумерацией) /
   расхождение с уже подписанным / исчезли. Номера никогда не переиспользуются и не «съезжают».
   Модуль чистый (без DOM) — тестируется в Node. */
(function (root) {
  'use strict';
  var E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  var money = E.money, r2 = E.r2, dateShort = E.dateShort;

  var STATUSES = ['подготовлен', 'на подписи', 'подписан', 'аннулирован'];
  var SIGNED = 'подписан', VOID = 'аннулирован';

  // ---------- вспомогательное ----------
  function hash(str) {   // 64 бита (два независимых 32-битных хэша) — для отпечатков, не для защиты
    var a = 0x811c9dc5, b = 0x9747b28c; str = String(str);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i); a ^= c; a = Math.imul(a, 16777619) >>> 0;
      b ^= (c + i) & 0xffff; b = Math.imul(b, 2246822519) >>> 0; b ^= b >>> 13;
    }
    return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
  }
  var REQ_FIELDS = ['Полное наименование', 'ИНН', 'Код КПП', 'Юридический адрес', 'Расчетный счет', 'Банк', 'БИК', 'Корр.счет', 'Директор', 'Генеральный директор', 'Руководитель'];
  function reqHash(r) { if (!r) return 'нет'; return hash(REQ_FIELDS.map(function (k) { return String(r[k] == null ? '' : r[k]).trim(); }).join('¦')); }
  function cents(x) { return Math.round(Math.abs(x) * 100); }
  function nowIso() { return new Date().toISOString(); }
  function isoDate(d) { return d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : ''; }

  // ---------- дело ----------
  function create(name) { return { v: 1, name: name || '', created: nowIso(), updated: nowIso(), docs: {}, issues: [], templates: {}, params: {} }; }
  function normalize(c) {
    c = c || create();
    c.docs = c.docs || {}; c.issues = c.issues || []; c.templates = c.templates || {}; c.params = c.params || {};
    return c;
  }
  function recs(c) { return Object.keys(c.docs).map(function (k) { return c.docs[k]; }); }
  function isActive(rec) { return rec && rec.status !== VOID; }

  // наибольший занятый номер по каждому «префикс + вид» — включая аннулированные: номера не переиспользуются
  function floors(c) {
    var f = {};
    recs(c).forEach(function (r) {
      var m = /^(.*?-)?(З|Ц|П)-(\d+)$/.exec(r.num || ''); if (!m) return;
      var k = (m[1] || '') + m[2]; f[k] = Math.max(f[k] || 0, +m[3]);
    });
    return f;
  }
  /* Порядок обработки организаций пакета. Документ между двумя организациями пакета формируется «с точки зрения» той, что обработана первой
     (счета и формулировки берутся из ее книги), поэтому порядок запоминается в деле и не зависит от перестановок на экране. */
  function orderOrgs(c, inns) {
    var ord = (c.params && c.params.orgOrder) || [], pos = function (i) { var k = ord.indexOf(i); return k < 0 ? 1e6 : k; };
    return inns.map(function (i, k) { return [i, k]; }).sort(function (a, b) { return (pos(a[0]) - pos(b[0])) || (a[1] - b[1]); }).map(function (x) { return x[0]; });
  }
  // то, что передается в движок (opts.stable): ключ операции → номер для активных документов
  function stable(c) {
    var map = {};
    recs(c).forEach(function (r) { if (isActive(r)) map[r.key] = r.num; });
    return { map: map, floor: floors(c) };
  }
  function summary(c) {
    var s = { total: 0 }; STATUSES.forEach(function (x) { s[x] = 0; });
    recs(c).forEach(function (r) { s.total++; s[r.status] = (s[r.status] || 0) + 1; });
    return s;
  }

  // ---------- операции из результатов движка ----------
  var TITLES = {
    'зачет': 'Соглашение о зачете', 'уступка-кз': 'Уступка: кредитор → Консолидатору', 'уступка-дз': 'Уступка дебиторки → Консолидатору',
    'зц': 'Зачет цены уступок', 'внеш-зачет': 'Зачет с внешним', 'внеш-уступка': 'Уступка внешней дебиторки + уведомление', 'внеш-перевод': 'Перевод внешнего долга'
  };
  function itemsSnap(items) {
    return (items || []).map(function (i) { return [String(i.acc), i.kind && i.kind.code || '', cents(i.amount), (i.contracts || []).join('; ')]; });
  }
  function itemsLabel(items) {
    return (items || []).map(function (i) { return i.acc + ' ' + (i.kind && i.kind.label || '') + ': ' + money(Math.abs(i.amount)); });
  }
  function party(role, inn, name, req) { return { role: role, inn: inn || '', name: name || '', reqFp: reqHash(req) }; }

  /* ctx: { group: [результаты Engine2.runGroup], exts: [{org:{inn,name}, data, pl, opts}], tplHash: {kind: hash}, orgInns: [ИНН организаций пакета] }
     → массив операций (то, что ДОЛЖНО быть выпущено по текущим данным) */
  function collect(ctx) {
    var ops = [], th = ctx.tplHash || {};
    var tplFp = function (kinds) { return kinds.map(function (k) { return k + ':' + (th[k] || 'встроенный'); }).join(','); };
    var scope = { 'ВГО': {}, 'Внешние': {} };
    var ctxHas = function (c, inn) { return (c.orgInns || []).indexOf(inn) >= 0; };
    (ctx.group || []).forEach(function (r) {
      var org = r.data.org, oinn = org.inn, orgReq = r.data.orgReq, cess = r.opts.cessionary, cessInn = cess ? cess['ИНН'] : '';
      var pay = r.opts.payDate ? dateShort(r.opts.payDate) : '';
      scope['ВГО'][oinn] = 1;
      var base = function (o) { o.family = 'ВГО'; o.orgInn = oinn; o.orgName = org.name; o.orgs = [oinn]; return o; };
      r.pl.zachety.forEach(function (z) {
        if (z.external) return;
        var cp = z.cp;
        var o = base({
          key: z.key, num: z.num, type: 'зачет', kinds: ['zachet'], title: TITLES['зачет'], amount: r2(z.amount), price: null,
          parties: [party('Сторона 1', oinn, org.name, orgReq), party('Сторона 2', cp.inn, cp.name, cp.org)], counterparty: cp.name, counterpartyInn: cp.inn,
          snap: { amount: cents(z.amount), claims: [itemsSnap(z.orgClaims), itemsSnap(z.cpClaims)], adv: !!z.adv },
          detail: [].concat(itemsLabel(z.orgClaims).map(function (t) { return 'требование организации: ' + t; }), itemsLabel(z.cpClaims).map(function (t) { return 'долг организации: ' + t; }))
        });
        if (ctxHas(ctx, cp.inn)) o.orgs.push(cp.inn);
        ops.push(o);
      });
      r.pl.cessions.forEach(function (x) {
        if (x.external) return;
        var cp = x.cp, kz = x.dir === 'КЗ';
        var offZc = x.dir === 'ДЗ' ? (r.opts.payDzByOffset ? r.pl.zcNum : '') : (r.opts.offsetCedents && r.opts.offsetCedents[cp.inn] || '');
        var cedent = kz ? party('Цедент', cp.inn, cp.name, cp.org) : party('Цедент', oinn, org.name, orgReq);
        var debtor = kz ? party('Должник', oinn, org.name, orgReq) : party('Должник', cp.inn, cp.name, cp.org);
        var o = base({
          key: x.key, num: x.num, type: kz ? 'уступка-кз' : 'уступка-дз', kinds: ['cession'], title: TITLES[kz ? 'уступка-кз' : 'уступка-дз'],
          amount: r2(x.nominal), price: r2(x.price),
          parties: [cedent, party('Цессионарий', cessInn, cess ? cess['Полное наименование'] : '', cess), debtor], counterparty: cp.name, counterpartyInn: cp.inn,
          snap: { amount: cents(x.nominal), price: cents(x.price), pct: x.pct, pay: offZc ? 'зачет ' + offZc : 'деньги', items: itemsSnap(x.items) },
          payText: offZc ? 'зачетом по ' + offZc : 'деньгами' + (pay ? ' до ' + pay : ''),
          detail: itemsLabel(x.items)
        });
        if (ctxHas(ctx, cp.inn)) o.orgs.push(cp.inn);
        ops.push(o);
      });
      if (r.opts.payDzByOffset && r.pl.zc > 0.004) {
        var kzNums = r.pl.cessions.filter(function (x) { return x.dir === 'КЗ'; }).map(function (x) { return x.num; });
        var dzNums = r.pl.cessions.filter(function (x) { return x.dir === 'ДЗ'; }).map(function (x) { return x.num; });
        ops.push(base({
          key: r.pl.zcKey, num: r.pl.zcNum, type: 'зц', kinds: ['zachet'], title: TITLES['зц'], amount: r2(r.pl.zc), price: null,
          parties: [party('Сторона 1', cessInn, cess ? cess['Полное наименование'] : '', cess), party('Сторона 2', oinn, org.name, orgReq)],
          counterparty: cess ? cess['Полное наименование'] : '', counterpartyInn: cessInn,
          snap: { amount: cents(r.pl.zc), own: [cents(r.pl.own.kz), cents(r.pl.own.dz)], kz: cents(r.pl.kzNominal), dzPrice: cents(r.pl.dzPrice), kzNums: kzNums, dzNums: dzNums },
          detail: ['зачет цены уступленной дебиторки (' + (dzNums.join(', ') || '—') + ') против долга перед Консолидатором']
        }));
      }
    });
    (ctx.exts || []).forEach(function (e) {
      var oinn = e.org.inn, orgReq = e.data.orgReq, rcp = e.opts.recipient, rinn = rcp ? rcp['ИНН'] : '', rname = rcp ? rcp['Полное наименование'] : '';
      scope['Внешние'][oinn] = 1;
      var pay = e.opts.payDate ? dateShort(e.opts.payDate) : '';
      var base = function (o) { o.family = 'Внешние'; o.orgInn = oinn; o.orgName = e.org.name; o.orgs = [oinn]; return o; };
      e.pl.zachety.forEach(function (z) {
        ops.push(base({ key: z.key, num: z.num, type: 'внеш-зачет', kinds: ['zachet'], title: TITLES['внеш-зачет'], amount: r2(z.amount), price: null,
          parties: [party('Сторона 1', oinn, e.org.name, orgReq), party('Сторона 2', z.cp.inn, z.cp.name, z.cp.org)], counterparty: z.cp.name, counterpartyInn: z.cp.inn,
          snap: { amount: cents(z.amount), claims: [itemsSnap(z.orgClaims), itemsSnap(z.cpClaims)], adv: !!z.adv },
          detail: [].concat(itemsLabel(z.orgClaims), itemsLabel(z.cpClaims)) }));
      });
      e.pl.cessions.forEach(function (x) {
        ops.push(base({ key: x.key, num: x.num, type: 'внеш-уступка', kinds: ['cessionExt', 'notice'], title: TITLES['внеш-уступка'], amount: r2(x.nominal), price: r2(x.price),
          parties: [party('Цедент', oinn, e.org.name, orgReq), party('Цессионарий', rinn, rname, rcp), party('Должник', x.cp.inn, x.cp.name, x.cp.org)], counterparty: x.cp.name, counterpartyInn: x.cp.inn,
          snap: { amount: cents(x.nominal), price: cents(x.price), pct: x.pct, pay: e.opts.payByOffset ? 'зачет' : 'деньги', items: itemsSnap(x.items), notice: x.notice },
          payText: e.opts.payByOffset ? 'зачетом' : 'деньгами' + (pay ? ' до ' + pay : ''), extraNums: [x.notice], detail: itemsLabel(x.items) }));
      });
      e.pl.transfers.forEach(function (x) {
        ops.push(base({ key: x.key, num: x.num, type: 'внеш-перевод', kinds: ['transfer'], title: TITLES['внеш-перевод'], amount: r2(x.nominal), price: r2(x.nominal),
          parties: [party('Кредитор', x.cp.inn, x.cp.name, x.cp.org), party('Первоначальный должник', oinn, e.org.name, orgReq), party('Новый должник', rinn, rname, rcp)], counterparty: x.cp.name, counterpartyInn: x.cp.inn,
          snap: { amount: cents(x.nominal), pay: e.opts.payByOffset ? 'зачет' : 'деньги', items: itemsSnap(x.items) },
          payText: e.opts.payByOffset ? 'зачетом' : 'деньгами' + (pay ? ' до ' + pay : ''), detail: itemsLabel(x.items) }));
      });
    });
    ops.forEach(function (o) {
      o.fp = hash(JSON.stringify(o.snap) + '|' + o.num);
      o.partyFp = hash(o.parties.map(function (p) { return p.role + ':' + p.inn + ':' + p.reqFp; }).join('|'));
      o.tplFp = tplFp(o.kinds);
    });
    return { ops: ops, scope: scope };
  }

  // ---------- причины изменений ----------
  function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function itemsDiff(oldI, newI) {
    var out = [], m = function (arr) { var o = {}; (arr || []).forEach(function (i) { var k = i[0] + '·' + i[1]; o[k] = (o[k] || 0) + i[2]; }); return o; };
    var a = m(oldI), b = m(newI), lab = function (k) { return 'сч. ' + k.split('·')[0]; };
    Object.keys(b).forEach(function (k) { if (!(k in a)) out.push(lab(k) + ': новая позиция ' + money(b[k] / 100)); else if (a[k] !== b[k]) out.push(lab(k) + ': ' + money(a[k] / 100) + ' → ' + money(b[k] / 100)); });
    Object.keys(a).forEach(function (k) { if (!(k in b)) out.push(lab(k) + ': позиции больше нет (было ' + money(a[k] / 100) + ')'); });
    return out;
  }
  function reasons(rec, op) {
    var r = [], o = rec.snap || {}, n = op.snap;
    if (o.amount !== n.amount) r.push('сумма ' + money(o.amount / 100) + ' → ' + money(n.amount / 100) + ' (' + (n.amount >= o.amount ? '+' : '−') + money(Math.abs(n.amount - o.amount) / 100) + ')');
    if (o.price != null && n.price != null && o.price !== n.price) r.push('цена ' + money(o.price / 100) + ' → ' + money(n.price / 100));
    if (o.pay !== n.pay && (o.pay || n.pay)) r.push('порядок расчетов: ' + (o.pay || '—') + ' → ' + (n.pay || '—'));
    if (o.items || n.items) { var d = itemsDiff(o.items, n.items); if (d.length) r.push('состав: ' + d.join('; ')); else if (!sameJson(o.items, n.items)) r.push('изменились договоры-основания или структура требований'); }
    if (o.claims || n.claims) {
      var d1 = itemsDiff(o.claims && o.claims[0], n.claims && n.claims[0]), d2 = itemsDiff(o.claims && o.claims[1], n.claims && n.claims[1]);
      if (d1.length) r.push('требования организации: ' + d1.join('; ')); if (d2.length) r.push('долги организации: ' + d2.join('; '));
      if (!d1.length && !d2.length && !sameJson(o.claims, n.claims)) r.push('изменились договоры-основания');
    }
    if (o.kzNums && !sameJson(o.kzNums, n.kzNums)) r.push('изменился перечень уступок кредиторов: ' + (o.kzNums.join(', ') || '—') + ' → ' + (n.kzNums.join(', ') || '—'));
    if (o.dzNums && !sameJson(o.dzNums, n.dzNums)) r.push('изменился перечень уступок дебиторки: ' + (o.dzNums.join(', ') || '—') + ' → ' + (n.dzNums.join(', ') || '—'));
    if (o.own && !sameJson(o.own, n.own)) r.push('собственный долг/требование Консолидатора: ' + money(o.own[0] / 100) + '/' + money(o.own[1] / 100) + ' → ' + money(n.own[0] / 100) + '/' + money(n.own[1] / 100));
    if (!r.length) r.push('изменился состав данных');
    return r;
  }
  function partyChanges(rec, op) {
    var out = [];
    op.parties.forEach(function (p) {
      var old = (rec.parties || []).filter(function (x) { return x.role === p.role; })[0];
      if (old && old.reqFp !== p.reqFp) out.push(p.role + ' «' + p.name + '»');
    });
    return out;
  }

  // ---------- сверка ----------
  /* → { rows: [{state, op, rec, reasons, notes, id}], counts }
     state: new | same | changed | conflict | gone | goneSigned
     scope — ИНН организаций, которые сейчас считаются (документы вне области не трогаем) */
  function reconcile(c, built) {
    var ops = built.ops, scope = built.scope || {};
    var rows = [], seen = {}, counts = { new: 0, same: 0, changed: 0, conflict: 0, gone: 0, goneSigned: 0, out: 0, 'void': 0 };
    ops.forEach(function (op) {
      var rec = c.docs[op.key]; seen[op.key] = 1;
      var row = { id: op.key, op: op, rec: rec && isActive(rec) ? rec : null, reasons: [], notes: [] };
      if (!row.rec) {
        row.state = 'new';
      } else {
        var fpEq = rec.fp === op.fp, accepted = rec.accepted && rec.accepted === op.fp;
        var pch = partyChanges(rec, op), tplCh = rec.tplFp !== op.tplFp;
        if (rec.num !== op.num) row.notes.push('номер в реестре ' + rec.num + ' — в расчете получился ' + op.num);
        if (fpEq || accepted) {
          if (pch.length) { if (rec.status === SIGNED) row.notes.push('реквизиты изменились (' + pch.join(', ') + ') — на подписанный документ не влияет'); }
          if (tplCh && rec.status === SIGNED) row.notes.push('шаблон обновлен после подписания — не влияет');
          if (accepted && !fpEq) row.notes.push('расхождение с данными принято вручную');
          if ((pch.length || tplCh) && rec.status !== SIGNED && !accepted) {
            row.state = 'changed';
            if (pch.length) row.reasons.push('изменились реквизиты: ' + pch.join(', '));
            if (tplCh) row.reasons.push('обновлен шаблон документа');
          } else row.state = 'same';
        } else if (rec.status === SIGNED) {
          row.state = 'conflict'; row.reasons = reasons(rec, op);
          if (pch.length) row.reasons.push('изменились реквизиты: ' + pch.join(', '));
        } else {
          row.state = 'changed'; row.reasons = reasons(rec, op);
          if (pch.length) row.reasons.push('изменились реквизиты: ' + pch.join(', '));
          if (tplCh) row.reasons.push('обновлен шаблон документа');
        }
      }
      counts[row.state]++; rows.push(row);
    });
    recs(c).forEach(function (rec) {
      if (seen[rec.key] && isActive(rec)) return;
      // аннулированные и документы вне текущего пакета остаются в списке — реестр виден целиком
      if (!isActive(rec)) { counts['void']++; rows.push({ id: rec.key, op: null, rec: rec, state: 'void', reasons: [], notes: rec.replaces ? ['заменяет ' + rec.replaces] : [] }); return; }
      var sc = scope[rec.family] || {};
      if (!(rec.orgs || []).some(function (i) { return sc[i]; })) { counts.out++; rows.push({ id: rec.key, op: null, rec: rec, state: 'out', reasons: [], notes: ['вне текущего расчета: организация не в пакете или данные не загружены'] }); return; }
      if (rec.ackGone) { counts.same++; rows.push({ id: rec.key, op: null, rec: rec, state: 'same', reasons: [], notes: ['исчезновение из расчета признано допустимым'] }); return; }
      var st = rec.status === SIGNED ? 'goneSigned' : 'gone';
      counts[st]++;
      rows.push({ id: rec.key, op: null, rec: rec, state: st, reasons: [rec.status === SIGNED ? 'по текущим данным такого документа уже не должно быть, но он подписан' : 'по текущим данным документ больше не нужен'], notes: [] });
    });
    return { rows: rows, counts: counts };
  }

  // ---------- фиксация выпуска ----------
  function log(rec, text) { (rec.history = rec.history || []).push({ ts: nowIso(), text: text }); }
  /* issue: { rows (из reconcile), pick: {key:true} какие строки выпускаем, docDate: Date, payDate, templates: {kind:hash} } */
  function commit(c, rec0, issue) {
    var no = (c.issues.length ? c.issues[c.issues.length - 1].n : 0) + 1, made = [], nNew = 0, nCh = 0, nRe = 0;
    rec0.rows.forEach(function (row) {
      if (!issue.pick[row.id] || !row.op) return;
      var op = row.op, rec = row.rec;
      var fill = function (r) {
        r.key = op.key; r.num = op.num; r.family = op.family; r.type = op.type; r.title = op.title; r.orgInn = op.orgInn; r.orgName = op.orgName; r.orgs = op.orgs;
        r.parties = op.parties; r.counterparty = op.counterparty; r.counterpartyInn = op.counterpartyInn; r.amount = op.amount; r.price = op.price;
        r.fp = op.fp; r.partyFp = op.partyFp; r.tplFp = op.tplFp; r.snap = op.snap; r.detail = op.detail; r.payText = op.payText || ''; r.extraNums = op.extraNums || [];
        delete r.accepted;
      };
      if (!rec) {
        rec = { rev: 1, status: 'подготовлен', history: [], docDate: isoDate(issue.dateOf ? issue.dateOf(row) : issue.docDate), payDate: isoDate(issue.payDate) };
        if (c.pendingReplace && c.pendingReplace[op.key]) { rec.replaces = c.pendingReplace[op.key]; delete c.pendingReplace[op.key]; }
        fill(rec); log(rec, 'выпуск №' + no + ': документ создан (ред. 1)' + (rec.replaces ? ', заменяет ' + rec.replaces : ''));
        c.docs[op.key] = rec; nNew++;
      } else if (row.state === 'changed' || row.state === 'conflict') {
        rec.rev = (rec.rev || 1) + 1; var was = rec.status; rec.status = 'подготовлен';
        rec.docDate = isoDate(issue.dateOf ? issue.dateOf(row) : issue.docDate) || rec.docDate;
        fill(rec); log(rec, 'выпуск №' + no + ': ред. ' + rec.rev + ' (' + row.reasons.join('; ') + '); прежняя редакция была «' + was + '» — отозвать');
        nCh++;
      } else { log(rec, 'выпуск №' + no + ': ред. ' + rec.rev + ' выгружена повторно'); nRe++; }
      made.push(op.num);
    });
    c.params.orgOrder = (c.params.orgOrder || []).concat((issue.orgInns || []).filter(function (i) { return (c.params.orgOrder || []).indexOf(i) < 0; }));
    c.issues.push({ n: no, ts: nowIso(), docDate: isoDate(issue.docDate), created: nNew, reissued: nCh, repeated: nRe, nums: made });
    c.updated = nowIso();
    return no;
  }
  function setStatus(c, key, status, note) {
    var r = c.docs[key]; if (!r) return;
    if (r.status === status) return;
    log(r, 'статус: ' + r.status + ' → ' + status + (note ? ' (' + note + ')' : ''));
    r.status = status;
    if (status === 'на подписи') r.sentDate = nowIso().slice(0, 10);
    if (status === SIGNED) r.signedDate = nowIso().slice(0, 10);
    c.updated = nowIso();
  }
  function accept(c, key, fp) { var r = c.docs[key]; if (!r) return; r.accepted = fp; log(r, 'расхождение с данными принято вручную — документ остается в силе'); c.updated = nowIso(); }
  function voidDoc(c, key, note, replacing) {
    var r = c.docs[key]; if (!r) return;
    log(r, 'аннулирован' + (note ? ' (' + note + ')' : '')); r.status = VOID; r.voidDate = nowIso().slice(0, 10);
    if (replacing) { c.pendingReplace = c.pendingReplace || {}; c.pendingReplace[key] = r.num; }
    c.updated = nowIso();
  }
  function ackGone(c, key) { var r = c.docs[key]; if (!r) return; r.ackGone = true; log(r, 'исчезновение документа из расчета признано допустимым'); c.updated = nowIso(); }
  function setNote(c, key, note) { var r = c.docs[key]; if (r) { r.note = note; c.updated = nowIso(); } }

  // ---------- отчеты ----------
  function statusRu(s) { return { new: 'Новый', same: 'Без изменений', changed: 'Изменился — перевыпуск', conflict: 'Расхождение с подписанным', gone: 'Исчез — отозвать', goneSigned: 'Исчез, но подписан' }[s] || s; }
  function buildRegistryXlsx(c, reco) {
    var X = E.XLSX, wb = X.utils.book_new();
    var list = recs(c).sort(function (a, b) { return String(a.num).localeCompare(String(b.num), 'ru', { numeric: true }); });
    var a1 = [['Реестр документов' + (c.name ? ': ' + c.name : '') + ' — на ' + dateShort(new Date())], [],
      ['№', 'Вид', 'Организация', 'Контрагент', 'ИНН контрагента', 'Сумма', 'Цена', 'Ред.', 'Статус', 'Дата документа', 'Отправлен', 'Подписан', 'Заменяет', 'Примечание', 'Последнее событие']];
    list.forEach(function (r) {
      var h = (r.history || []).slice(-1)[0];
      a1.push([r.num + (r.extraNums && r.extraNums.length ? ' + ' + r.extraNums.join(', ') : ''), r.title, r.orgName, r.counterparty, r.counterpartyInn, r.amount, r.price == null ? '' : r.price, r.rev, r.status, r.docDate || '', r.sentDate || '', r.signedDate || '', r.replaces || '', r.note || '', h ? h.text : '']);
    });
    var ws1 = X.utils.aoa_to_sheet(a1);
    for (var R = 4; R <= a1.length; R++) ['F', 'G'].forEach(function (col) { var x = ws1[col + R]; if (x && x.t === 'n') x.z = '#,##0.00'; });
    ws1['!cols'] = [18, 34, 30, 34, 13, 16, 16, 5, 13, 12, 11, 11, 12, 30, 60].map(function (w) { return { wch: w }; });
    ws1['!autofilter'] = { ref: 'A3:O' + a1.length };
    X.utils.book_append_sheet(wb, ws1, 'Реестр');
    // по контрагентам: что у кого на подписи
    var by = {};
    list.filter(isActive).forEach(function (r) { var k = r.counterpartyInn + '|' + r.counterparty; (by[k] = by[k] || []).push(r); });
    var a2 = [['Что у кого на подписи — по контрагентам'], [], ['Контрагент', 'ИНН', 'Документов', 'Подписано', 'На подписи', 'Подготовлено', 'Номера (статус)']];
    Object.keys(by).sort().forEach(function (k) {
      var l = by[k], n = function (s) { return l.filter(function (r) { return r.status === s; }).length; };
      a2.push([l[0].counterparty, l[0].counterpartyInn, l.length, n(SIGNED), n('на подписи'), n('подготовлен'), l.map(function (r) { return r.num + ' (' + r.status + ')'; }).join('; ')]);
    });
    var ws2 = X.utils.aoa_to_sheet(a2); ws2['!cols'] = [40, 13, 10, 10, 11, 12, 90].map(function (w) { return { wch: w }; });
    X.utils.book_append_sheet(wb, ws2, 'По контрагентам');
    if (reco) {
      var a3 = [['Сверка расчета с реестром'], [], ['Статус сверки', '№', 'Документ', 'Контрагент', 'Сумма сейчас', 'Сумма в реестре', 'Что изменилось']];
      reco.rows.forEach(function (w) {
        var src = w.op || w.rec;
        a3.push([statusRu(w.state), src.num, src.title, src.counterparty, w.op ? w.op.amount : '', w.rec ? w.rec.amount : '', w.reasons.concat(w.notes).join(' | ')]);
      });
      var ws3 = X.utils.aoa_to_sheet(a3); ws3['!cols'] = [26, 16, 34, 36, 16, 16, 100].map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, ws3, 'Сверка');
    }
    var a4 = [['Журнал выпусков'], [], ['Выпуск №', 'Когда', 'Дата документов', 'Новых', 'Перевыпущено', 'Повторно', 'Номера']];
    c.issues.forEach(function (i) { a4.push([i.n, i.ts.replace('T', ' ').slice(0, 16), i.docDate, i.created, i.reissued, i.repeated, i.nums.join(', ')]); });
    var ws4 = X.utils.aoa_to_sheet(a4); ws4['!cols'] = [9, 17, 14, 8, 13, 10, 100].map(function (w) { return { wch: w }; });
    X.utils.book_append_sheet(wb, ws4, 'Выпуски');
    return X.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  var api = { isoDate: isoDate, orderOrgs: orderOrgs, STATUSES: STATUSES, create: create, normalize: normalize, recs: recs, isActive: isActive, floors: floors, stable: stable, summary: summary, collect: collect,
    reconcile: reconcile, commit: commit, setStatus: setStatus, accept: accept, voidDoc: voidDoc, ackGone: ackGone, setNote: setNote, buildRegistryXlsx: buildRegistryXlsx, statusRu: statusRu, hash: hash, reqHash: reqHash };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Case = api;
})(typeof window !== 'undefined' ? window : globalThis);
