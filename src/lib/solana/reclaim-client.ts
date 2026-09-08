import {
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  getBase58Decoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  isTransactionSendingSigner,
  getTransactionEncoder,
  type ReadonlyUint8Array,
  type Transaction,
  type TransactionSigner,
} from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  assertOwnerMatch,
  assertReviewReady,
  buildReclaimTransaction,
  type ReclaimReceipt,
  type ReclaimReview,
} from "./reclaim";
import { assertWalletReclaimMessage } from "./reclaim-wallet-policy";
import { TOKEN_PROGRAM_ADDRESS as SPL_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

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
  onSigningDiagnostics?: (report: ReclaimSigningDiagnosticReport) => void;
};

export type ReclaimSigningDiagnosticReport = {
  schemaVersion: 1;
  capturedAt: string;
  capturePoint: "before-wallet-signing";
  network: "solana:mainnet";
  noSubmit: boolean;
  selectedTransactions: number;
  totalTransactions: number;
  transactions: ReturnType<typeof buildSigningDiagnostics>;
};

export type ExecuteReclaimDiagnostics = {
  signerTransactionLimit?: number;
  noSubmit?: boolean;
};

const DEV_SIGNER_BATCH_LIMIT = 0;
const DEV_DIAGNOSTICS_ENABLED =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

function clampLimit(limit: number, total: number) {
  return Math.max(1, Math.min(total, limit));
}

function selectedSignerBatchLimit(total: number, override?: number) {
  if (typeof override === "number" && override > 0)
    return clampLimit(override, total);
  if (!DEV_DIAGNOSTICS_ENABLED || DEV_SIGNER_BATCH_LIMIT <= 0) return 1;
  return clampLimit(DEV_SIGNER_BATCH_LIMIT, total);
}

function shouldLogDiagnostics(override?: number, noSubmit = false) {
  return DEV_DIAGNOSTICS_ENABLED || typeof override === "number" || noSubmit;
}

function isDiagnosticNoSubmitEnabled(
  totalTransactions: number,
  override?: number,
  noSubmit = false,
) {
  return totalTransactions > 0 && (noSubmit || typeof override === "number");
}

function diagnosticLogContext(override?: number, selected?: number, total?: number, noSubmit = false) {
  return {
    source: override ? "query" : DEV_DIAGNOSTICS_ENABLED ? "local" : "none",
    selectedTransactions: selected,
    totalTransactions: total,
    noSubmit: isDiagnosticNoSubmitEnabled(total ?? 0, override, noSubmit),
  };
}

function readComputeLimitAndPrice(data: ReadonlyUint8Array | undefined) {
  if (!data || data.length !== 5) return null;
  const view = new DataView(Uint8Array.from(data).buffer);
  return new DataView(view.buffer).getUint32(1, true);
}

function readMicroLamports(data: ReadonlyUint8Array | undefined) {
  if (!data || data.length !== 9) return null;
  const bytes = Uint8Array.from(data);
  return new DataView(bytes.buffer).getBigUint64(1, true).toString();
}

