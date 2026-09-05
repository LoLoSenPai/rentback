import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicApiError, publicApiError, readSmallJson } from "./api-safety";
import { ScanLimiter, scanClientKey } from "./scan-limit";

afterEach(() => vi.unstubAllEnvs());
describe("public API protection", () => {
  it.each(["fetch failed https://mainnet.helius-rpc.com/?api-key=secret-value", "Invalid authorization: Bearer private-value", "Invalid account\n at internalFile.ts:12", "Unexpected SDK internals", "Invalid api_key private-value"])("does not expose sensitive transport/internal errors", (message) => {
    expect(publicApiError(new Error(message), "Try again.")).toBe("Try again.");
  });
  it("keeps actionable application validation and simulation errors", () => {
    expect(publicApiError(new PublicApiError("walletAddress is required."), "Fallback")).toBe("walletAddress is required.");
    expect(publicApiError(new Error("Reclaim simulation failed: Instruction 2: Custom 12"), "Fallback")).toContain("Custom 12");
  });
  it("bounds actual streamed JSON bytes and rejects invalid bodies", async () => {
    const request = (body: string) => new Request("https://rentback.example/api/scan", { method: "POST", body });
    expect(await readSmallJson(request('{"walletAddress":"public"}'))).toEqual({ walletAddress: "public" });
    await expect(readSmallJson(request("x".repeat(1025)))).rejects.toMatchObject({ status: 413 });
    await expect(readSmallJson(request("invalid"))).rejects.toThrow(/Invalid JSON/);
  });
  it("limits per-client scans, concurrency and overall traffic with bounded windows", () => {
    const limiter = new ScanLimiter();
    for (let i = 0; i < 30; i++) { const release = limiter.acquire("one", 1)!; expect(release).toBeTypeOf("function"); release(); }
    expect(limiter.acquire("one", 2)).toBeNull();
    expect(limiter.acquire("one", 60_002)).toBeTypeOf("function");
    const concurrent = new ScanLimiter(); const releases = Array.from({ length: 4 }, (_, i) => concurrent.acquire(String(i), 1)!);
    expect(concurrent.acquire("extra", 1)).toBeNull(); releases[0](); releases[0]();
    expect(concurrent.acquire("extra", 1)).toBeTypeOf("function"); expect(concurrent.acquire("extra2", 1)).toBeNull();
    const global = new ScanLimiter();
    for (let i = 0; i < 120; i++) global.acquire(String(i), 1)!();
    expect(global.acquire("new", 1)).toBeNull();
  });
  it("ignores spoofable IP headers unless a trusted proxy is explicitly configured", () => {
    const request = new Request("https://rentback.example", { headers: { "x-forwarded-for": "203.0.113.10, 127.0.0.1" } });
    vi.stubEnv("TRUST_PROXY_IP_HEADER", ""); expect(scanClientKey(request)).toBe("shared");
    vi.stubEnv("TRUST_PROXY_IP_HEADER", "x-forwarded-for"); expect(scanClientKey(request)).toBe("203.0.113.10");
  });
});
