export function isWriterConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already has an active writer/i.test(message);
}

export function compactionFailure(message: string, hasCompactionItem = false) {
  if (!hasCompactionItem && !/\bcompact(?:ion|ing)?\b/i.test(message)) return undefined;
  return /\bcontent_filter\b/i.test(message) ? 'filtered' : 'failed';
}
