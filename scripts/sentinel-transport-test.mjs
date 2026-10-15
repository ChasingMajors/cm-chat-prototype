import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
for (const file of ['command-center/index.html', 'command-center/simple-agent/index.html']) {
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
  const calls = [];
  let failCount = 1;
  const context = vm.createContext({AbortController, setTimeout, clearTimeout, DEFAULT_OPERATOR_URL: 'https://example.test/exec', fetch: async (url, options) => {
    calls.push({url, options});
    if (failCount-- > 0) return {ok: false, status: 404, statusText: 'Not Found'};
    return {ok: true, json: async () => ({ok: true, items: []})};
  }});
  vm.runInContext(script.slice(script.indexOf('      function withQuery'), script.indexOf('      function readOperatorKey')), context);
  assert.equal((await context.postOperatorStep('sourceWatch', {}, 5000, 'Checklist scan')).ok, true);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].url, calls[1].url, 'a retry must use a fresh request URL');
  assert(calls.every(c => c.options.cache === 'no-store'));
  calls.length = 0;
  failCount = 2;
  await assert.rejects(context.postOperatorStep('prvSourceWatch', {}, 5000, 'Print-run scan'), /HTTP 404/);
  assert.equal(calls.length, 2, 'retry is bounded');
  calls.length = 0;
  failCount = 1;
  await assert.rejects(context.postOperatorStep('executeSourceImport', {}, 5000, 'Write'), /HTTP 404/);
  assert.equal(calls.length, 1, 'mutations must never be automatically retried');
  console.log(file + ': fresh request URLs, bounded read-only retries, single write attempt passed');
}
