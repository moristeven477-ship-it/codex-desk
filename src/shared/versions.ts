// Stable releases only: a preview build must never silently replace a stable install.
export function stableVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  return /^(?:v|codex-cli )?(\d+\.\d+\.\d+)$/.exec(value.trim())?.[1];
}

export function newerVersion(candidate: unknown, current: unknown): boolean {
  const next = stableVersion(candidate)?.split('.').map(Number);
  const previous = stableVersion(current)?.split('.').map(Number);
  if (!next || !previous) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i];
  }
  return false;
}

export function serverVersion(userAgent: unknown): string | undefined {
  if (typeof userAgent !== 'string') return;
  return /(?:^|[ /])(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?=[ );]|$)/.exec(userAgent)?.[1];
}
