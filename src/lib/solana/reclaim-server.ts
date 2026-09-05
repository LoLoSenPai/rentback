import {
  address, createSolanaRpc, getBase64Encoder, getBase64Decoder, getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder, getTransactionDecoder,
  getSignatureFromTransaction, assertIsFullySignedTransaction, isSome, signature,
} from "@solana/kit";
import { getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getTokenDecoder as getToken2022Decoder, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { getConfiguredRpcUrl } from "./rpc";
import {
  assertOwnerMatch, buildReclaimTransaction, decimalLamports, equalBytes, MAX_TRANSACTION_BYTES,
  planReclaimBatches, RECLAIM_PROGRAMS, REVIEW_LIFETIME_MS, toReclaimAccountDto, transactionBytes,
  type ReclaimAccount, type ReclaimAccountDto, type ReclaimBatchDto, type ReclaimReceipt, type ReclaimReview,
} from "./reclaim";

import { assertComputeBudget, computeBudgetFromSimulation } from "./reclaim-budget";
import { buildLegacyReceiptTransaction } from "./reclaim";
import { assertSignedMessageUnchanged } from "./reclaim-message";

export type ReclaimRpc = ReturnType<typeof createSolanaRpc>;
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export function rpcErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "InstructionError" in error) {
    const [index, detail] = (error as { InstructionError: [unknown, unknown] }).InstructionError;
    return `Instruction ${String(index)}: ${typeof detail === "string" ? detail : detail && typeof detail === "object" ? Object.entries(detail).map(([key, value]) => `${key} ${String(value)}`).join(", ") : String(detail)}`;
  }
  return "Transaction validation failed";
}
export async function mainnetReclaimRpc(): Promise<ReclaimRpc> {
  const rpc = createSolanaRpc(getConfiguredRpcUrl());
  if (await rpc.getGenesisHash().send() !== MAINNET_GENESIS) throw new Error("Reclaim RPC is not Solana mainnet.");
  return rpc;
}

export function decodeReclaimAccount(owner: string, pubkey: string, account: { owner: string; data: readonly [string, string]; lamports: bigint; executable: boolean }, rentMinimum: bigint): ReclaimAccount | null {
  if (!(RECLAIM_PROGRAMS as readonly string[]).includes(account.owner) || account.executable || typeof account.lamports !== "bigint") throw new Error("Invalid token account from RPC.");
  const data = getBase64Encoder().encode(account.data[0]);
  if (data.length < 165 || (account.owner === TOKEN_PROGRAM_ADDRESS && data.length !== 165) || (data.length > 165 && data[165] !== 2)) throw new Error("Invalid token account size or type.");
  const token = account.owner === TOKEN_PROGRAM_ADDRESS ? getTokenDecoder().decode(data) : getToken2022Decoder().decode(data);
  if (token.owner !== owner) throw new Error("Token account owner changed. Scan again.");
  if (token.state === 0 || isSome(token.isNative)) return null;
  const excess = account.lamports > rentMinimum ? account.lamports - rentMinimum : 0n;
  if (!excess) return null;
  return { address: pubkey, program: address(account.owner) as ReclaimAccount["program"], dataSize: data.length, lamports: account.lamports, rentMinimum, excess };
}

// Every preparation and submission re-fetches raw accounts and uncached rent.
// No scanner projections, cached rents, client amounts or assumed 165-byte sizes.
export async function fetchFreshReclaimAccounts(rpc: ReclaimRpc, owner: string, candidates?: readonly string[]): Promise<ReclaimAccountDto[]> {
  if (candidates && (candidates.length > 1000 || new Set(candidates).size !== candidates.length)) throw new Error("Invalid candidate list.");
  candidates?.forEach(address);
  const responses = await Promise.all(RECLAIM_PROGRAMS.map((programId) => rpc.getTokenAccountsByOwner(address(owner), { programId }, { encoding: "base64", commitment: "confirmed" }).send()));
  const rows = responses.flatMap((response) => response.value).filter((row) => !candidates || candidates.includes(row.pubkey));
  const sizes = [...new Set(rows.map((row) => getBase64Encoder().encode(row.account.data[0]).length))];
  const rents = new Map(await Promise.all(sizes.map(async (size) => [size, await rpc.getMinimumBalanceForRentExemption(BigInt(size), { commitment: "confirmed" }).send()] as const)));
  return rows.flatMap((row) => {
    const size = getBase64Encoder().encode(row.account.data[0]).length;
    const rent = rents.get(size);
    if (rent === undefined || typeof rent !== "bigint") throw new Error("Invalid rent minimum.");
    const parsed = decodeReclaimAccount(owner, row.pubkey, row.account, rent);
    return parsed ? [toReclaimAccountDto(parsed)] : [];
  }).sort((left, right) => left.address.localeCompare(right.address));
}

