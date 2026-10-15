import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../command-center/static-exporter/Code.gs', import.meta.url), 'utf8');
const context = vm.createContext({ console, Date });
vm.runInContext(source, context);
const clone = value => JSON.parse(JSON.stringify(value));
const dir = 'data/v1/checklists/search-index/';
const manifestPath = dir + 'baseball.json';
let repo, writes, reads, failPath;
function reset() {
  repo = new Map(); writes = []; reads = []; failPath = '';
  const shards = Array.from({ length: 61 }, (_, i) => `baseball-${i + 1}.json`);
  repo.set(manifestPath, { ok: true, sharded: true, shards });
  shards.forEach((name, i) => repo.set(dir + name, { rows: [
    { code: `other-${i}`, player: 'Unchanged' },
    ...(i === 0 || i === 60 ? [{ code: 'target', player: 'Old' }] : [])
  ] }));
}
context.fetchGitHubJsonFile_ = path => { reads.push(path); return clone(repo.get(path) || null); };
context.fetchGitHubJsonFiles_ = paths => paths.map(context.fetchGitHubJsonFile_);
context.putGitHubJsonFile_ = (path, data) => {
  if (path === failPath) throw new Error('Simulated GitHub write failure');
  writes.push(path); repo.set(path, clone(data)); return { path, commit: 'test' };
};
function allRows() {
  return repo.get(manifestPath).shards.flatMap(name => repo.get(dir + name).rows);
}

reset();
const initial = clone(repo.get(manifestPath));
context.putGitHubChecklistSearchProduct_('baseball', 'target', [{ code: 'target', player: 'New' }], 'now');
assert.equal(writes.length, 4, '61 legacy shards require only two retained shards, one product shard, and the manifest');
assert.equal(writes.at(-1), manifestPath);
assert.equal(allRows().length, 62);
assert.equal(allRows().filter(row => row.code === 'target').length, 1);

context.putGitHubChecklistSearchProduct_('baseball', 'another-target', [{ code: 'another-target', player: 'Next product' }], 'next');
assert.equal(repo.get(manifestPath).product_shards.target.length, 1, 'a consecutive product publish preserves the previous lookup');
assert.equal(allRows().filter(row => row.code === 'target').length, 1);
assert.equal(allRows().filter(row => row.code === 'another-target').length, 1);
assert.equal(allRows().find(row => row.code === 'target').player, 'New');
assert.equal(allRows().filter(row => row.player === 'Unchanged').length, 61);
assert.equal(repo.get(dir + initial.shards[0]).rows[1].player, 'Old', 'old shard is immutable');

writes = []; reads = [];
context.putGitHubChecklistSearchProduct_('baseball', 'target', [{ code: 'target', player: 'Updated again' }], 'later');
assert.equal(writes.length, 2, 'repeat publish writes only product data and manifest');
assert.equal(reads.length, 1, 'repeat publish does not read legacy shards');
assert.equal(allRows().filter(row => row.code === 'target').length, 1);

reset();
failPath = manifestPath;
assert.throws(() => context.putGitHubChecklistSearchProduct_('baseball', 'target', [{ code: 'target' }], 'now'), /Simulated/);
assert.deepEqual(repo.get(manifestPath), initial, 'failed publish preserves old manifest');
assert.equal(allRows().filter(row => row.code === 'target').length, 2, 'old rows remain reachable after failure');

reset();
repo.set(manifestPath, { rows: [{ code: 'other' }, { code: 'target', player: 'Old' }] });
context.putGitHubChecklistSearchProduct_('baseball', 'target', [{ code: 'target', player: 'New' }], 'now');
assert.deepEqual(repo.get(manifestPath).rows, [{ code: 'other' }, { code: 'target', player: 'New' }]);
assert.throws(() => context.putGitHubChecklistSearchProduct_('baseball', 'target', [], 'now'), /empty/);

context.requireCmOperatorKey_ = () => {};
let released = 0;
context.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => released++ }) };
assert.equal(context.publishChecklistAfterImport_({}).status, 'publish_busy');
context.LockService.getScriptLock = () => ({ tryLock: () => true, releaseLock: () => released++ });
context.publishChecklistAfterImportLocked_ = () => { throw new Error('failure'); };
assert.throws(() => context.publishChecklistAfterImport_({}), /failure/);
assert.equal(released, 1, 'publish lock is released even on error');

context.fetchGitHubChecklistProduct_ = () => ({ rows: [{}], parallels: [] });
context.fetchGitHubJsonFile_ = () => ({ index: [{ Code: 'target' }] });
context.countGitHubChecklistSearchRows_ = () => 2;
context.validatePublicChecklistProductLite_ = () => { throw new Error('Pages not ready'); };
const validation = context.validatePublishedChecklistProductLite_('baseball', 'target');
assert.equal(validation.github.ok, true);
assert.equal(validation.public.ok, false, 'Pages errors do not turn a committed GitHub publish into a failure');

const requests = [];
const reader = vm.createContext({
  Date,
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({ GITHUB_TOKEN: 'test-token' })[key] || '' }) },
  UrlFetchApp: {
    fetch: (url, options) => {
      requests.push({ url, options });
      return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
    },
    fetchAll: batch => batch.map(request => {
      requests.push({ url: request.url, options: request });
      return { getResponseCode: () => 200, getContentText: () => '{"rows":[]}' };
    })
  }
});
vm.runInContext(source, reader);
assert.equal(reader.fetchGitHubJsonFile_('data/test.json').ok, true);
reader.fetchGitHubJsonFiles_(['data/shard.json']);
assert(requests.every(request => request.url.startsWith('https://api.github.com/repos/')));
assert(requests.every(request => request.options.headers.Accept === 'application/vnd.github.raw+json'));

const operator = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../command-center/operator-backend/Code.gs', import.meta.url), 'utf8'), operator);
for (const [sport, season] of [['baseball', '2027'], ['football', '2027'], ['basketball', '2026-27'], ['basketball', '2027'], ['hockey', '2026-27'], ['soccer', '2026-27']]) {
  const target = operator.getChecklistSpreadsheetId_(sport, season);
  const exporterTarget = vm.runInContext(`CM_CHECKLIST_DB_MAP[${JSON.stringify(sport)}][${JSON.stringify(season)}]`, reader);
  assert.equal(target, exporterTarget, 'imports and exports must use the same season source');
  assert.notEqual(target, operator.getChecklistSpreadsheetId_(sport, 'current'), 'new season must not fall back to prior current sheet');
}
assert.notEqual(operator.getChecklistSpreadsheetId_('basketball', '2026-27'), operator.getChecklistSpreadsheetId_('basketball', '2027'), 'NBA and WNBA seasons must use distinct sources');
console.log('Static exporter regression checks passed.');
