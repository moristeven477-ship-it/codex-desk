import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { remoteFixture } from './fixtures/remote';
import type { Bootstrap, Thread } from '../src/shared/types';

test('phone pairing enforces authentication, same origin, single-use codes, private storage and revocation', async () => {
  const f = await remoteFixture();
  try {
    const origin = f.gateway.status.localOrigin;
    const post = (url: string, data: unknown, cookie = '', source = origin) =>
      fetch(origin + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: source, Cookie: cookie },
        body: JSON.stringify(data),
      });
    assert.equal((await fetch(origin + '/v1/session')).status, 401);
    assert.equal((await post('/v1/rpc', { method: 'bootstrap' })).status, 401);
    const pair = f.gateway.createPairing();
    assert.equal(
      (await post('/v1/pair', { code: pair.code, name: 'Phone' }, '', 'https://malicious.example')).status,
      403,
    );
    assert.equal((await post('/v1/pair', { code: 'wrong', name: 'Phone' })).status, 401);
    const paired = await post('/v1/pair', { code: pair.code, name: 'Phone' });
    assert.equal(paired.status, 200);
    const cookie = paired.headers.get('set-cookie')!.split(';')[0];
    assert.match(paired.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    assert.equal((await post('/v1/pair', { code: pair.code, name: 'Another phone' })).status, 401);
    const raw = await readFile(path.join(f.root, 'remote/remote.json'), 'utf8');
    assert.ok(!raw.includes(cookie.slice('cd_session='.length)) && !raw.includes(pair.code));
    assert.equal((await stat(path.join(f.root, 'remote/remote.json'))).mode & 0o777, 0o600);
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/v1/events', {
      headers: { Cookie: cookie, Origin: origin },
    });
    await once(socket, 'open');
    const closed = once(socket, 'close');
    await f.gateway.revoke(f.gateway.status.devices[0].id);
    await closed;
    assert.equal((await fetch(origin + '/v1/session', { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fetch(origin + '/../../package.json')).status, 404);
  } finally {
    await f.close();
  }
});

test('remote commands share CLI state, deduplicate delivery and keep phone preferences separate', async () => {
  const f = await remoteFixture();
  try {
    const origin = f.gateway.status.localOrigin;
    const pair = f.gateway.createPairing();
    const paired = await fetch(origin + '/v1/pair', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pair.code, name: 'Test Android' }),
    });
    const cookie = paired.headers.get('set-cookie')!.split(';')[0];
    const rpc = async (method: string, params = {}, id = randomUUID()) => {
      const response = await fetch(f.gateway.status.localOrigin + '/v1/rpc', {
        method: 'POST',
        headers: { Origin: f.gateway.status.localOrigin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, method, params }),
      });
      return { status: response.status, ...(await response.json()) };
    };
    assert.equal((await rpc('remote.pair')).ok, false);
    assert.equal((await rpc('settings.update', { binaryPath: '/tmp/other-codex' })).ok, false);
    assert.equal((await rpc('codex.restart')).ok, false);
    await rpc('settings.update', { locale: 'zh', fontSize: 17.5, lastThreadId: 'fixture-history' });
    assert.equal(f.service.store.state.settings.locale, 'en');
    assert.equal(f.service.store.state.settings.lastThreadId, '');
    const boot = (await rpc('bootstrap')).value as Bootstrap;
    assert.equal(boot.settings.locale, 'zh');
    assert.equal(boot.settings.binaryPath, '');
    assert.equal(boot.settings.codexHome, '');
    const thread = (await rpc('thread.create', { access: 'danger-full-access' })).value as Thread;
    const id = randomUUID();
    const params = { threadId: thread.id, text: 'wait for phone steering' };
    const [a, b] = await Promise.all([rpc('turn.start', params, id), rpc('turn.start', params, id)]);
    assert.equal(a.ok, true);
    assert.deepEqual(a, b);
    assert.equal((await rpc('turn.start', { ...params, text: 'different' }, id)).status, 409);
    const steerId = randomUUID();
    await rpc('turn.steer', {
      threadId: thread.id,
      expectedTurnId: a.value.turn.id,
      clientUserMessageId: steerId,
      text: 'Direction from Android.',
    });
    const history = (await f.service.handle('thread.open', { threadId: thread.id })) as Thread;
    assert.equal(history.turns.length, 1);
    assert.equal(history.turns[0].items.filter((i) => i.clientId === steerId).length, 1);
    assert.equal(history.permissionMode, 'danger-full-access');
    assert.equal(history.approvalPolicy, 'never');
    const activeId = history.turns[0].id;
    await f.gateway.stop(false);
    await f.gateway.start();
    assert.equal((await rpc('bootstrap')).value.settings.locale, 'zh');
    const resumed = (await rpc('thread.open', { threadId: thread.id })).value as Thread;
    assert.equal(resumed.turns[0].id, activeId);
    assert.equal(resumed.turns[0].status, 'inProgress');
    await rpc('turn.interrupt', { threadId: thread.id, turnId: activeId });
  } finally {
    await f.close();
  }
});