export async function prepareReclaim(rpc: ReclaimRpc, owner: string, scannedWallet: string, candidates?: readonly string[]): Promise<ReclaimReview> {
  assertOwnerMatch(owner, scannedWallet);
  const accounts = await fetchFreshReclaimAccounts(rpc, owner, candidates);
  const { value: block } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const lifetime = { blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight.toString(), accountOrder: "program-first-use-v1" as const };
  const groups = planReclaimBatches(accounts, owner, lifetime);
  const batches: ReclaimBatchDto[] = [];
  for (const group of groups) {
    const probe = buildReclaimTransaction(group, owner, lifetime);
    const measured = await rpc.simulateTransaction(getBase64EncodedWireTransaction(probe), { encoding: "base64", sigVerify: false, commitment: "confirmed" }).send();
    if (measured.value.err) throw new Error(`Reclaim simulation failed: ${rpcErrorText(measured.value.err)}. No signature was requested.`);
    const computeBudget = computeBudgetFromSimulation(measured.value.unitsConsumed);
    const finalLifetime = { ...lifetime, computeBudget };
    const transaction = buildReclaimTransaction(group, owner, finalLifetime);
    const simulation = await rpc.simulateTransaction(getBase64EncodedWireTransaction(transaction), { encoding: "base64", sigVerify: false, commitment: "confirmed" }).send();
    if (simulation.value.err) throw new Error(`Reclaim simulation failed: ${rpcErrorText(simulation.value.err)}. No signature was requested.`);
    const fee = await rpc.getFeeForMessage(getBase64Decoder().decode(transaction.messageBytes) as Parameters<ReclaimRpc["getFeeForMessage"]>[0], { commitment: "confirmed" }).send();
    if (fee.value === null) throw new Error("Unable to estimate transaction fee. Refresh the review.");
    const simulatedAt = Date.now();
    batches.push({ ...finalLifetime, accounts: group, expectedLamports: group.reduce((sum, a) => sum + decimalLamports(a.excess), 0n).toString(), feeLamports: fee.value.toString(), simulatedAt, expiresAt: simulatedAt + REVIEW_LIFETIME_MS, wireBytes: transactionBytes(group, owner, finalLifetime) });
  }
  return { owner, chain: "solana:mainnet", batches, eligibleAccounts: accounts.length, expectedLamports: accounts.reduce((sum, a) => sum + decimalLamports(a.excess), 0n).toString(), feeLamports: batches.reduce((sum, b) => sum + decimalLamports(b.feeLamports), 0n).toString() };
}

