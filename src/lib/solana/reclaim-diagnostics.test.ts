import { describe, expect, it, vi } from "vitest";
import { address, getAddressDecoder, type Transaction, type TransactionSigner } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { parseReclaimDiagnostics } from "./reclaim-diagnostics";
import { executeReviewedBatch } from "./reclaim-client";
import { transactionBytes, type ReclaimReview } from "./reclaim";
import { RECLAIM_WALLET_POLICY } from "./reclaim-wallet-policy";

const owner = address("D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw");
function fixture() {
  const now = Date.now();
  const lifetime = { walletPolicy: RECLAIM_WALLET_POLICY, blockhash: "11111111111111111111111111111111", lastValidBlockHeight: "1000", computeBudget: { units: 10000, microLamports: "100000" } };
  const batches = Array.from({ length: 6 }, (_, index) => {
    const accounts = [{ address: getAddressDecoder().decode(Uint8Array.from({ length: 32 }, (_, i) => i === 0 ? index + 1 : 7)), program: TOKEN_PROGRAM_ADDRESS, dataSize: 165, lamports: "3000000", rentMinimum: "2000000", excess: "1000000" }];
    return { ...lifetime, accounts, expectedLamports: "1000000", feeLamports: "6000", simulatedAt: now, expiresAt: now + 30000, wireBytes: transactionBytes(accounts, owner, lifetime) };
  });
  const review: ReclaimReview = { owner, chain: "solana:mainnet", eligibleAccounts: 6, expectedLamports: "6000000", feeLamports: "36000", batches };
  // Local test bytes only: no wallet, RPC or real signature generation.
  const sign = vi.fn(async (transactions: readonly Transaction[]) => transactions.map(tx => ({ ...tx, signatures: { [owner]: new Uint8Array(64).fill(7) } })));
  const signer = { address: owner, modifyAndSignTransactions: sign } as unknown as TransactionSigner;
  const submit = vi.fn(async () => undefined), onReceipt = vi.fn();
  const deps = { getConnection: () => ({ address: owner, walletId: "Test", signer }), submit, onReceipt };
  return { review, deps, sign, submit, onReceipt };
}

describe("explicit non-broadcast diagnostic mode", () => {
  it.each([1, 2, 6])("selects %i transactions in one request without submitting or emitting signature identifiers", async limit => {
    const mode = parseReclaimDiagnostics(`?rbDiagSignLimit=${limit}`);
    expect(mode.mode).toBe("diagnostic");
    if (mode.mode !== "diagnostic") throw new Error("Expected diagnostic mode");
    const f = fixture();
    const receipts = await executeReviewedBatch(f.review, owner, f.deps, mode.options);
    expect(f.sign).toHaveBeenCalledTimes(1);
    expect(f.sign.mock.calls[0][0]).toHaveLength(limit);
    expect(f.submit).not.toHaveBeenCalled();
    expect(receipts).toHaveLength(limit);
    expect(receipts.every(r => r.signature === undefined)).toBe(true);
    expect(f.onReceipt.mock.calls.every(([r]) => r.signature === undefined)).toBe(true);
  });
  it("honors noSubmit independently of the optional transaction limit", async () => {
    const f = fixture();
    await executeReviewedBatch(f.review, owner, f.deps, { noSubmit: true });
    expect(f.sign.mock.calls[0][0]).toHaveLength(6);
    expect(f.submit).not.toHaveBeenCalled();
  });
  it("retains the ordinary grouped-signing flow without diagnostic options", async () => {
    const f = fixture();
    await executeReviewedBatch(f.review, owner, f.deps);
    expect(f.sign).toHaveBeenCalledTimes(1);
    expect(f.sign.mock.calls[0][0]).toHaveLength(6);
    expect(f.submit).toHaveBeenCalledTimes(6);
  });
  it("leaves normal URLs unchanged", () => {
    expect(parseReclaimDiagnostics("")).toEqual({ mode: "normal" });
    expect(parseReclaimDiagnostics("?other=1")).toEqual({ mode: "normal" });
  });
  it.each(["", "0", "3", "-1", "1.5", "NaN", "01", "1&rbDiagSignLimit=2"])("fails closed for invalid diagnostic parameter %s", value => {
    expect(parseReclaimDiagnostics(`?rbDiagSignLimit=${value}`)).toEqual({ mode: "invalid" });
  });
});
