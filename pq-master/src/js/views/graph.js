/* =====================================================================
   views/graph.js — граф зависимостей запросов (SVG, послойная раскладка)
   и параметризатор (вынос захардкоженных источников в параметры).
   ===================================================================== */
function displayQName(n){ return $('#graphAnon').checked ? anonQueryName(n) : n; }
function graphSvg(A, opts){
  opts = opts || {};
  const ms = A.members; const layer = new Map(); const visiting = new Set();
  const L = m => { if (layer.has(m.name)) return layer.get(m.name); if (visiting.has(m.name)) return 0; visiting.add(m.name); let l = 0; for (const r of m.refs){ const x = A.byName.get(r); if (x) l = Math.max(l, L(x) + 1); } visiting.delete(m.name); layer.set(m.name, l); return l; };
  ms.forEach(L);
  const layers = []; for (const m of ms){ const l = layer.get(m.name); (layers[l] = layers[l] || []).push(m); }
  for (let i = 0; i < layers.length; i++) layers[i] = layers[i] || [];
  const posY = new Map(); layers.forEach(ly => ly.forEach((m, i) => posY.set(m.name, i)));
  for (let it = 0; it < 4; it++) for (let li = 1; li < layers.length; li++){
    const bc = m => { const r = [...m.refs].filter(x => posY.has(x)); return r.length ? r.reduce((s, x) => s + posY.get(x), 0) / r.length : posY.get(m.name); };
    layers[li].sort((a, b) => bc(a) - bc(b)); layers[li].forEach((m, i) => posY.set(m.name, i));
  }
  const W = 190, H = 38, GX = 80, GY = 14, P = 16;
  const maxN = Math.max(1, ...layers.map(l => l.length));
  const width = P * 2 + layers.length * W + Math.max(0, layers.length - 1) * GX, height = P * 2 + maxN * (H + GY);
  const xy = new Map();
  layers.forEach((ly, li) => { const off = (maxN - ly.length) * (H + GY) / 2; ly.forEach((m, i) => xy.set(m.name, { x: P + li * (W + GX), y: P + off + i * (H + GY) })); });
  const lintQ = new Set((opts.lint || []).filter(l => l.sev === 'err' || l.sev === 'warn').map(l => l.query));
  const nm = opts.name || (n => n);
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8a93a5"/></marker></defs>';
  for (const m of ms) for (const r of m.refs){
    const a = xy.get(r), b = xy.get(m.name); if (!a || !b) continue;
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
    svg += '<path class="gedge" data-from="' + escHtml(r) + '" data-to="' + escHtml(m.name) + '" d="M' + x1 + ',' + y1 + ' C' + (x1 + GX / 2) + ',' + y1 + ' ' + (x2 - GX / 2) + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="url(#arr)"/>';
  }
  for (const m of ms){
    const p = xy.get(m.name); const cls = ['gnode', m.hasSource ? 'src' : '', m.isParam ? 'param' : '', m.isFn ? 'fn' : '', (m.load.sheet || m.load.model) ? 'load' : '', lintQ.has(m.name) ? 'warnf' : '', m.name === opts.sel ? 'sel' : ''].join(' ');
    const label = nm(m.name); const short = label.length > 26 ? label.slice(0, 25) + '…' : label;
    const sub = (m.isParam ? 'параметр' : m.isFn ? 'функция' : m.sources.length ? [...new Set(m.sources)][0] : (m.steps ? m.steps.steps.length + ' шаг.' : '')) + (m.load.rows != null ? ' · ' + m.load.rows + ' стр.' : '');
    svg += '<g class="' + cls + '" data-q="' + escHtml(m.name) + '"><title>' + escHtml(label) + '</title><rect x="' + p.x + '" y="' + p.y + '" width="' + W + '" height="' + H + '" rx="7"/><text x="' + (p.x + 9) + '" y="' + (p.y + 16) + '">' + escHtml(short) + '</text><text x="' + (p.x + 9) + '" y="' + (p.y + 31) + '" style="font-size:10.5px;fill:var(--muted)">' + escHtml(sub) + '</text></g>';
  }
  return svg + '</svg>';
}
function renderGraph(){
  if (!S.A) return;
  $('#graphBox').innerHTML = S.A.members.length ? graphSvg(S.A, { lint: S.lint, sel: S.sel, name: displayQName }) : '<div class="muted" style="padding:14px">Нет запросов</div>';
  $$('.gnode', $('#graphBox')).forEach(g => {
    g.onclick = () => openInEditor(g.dataset.q);
    g.onmouseenter = () => $$('.gedge', $('#graphBox')).forEach(e => e.classList.toggle('hi', e.dataset.from === g.dataset.q || e.dataset.to === g.dataset.q));
    g.onmouseleave = () => $$('.gedge.hi', $('#graphBox')).forEach(e => e.classList.remove('hi'));
  });
  renderParams();
}
$('#graphAnon').addEventListener('change', renderGraph);
const GRAPH_EXPORT_CSS = '<style>text{font:12px sans-serif;fill:#1d2330}.gnode rect{fill:#fff;stroke:#c9ced8}.gnode.src rect{fill:#e1f4e9}.gnode.param rect{fill:#e3ecfc}.gnode.load rect{stroke:#2f6fde;stroke-width:2}.gnode.warnf rect{stroke:#b26a00;stroke-width:2}.gnode.fn rect{stroke-dasharray:4 3}.gedge{fill:none;stroke:#8a93a5}</style>';
$('#graphSvgBtn').onclick = async () => {
  const svg = $('#graphBox svg'); if (!svg) return;
  const txt = svg.outerHTML.replace('<defs>', GRAPH_EXPORT_CSS + '<defs>');
  if (!$('#graphAnon').checked){ const r = await modal('<h2>Граф с реальными именами</h2><p>В графе реальные имена запросов. Если файл пойдёт наружу, включите «обезличенные имена».</p>', [['cancel', 'Отмена'], ['go', 'Скачать для себя', 'pri']]); if (r === 'go') download('pq-граф.svg', txt, 'image/svg+xml'); return; }
  if (await gate(txt.replace(/<[^>]+>/g, ' '), 'Граф SVG')){ download('pq-граф_' + stamp() + '.svg', txt, 'image/svg+xml'); audit('скачивание', 'граф.svg', txt); }
};
function renderParams(){
  const cand = paramCandidates(S.A);
  const groups = new Map();
  for (const c of cand){ const g = groups.get(c.value) || { value: c.value, role: c.role, fns: new Set(), qs: new Set() }; g.fns.add(c.fn); g.qs.add(c.member); groups.set(c.value, g); }
  if (!groups.size){ $('#paramBox').innerHTML = '<div class="note ok small">Захардкоженных значений источников не найдено — всё уже в параметрах или источники внутри книги.</div>'; return; }
  const used = new Set(S.A.members.map(m => m.name));
  let h = '<table class="t"><tr><th></th><th>Значение</th><th>Тип</th><th>Где</th><th>Имя параметра</th></tr>'; let i = 0;
  for (const g of groups.values()){ h += '<tr><td><input type="checkbox" data-pi="' + i + '" checked></td><td class="mono small">' + escHtml(g.value) + '</td><td>' + ({ SRV: 'сервер', DB: 'база', URL: 'URL', PATH: 'путь' }[g.role] || g.role) + '</td><td class="small">' + [...g.fns].join(', ') + '<br><span class="muted">' + [...g.qs].map(escHtml).join(', ') + '</span></td><td><input type="text" data-pn="' + i + '" value="' + escHtml(suggestParamName(g.role, g.value, used)) + '"></td></tr>'; i++; }
  h += '</table><div class="row"><button class="btn pri" id="applyParams">Вынести отмеченные в параметры</button><span class="small muted">Изменения попадут в рабочую версию — их видно в «Истории», отменить можно кнопкой ↶.</span></div>';
  $('#paramBox').innerHTML = h;
  const vals = [...groups.values()];
  $('#applyParams').onclick = () => {
    const picks = []; const names = new Set(S.A.members.map(m => m.name));
    for (let k = 0; k < vals.length; k++){
      if (!$('[data-pi="' + k + '"]').checked) continue;
      const nm = $('[data-pn="' + k + '"]').value.trim();
      if (!nm) return toast('Пустое имя параметра', 'warn');
      if (names.has(nm)) return toast('Имя «' + nm + '» уже занято другим запросом', 'warn');
      names.add(nm); picks.push({ value: vals[k].value, name: nm });
    }
    if (!picks.length) return toast('Ничего не отмечено', 'warn');
    setWork(applyParameterize(S.work, S.A, picks), 'param', 'Параметры: ' + picks.map(p => p.name).join(', '));
    toast('Создано параметров: ' + picks.length, 'ok');
  };
}
registerView('graph', { render: renderGraph });