function buildSigningDiagnostics(transactions: readonly Transaction[]) {
  return transactions.map((transaction, index) => {
    const message = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    );
    if (message.version !== 0) {
      throw new Error("Signing diagnostics only support v0 reclaim transactions.");
    }
    const withdrawals = message.instructions.slice(2);
    const sourceAccounts = new Set<string>();
    let tokenInstructions = 0;
    let token2022Instructions = 0;
    let otherInstructions = 0;
    for (const instruction of withdrawals) {
      const program = message.staticAccounts[instruction.programAddressIndex];
      if (program === SPL_TOKEN_PROGRAM_ADDRESS) tokenInstructions += 1;
      else if (program === TOKEN_2022_PROGRAM_ADDRESS)
        token2022Instructions += 1;
      else otherInstructions += 1;
      const source = instruction.accountIndices?.[0];
      if (typeof source === "number" && message.staticAccounts[source])
        sourceAccounts.add(message.staticAccounts[source]);
    }
    return {
      index: index + 1,
      instructions: message.instructions.length,
      bytes: getTransactionEncoder().encode(transaction).length,
      messageBytes: transaction.messageBytes.length,
      computeUnitLimit: readComputeLimitAndPrice(message.instructions[0]?.data),
      computeUnitPrice: readMicroLamports(message.instructions[1]?.data),
      accountCount: message.staticAccounts.length,
      sourceAccounts: sourceAccounts.size,
      tokenInstructions,
      token2022Instructions,
      otherInstructions,
      // Message bytes have no signatures. Include a normalized representation
      // so local/production comparisons can ignore only the recent blockhash.
      messageBase64: getBase64Decoder().decode(transaction.messageBytes),
      version: message.version,
      header: message.header,
      recentBlockhash: message.lifetimeToken,
      staticAccounts: [...message.staticAccounts],
      compiledInstructions: message.instructions.map((instruction) => ({
        programAddressIndex: instruction.programAddressIndex,
        accountIndices: [...(instruction.accountIndices ?? [])],
        dataBase64: getBase64Decoder().decode(instruction.data ?? new Uint8Array()),
      })),
      addressTableLookups: message.addressTableLookups ?? [],
    };
  });
}

function logSigningDiagnostics(
  transactions: readonly Transaction[],
  selected: number,
  options?: ExecuteReclaimDiagnostics,
) {
  const limit = options?.signerTransactionLimit;
  if (!shouldLogDiagnostics(limit, options?.noSubmit)) return;
  const diagnostics = buildSigningDiagnostics(transactions);
  const selectedDiagnostics = diagnostics.slice(0, selected);
  console.info("[RentBack][Diag] signing request summary", {
    ...diagnosticLogContext(limit, selected, transactions.length, options?.noSubmit),
    diagnostics: selectedDiagnostics,
  });
}

