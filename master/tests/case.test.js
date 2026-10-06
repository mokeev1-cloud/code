const load = require('./load'); const m = load(); const { E, V, X, T, C } = m;
let fails = 0; const ok = (n, c, i) => { console.log((c ? 'OK   ' : 'FAIL ') + n + (i ? '  — ' + i : '')); if (!c) fails++; };
const INN = { A: '1000000001', B: '1000000002', G: '1000000003', D: '1000000004', K: '1000000009' };

function run(d, c, order0, over) {
  const order = C.orderOrgs(c, order0);
  const base = Object.assign({ statuses: { 'транзит': 1, 'обнуляем': 1, 'обнуляем приоритет': 1 }, cessionary: d.req.byInn[INN.K], date: new Date(2030, 2, 31), payDate: new Date(2030, 4, 31), payDzByOffset: true, stable: C.stable(c) }, over || {});
  const group = V.runGroup(d.merged, d.req, d.reg, base, order.map(i => ({ inn: i, prefix: i === INN.A ? 'А' : 'Б' })));
  const exts = group.map(r => {
    const xo = { orgInn: r.opts.orgInn, recipient: d.req.byInn[INN.K], date: base.date, payDate: base.payDate, threshold: 1, payByOffset: false, prefix: 'В' + (r.opts.orgInn === INN.A ? 'А' : 'Б'), stable: C.stable(c) };
    const data = X.prepare(d.merged, d.req, d.reg, xo); return { org: r.data.org, data, pl: X.plan(data, xo), opts: xo };
  });
  const built = C.collect({ group, exts, orgInns: order });
  return { group, exts, built, order, reco: C.reconcile(c, built) };
}
function issueAll(c, r, date) { const pick = {}; r.reco.rows.forEach(w => { if (w.op && (w.state === 'new' || w.state === 'changed' || w.state === 'conflict')) pick[w.id] = true; }); return C.commit(c, r.reco, { pick, docDate: date || new Date(2030, 2, 31), orgInns: r.order }); }
const numOf = (r, key) => (r.built.ops.filter(o => o.key === key)[0] || {}).num;

// --- выпуск 1: все новые
let d = T.dataset(), c = C.create('тест');
let r1 = run(d, c, [INN.A, INN.B]);
ok('выпуск 1: все операции новые', r1.reco.rows.length > 0 && r1.reco.rows.every(w => w.state === 'new'), r1.reco.rows.map(w => w.op.num).join(' '));
const nums1 = {}; r1.built.ops.forEach(o => nums1[o.key] = o.num);
issueAll(c, r1);
ok('в реестре столько же документов, сколько операций', C.recs(c).length === r1.built.ops.length, C.recs(c).length);
// ключи внутригрупповых операций не зависят от порядка организаций
let rs = run(d, c, [INN.B, INN.A]);
const keysA = r1.built.ops.map(o => o.key).sort().join(), keysB = rs.built.ops.map(o => o.key).sort().join();
ok('порядок организаций в пакете не меняет ключи и номера', keysA === keysB && rs.built.ops.every(o => nums1[o.key] === o.num), keysA === keysB ? '' : keysA + ' | ' + keysB);
ok('повторный расчет на тех же данных: всё «без изменений»', rs.reco.rows.every(w => w.state === 'same'), JSON.stringify(rs.reco.counts) + ' ' + rs.reco.rows.filter(w => w.state !== 'same').map(w => w.op.num + ': ' + w.reasons.join('/')).join('; '));

// --- подписываем часть документов
const ops = r1.built.ops; const signedKey = ops.filter(o => o.family === 'ВГО' && o.type === 'уступка-кз')[0].key, sentKey = ops.filter(o => o.type === 'зачет')[0].key;
C.setStatus(c, signedKey, 'на подписи'); C.setStatus(c, signedKey, 'подписан'); C.setStatus(c, sentKey, 'на подписи');

