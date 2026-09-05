import type { ReclaimSuccess } from "../reclaim-result";
import { SITE_URL } from "../site";

export type ReclaimSharePayload = {
  amountReclaimedSol: string;
  accountsProcessed: number;
  rentBackFeePercent: 0;
  txCount?: number;
  walletShort?: string;
  confirmedSignatures?: string[];
  timestamp?: string;
  network: "mainnet";
  hasRemainingExcess: boolean;
  remainingClaimableSol?: string;
};

export const SHARE_SIZE = { width: 1200, height: 630 };
const allowedKeys = new Set(["v", "amount", "accounts", "fee", "txs", "network", "partial", "remaining", "walletShort", "timestamp", "signatures"]);
export class InvalidSharePayload extends Error { constructor() { super("Invalid reclaim share data."); } }

function solLamports(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,9})?$/.test(value)) throw new InvalidSharePayload();
  const [whole, decimal = ""] = value.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(decimal.padEnd(9, "0"));
}
export function lamportsToShareSol(value: string | bigint): string {
  if (typeof value === "string" && !/^(0|[1-9][0-9]{0,20})$/.test(value)) throw new InvalidSharePayload();
  const amount = BigInt(value);
  if (amount < 0n) throw new InvalidSharePayload();
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${amount / 1_000_000_000n}${fraction ? `.${fraction}` : ""}`;
}
function count(value: unknown, max: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) throw new InvalidSharePayload();
  return value;
}

export function validateSharePayload(input: ReclaimSharePayload): ReclaimSharePayload {
  if (!input || input.network !== "mainnet" || input.rentBackFeePercent !== 0 || typeof input.hasRemainingExcess !== "boolean") throw new InvalidSharePayload();
  const amount = solLamports(input.amountReclaimedSol);
  if (amount === 0n) throw new InvalidSharePayload();
  const result: ReclaimSharePayload = { amountReclaimedSol: lamportsToShareSol(amount), accountsProcessed: count(input.accountsProcessed, 1_000_000), rentBackFeePercent: 0, network: "mainnet", hasRemainingExcess: input.hasRemainingExcess };
  if (input.txCount !== undefined) result.txCount = count(input.txCount, 10_000);
  if (input.walletShort !== undefined) {
    if (typeof input.walletShort !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{3,6}\.\.\.[1-9A-HJ-NP-Za-km-z]{3,6}$/.test(input.walletShort)) throw new InvalidSharePayload();
    result.walletShort = input.walletShort;
  }
  if (input.timestamp !== undefined) {
    if (typeof input.timestamp !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.timestamp) || !Number.isFinite(Date.parse(input.timestamp)) || new Date(input.timestamp).toISOString() !== input.timestamp) throw new InvalidSharePayload();
    result.timestamp = input.timestamp;
  }
  if (input.confirmedSignatures !== undefined) {
    if (!Array.isArray(input.confirmedSignatures) || input.confirmedSignatures.length > 10 || input.confirmedSignatures.some((s) => typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s)) || new Set(input.confirmedSignatures).size !== input.confirmedSignatures.length) throw new InvalidSharePayload();
    result.confirmedSignatures = [...input.confirmedSignatures];
  }
  if (input.remainingClaimableSol !== undefined) {
    const remaining = solLamports(input.remainingClaimableSol);
    if (input.hasRemainingExcess !== (remaining > 0n)) throw new InvalidSharePayload();
    result.remainingClaimableSol = lamportsToShareSol(remaining);
  }
  return result;
}

export function sharePayloadFromSuccess(result: ReclaimSuccess, remainingLamports = "0"): ReclaimSharePayload {
  // The completion DTO is built from confirmed receipts, never a scan estimate.
  const remaining = lamportsToShareSol(remainingLamports);
  return validateSharePayload({ amountReclaimedSol: lamportsToShareSol(result.reclaimedLamports), accountsProcessed: result.processedAccounts, rentBackFeePercent: result.rentBackFeePercent, txCount: result.transactionCount, network: "mainnet", hasRemainingExcess: remaining !== "0", remainingClaimableSol: remaining === "0" ? undefined : remaining });
}

export function formatShareSol(value: string, short = false): string {
  let lamports = solLamports(value);
  if (short) {
    const rounded = ((lamports + 50_000n) / 100_000n) * 100_000n;
    if (rounded > 0n) lamports = rounded;
  }
  const [whole, fraction] = lamportsToShareSol(lamports).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

export function buildShareCardViewModel(input: ReclaimSharePayload) {
  const data = validateSharePayload(input);
  const amount = formatShareSol(data.amountReclaimedSol);
  return {
    amount, amountFontSize: amount.length > 19 ? 66 : amount.length > 14 ? 80 : 108,
    status: data.hasRemainingExcess ? "PARTIAL RECLAIM" : "RECLAIM COMPLETE",
    accounts: data.accountsProcessed.toLocaleString("en-US"), accountLabel: data.accountsProcessed === 1 ? "token account processed" : "token accounts processed",
    transactions: data.txCount?.toLocaleString("en-US"), transactionLabel: data.txCount === 1 ? "transaction confirmed" : "transactions confirmed",
    fee: "0%", trust: "No tokens burned. No accounts closed.", productHost: new URL(SITE_URL).host,
    remaining: data.hasRemainingExcess ? data.remainingClaimableSol ? `${formatShareSol(data.remainingClaimableSol)} SOL still claimable` : "More excess remains to reclaim" : undefined,
    walletShort: data.walletShort, date: data.timestamp?.slice(0, 10),
  };
}

export function shareSearchParams(input: ReclaimSharePayload): URLSearchParams {
  const data = validateSharePayload(input);
  const params = new URLSearchParams({ v: "1", amount: data.amountReclaimedSol, accounts: String(data.accountsProcessed), fee: "0", network: "mainnet", partial: data.hasRemainingExcess ? "1" : "0" });
  if (data.txCount !== undefined) params.set("txs", String(data.txCount));
  if (data.walletShort) params.set("walletShort", data.walletShort);
  if (data.timestamp) params.set("timestamp", data.timestamp);
  if (data.remainingClaimableSol !== undefined) params.set("remaining", data.remainingClaimableSol);
  if (data.confirmedSignatures?.length) params.set("signatures", data.confirmedSignatures.join(","));
  return params;
}
export function parseShareSearchParams(params: URLSearchParams): ReclaimSharePayload {
  if (params.toString().length > 1800) throw new InvalidSharePayload();
  for (const key of params.keys()) if (!allowedKeys.has(key) || params.getAll(key).length !== 1) throw new InvalidSharePayload();
  const required = (key: string) => { const value = params.get(key); if (value === null) throw new InvalidSharePayload(); return value; };
  const integer = (value: string) => { if (!/^[1-9][0-9]{0,6}$/.test(value)) throw new InvalidSharePayload(); return Number(value); }; // Counts only, never SOL.
  if ((params.get("v") ?? "1") !== "1" || (params.get("fee") ?? "0") !== "0" || (params.get("network") ?? "mainnet") !== "mainnet" || !["0", "1"].includes(params.get("partial") ?? "0")) throw new InvalidSharePayload();
  return validateSharePayload({ amountReclaimedSol: required("amount"), accountsProcessed: integer(required("accounts")), rentBackFeePercent: 0, network: "mainnet", hasRemainingExcess: params.get("partial") === "1", txCount: params.has("txs") ? integer(required("txs")) : undefined, walletShort: params.get("walletShort") ?? undefined, timestamp: params.get("timestamp") ?? undefined, remainingClaimableSol: params.get("remaining") ?? undefined, confirmedSignatures: params.has("signatures") ? required("signatures").split(",") : undefined });
}
export const sharePreviewPath = (data: ReclaimSharePayload) => `/share/reclaim?${shareSearchParams(data)}`;
export const shareImagePath = (data: ReclaimSharePayload) => `/api/share/reclaim-image?${shareSearchParams(data)}`;
export const shareDownloadPath = (data: ReclaimSharePayload) => `${shareImagePath(data)}&download=1`;
export function shareText(input: ReclaimSharePayload): string {
  const data = validateSharePayload(input);
  return `Recovered ${formatShareSol(data.amountReclaimedSol, true)} SOL in excess rent with RentBack. ${data.hasRemainingExcess ? "More excess remains to reclaim." : "Old Solana token accounts had more SOL than they needed."}`;
}
export function shareOnXUrl(data: ReclaimSharePayload): string {
  return `https://x.com/intent/post?${new URLSearchParams({ text: shareText(data), url: `${SITE_URL}${sharePreviewPath(data)}` })}`;
}
export function sharePostText(data: ReclaimSharePayload): string {
  return `${shareText(data)}\n\n${SITE_URL}`;
}
