import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("real dynamic PNG rendering", () => {
  it.each(["amount=0.010689097&accounts=58&txs=3", "amount=0.009586831&accounts=52&txs=2&partial=1&remaining=0.001102266", "amount=0.1&accounts=1", "amount=999999999999.999999999&accounts=1000000&txs=10000&walletShort=D2FD...Zbdrw&timestamp=2026-09-05T00:00:00.000Z"])("renders a 1200x630 PNG for %s", async (params) => {
    const response = await GET(new Request(`https://rentback.lololabs.xyz/api/share/reclaim-image?${params}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(1200); expect(bytes.readUInt32BE(20)).toBe(630);
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
  }, 30_000);
  it("returns a bounded non-cacheable 400 for invalid input", async () => {
    const response = await GET(new Request("https://rentback.lololabs.xyz/api/share/reclaim-image?amount=<script>&accounts=1"));
    expect(response.status).toBe(400); expect(await response.text()).toBe("Invalid reclaim share data.");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
