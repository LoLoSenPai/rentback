// Per-process protection, not a distributed DDoS service. The deployment proxy
// must overwrite the configured IP header; untrusted headers are ignored.
export class ScanLimiter {
  private clients = new Map<string, { count: number; resetsAt: number }>();
  private global = { count: 0, resetsAt: 0 };
  private active = 0;
  acquire(client: string, now = Date.now()): (() => void) | null {
    if (now >= this.global.resetsAt) this.global = { count: 0, resetsAt: now + 60_000 };
    if (this.active >= 4 || this.global.count >= 120) return null;
    let bucket = this.clients.get(client);
    if (!bucket || now >= bucket.resetsAt) {
      if (this.clients.size >= 5000) {
        for (const [key, item] of this.clients) if (now >= item.resetsAt) this.clients.delete(key);
        if (this.clients.size >= 5000 && !bucket) return null;
      }
      bucket = { count: 0, resetsAt: now + 60_000 }; this.clients.set(client, bucket);
    }
    if (bucket.count >= 30) return null;
    bucket.count++; this.global.count++; this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}
export const scanLimiter = new ScanLimiter();
export function scanClientKey(request: Request): string {
  const header = process.env.TRUST_PROXY_IP_HEADER?.toLowerCase();
  if (!header || !["x-forwarded-for", "x-real-ip", "cf-connecting-ip"].includes(header)) return "shared";
  const value = request.headers.get(header)?.split(",")[0].trim();
  return value && /^[0-9a-fA-F:.]{3,64}$/.test(value) ? value : "shared";
}
