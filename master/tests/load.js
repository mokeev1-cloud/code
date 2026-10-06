/* Загрузка модулей движка в Node: исходники лежат под короткими именами, внутри они зовут друг друга по прежним (engine_v2.js …) —
   поэтому копируем во временную папку под нужными именами. */
const fs = require('fs'), path = require('path'), os = require('os');
const SRC = path.join(__dirname, '..', 'src');
const MAP = { 'engine/core.js': 'engine.js', 'engine/tpl.js': 'engine_tpl.js', 'engine/cess.js': 'engine_v2.js', 'engine/acc.js': 'engine_acc.js', 'engine/liq.js': 'engine_liq.js',
  'engine/ext.js': 'engine_ext.js', 'engine/test.js': 'engine_test.js', 'case.js': 'case.js', 'lib/lib-xlsx.js': 'xlsx.js', 'lib/lib-jszip.js': 'jszip.js', 'lib/lib-petrovich.js': 'petro.js' };
module.exports = function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'master-'));
  Object.keys(MAP).forEach(k => fs.copyFileSync(path.join(SRC, k), path.join(dir, MAP[k])));
  const r = n => require(path.join(dir, n));
  const E = r('engine.js');
  E.libs({ XLSX: r('xlsx.js'), JSZip: r('jszip.js'), petrovich: r('petro.js') });
  return { E, TPL: r('engine_tpl.js'), V: r('engine_v2.js'), A: r('engine_acc.js'), L: r('engine_liq.js'), X: r('engine_ext.js'), T: r('engine_test.js'), C: r('case.js') };
};