// --- данные изменились: у Контрагента Г (D) долг вырос, у В (G) дебиторка выросла; новый контрагент в реестре не появился
const d2 = T.dataset();
d2.merged.byInn[INN.A].cps.forEach(cp => { if (cp.inn === INN.D) { cp.acc['60'] = -260; cp.det['60'][3] = -260; } if (cp.inn === INN.G) { cp.acc['62'] = 400; cp.det['62'][3] = 400; } });
let r2 = run(d2, c, [INN.A, INN.B]);
const st = {}; r2.reco.rows.forEach(w => st[w.id] = w);
ok('номера уже выпущенных операций не изменились', r2.built.ops.every(o => nums1[o.key] === undefined || nums1[o.key] === o.num));
const chG = r2.reco.rows.filter(w => w.op && w.op.counterpartyInn === INN.G && w.op.type !== 'зц');
ok('изменение суммы по контрагенту В обнаружено', chG.some(w => w.state === 'changed' || w.state === 'conflict'), chG.map(w => w.op.num + ':' + w.state + ' ' + w.reasons.join('/')).join(' ; '));
const dRows = r2.reco.rows.filter(w => w.op && w.op.counterpartyInn === INN.D);
ok('подписанная уступка с изменением суммы — расхождение с подписанным (conflict)', dRows.some(w => w.state === 'conflict' && w.rec.status === 'подписан'), dRows.map(w => w.op.num + ':' + w.state).join(' '));
ok('причина изменения читается человеком', dRows.some(w => /сумма .* → /.test(w.reasons.join())), dRows.map(w => w.reasons.join(' | ')).join(' ## '));
ok('ЗЦ при изменении цены/долга помечен как изменившийся', r2.reco.rows.some(w => w.op && w.op.type === 'зц' && w.state === 'changed'), r2.reco.rows.filter(w => w.op && w.op.type === 'зц').map(w => w.op.num + ':' + w.state).join(' '));
ok('без лишних срабатываний: операции без изменений данных остаются «без изменений»', r2.reco.rows.filter(w => w.op && w.op.family === 'Внешние' && w.state === 'same').length >= 1);

// --- перевыпуск неподписанных: номер тот же, редакция +1
const chKeys = r2.reco.rows.filter(w => w.state === 'changed').map(w => w.id), numsBefore = chKeys.map(k => c.docs[k].num);
issueAll(c, r2);
ok('перевыпуск: номер сохранен, редакция выросла', chKeys.every((k, i) => c.docs[k].num === numsBefore[i] && c.docs[k].rev === 2), chKeys.map(k => c.docs[k].num + ' р' + c.docs[k].rev).join(', '));
ok('после перевыпуска статус сброшен в «подготовлен» и записан в историю', chKeys.every(k => c.docs[k].status === 'подготовлен' && /ред\. 2/.test(c.docs[k].history.slice(-1)[0].text)));

// --- принять расхождение с подписанным: документ остается в силе, повтор не беспокоит
const cfl = r2.reco.rows.filter(w => w.state === 'conflict'); cfl.forEach(w => C.accept(c, w.id, w.op.fp));
let r3 = run(d2, c, [INN.A, INN.B]);
ok('принятое расхождение перестает показываться как конфликт', r3.reco.rows.filter(w => w.state === 'conflict').length === 0 && r3.reco.rows.filter(w => w.rec && w.rec.accepted).length >= 1);

// --- аннулировать подписанный и выпустить заново: старый номер не переиспользуется, новый — следующий
if (cfl.length) {
  const k = cfl[0].id, old = c.docs[k].num; const fl0 = C.floors(c);
  C.voidDoc(c, k, 'заменяем', true);
  let r4 = run(d2, c, [INN.A, INN.B]); const nw = r4.built.ops.filter(o => o.key === k)[0];
  ok('после аннулирования операция получает НОВЫЙ номер (старый не переиспользуется)', nw && nw.num !== old, old + ' → ' + (nw && nw.num));
  const mm = /^(.*?-)?(З|Ц)-(\d+)$/.exec(nw.num), pf = (mm[1] || '') + mm[2];
  ok('новый номер = максимум + 1', +mm[3] === (fl0[pf] || 0) + 1, nw.num + ' при floor ' + fl0[pf]);
  issueAll(c, r4); ok('в новой записи указано, что она заменяет прежний номер', c.docs[k].replaces === old, c.docs[k].replaces);
}
// --- исчезновение документа
const d3 = T.dataset(); d3.merged.byInn[INN.A].cps = d3.merged.byInn[INN.A].cps.filter(cp => cp.inn !== INN.G);
let r5 = run(d3, c, [INN.A, INN.B]);
ok('исчезнувший документ обнаружен (gone / goneSigned)', r5.reco.rows.some(w => w.state === 'gone' || w.state === 'goneSigned'), JSON.stringify(r5.reco.counts));
// --- реестр xlsx и сериализация
const xl = C.buildRegistryXlsx(c, r5.reco); ok('реестр Excel собирается', xl && (xl.byteLength || xl.length) > 1000, xl.byteLength || xl.length);
const back = JSON.parse(JSON.stringify(c)); ok('дело сериализуется без потерь', JSON.stringify(C.stable(back)) === JSON.stringify(C.stable(c)));
console.log(fails ? '\nПРОВАЛОВ: ' + fails : '\nвсе проверки дела пройдены'); process.exit(fails ? 1 : 0);
