import { describe, expect, it } from "vitest";
import { buildReclaimSuccess, reclaimShareUrl, receiptLabel } from "./reclaim-result";
import type { ReclaimReceipt } from "./solana/reclaim";
import { SITE_URL } from "./site";

const owner = "D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw";
function receipt(index: number, count: number, amount: string): ReclaimReceipt {
  return { owner, status: "confirmed", actualLamports: amount, signature: String(index + 1).repeat(88), batch: { accounts: Array.from({ length: count }, (_, i) => ({ address: `source-${index}-${i}` })) } } as ReclaimReceipt;
}
const history = [receipt(0, 26, "4799685"), receipt(1, 26, "4787146"), receipt(2, 6, "1102266")];
describe("confirmed completion presentation", () => {
  it("uses exact confirmed amounts and unique accounts, not initial scan estimates", () => {
    const result = buildReclaimSuccess([...history, history[0]], owner, "0");
    expect(result).toEqual({ reclaimedLamports: "10689097", processedAccounts: 58, transactionCount: 3, rentBackFeePercent: 0 });
    expect(JSON.stringify(result)).not.toContain(owner);
  });
  it("requires a zero rescan and no unresolved transactions; another wallet cannot inherit success", () => {
    expect(buildReclaimSuccess(history, owner, "1")).toBeNull();
    expect(buildReclaimSuccess(history, "another-owner", "0")).toBeNull();
    expect(buildReclaimSuccess([], owner, "0")).toBeNull();
    expect(buildReclaimSuccess([...history, { ...history[0], status: "pending" }], owner, "0")).toBeNull();
  });
  it("distinguishes blocked, network-failed and confirmed attempts", () => {
    expect(receiptLabel({ ...history[0], signature: undefined, status: "failed" })).toBe("Blocked before submission");
    expect(receiptLabel({ ...history[0], status: "failed" })).toBe("Submitted and failed on-chain");
    expect(receiptLabel(history[0])).toBe("Confirmed");
    expect(receiptLabel({ ...history[0], signature: undefined, status: "expired" })).toBe("Expired without confirmation");
  });
  it("generates optional share copy with the real rounded total and production URL, without addresses", () => {
    const url = new URL(reclaimShareUrl(buildReclaimSuccess(history, owner, "0")!));
    expect(url.origin).toBe("https://x.com");
    expect(url.searchParams.get("text")).toContain("0.0107 SOL");
    expect(url.searchParams.get("text")).toContain("Old Solana token accounts had more SOL than they needed.");
    expect(url.searchParams.get("url")).toContain(`${SITE_URL}/share/reclaim?`);
    expect(url.href).not.toContain(owner);
  });
  it("keeps huge amounts and tiny share amounts exact without Number conversion", () => {
    const huge = buildReclaimSuccess([{ ...history[0], actualLamports: "9007199254740993123" }], owner, "0")!;
    expect(huge.reclaimedLamports).toBe("9007199254740993123");
    const text = new URL(reclaimShareUrl({ ...huge, reclaimedLamports: "1" })).searchParams.get("text");
    expect(text).toContain("0.000000001 SOL");
  });
});
