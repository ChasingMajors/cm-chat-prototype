import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Layer A regression guard for the PRV 404 fix: a product with NO Print Run Vault
// data must degrade to a clean empty result ([]) with no console.warn and no Apps
// Script (VAULT_EXEC_URL) fallback, while genuine failures (5xx/network) still warn
// and fall back, and products that DO have data still return their real rows.

const root = new URL('../', import.meta.url);
const apiSrc = fs.readFileSync(new URL('api.js', root), 'utf8');

const STATIC_BASE = 'https://app.example.com/data/v1';
const VAULT_EXEC_URL = 'https://script.example.com/vault-exec';

// Build a fresh, isolated CMChat module context for each case so the module's
// internal URL/code caches never leak across cases.
function loadApi({ fetchImpl }) {
  const warnings = [];
  const fetchCalls = [];

  const CMChat = {
    api: {},
    config: {
      STATIC_DATA_BASE: STATIC_BASE,
      VAULT_EXEC_URL
    },
    cache: { memCache: { printRunRows: new Map() } },
    utils: {
      makeKey: (...a) => a.join('|'),
      normalize: s => String(s || '').toLowerCase(),
      uniq: a => [...new Set(a)]
    }
  };

  const fetchStub = (url, opts) => {
    fetchCalls.push({ url, opts });
    return fetchImpl(url, opts);
  };

  const sandbox = {
    window: { CMChat },
    console: {
      warn: (...a) => warnings.push(a),
      debug: () => {},
      log: () => {},
      error: (...a) => warnings.push(['ERROR', ...a])
    },
    fetch: fetchStub,
    AbortController: class {
      constructor() { this.signal = { aborted: false }; }
      abort() { this.signal.aborted = true; }
    },
    setTimeout: () => 0,
    clearTimeout: () => {}
  };

  vm.runInContext(apiSrc, vm.createContext(sandbox));
  return { api: CMChat.api, warnings, fetchCalls };
}

// A Response-like stub.
const res = (data, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => data
});

// getPrintRunData returns arrays created inside the VM realm, so their prototype is
// not the host Array. Normalize to a plain host array before deep-comparing.
const plain = v => JSON.parse(JSON.stringify(v));

// ---- Case 1: missing PRV data (manifest 404) => [] , no warn, no fallback ----
{
  const { api, warnings, fetchCalls } = loadApi({
    fetchImpl: async url => {
      if (url.endsWith('/vault/products/all.json')) return res(null, { ok: false, status: 404 });
      throw new Error('unexpected fetch ' + url);
    }
  });
  const rows = await api.getPrintRunData('missing-code-1', 'baseball');
  assert.deepEqual(plain(rows), [], 'missing PRV data must resolve to an empty array');
  assert.equal(warnings.length, 0, 'a 404 must NOT produce a console.warn');
  assert.ok(
    !fetchCalls.some(c => c.url === VAULT_EXEC_URL),
    'a 404 must NOT engage the Apps Script (VAULT_EXEC_URL) fallback'
  );
}

// ---- Case 1b: manifest ok but code absent from product_map => [] , no warn, no fallback ----
{
  const { api, warnings, fetchCalls } = loadApi({
    fetchImpl: async url => {
      if (url.endsWith('/vault/products/all.json')) return res({ product_map: {}, shards: [] });
      throw new Error('unexpected fetch ' + url);
    }
  });
  const rows = await api.getPrintRunData('missing-code-1b', 'baseball');
  assert.deepEqual(plain(rows), [], 'a code absent from the manifest must resolve to []');
  assert.equal(warnings.length, 0, 'an absent manifest entry must NOT warn');
  assert.ok(!fetchCalls.some(c => c.url === VAULT_EXEC_URL), 'absent entry must NOT hit the fallback');
}

// ---- Case 2: genuine 5xx failure => warn + Apps Script fallback used ----
{
  const { api, warnings, fetchCalls } = loadApi({
    fetchImpl: async (url, opts) => {
      if (url.endsWith('/vault/products/all.json')) return res(null, { ok: false, status: 500 });
      if (url === VAULT_EXEC_URL) return res({ rows: [{ set_name: 'Base', print_run: 199 }] });
      throw new Error('unexpected fetch ' + url);
    }
  });
  const rows = await api.getPrintRunData('error-code-2', 'baseball');
  assert.deepEqual(plain(rows), [{ set_name: 'Base', print_run: 199 }], 'a 5xx must fall back to Apps Script rows');
  assert.ok(warnings.length >= 1, 'a genuine failure must still console.warn');
  assert.ok(
    fetchCalls.some(c => c.url === VAULT_EXEC_URL),
    'a genuine failure must still engage the Apps Script fallback'
  );
}

// ---- Case 3: product DOES have data => real rows, no fallback ----
{
  const realRows = [{ set_name: 'Base', print_run: 25 }];
  const { api, warnings, fetchCalls } = loadApi({
    fetchImpl: async url => {
      if (url.endsWith('/vault/products/all.json')) {
        return res({ product_map: { 'have-code-3': 'shard-a.json' } });
      }
      if (url.endsWith('/vault/products/shard-a.json')) {
        return res({ products: { 'have-code-3': { rows: realRows } } });
      }
      throw new Error('unexpected fetch ' + url);
    }
  });
  const rows = await api.getPrintRunData('have-code-3', 'baseball');
  assert.deepEqual(plain(rows), realRows, 'a product with PRV data must return its real rows');
  assert.equal(warnings.length, 0, 'the happy path must not warn');
  assert.ok(!fetchCalls.some(c => c.url === VAULT_EXEC_URL), 'the happy path must not hit the fallback');
}

console.log('PRV missing-data (Layer A): 404 => clean empty, no fallback; 5xx => warn+fallback; present => real rows passed.');
