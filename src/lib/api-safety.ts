export class PublicApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function publicApiError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message;
  // Fail closed on transport URLs, credential fields and multiline stack text.
  if (message.length > 600 || /https?:|wss?:|api[-_ ]?key|authorization|bearer|secret|password|credential|\r|\n|\bat\s+\S+\s*\(/i.test(message)) return fallback;
  if (cause instanceof PublicApiError || /^(Invalid |Connect |Reclaim |Signed transaction |Your wallet |Wallet |This wallet |Account |Token account |Candidate |Current |A transaction |Transaction |Simulation |Unable to estimate |Could not estimate |Missing |Request |RPC must |Expected mainnet|Only mainnet)/.test(message)) return message;
  return fallback;
}

export async function readSmallJson(request: Request, maxBytes = 1024): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new PublicApiError("Request body is required.");
  const decoder = new TextDecoder(); let bytes = 0; let text = "";
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new PublicApiError("Request is too large.", 413); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { throw new PublicApiError("Invalid JSON request."); }
  } finally { reader.releaseLock(); }
}
