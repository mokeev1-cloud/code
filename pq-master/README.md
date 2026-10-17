# Мастер PQ — исходники

Готовый инструмент — один файл **`../pq-master.html`**: откройте его в браузере (лучше Chrome или Edge).
Здесь лежат модули, из которых он собирается.

- `src/` — модули (HTML-разметка разделов, CSS, JS по слоям: `core`, `m`, `nda`, `opt`, `app`, `views`).
- `vendor/` — встроенный CodeMirror 6 (MIT), собранный один раз (`codemirror.entry.js` — точка входа сборки).
- `build.mjs` — сборщик без зависимостей: `node build.mjs [--check]`, разрезка: `node build.mjs --split ФАЙЛ ПАПКА`.
- `test/e2e.mjs` — сквозной прогон в headless-браузере (нужен `playwright-core`).
- `DEV.md` — документация для разработчика: карта модулей, инварианты приватности, рецепты. Она же встроена в HTML
  (раздел «Справка → Для разработчика»).

Пересборка CodeMirror (нужна только при обновлении версии):

```
npm i @codemirror/state@6 @codemirror/view@6 @codemirror/language@6 @codemirror/commands@6 \
      @codemirror/autocomplete@6 @codemirror/search@6 @codemirror/lint@6 @lezer/highlight@1 esbuild
npx esbuild vendor/codemirror.entry.js --bundle --format=iife --minify --target=es2019 \
      --legal-comments=none --outfile=vendor/codemirror.bundle.js
```
