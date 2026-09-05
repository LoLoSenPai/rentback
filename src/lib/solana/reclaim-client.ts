import {
  assertIsFullySignedTransaction, assertIsTransactionWithinSizeLimit, getBase58Decoder,
  getBase64EncodedWireTransaction, getSignatureFromTransaction,
  isTransactionModifyingSigner, isTransactionPartialSigner, isTransactionSendingSigner,
  type TransactionSigner,
} from "@solana/kit";
import {
  assertOwnerMatch, assertReviewReady, buildReclaimTransaction,
  type ReclaimReceipt, type ReclaimReview,
} from "./reclaim";
import { assertWalletReclaimMessage } from "./reclaim-wallet-policy";

export async function reclaimRequest<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/reclaim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Reclaim request failed.");
  return value as T;
}

export type ReclaimConnection = { address: string; signer: TransactionSigner | null; walletId: string };
export type ExecuteReclaimDependencies = {
  getConnection: () => ReclaimConnection | null;
  submit: (receipt: ReclaimReceipt, wire: string) => Promise<unknown>;
  onReceipt: (receipt: ReclaimReceipt) => void;
};

// Called only from an explicit button click. Does not prepare or sign later
// batches automatically; that also preserves Android's trusted-gesture handoff.
export async function executeReviewedBatch(review: ReclaimReview, scannedWallet: string, deps: ExecuteReclaimDependencies): Promise<ReclaimReceipt> {
  const active = deps.getConnection();
  const connection = active ? { ...active } : null;
  assertOwnerMatch(connection?.address ?? null, scannedWallet);
  assertReviewReady(review, scannedWallet);
  if (!connection?.signer || !review.batches.length) throw new Error("This wallet cannot sign a reclaim transaction.");
  const signer = connection.signer;
  if (signer.address !== connection.address) throw new Error("Signer changed. Review the connected account again.");
  const batch = review.batches[0];
  if (batch.walletPolicy && !isTransactionModifyingSigner(signer) && !isTransactionPartialSigner(signer)) {
    throw new Error("This wallet cannot return a signed transaction for safety checks. Choose a wallet that supports sign-only transactions.");
  }
  const transaction = buildReclaimTransaction(batch.accounts, scannedWallet, batch, signer);
  assertIsTransactionWithinSizeLimit(transaction);
  let receipt: ReclaimReceipt = { owner: scannedWallet, batch, status: "pending" };
  // Record intent BEFORE asking the wallet. If a sending wallet times out after
  // broadcast, retries stay blocked until status or blockhash expiry resolves it.
  deps.onReceipt(receipt);
  const assertSameConnection = () => {
    const current = deps.getConnection();
    if (current?.address !== connection.address || current.walletId !== connection.walletId || current.signer !== signer) throw new Error("Wallet account changed. Submission stopped; refresh before continuing.");
  };
  if (isTransactionModifyingSigner(signer) || isTransactionPartialSigner(signer)) {
    let signed;
    try {
      signed = isTransactionModifyingSigner(signer)
      ? (await signer.modifyAndSignTransactions([transaction]))[0]
      : { ...transaction, signatures: { ...transaction.signatures, ...(await signer.signTransactions([transaction]))[0] } };
    assertSameConnection();
    if (!signed) throw new Error("Wallet returned no signed transaction. Nothing was submitted by RentBack.");
    assertWalletReclaimMessage(transaction.messageBytes, signed.messageBytes, batch);
    assertIsFullySignedTransaction(signed);
    assertIsTransactionWithinSizeLimit(signed);
    } catch (cause) {
      deps.onReceipt({ ...receipt, status: "failed", error: cause instanceof Error ? cause.message : "Wallet rejected the transaction." });
      throw cause;
    }
    receipt = { ...receipt, signature: getSignatureFromTransaction(signed) };
    deps.onReceipt(receipt); // Known before network submission; survives response loss.
    await deps.submit(receipt, getBase64EncodedWireTransaction(signed));
  } else if (isTransactionSendingSigner(signer)) {
    // MWA wallets may expose only sign-and-send. The exact allowlisted, simulated
    // message is passed to the selected wallet; the confirmed message is checked
    // by the server before reporting any reclaimed amount.
    const signatures = await signer.signAndSendTransactions([transaction]);
    if (signatures.length !== 1) throw new Error("Wallet returned no transaction signature. Check status before retrying.");
    receipt = { ...receipt, signature: getBase58Decoder().decode(signatures[0]) };
    deps.onReceipt(receipt);
  } else throw new Error("This wallet does not support transaction signing.");
  return receipt;
}

export function hasUnresolvedReclaim(receipts: readonly ReclaimReceipt[], owner: string) {
  return receipts.some((receipt) => receipt.owner === owner && receipt.status === "pending");
}
export function remainingCandidates(review: ReclaimReview, receipts: readonly ReclaimReceipt[]) {
  const completed = new Set(receipts.filter((receipt) => receipt.owner === review.owner && receipt.status === "confirmed").flatMap((receipt) => receipt.batch.accounts.map((account) => account.address)));
  return review.batches.flatMap((batch) => batch.accounts.map((account) => account.address)).filter((candidate) => !completed.has(candidate));
}
