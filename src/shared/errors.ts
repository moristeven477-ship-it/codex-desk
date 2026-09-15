export function isWriterConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already has an active writer/i.test(message);
}
