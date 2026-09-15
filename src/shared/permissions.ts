import type { AccessMode, JsonObject, Thread } from './types';

/** The full server policies remain authoritative, including custom roots and reviewers. */
export function threadPermissions(settings: JsonObject): Partial<Thread> {
  const sandbox = (settings.sandboxPolicy ?? settings.sandbox) as JsonObject | undefined;
  const modes: Record<string, Thread['permissionMode']> = {
    readOnly: 'read-only',
    workspaceWrite: 'workspace-write',
    dangerFullAccess: 'danger-full-access',
    externalSandbox: 'external-sandbox',
  };
  return {
    ...(sandbox ? { sandboxPolicy: sandbox, permissionMode: modes[String(sandbox.type)] } : {}),
    ...(settings.approvalPolicy !== undefined
      ? { approvalPolicy: settings.approvalPolicy as Thread['approvalPolicy'] }
      : {}),
    ...(settings.approvalsReviewer !== undefined
      ? { approvalsReviewer: settings.approvalsReviewer as string }
      : {}),
    ...(settings.activePermissionProfile !== undefined
      ? { activePermissionProfile: settings.activePermissionProfile as Thread['activePermissionProfile'] }
      : {}),
  };
}

/** Only used for an explicit permission selection in Desk. Full access is CLI --yolo. */
export function permissionOverride(access?: AccessMode): JsonObject {
  if (!access) return {};
  const sandboxPolicy =
    access === 'danger-full-access'
      ? { type: 'dangerFullAccess' }
      : access === 'read-only'
        ? { type: 'readOnly', networkAccess: false }
        : {
            type: 'workspaceWrite',
            writableRoots: [],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          };
  return {
    sandboxPolicy,
    approvalPolicy: access === 'danger-full-access' ? 'never' : 'on-request',
    approvalsReviewer: 'user',
  };
}
