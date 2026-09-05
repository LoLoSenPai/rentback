import { describe, expect, it } from "vitest";
import { buildShareCardViewModel, formatShareSol, lamportsToShareSol, parseShareSearchParams, shareImagePath, shareOnXUrl, sharePayloadFromSuccess, sharePreviewPath, shareSearchParams, shareText, validateSharePayload, type ReclaimSharePayload } from "./reclaim-share";

const completed = { reclaimedLamports: "10689097", processedAccounts: 58, transactionCount: 3, rentBackFeePercent: 0 as const };
const payload = sharePayloadFromSuccess(completed);

describe("dynamic reclaim share model", () => {
  it("maps the actual confirmed completion DTO without adding a wallet or pre-reclaim estimate", () => {
    expect(payload).toEqual({ amountReclaimedSol: "0.010689097", accountsProcessed: 58, txCount: 3, rentBackFeePercent: 0, network: "mainnet", hasRemainingExcess: false });
    expect(JSON.stringify(payload)).not.toContain("wallet");
    expect(shareImagePath(payload)).toContain("amount=0.010689097");
    expect(sharePreviewPath(payload)).toContain("accounts=58");
  });
  it("supports complete, minimal and partially completed cards", () => {
    expect(buildShareCardViewModel(payload).status).toBe("RECLAIM COMPLETE");
    const minimal = parseShareSearchParams(new URLSearchParams("amount=0.1&accounts=1"));
    expect(buildShareCardViewModel(minimal)).toMatchObject({ amount: "0.1", transactions: undefined, walletShort: undefined, accountLabel: "token account processed" });
    const partial = sharePayloadFromSuccess({ ...completed, reclaimedLamports: "9586831", processedAccounts: 52, transactionCount: 2 }, "1102266");
    expect(buildShareCardViewModel(partial)).toMatchObject({ amount: "0.009586831", status: "PARTIAL RECLAIM", remaining: "0.001102266 SOL still claimable" });
    expect(buildShareCardViewModel({ ...partial, remainingClaimableSol: undefined }).remaining).toBe("More excess remains to reclaim");
  });
  it("formats SOL with useful precision, no trailing noise and no float loss", () => {
    expect(formatShareSol("0.010689097")).toBe("0.010689097");
    expect(formatShareSol("0.010689097", true)).toBe("0.0107");
    expect(formatShareSol("10.100000000")).toBe("10.1");
    expect(formatShareSol("0.000000001", true)).toBe("0.000000001");
    expect(formatShareSol("123456789.123456789")).toBe("123,456,789.123456789");
    expect(lamportsToShareSol("9007199254740993123")).toBe("9007199254.740993123");
    expect(buildShareCardViewModel({ ...payload, amountReclaimedSol: "999999999999.999999999" }).amountFontSize).toBe(66);
  });
  it("round-trips bounded optional fields, including shortened-only identity", () => {
    const optional = { ...payload, walletShort: "D2FD...Zbdrw", timestamp: "2026-09-05T00:00:00.000Z", confirmedSignatures: ["2".repeat(88)] };
    expect(parseShareSearchParams(shareSearchParams(optional))).toEqual(optional);
  });
  it("creates concise natural X text and attaches the canonical dynamic preview URL", () => {
    expect(shareText(payload)).toBe("Recovered 0.0107 SOL in excess rent with RentBack. Old Solana token accounts had more SOL than they needed.");
    const intent = new URL(shareOnXUrl(payload));
    expect(intent.origin).toBe("https://x.com");
    expect(intent.searchParams.get("url")).toBe(`https://rentback.lololabs.xyz${sharePreviewPath(payload)}`);
    expect(shareText(payload).length + 24).toBeLessThan(280);
    expect(shareText({ ...payload, hasRemainingExcess: true })).toContain("More excess remains");
  });
  it.each(["amount=-1&accounts=1", "amount=0&accounts=1", "amount=NaN&accounts=1", "amount=1e6&accounts=1", "amount=0.1234567891&accounts=1", "amount=1000000000000&accounts=1", "amount=1&accounts=0", "amount=1&accounts=1.5", "amount=1&accounts=1000001", "amount=1&accounts=1&txs=10001", "amount=1&accounts=1&fee=2", "amount=1&accounts=1&network=devnet", "amount=1&accounts=1&partial=true", "amount=1&accounts=1&partial=0&remaining=1", "amount=1&accounts=1&partial=1&remaining=0", "amount=1&amount=2&accounts=1", "amount=1&accounts=1&image=https://evil.test", "amount=1&accounts=1&walletShort=D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw", "amount=1&accounts=1&walletShort=<script>", "amount=1&accounts=1&timestamp=2026-02-30T00:00:00.000Z", "amount=1&accounts=1&v=2", "amount=1&accounts=1&signatures=invalid"])("rejects unsafe or inconsistent query: %s", (query) => {
    expect(() => parseShareSearchParams(new URLSearchParams(query))).toThrow("Invalid reclaim share data");
  });
  it("rejects excessive URL length and non-integer object inputs", () => {
    expect(() => parseShareSearchParams(new URLSearchParams(`amount=1&accounts=1&walletShort=${"A".repeat(1800)}`))).toThrow();
    expect(() => validateSharePayload({ ...payload, accountsProcessed: "58" } as unknown as ReclaimSharePayload)).toThrow();
  });
});
