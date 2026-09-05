"use client";

import { useEffect, useRef, useState } from "react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { walletClient } from "@/lib/solana/wallet-client";
import { formatLamportsAsSol } from "@/lib/rent-calculations";
import { getWalletOwnershipState } from "@/lib/solana/wallet-ownership";
import { decimalLamports, type ReclaimReceipt, type ReclaimReview } from "@/lib/solana/reclaim";
import { executeReviewedBatch, hasUnresolvedReclaim, reclaimRequest, remainingCandidates } from "@/lib/solana/reclaim-client";
import type { RentBackApiResult } from "@/lib/solana/scan";
import { shortWallet } from "./wallet-control";
import { buildReclaimSuccess, confirmedReceipts, receiptLabel } from "@/lib/reclaim-result";
import { publicApiError } from "@/lib/api-safety";
import { sharePayloadFromSuccess, sharePreviewPath } from "@/lib/share/reclaim-share";
import { ShareActions } from "./share/reclaim/share-actions";

const primary = "min-h-11 rounded-xl bg-rent-accent px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50";
const secondary = "min-h-11 rounded-xl border border-rent-border px-4 py-2 text-sm text-slate-200 disabled:opacity-50";
const storageKey = "rentback:reclaim-receipts:v1";
const sol = (value: string) => `${formatLamportsAsSol(decimalLamports(value))} SOL`;

