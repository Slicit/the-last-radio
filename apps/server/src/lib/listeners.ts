// HLS clients are invisible to mediamtx individually (it counts one muxer),
// so the player sends a heartbeat and we count distinct listeners here. We
// also remember which signed-in user each listener is, since only people
// actually listening get a say in skip votes.
const TTL_MS = 45_000;
type Beat = { at: number; userId: string | null; ip: string };
// One household may have a few tabs/devices; more than this from one IP is inflation.
const MAX_LISTENERS_PER_IP = 5;
const byRadio = new Map<string, Map<string, Beat>>();

function live(radioId: string): Map<string, Beat> | undefined {
  const m = byRadio.get(radioId);
  if (!m) return undefined;
  const cutoff = Date.now() - TTL_MS;
  for (const [id, b] of m) if (b.at < cutoff) m.delete(id);
  return m;
}

/** Records a listener; returns false when the IP already has too many (it then isn't counted). */
export function heartbeat(radioId: string, listenerId: string, userId: string | null, ip: string): boolean {
  let m = live(radioId);
  if (!m) byRadio.set(radioId, (m = new Map()));
  if (!m.has(listenerId)) {
    let fromIp = 0;
    for (const b of m.values()) if (b.ip === ip) fromIp++;
    if (fromIp >= MAX_LISTENERS_PER_IP) return false;
  }
  m.set(listenerId, { at: Date.now(), userId, ip });
  return true;
}

export function listenerCount(radioId: string): number {
  return live(radioId)?.size ?? 0;
}

/** Listeners, leaving out signed-in people in `except` (those left out of statistics). */
export function countedListeners(radioId: string, except: Set<string>): number {
  let n = 0;
  for (const b of live(radioId)?.values() ?? []) if (!b.userId || !except.has(b.userId)) n++;
  return n;
}

export function isListening(radioId: string, userId: string): boolean {
  for (const b of live(radioId)?.values() ?? []) if (b.userId === userId) return true;
  return false;
}
