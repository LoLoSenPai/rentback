import type { ReclaimReceipt } from "./solana/reclaim";
import { decimalLamports } from "./solana/reclaim";
import { shareOnXUrl, sharePayloadFromSuccess } from "./share/reclaim-share";

// Wallet-free, JSON-safe presentation DTO, reusable by a future share card.
export type ReclaimSuccess = { reclaimedLamports: string; processedAccounts: number; transactionCount: number; rentBackFeePercent: 0 };

export function confirmedReceipts(receipts: readonly ReclaimReceipt[], owner: string) {
  const seen = new Set<string>();
  return receipts.filter((r) => {
    if (r.owner !== owner || r.status !== "confirmed") return false;
    const key = r.signature ?? `${r.batch.blockhash}:${r.batch.accounts.map((a) => a.address).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildReclaimSuccess(receipts: readonly ReclaimReceipt[], owner: string, currentExcess: string): ReclaimSuccess | null {
  if (decimalLamports(currentExcess) !== 0n || receipts.some((r) => r.owner === owner && r.status === "pending")) return null;
  const confirmed = confirmedReceipts(receipts, owner);
  const total = confirmed.reduce((sum, r) => sum + decimalLamports(r.actualLamports ?? "0"), 0n);
  if (total === 0n) return null;
  return { reclaimedLamports: total.toString(), processedAccounts: new Set(confirmed.flatMap((r) => r.batch.accounts.map((a) => a.address))).size, transactionCount: confirmed.length, rentBackFeePercent: 0 };
}

export function receiptLabel(receipt: ReclaimReceipt) {
  if (receipt.status === "confirmed") return "Confirmed";
  if (receipt.status === "failed") return receipt.signature ? "Submitted and failed on-chain" : "Blocked before submission";
  if (receipt.status === "expired") return "Expired without confirmation";
  return receipt.signature ? "Awaiting network confirmation" : "Awaiting wallet or network outcome";
}

export function reclaimShareUrl(result: ReclaimSuccess): string {
  return shareOnXUrl(sharePayloadFromSuccess(result));
}
