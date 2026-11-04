import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSettingsHandler } = require('../.test-build/settings.cjs');

const request = (method = 'GET', body = null, token = 'test-session') => ({ httpMethod: method, headers: token ? { authorization: `Bearer ${token}` } : {}, body });
const row = { id: 'server-row-id', gpt_api_key: 'secret-gpt-fixture', gemini_api_key: 'secret-gemini-fixture', line_channel_secret: 'secret-line-fixture', future_secret: 'never-disclose', system_prompt: 'Hello', is_ai_enabled: true };
function fixture(user, authError = null) {
  const calls = [];
  const client = {
    auth: { getUser: async token => { calls.push(['auth', token]); return { data: { user }, error: authError }; } },
    from: table => {
      calls.push(['table', table]);
      return {
        select: () => ({ single: async () => ({ data: row, error: null }) }),
        update: data => ({ eq: async (column, id) => { calls.push(['update', data, column, id]); return { error: null }; } }),
      };
    },
  };
  return { calls, handler: createSettingsHandler(() => client) };
}

test('unauthenticated request is rejected before database access', async () => {
  const f = fixture(null);
  assert.equal((await f.handler(request('GET', null, ''))).statusCode, 401);
  assert.deepEqual(f.calls, []);
});
test('forged admin user_metadata and ordinary users cannot access settings', async () => {
  for (const user of [{ user_metadata: { role: 'admin' } }, { app_metadata: { role: 'member' } }]) {
    const f = fixture(user);
    assert.equal((await f.handler(request())).statusCode, 403);
    assert.equal(f.calls.some(call => call[0] === 'table'), false);
  }
});
test('invalid session is rejected', async () => {
  const f = fixture(null, new Error('invalid token'));
  assert.equal((await f.handler(request())).statusCode, 401);
});
test('admin reads get safe settings and presence flags, never secret values or unknown columns', async () => {
  const f = fixture({ app_metadata: { role: 'admin' } });
  const response = await f.handler(request());
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const safe = JSON.parse(response.body).settings;
  assert.deepEqual(safe.configured_secrets, ['gpt_api_key', 'gemini_api_key', 'line_channel_secret']);
  assert.equal(safe.system_prompt, 'Hello');
  for (const secret of ['secret-gpt-fixture', 'secret-gemini-fixture', 'secret-line-fixture', 'never-disclose']) assert.equal(response.body.includes(secret), false);
});
test('writes cannot choose another row, blank secrets retain old values and changed secrets stay write-only', async () => {
  const f = fixture({ app_metadata: { role: 'admin' } });
  const response = await f.handler(request('PATCH', JSON.stringify({ id: 'attacker-row', gpt_api_key: '', gemini_api_key: 'replacement-secret', system_prompt: 'Updated', future_secret: 'bad' })));
  assert.equal(response.statusCode, 200);
  const update = f.calls.find(call => call[0] === 'update');
  assert.equal(update[1].gpt_api_key, undefined);
  assert.equal(update[1].gemini_api_key, 'replacement-secret');
  assert.equal(update[1].id, undefined);
  assert.equal(update[1].future_secret, undefined);
  assert.equal(update[3], row.id);
  assert.equal(response.body.includes('replacement-secret'), false);
});
test('bad JSON and invalid numeric settings are rejected before querying settings', async () => {
  for (const input of ['{', JSON.stringify({ gpt_max_tokens: '2000' }), JSON.stringify({ gpt_temperature: -1 }), '[]']) {
    const f = fixture({ app_metadata: { role: 'admin' } });
    assert.equal((await f.handler(request('PATCH', input))).statusCode, 400);
    assert.equal(f.calls.some(call => call[0] === 'table'), false);
  }
});
test('server errors do not expose internal details', async () => {
  const handler = createSettingsHandler(() => { throw new Error('private-server-key'); });
  const response = await handler(request());
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.includes('private-server-key'), false);
});