export function ReclaimPanel({ scan, onConnect, onRescan }: { scan: RentBackApiResult; onConnect: () => void; onRescan: (owner: string) => Promise<void> }) {
  const connection = useConnectedWallet(walletClient);
  const owner = scan.scannedWallet;
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  const state = getWalletOwnershipState({ scanResult: scan, connectedWalletAddress: connection?.account.address ?? null }).state;
  const [review, setReview] = useState<ReclaimReview | null>(null);
  const [receipts, setReceipts] = useState<ReclaimReceipt[]>([]);
  const receiptRef = useRef<ReclaimReceipt[]>([]);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [progress, setProgress] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as ReclaimReceipt[];
      if (Array.isArray(saved) && saved.length <= 1000 && saved.every((entry) => entry && typeof entry.owner === "string" && Array.isArray(entry.batch?.accounts) && ["pending", "confirmed", "failed", "expired"].includes(entry.status))) {
        receiptRef.current = saved; setReceipts(saved); setHistoryReady(true);
      } else throw new Error("Invalid transaction history.");
    } catch { setError("Previous transaction history could not be loaded. Check your wallet activity before retrying."); }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  useEffect(() => { setReview(null); }, [connection?.account.address, connection?.wallet.name, owner]);

  function saveReceipt(receipt: ReclaimReceipt) {
    const key = (entry: ReclaimReceipt) => `${entry.owner}:${entry.batch.blockhash}:${entry.batch.accounts.map((a) => a.address).join(",")}`;
    const next = [...receiptRef.current.filter((entry) => key(entry) !== key(receipt)), receipt];
    // Persist only public transaction receipts, never wallet auth or signatures
    // over messages. This is history, not wallet auto-connection.
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    receiptRef.current = next;
    if (mounted.current) setReceipts(next);
  }
  async function run(task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { await task(); }
    catch (cause) { if (mounted.current) setError(publicApiError(cause, "Reclaim could not complete. Check transaction status before retrying.")); }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); setProgress(""); } }
  }
  async function prepare(candidates?: string[]) {
    if (!historyReady) throw new Error("Transaction history is unavailable. Check your wallet activity before retrying.");
    if (hasUnresolvedReclaim(receiptRef.current, owner)) throw new Error("A transaction is still unresolved. Check its status before retrying.");
    setProgress("Checking current accounts, rent and simulations...");
    const next = await reclaimRequest<ReclaimReview>({ action: "prepare", owner, scannedWallet: owner, candidates });
    if (walletClient.wallet.getState().connected?.account.address !== owner) throw new Error("Wallet account changed. Connect the scanned wallet again.");
    if (mounted.current && activeOwner.current === owner) setReview(next);
  }
  async function checkReceipt(receipt: ReclaimReceipt, poll: boolean) {
    let next = receipt;
    for (let attempt = 0; attempt < (poll ? 25 : 1); attempt++) {
      next = await reclaimRequest<ReclaimReceipt>({ action: "status", receipt: next });
      saveReceipt(next);
      if (next.status !== "pending") break;
      if (poll) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    await onRescan(owner);
    return next;
  }
  async function reclaim() {
    if (!historyReady || !review || hasUnresolvedReclaim(receiptRef.current, owner)) throw new Error("Refresh the review before continuing.");
    const reviewed = review;
    const completed = receiptRef.current.filter((entry) => entry.owner === owner && entry.status === "confirmed").length;
    setProgress(`Transaction ${completed + 1} of ${completed + reviewed.batches.length}: continue in your wallet`);
    try {
      const receipt = await executeReviewedBatch(reviewed, owner, {
        getConnection: () => {
          const current = walletClient.wallet.getState().connected;
          return current ? { address: current.account.address, signer: current.signer, walletId: current.wallet.name } : null;
        },
        onReceipt: saveReceipt,
        submit: (receipt, wire) => reclaimRequest({ action: "submit", owner, scannedWallet: owner, batch: receipt.batch, wire }),
      });
      setProgress(`Transaction ${completed + 1}: waiting for confirmation...`);
      const confirmed = await checkReceipt(receipt, true);
      setReview(null);
      if (confirmed.status === "confirmed") {
        const candidates = remainingCandidates(reviewed, receiptRef.current);
        if (candidates.length && mounted.current) await prepare(candidates);
      } else if (confirmed.status === "pending") throw new Error("Confirmation is still pending. Your transaction history is saved; check status before retrying.");
      else throw new Error(confirmed.error ?? "Transaction did not complete. Refresh remaining excess to retry.");
    } catch (cause) {
      setReview(null);
      // Refresh the public scan even on rejection or network failure. A wallet
      // may have broadcast successfully before the response was lost.
      try { await onRescan(owner); } catch { /* Keep the original failure and all receipts. */ }
      throw cause;
    }
  }
  const history = receipts.filter((receipt) => receipt.owner === owner);
  const unresolved = hasUnresolvedReclaim(receipts, owner);
  const expired = review?.batches.some((batch) => now >= batch.expiresAt);
  const confirmed = confirmedReceipts(receipts, owner);
  const actual = confirmed.reduce((total, receipt) => total + decimalLamports(receipt.actualLamports ?? "0"), 0n);
  const success = buildReclaimSuccess(receipts, owner, scan.totals.claimableNowLamports);
  const attempts = history.filter((receipt) => receipt.status !== "confirmed");

  return <div className="mt-5 space-y-3 border-t border-rent-border pt-5">
    {success && <div role="status" className="space-y-2 rounded-xl border border-rent-accent/30 bg-rent-accent/5 p-4">
      <h3 className="break-words text-2xl font-semibold text-rent-accent">{sol(success.reclaimedLamports)} reclaimed</h3>
      <p className="text-sm text-slate-200">{success.processedAccounts} token accounts processed</p>
      <p className="text-sm text-slate-200">0% RentBack fee</p>
      <p className="text-xs text-slate-400">Confirmed amount before network fees. No current excess remains.</p>
      <ShareActions data={sharePayloadFromSuccess(success)} />
      <a className="inline-flex min-h-11 items-center text-sm text-slate-300 underline underline-offset-4" href={sharePreviewPath(sharePayloadFromSuccess(success))} target="_blank" rel="noopener noreferrer">Preview share card</a>
    </div>}
    {!success && state === "disconnected" && <><button type="button" className={primary} onClick={onConnect}>Connect wallet</button><p className="text-sm text-slate-400">Connect the scanned wallet to prepare the reclaim.</p></>}
    {!success && state === "mismatched" && <><p className="text-sm">This is not the wallet you scanned.</p><p className="break-words text-xs text-slate-400">Scanned: {shortWallet(owner)} / Connected: {shortWallet(connection!.account.address)}</p><button type="button" className={secondary} onClick={onConnect}>Connect scanned wallet</button></>}
    {!success && state === "no-claimable" && <p className="text-sm text-slate-300">No excess SOL currently available to reclaim.</p>}
    {!success && state === "matching" && <>
      <p className="text-sm text-rent-accent">Connected to the scanned wallet.</p>
      {!review && <button type="button" className={primary} disabled={busy || unresolved || !connection?.signer} onClick={() => void run(() => prepare())}>Review reclaim</button>}
      {!connection?.signer && <p className="text-sm text-slate-400">This account is read-only. Choose a wallet account that can authorize transactions.</p>}
      {review && <div className="space-y-3 rounded-xl border border-rent-border bg-rent-bg/70 p-4">
        <p className="text-xl font-semibold">Reclaim {sol(review.expectedLamports)}</p>
        <p className="text-sm text-slate-300">{review.eligibleAccounts} accounts / {review.batches.length} transactions</p>
        <p className="text-xs text-slate-400">Estimated network fees: {sol(review.feeLamports)}. RentBack fee: 0%.</p>
        <p className="text-sm text-slate-200">Only excess SOL will move to your connected wallet. Tokens stay untouched and token accounts stay open.</p>
        <p className="text-xs text-slate-400">Mainnet / Destination: {shortWallet(owner)}. Each transaction needs your approval.</p>
        {review.batches.length === 0 ? <p className="text-sm">No excess remains after rechecking the accounts.</p> : expired ? <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => prepare(remainingCandidates(review, receiptRef.current)))}>Refresh expired review</button> :
          <button type="button" className={primary} disabled={busy || unresolved} onClick={() => void run(reclaim)}>Reclaim {sol(review.batches[0].expectedLamports)}{review.batches.length > 1 ? " / next transaction" : ""}</button>}
      </div>}
    </>}
    {progress && <p role="status" aria-live="polite" className="text-sm text-rent-accent">{progress}</p>}
    {error && !success && <p role="alert" className="break-words text-sm text-red-300">{error}</p>}
    {unresolved && <><p className="text-sm text-amber-200">A transaction may still be processing. Check status before starting another reclaim.</p><button type="button" className={secondary} disabled={busy} onClick={() => void run(async () => { for (const receipt of receiptRef.current.filter((entry) => entry.owner === owner && entry.status === "pending")) await checkReceipt(receipt, false); })}>Check transaction status</button></>}
    {confirmed.length > 0 && <div className="space-y-2 text-sm">
      {!success && <p>Confirmed reclaimed: {formatLamportsAsSol(actual)} SOL <span className="text-xs text-slate-400">before network fees</span></p>}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-slate-300">View transaction details</summary>
        <div className="space-y-2 pb-2">{confirmed.map((receipt, index) => <div key={`${receipt.batch.blockhash}-${index}`} className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400">Confirmed</span>
          {receipt.signature && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt.signature) && <a href={`https://explorer.solana.com/tx/${receipt.signature}`} target="_blank" rel="noopener noreferrer" className="break-all text-rent-accent underline">{shortWallet(receipt.signature)}</a>}
        </div>)}</div>
      </details>
    </div>}
    {attempts.length > 0 && <details className="text-xs text-slate-400">
      <summary className="min-h-11 cursor-pointer py-3">Technical attempt history</summary>
      <div className="space-y-3 pb-2">{attempts.map((receipt, index) => <div key={`${receipt.batch.blockhash}-${index}`} className="space-y-1 break-words">
        <p>{receiptLabel(receipt)}</p>
        {receipt.signature && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt.signature) && <a href={`https://explorer.solana.com/tx/${receipt.signature}`} target="_blank" rel="noopener noreferrer" className="break-all text-rent-accent underline">{shortWallet(receipt.signature)}</a>}
        {receipt.error && <p>{publicApiError(new Error(receipt.error), "This attempt did not complete. Check its status before retrying.")}</p>}
      </div>)}</div>
    </details>}
  </div>;
}
