import { useCallback, useRef, useState } from 'react';
import { readPendingSteers, STEERING_STORAGE_KEY, type PendingSteer } from '../shared/steering';

export function usePendingSteers() {
  const [entries, setEntries] = useState<PendingSteer[]>(() => {
    try {
      return readPendingSteers(localStorage.getItem(STEERING_STORAGE_KEY));
    } catch {
      return [];
    }
  });
  const current = useRef(entries);
  const [saved, setSaved] = useState(true);
  const update = useCallback((change: (entries: PendingSteer[]) => PendingSteer[]) => {
    const next = change(current.current);
    if (next === current.current) return;
    current.current = next;
    // Persist before the RPC starts. Only text and attachment paths are stored,
    // never image bytes. These local receipts are never automatically resent.
    try {
      localStorage.setItem(STEERING_STORAGE_KEY, JSON.stringify(next));
      setSaved(true);
    } catch {
      setSaved(false);
    }
    setEntries(next);
  }, []);
  return { entries, saved, update };
}