export async function submitReclaim(rpc: ReclaimRpc, owner: string, scannedWallet: string, batch: ReclaimBatchDto, wire: string) {
  assertComputeBudget(batch.computeBudget);
  assertOwnerMatch(owner, scannedWallet);
  const bytes = getBase64Encoder().encode(wire);
  if (bytes.length > MAX_TRANSACTION_BYTES) throw new Error("Transaction exceeds network size limit.");
  const transaction = getTransactionDecoder().decode(bytes);
  assertIsFullySignedTransaction(transaction);
  const fresh = await fetchFreshReclaimAccounts(rpc, owner, batch.accounts.map((account) => account.address));
  const ordered = batch.accounts.map((account) => fresh.find((item) => item.address === account.address));
  if (ordered.some((account) => !account)) throw new Error("Account eligibility changed. Refresh remaining excess before signing again.");
  if (ordered.some((account, index) => account!.excess !== batch.accounts[index].excess || account!.rentMinimum !== batch.accounts[index].rentMinimum || account!.dataSize !== batch.accounts[index].dataSize)) throw new Error("Account balance or rent changed since review. Refresh remaining excess.");
  const expected = buildReclaimTransaction(ordered as ReclaimAccountDto[], owner, batch);
  if (!equalBytes(transaction.messageBytes, expected.messageBytes)) {
    try { assertSignedMessageUnchanged(expected.messageBytes, transaction.messageBytes); }
    catch (cause) { throw new Error(`Signed transaction differs from the approved reclaim instructions. ${cause instanceof Error ? cause.message : "Submission stopped."}`); }
  }
  if (await rpc.getBlockHeight({ commitment: "confirmed" }).send() > decimalLamports(batch.lastValidBlockHeight)) throw new Error("Transaction expired. Refresh the review.");
  const simulation = await rpc.simulateTransaction(getBase64EncodedWireTransaction(transaction), { encoding: "base64", sigVerify: true, commitment: "confirmed" }).send();
  if (simulation.value.err) throw new Error(`Signed reclaim simulation failed: ${rpcErrorText(simulation.value.err)}`);
  // RPC verifies the actual signature; no server key or signing authority exists.
  const sent = await rpc.sendTransaction(getBase64EncodedWireTransaction(transaction), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0n }).send();
  if (sent !== getSignatureFromTransaction(transaction)) throw new Error("RPC returned an unexpected transaction signature.");
  return sent;
}

export async function readReclaimReceipt(rpc: ReclaimRpc, receipt: ReclaimReceipt): Promise<ReclaimReceipt> {
  address(receipt.owner);
  if (receipt.signature) {
    const tx = await rpc.getTransaction(signature(receipt.signature), { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 0 }).send();
    if (tx) {
      if (tx.meta?.err) return { ...receipt, status: "failed", actualLamports: "0", error: rpcErrorText(tx.meta.err) };
      if (!tx.meta) throw new Error("Transaction metadata is not available yet.");
      const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(tx.transaction[0]));
      const expected = receipt.batch.computeBudget ? buildReclaimTransaction(receipt.batch.accounts, receipt.owner, receipt.batch) : buildLegacyReceiptTransaction(receipt.batch.accounts, receipt.owner, receipt.batch);
      if (!equalBytes(decoded.messageBytes, expected.messageBytes)) throw new Error("Confirmed transaction differs from the reviewed reclaim.");
      const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
      if (message.version !== 0) throw new Error("Unexpected transaction version.");
      let actual = 0n;
      for (const account of receipt.batch.accounts) {
        const index = message.staticAccounts.indexOf(address(account.address));
        if (index < 0) throw new Error("Reclaim account missing from confirmed transaction.");
        const delta = tx.meta.preBalances[index] - tx.meta.postBalances[index];
        if (delta < 0n) throw new Error("Unexpected source balance change.");
        actual += delta;
      }
      const destination = message.staticAccounts.indexOf(address(receipt.owner));
      if (tx.meta.postBalances[destination] - tx.meta.preBalances[destination] + tx.meta.fee !== actual) throw new Error("Reclaim destination balance did not reconcile.");
      return { ...receipt, status: "confirmed", actualLamports: actual.toString(), feeLamports: tx.meta.fee.toString(), error: undefined };
    }
    const status = await rpc.getSignatureStatuses([signature(receipt.signature)], { searchTransactionHistory: true }).send();
    if (status.value[0]?.err) return { ...receipt, status: "failed", actualLamports: "0", error: rpcErrorText(status.value[0].err) };
    // A landed transaction with delayed metadata is not safe to retry.
    if (status.value[0]) return { ...receipt, status: "pending" };
  }
  const height = await rpc.getBlockHeight({ commitment: "finalized" }).send();
  return { ...receipt, status: height > decimalLamports(receipt.batch.lastValidBlockHeight) + 32n ? "expired" : "pending" };
}