export async function executeReviewedBatch(
  review: ReclaimReview,
  scannedWallet: string,
  deps: ExecuteReclaimDependencies,
  diagnostics: ExecuteReclaimDiagnostics = {},
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

  if (
    isDiagnosticNoSubmitEnabled(review.batches.length, diagnostics.signerTransactionLimit, diagnostics.noSubmit) &&
    isTransactionSendingSigner(signer) &&
    !isTransactionModifyingSigner(signer) &&
    !isTransactionPartialSigner(signer)
  ) {
    throw new Error(
      "Diagnostic mode does not support wallets that broadcast during signing. Use a wallet with sign-only tx APIs.",
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
  const selectedTransactionCount = selectedSignerBatchLimit(
    transactions.length,
    diagnostics.signerTransactionLimit,
  );
  const selectedTransactions = transactions.slice(0, selectedTransactionCount);
  const selectedBatches = review.batches.slice(0, selectedTransactionCount);

  logSigningDiagnostics(transactions, selectedTransactionCount, diagnostics);
  if (isDiagnosticNoSubmitEnabled(transactions.length, diagnostics.signerTransactionLimit, diagnostics.noSubmit)) {
    deps.onSigningDiagnostics?.({
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      capturePoint: "before-wallet-signing",
      network: "solana:mainnet",
      noSubmit: true,
      selectedTransactions: selectedTransactionCount,
      totalTransactions: transactions.length,
      transactions: buildSigningDiagnostics(selectedTransactions),
    });
  }

  if (
    diagnostics.signerTransactionLimit &&
    selectedTransactionCount !== transactions.length
  ) {
    console.warn(
      "[RentBack][Diag] Active: only first transactions are sent to the wallet signer",
      { onlyFirst: selectedTransactionCount, total: transactions.length },
    );
  }

  let receipts: ReclaimReceipt[] = selectedBatches.map((batch) => ({
    owner: scannedWallet,
    batch,
    status: "pending",
  }));

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
    let validated: { wire: string; signature: string }[] = [];

    try {
      const signedTransactions = await (async () => {
        if (isTransactionModifyingSigner(signer)) {
          return signer.modifyAndSignTransactions(selectedTransactions);
        }
        const signatureSets = await signer.signTransactions(selectedTransactions);
        if (signatureSets.length !== selectedTransactions.length) {
          throw new Error(
            "Wallet returned an unexpected number of signed transactions.",
          );
        }
        return selectedTransactions.map((transaction, index) => ({
          ...transaction,
          signatures: { ...transaction.signatures, ...signatureSets[index] },
        }));
      })();

      assertSameConnection();

      if (signedTransactions.length !== selectedTransactions.length) {
        throw new Error(
          "Wallet returned an unexpected number of signed transactions.",
        );
      }

      validated = signedTransactions.map((signed, index) => {
        if (!signed) {
          throw new Error("Wallet returned no signed transaction.");
        }
        assertWalletReclaimMessage(
          selectedTransactions[index].messageBytes,
          signed.messageBytes,
          selectedBatches[index],
        );
        assertIsFullySignedTransaction(signed);
        assertIsTransactionWithinSizeLimit(signed);
        return {
          wire: getBase64EncodedWireTransaction(signed),
          signature: getSignatureFromTransaction(signed),
        };
      });

      if (isDiagnosticNoSubmitEnabled(transactions.length, diagnostics.signerTransactionLimit, diagnostics.noSubmit)) {
        // Never persist a signed transaction identifier or reach submit in a
        // diagnostic run. The panel keeps these attempts out of receipt history.
        const skipped = receipts.map((receipt) => ({
          ...receipt,
          status: "failed" as const,
          error: "Diagnostic mode: signatures were validated locally but not submitted.",
        }));
        for (const receipt of skipped) deps.onReceipt(receipt);
        return skipped;
      }

      receipts = receipts.map((receipt, index) => ({
        ...receipt,
        signature: validated[index].signature,
      }));
      for (const receipt of receipts) {
        deps.onReceipt(receipt);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Wallet rejected the transactions.";
      const failed = receipts.map((receipt) => ({ ...receipt, status: "failed" as const, error: message }));
      for (const receipt of failed) {
        deps.onReceipt(receipt);
      }
      throw cause;
    }

    for (let index = 0; index < validated.length; index++) {
      try {
        await deps.submit(receipts[index], validated[index].wire);
      } catch (cause) {
        for (
          let skippedIndex = index + 1;
          skippedIndex < receipts.length;
          skippedIndex++
        ) {
          const skipped: ReclaimReceipt = {
            ...receipts[skippedIndex],
            status: "failed",
            error: "Not submitted because an earlier transaction outcome is unresolved.",
          };
          receipts[skippedIndex] = skipped;
          deps.onReceipt(skipped);
        }
        throw cause;
      }
    }

    return receipts;
  }

  if (isTransactionSendingSigner(signer)) {
    const signatures = await signer.signAndSendTransactions(selectedTransactions);
    const returnedCount = Math.min(signatures.length, receipts.length);
    for (let index = 0; index < returnedCount; index++) {
      const receipt: ReclaimReceipt = {
        ...receipts[index],
        signature: getBase58Decoder().decode(signatures[index]),
      };
      receipts[index] = receipt;
      deps.onReceipt(receipt);
    }
    if (signatures.length !== selectedTransactions.length) {
      throw new Error(
        "Wallet returned an unexpected number of transaction signatures.",
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
      .filter((receipt) => receipt.owner === review.owner && receipt.status === "confirmed")
      .flatMap((receipt) => receipt.batch.accounts.map((account) => account.address)),
  );
  return review.batches
    .flatMap((batch) => batch.accounts.map((account) => account.address))
    .filter((candidate) => !completed.has(candidate));
}
