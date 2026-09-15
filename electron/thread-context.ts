import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject, Thread } from '../src/shared/types';
import { threadPermissions } from '../src/shared/permissions';

// A standalone CLI cannot expose live settings through another app-server.
// Read its last persisted turn context without opening a writer or changing the log.
export async function storedThreadContext(
  home: string,
  thread: Thread,
): Promise<{
  display: Partial<Thread>;
  resume: JsonObject;
}> {
  const empty = { display: {}, resume: {} };
  if (!thread.path) return empty;
  try {
    const [root, file] = await Promise.all([realpath(home), realpath(thread.path)]);
    const relative = path.relative(root, file);
    if (!/^(sessions|archived_sessions)\//.test(relative) || !path.basename(file).includes(thread.id))
      return empty;
    const handle = await open(file, 'r');
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - 16 * 1024 * 1024);
      const bytes = Buffer.alloc(size - start);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
      const lines = bytes.subarray(0, bytesRead).toString('utf8').split('\n');
      if (start) lines.shift();
      for (const line of lines.reverse()) {
        if (!line.includes('"turn_context"')) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (record.type !== 'turn_context' || !record.payload) continue;
        const context = record.payload;
        const policy = context.sandbox_policy;
        const kind = policy?.type;
        if (!['read-only', 'workspace-write', 'danger-full-access'].includes(kind)) return empty;
        const sandboxPolicy =
          kind === 'workspace-write'
            ? {
                type: 'workspaceWrite',
                writableRoots: policy.writable_roots ?? [],
                networkAccess: policy.network_access ?? false,
                excludeTmpdirEnvVar: policy.exclude_tmpdir_env_var ?? false,
                excludeSlashTmp: policy.exclude_slash_tmp ?? false,
              }
            : kind === 'danger-full-access'
              ? { type: 'dangerFullAccess' }
              : { type: 'readOnly', networkAccess: policy.network_access ?? false };
        const settings: JsonObject = {
          sandboxPolicy,
          ...(context.approval_policy !== undefined ? { approvalPolicy: context.approval_policy } : {}),
          ...(context.approvals_reviewer !== undefined
            ? { approvalsReviewer: context.approvals_reviewer }
            : {}),
        };
        return {
          display: threadPermissions(settings),
          resume: {
            sandbox: kind,
            ...(settings.approvalPolicy !== undefined ? { approvalPolicy: settings.approvalPolicy } : {}),
            ...(settings.approvalsReviewer !== undefined
              ? { approvalsReviewer: settings.approvalsReviewer }
              : {}),
            ...(kind === 'workspace-write'
              ? {
                  config: {
                    sandbox_workspace_write: {
                      writable_roots: sandboxPolicy.writableRoots,
                      network_access: sandboxPolicy.networkAccess,
                      exclude_tmpdir_env_var: sandboxPolicy.excludeTmpdirEnvVar,
                      exclude_slash_tmp: sandboxPolicy.excludeSlashTmp,
                    },
                  },
                }
              : {}),
          },
        };
      }
      return empty;
    } finally {
      await handle.close();
    }
  } catch {
    return empty;
  }
}
