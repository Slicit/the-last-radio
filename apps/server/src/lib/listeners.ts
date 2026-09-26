// HLS clients are invisible to mediamtx individually (it counts one muxer),
// so the player sends a heartbeat and we count distinct listeners here. We
// also remember which signed-in user each listener is, since only people
// actually listening get a say in skip votes.
const TTL_MS = 45_000;
type Beat = { at: number; userId: string | null };
const byRadio = new Map<string, Map<string, Beat>>();

function live(radioId: string): Map<string, Beat> | undefined {
  const m = byRadio.get(radioId);
  if (!m) return undefined;
  const cutoff = Date.now() - TTL_MS;
  for (const [id, b] of m) if (b.at < cutoff) m.delete(id);
  return m;
}

export function heartbeat(radioId: string, listenerId: string, userId: string | null) {
  let m = byRadio.get(radioId);
  if (!m) byRadio.set(radioId, (m = new Map()));
  m.set(listenerId, { at: Date.now(), userId });
}

export function listenerCount(radioId: string): number {
  return live(radioId)?.size ?? 0;
}

export function isListening(radioId: string, userId: string): boolean {
  for (const b of live(radioId)?.values() ?? []) if (b.userId === userId) return true;
  return false;
}
