import {
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  isTransactionSendingSigner,
  type TransactionSigner,
} from "@solana/kit";
import {
  assertOwnerMatch,
  assertReviewReady,
  buildReclaimTransaction,
  type ReclaimReceipt,
  type ReclaimReview,
} from "./reclaim";
import { assertWalletReclaimMessage } from "./reclaim-wallet-policy";

export async function reclaimRequest<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/reclaim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value.error === "string" ? value.error : "Reclaim request failed.",
    );
  return value as T;
}

export type ReclaimConnection = {
  address: string;
  signer: TransactionSigner | null;
  walletId: string;
};
export type ExecuteReclaimDependencies = {
  getConnection: () => ReclaimConnection | null;
  submit: (receipt: ReclaimReceipt, wire: string) => Promise<unknown>;
  onReceipt: (receipt: ReclaimReceipt) => void;
};

// Called only from an explicit button click.
// Builds and signs all reviewed transactions in one wallet request.
// Nothing is broadcast until every wallet-returned transaction passes validation.
export async function executeReviewedBatch(
  review: ReclaimReview,
  scannedWallet: string,
  deps: ExecuteReclaimDependencies,
): Promise<ReclaimReceipt[]> {
  const active = deps.getConnection();
  const connection = active ? { ...active } : null;

  assertOwnerMatch(connection?.address ?? null, scannedWallet);
  assertReviewReady(review, scannedWallet);

  if (!connection?.signer || !review.batches.length) {
    throw new Error("This wallet cannot sign a reclaim transaction.");
  }

  const signer = connection.signer;

  if (signer.address !== connection.address) {
    throw new Error("Signer changed. Review the connected account again.");
  }

  if (
    review.batches.some((batch) => batch.walletPolicy) &&
    !isTransactionModifyingSigner(signer) &&
    !isTransactionPartialSigner(signer)
  ) {
    throw new Error(
      "This wallet cannot return signed transactions for safety checks. Choose a wallet that supports sign-only transactions.",
    );
  }

  const transactions = review.batches.map((batch) => {
    const transaction = buildReclaimTransaction(
      batch.accounts,
      scannedWallet,
      batch,
      signer,
    );

    assertIsTransactionWithinSizeLimit(transaction);

    return transaction;
  });

  let receipts: ReclaimReceipt[] = review.batches.map((batch) => ({
    owner: scannedWallet,
    batch,
    status: "pending",
  }));

  // Persist every intent before opening the wallet.
  for (const receipt of receipts) {
    deps.onReceipt(receipt);
  }

  const assertSameConnection = () => {
    const current = deps.getConnection();

    if (
      current?.address !== connection.address ||
      current.walletId !== connection.walletId ||
      current.signer !== signer
    ) {
      throw new Error(
        "Wallet account changed. Submission stopped; refresh before continuing.",
      );
    }
  };

  if (
    isTransactionModifyingSigner(signer) ||
    isTransactionPartialSigner(signer)
  ) {
    let validated: {
      wire: string;
      signature: string;
    }[] = [];

    /*
     * SIGN + VALIDATE PHASE
     *
     * No transaction is submitted inside this try block.
     * Therefore, if anything fails here, it is safe to mark
     * every intent as failed.
     */
    try {
      const signedTransactions = await (async () => {
        if (isTransactionModifyingSigner(signer)) {
          return signer.modifyAndSignTransactions(transactions);
        }

        const signatureSets = await signer.signTransactions(transactions);

        if (signatureSets.length !== transactions.length) {
          throw new Error(
            "Wallet returned an unexpected number of signed transactions. Nothing was submitted by RentBack.",
          );
        }

        return transactions.map((transaction, index) => ({
          ...transaction,
          signatures: {
            ...transaction.signatures,
            ...signatureSets[index],
          },
        }));
      })();

      assertSameConnection();

      if (signedTransactions.length !== transactions.length) {
        throw new Error(
          "Wallet returned an unexpected number of signed transactions. Nothing was submitted by RentBack.",
        );
      }

      // Validate EVERY transaction before broadcasting TX #1.
      validated = signedTransactions.map((signed, index) => {
        if (!signed) {
          throw new Error(
            "Wallet returned no signed transaction. Nothing was submitted by RentBack.",
          );
        }

        assertWalletReclaimMessage(
          transactions[index].messageBytes,
          signed.messageBytes,
          review.batches[index],
        );

        assertIsFullySignedTransaction(signed);
        assertIsTransactionWithinSizeLimit(signed);

        return {
          wire: getBase64EncodedWireTransaction(signed),
          signature: getSignatureFromTransaction(signed),
        };
      });

      // Persist every signature before network submission.
      receipts = receipts.map((receipt, index) => ({
        ...receipt,
        signature: validated[index].signature,
      }));

      for (const receipt of receipts) {
        deps.onReceipt(receipt);
      }
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Wallet rejected the transactions.";

      const failed = receipts.map((receipt) => ({
        ...receipt,
        status: "failed" as const,
        error: message,
      }));

      for (const receipt of failed) {
        deps.onReceipt(receipt);
      }

      throw cause;
    }

    /*
     * SUBMISSION PHASE
     *
     * At this point all transactions have:
     * - been signed
     * - passed RentBack validation
     * - had their signatures persisted
     *
     * A submission error is NOT treated as a definite failure because
     * the RPC response may have been lost after broadcast.
     */
    for (let index = 0; index < validated.length; index++) {
      try {
        await deps.submit(receipts[index], validated[index].wire);
      } catch (cause) {
        /*
         * The transaction whose submission just failed stays pending:
         * it may actually have reached the network.
         *
         * Later transactions were never submitted by RentBack, so they
         * can safely be marked failed and retried once the unresolved
         * transaction has been reconciled.
         */
        for (
          let skippedIndex = index + 1;
          skippedIndex < receipts.length;
          skippedIndex++
        ) {
          const skipped: ReclaimReceipt = {
            ...receipts[skippedIndex],
            status: "failed",
            error:
              "Not submitted because an earlier transaction outcome is unresolved.",
          };

          receipts[skippedIndex] = skipped;
          deps.onReceipt(skipped);
        }

        throw cause;
      }
    }

    return receipts;
  }

  /*
   * Legacy / sending-only wallets.
   *
   * signAndSendTransactions may already have broadcast transactions
   * before returning, so never convert an uncertain outcome to "failed".
   */
  if (isTransactionSendingSigner(signer)) {
    const signatures = await signer.signAndSendTransactions(transactions);

    // Save every signature we did receive before doing any further checks.
    const returnedCount = Math.min(signatures.length, receipts.length);

    for (let index = 0; index < returnedCount; index++) {
      const receipt: ReclaimReceipt = {
        ...receipts[index],
        signature: getBase58Decoder().decode(signatures[index]),
      };

      receipts[index] = receipt;
      deps.onReceipt(receipt);
    }

    if (signatures.length !== transactions.length) {
      throw new Error(
        "Wallet returned an unexpected number of transaction signatures. Check status before retrying.",
      );
    }

    assertSameConnection();

    return receipts;
  }

  throw new Error("This wallet does not support transaction signing.");
}

export function hasUnresolvedReclaim(
  receipts: readonly ReclaimReceipt[],
  owner: string,
) {
  return receipts.some(
    (receipt) => receipt.owner === owner && receipt.status === "pending",
  );
}
export function remainingCandidates(
  review: ReclaimReview,
  receipts: readonly ReclaimReceipt[],
) {
  const completed = new Set(
    receipts
      .filter(
        (receipt) =>
          receipt.owner === review.owner && receipt.status === "confirmed",
      )
      .flatMap((receipt) =>
        receipt.batch.accounts.map((account) => account.address),
      ),
  );
  return review.batches
    .flatMap((batch) => batch.accounts.map((account) => account.address))
    .filter((candidate) => !completed.has(candidate));
}
