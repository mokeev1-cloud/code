import { createDuckDB, VoidLogger, DEFAULT_RUNTIME, PACKAGE_VERSION } from '@duckdb/duckdb-wasm/dist/duckdb-browser-blocking.mjs';
import { makeData, makeVector, Table, Utf8, Float64, Bool } from 'apache-arrow';
window.PQM_DUCKDB = { createDuckDB, VoidLogger, DEFAULT_RUNTIME, PACKAGE_VERSION, arrow: { makeData, makeVector, Table, Utf8, Float64, Bool } };
