import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { scanLimiter } from "@/lib/scan-limit";
import { scanWalletRentProjection } from "@/lib/solana/scan";
vi.mock("@/lib/solana/scan", () => ({ scanWalletRentProjection: vi.fn(), toRentBackApiResult: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
const request = (body: string) => new Request("https://rentback.lololabs.xyz/api/scan", { method: "POST", body });
describe("scan endpoint release guards", () => {
  it("returns retry guidance before invoking RPC when limited", async () => {
    vi.spyOn(scanLimiter, "acquire").mockReturnValue(null);
    const response = await POST(request("{}"));
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60");
    expect(scanWalletRentProjection).not.toHaveBeenCalled();
  });
  it("rejects non-address inputs and oversized bodies before RPC", async () => {
    const release = vi.fn(); vi.spyOn(scanLimiter, "acquire").mockReturnValue(release);
    expect((await POST(request('{"walletAddress":42}'))).status).toBe(400);
    expect((await POST(request('{"walletAddress":"invalid"}'))).status).toBe(400);
    expect((await POST(request("x".repeat(1025)))).status).toBe(413);
    expect(release).toHaveBeenCalledTimes(3);
  });
  it("never exposes RPC URLs or credentials in error responses", async () => {
    vi.spyOn(scanLimiter, "acquire").mockReturnValue(vi.fn());
    vi.mocked(scanWalletRentProjection).mockRejectedValue(new Error("https://mainnet.helius-rpc.com/?api-key=private-test-secret"));
    const response = await POST(request('{"walletAddress":"D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw"}'));
    expect(response.status).toBe(500); expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text(); expect(text).not.toContain("private-test-secret"); expect(text).not.toContain("helius");
  });
});
