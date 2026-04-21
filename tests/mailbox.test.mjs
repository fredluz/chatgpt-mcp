import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atomicWriteJson,
  fetch,
  markRequestActive,
  notifyAgentIfAvailable,
  readRequest,
  removeRequest,
  requestPath,
  responsePath,
  status,
  submit,
  writeResponseVerified,
} from '../mailbox.mjs';

async function withMailboxHome(fn) {
  const prev = process.env.CHATGPT_MCP_HOME;
  const home = await mkdtemp(join(tmpdir(), 'chatgpt-mcp-mailbox-'));
  process.env.CHATGPT_MCP_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (prev == null) delete process.env.CHATGPT_MCP_HOME;
    else process.env.CHATGPT_MCP_HOME = prev;
  }
}

test('submit creates request file and pending status', async () => {
  await withMailboxHome(async () => {
    const { request_id } = await submit('hello world', { agent: 'foo' });
    assert.match(request_id, /^\d+-[a-f0-9]{4}-foo$/);

    const req = JSON.parse(await readFile(requestPath(request_id), 'utf8'));
    assert.equal(req.prompt, 'hello world');
    assert.equal(req.state, 'pending');
    assert.equal(req.agent, 'foo');

    const s = await status(request_id);
    assert.equal(s.state, 'pending');
    assert.equal(s.agent, 'foo');
    assert.equal(typeof s.elapsed_ms, 'number');

    const f = await fetch(request_id);
    assert.equal(f.complete, false);
    assert.equal(f.error, undefined);
    assert.deepEqual(f.files, []);
  });
});

test('status/fetch report complete after response is persisted', async () => {
  await withMailboxHome(async () => {
    const { request_id } = await submit('prompt', { agent: 'agentA' });
    const req = await readRequest(request_id);
    const active = await markRequestActive(request_id, req);

    const finished_at = new Date().toISOString();
    await writeResponseVerified(request_id, {
      request_id,
      state: 'complete',
      agent: 'agentA',
      text: 'done',
      files: [],
      created_at: active.created_at,
      started_at: active.started_at,
      finished_at,
      elapsed_ms: 1,
    });
    await removeRequest(request_id);

    const s = await status(request_id);
    assert.equal(s.state, 'complete');
    assert.equal(s.agent, 'agentA');

    const f = await fetch(request_id);
    assert.equal(f.complete, true);
    assert.equal(f.text, 'done');
    assert.deepEqual(f.files, []);
    assert.equal(f.error, undefined);
  });
});

test('status/fetch report error state', async () => {
  await withMailboxHome(async () => {
    const { request_id } = await submit('prompt', { agent: 'agentB' });
    const req = await readRequest(request_id);
    const active = await markRequestActive(request_id, req);

    const finished_at = new Date().toISOString();
    await writeResponseVerified(request_id, {
      request_id,
      state: 'error',
      agent: 'agentB',
      text: '',
      files: [],
      error: 'boom',
      created_at: active.created_at,
      started_at: active.started_at,
      finished_at,
      elapsed_ms: 2,
    });
    await removeRequest(request_id);

    const s = await status(request_id);
    assert.equal(s.state, 'error');
    assert.equal(s.error, 'boom');

    const f = await fetch(request_id);
    assert.equal(f.complete, true);
    assert.equal(f.error, 'boom');
  });
});

test('atomicWriteJson writes parseable JSON without leftover tmp files', async () => {
  await withMailboxHome(async (home) => {
    const targetDir = join(home, 'responses');
    const target = join(targetDir, 'atomic.json');
    const payload = { ok: true, nested: { value: 42 } };

    await atomicWriteJson(target, payload);

    const parsed = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(parsed, payload);

    const names = await readdir(targetDir);
    assert.equal(names.filter(n => n.endsWith('.tmp')).length, 0);
  });
});

test('notification hook calls runner when send-to-agent script exists', async () => {
  await withMailboxHome(async (home) => {
    const scriptPath = join(home, 'send-to-agent.sh');
    await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', 'utf8');

    let called = null;
    const ok = await notifyAgentIfAvailable('foo', '123', 'x'.repeat(200), {
      scriptPath,
      runner: async (_script, args) => { called = args; },
    });

    assert.equal(ok, true);
    assert.ok(called, 'runner should be called');
    assert.equal(called[0], 'foo');
    assert.match(called[1], /^exocortex-chatgpt response ready: 123 — preview: x{100}$/);

    const missing = await notifyAgentIfAvailable('foo', '123', 'preview', {
      scriptPath: join(home, 'missing.sh'),
      runner: async () => { throw new Error('should not run'); },
    });
    assert.equal(missing, false);
  });
});
