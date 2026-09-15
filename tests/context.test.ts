import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { storedThreadContext } from '../electron/thread-context';
import type { Thread } from '../src/shared/types';

test('read-only standalone context preserves YOLO and custom workspace roots; ignores partial records and escaped paths', async () => {
  const root = await mkdtemp('/tmp/desk-context-');
  try {
    await mkdir(root + '/sessions');
    const file = root + '/sessions/rollout-test-id.jsonl';
    const thread = { id: 'test-id', path: file } as Thread;
    const line = (policy: object, approval: string) =>
      JSON.stringify({
        type: 'turn_context',
        payload: {
          sandbox_policy: policy,
          approval_policy: approval,
          approvals_reviewer: 'user',
        },
      }) + '\n';
    const original =
      line({ type: 'read-only' }, 'on-request') +
      line({ type: 'danger-full-access' }, 'never') +
      '{"type":"turn_context","pay';
    await writeFile(file, original);
    const result = await storedThreadContext(root, thread);
    assert.equal(result.display.permissionMode, 'danger-full-access');
    assert.equal(result.display.approvalPolicy, 'never');
    assert.equal(result.resume.sandbox, 'danger-full-access');
    assert.equal(result.resume.approvalPolicy, 'never');
    assert.equal(await readFile(file, 'utf8'), original);
    await writeFile(
      file,
      line(
        {
          type: 'workspace-write',
          writable_roots: [root + '/other'],
          network_access: true,
          exclude_slash_tmp: true,
        },
        'never',
      ),
    );
    const custom = await storedThreadContext(root, thread);
    assert.deepEqual(custom.display.sandboxPolicy, {
      type: 'workspaceWrite',
      writableRoots: [root + '/other'],
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: true,
    });
    assert.deepEqual(custom.resume.config, {
      sandbox_workspace_write: {
        writable_roots: [root + '/other'],
        network_access: true,
        exclude_tmpdir_env_var: false,
        exclude_slash_tmp: true,
      },
    });
    await writeFile(root + '/outside-test-id.jsonl', original);
    await symlink(root + '/outside-test-id.jsonl', root + '/sessions/escape-test-id.jsonl');
    assert.deepEqual(
      await storedThreadContext(root, { ...thread, path: root + '/sessions/escape-test-id.jsonl' }),
      { display: {}, resume: {} },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
