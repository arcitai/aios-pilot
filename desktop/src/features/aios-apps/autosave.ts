export type PendingAutosaveTimer = {
  generation: number;
  timer: number;
};

/** Cancel a pending timer only when it belongs to the effect being cleaned up. */
export function cancelPendingAutosave(
  pending: PendingAutosaveTimer | null,
  generation: number,
  clearTimer: (timer: number) => void,
): boolean {
  if (!pending || pending.generation !== generation) return false;
  clearTimer(pending.timer);
  return true;
}
