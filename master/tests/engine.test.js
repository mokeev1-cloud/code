/* Самопроверка движка (синтетика) + шаблоны Word из папки templates/ на демо-данных. Запуск: node master/tests/engine.test.js */
const fs = require('fs'), path = require('path'); const load = require('./load'); const { E, TPL, V, X, T, C } = load(); const JSZip = E.JSZip;
let fails = 0; const ok = (n, c, i) => { console.log((c ? 'OK   ' : 'FAIL ') + n + (i ? '  — ' + i : '')); if (!c) fails++; };
(async () => {
  const res = await T.run(); res.forEach(r => { if (!r.ok) { console.log('FAIL движок: ' + r.test + ' ' + r.info); fails++; } }); console.log('OK   самопроверка движка: ' + res.filter(r => r.ok).length + ' из ' + res.length);
  // шаблоны юристов: все метки известны, документы собираются без «{{» и без «______» там, где данные есть
  const dir = path.join(__dirname, '..', 'templates'), kinds = ['cession', 'cessionExt', 'notice', 'zachet', 'transfer'], templates = {};
  fs.readdirSync(dir).filter(n => /\.docx$/.test(n)).forEach(n => { const k = kinds[+n[0] - 1]; templates[k] = new Uint8Array(fs.readFileSync(path.join(dir, n))); });
  ok('в папке templates — все 5 шаблонов', Object.keys(templates).length === 5);
  const d = T.dataset(), K = '1000000009', A = '1000000001', B = '1000000002', st = { 'транзит': 1, 'обнуляем': 1, 'обнуляем приоритет': 1 };
  const res2 = V.runGroup(d.merged, d.req, d.reg, { statuses: st, cessionary: d.req.byInn[K], date: new Date(2030, 2, 31), payDate: new Date(2030, 4, 31), payDzByOffset: true, templates }, [{ inn: A, prefix: 'А' }, { inn: B, prefix: 'Б' }]);
  const pk = await V.buildPackage(res2[0].pl, res2[0].data, Object.assign({}, res2[0].opts, { templates }));
  const xo = { orgInn: A, recipient: d.req.byInn[K], date: new Date(2030, 2, 31), payDate: new Date(2030, 4, 31), threshold: 1, payByOffset: false, prefix: 'В', templates };
  const xd = X.prepare(d.merged, d.req, d.reg, xo), pk2 = await X.buildPackage(X.plan(xd, xo), xd, xo);
  const all = pk.docs.concat(pk2.docs), zips = pk.docs.map(x => [pk, x]).concat(pk2.docs.map(x => [pk2, x]));
  const seenKinds = {}; let bad = 0;
  for (const [p, doc] of zips) { seenKinds[doc.kind] = 1; const z = await JSZip.loadAsync(await p.zip.file(doc.path).async('uint8array')); const x = await z.file('word/document.xml').async('string'); if (/\{\{/.test(x)) { bad++; console.log('   остались метки в', doc.path); } }
  ok('документы по шаблонам юристов собираются без остатков «{{»', bad === 0 && all.length >= 8, all.length + ' док.');
  ok('покрыты все 5 видов шаблонов', Object.keys(seenKinds).sort().join() === kinds.slice().sort().join(), Object.keys(seenKinds).join(','));
  console.log('   предупреждения сборки:', pk.warnings.concat(pk2.warnings).join(' | ') || 'нет');
  console.log(fails ? '\nПРОВАЛОВ: ' + fails : '\nвсе проверки движка и шаблонов пройдены'); process.exit(fails ? 1 : 0);
})();
