// HLS clients are invisible to mediamtx individually (it counts one muxer),
// so the player sends a heartbeat and we count distinct listeners here.
const TTL_MS = 45_000;
const byRadio = new Map<string, Map<string, number>>();

export function heartbeat(radioId: string, listenerId: string) {
  let m = byRadio.get(radioId);
  if (!m) byRadio.set(radioId, (m = new Map()));
  m.set(listenerId, Date.now());
}

export function listenerCount(radioId: string): number {
  const m = byRadio.get(radioId);
  if (!m) return 0;
  const cutoff = Date.now() - TTL_MS;
  for (const [id, t] of m) if (t < cutoff) m.delete(id);
  return m.size;
}
