import { applyReclaimAccountOrder, type ReclaimAccountOrder } from "./reclaim-layout";
import {
  address, appendTransactionMessageInstructions, blockhash, compileTransaction,
  createNoopSigner, createTransactionMessage, getTransactionEncoder,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Instruction, type ReadonlyUint8Array, type TransactionSigner,
} from "@solana/kit";
import { getWithdrawExcessLamportsInstruction as withdrawToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getWithdrawExcessLamportsInstruction as withdrawToken2022, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

import { assertComputeBudget, buildComputeBudgetInstructions, PLANNING_COMPUTE_BUDGET, type ReclaimComputeBudget } from "./reclaim-budget";

export const MAX_TRANSACTION_BYTES = 1232;
export const REVIEW_LIFETIME_MS = 30_000;
export const RECLAIM_PROGRAMS = [TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS] as const;
export type ReclaimProgram = typeof RECLAIM_PROGRAMS[number];
export type ReclaimAccount = {
  address: string; program: ReclaimProgram; dataSize: number;
  lamports: bigint; rentMinimum: bigint; excess: bigint;
};
export type ReclaimAccountDto = Omit<ReclaimAccount, "lamports" | "rentMinimum" | "excess"> & {
  lamports: string; rentMinimum: string; excess: string;
};
export type ReclaimLifetime = { accountOrder?: ReclaimAccountOrder; blockhash: string; lastValidBlockHeight: string; computeBudget?: ReclaimComputeBudget };
export type ReclaimBatchDto = ReclaimLifetime & {
  accounts: ReclaimAccountDto[]; expectedLamports: string; feeLamports: string;
  simulatedAt: number; expiresAt: number; wireBytes: number;
};
export type ReclaimReview = {
  owner: string; chain: "solana:mainnet"; batches: ReclaimBatchDto[];
  eligibleAccounts: number; expectedLamports: string; feeLamports: string;
};
export type ReclaimReceipt = {
  signature?: string; owner: string; batch: ReclaimBatchDto;
  status: "pending" | "confirmed" | "failed" | "expired";
  actualLamports?: string; feeLamports?: string; error?: string;
};

export function assertOwnerMatch(connected: string | null, scanned: string) {
  if (!connected || connected !== scanned) throw new Error("Connect the exact wallet you scanned before reclaiming.");
  address(connected);
}
export function decimalLamports(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid lamport amount.");
  return BigInt(value);
}
export function toReclaimAccountDto(account: ReclaimAccount): ReclaimAccountDto {
  return { ...account, lamports: account.lamports.toString(), rentMinimum: account.rentMinimum.toString(), excess: account.excess.toString() };
}
export function assertWithdrawOnly(instructions: readonly Instruction[], owner: string) {
  if (!instructions.length) throw new Error("No eligible accounts remain.");
  const sources = new Set<string>();
  for (const ix of instructions) {
    if (!(RECLAIM_PROGRAMS as readonly string[]).includes(ix.programAddress) || ix.data?.length !== 1 || ix.data[0] !== 38 || ix.accounts?.length !== 3)
      throw new Error("Transaction contains an instruction outside the reclaim allowlist.");
    const [source, destination, authority] = ix.accounts;
    if (source.address === owner || sources.has(source.address) || source.role !== 1 || destination.address !== owner || destination.role !== 1 || authority.address !== owner || authority.role !== 2)
      throw new Error("Invalid reclaim source, destination or authority.");
    sources.add(source.address);
  }
}
export function buildWithdrawInstructions(accounts: readonly Pick<ReclaimAccountDto, "address" | "program">[], owner: string, signer: TransactionSigner = createNoopSigner(address(owner))) {
  if (signer.address !== owner) throw new Error("Reclaim signer does not match the owner.");
  const instructions = accounts.map((account) => {
    const input = { source: address(account.address), destination: address(owner), authority: signer };
    if (account.program === TOKEN_PROGRAM_ADDRESS) return withdrawToken(input);
    if (account.program === TOKEN_2022_PROGRAM_ADDRESS) return withdrawToken2022(input);
    throw new Error("Unsupported token program.");
  });
  assertWithdrawOnly(instructions, owner);
  return instructions;
}
export function buildReclaimTransaction(accounts: readonly Pick<ReclaimAccountDto, "address" | "program">[], owner: string, lifetime: ReclaimLifetime, signer?: TransactionSigner) {
  const instructions = [...buildComputeBudgetInstructions(lifetime.computeBudget ?? PLANNING_COMPUTE_BUDGET), ...buildWithdrawInstructions(accounts, owner, signer)];
  const message = appendTransactionMessageInstructions(instructions,
    setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(lifetime.blockhash), lastValidBlockHeight: decimalLamports(lifetime.lastValidBlockHeight) },
      setTransactionMessageFeePayer(address(owner), createTransactionMessage({ version: 0 }))));
  return applyReclaimAccountOrder(compileTransaction(message), lifetime.accountOrder);
}
// Historical receipt verification only. Never used to prepare, sign or submit a new reclaim.
export function buildLegacyReceiptTransaction(accounts: readonly Pick<ReclaimAccountDto, "address" | "program">[], owner: string, lifetime: ReclaimLifetime, signer?: TransactionSigner) {
  const instructions = buildWithdrawInstructions(accounts, owner, signer);
  const message = appendTransactionMessageInstructions(instructions,
    setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(lifetime.blockhash), lastValidBlockHeight: decimalLamports(lifetime.lastValidBlockHeight) },
      setTransactionMessageFeePayer(address(owner), createTransactionMessage({ version: 0 }))));
  return compileTransaction(message);
}
export function transactionBytes(accounts: readonly Pick<ReclaimAccountDto, "address" | "program">[], owner: string, lifetime: ReclaimLifetime) {
  return getTransactionEncoder().encode(buildReclaimTransaction(accounts, owner, lifetime)).length;
}
export function planReclaimBatches(accounts: readonly ReclaimAccountDto[], owner: string, lifetime: ReclaimLifetime): ReclaimAccountDto[][] {
  const groups: ReclaimAccountDto[][] = [];
  let current: ReclaimAccountDto[] = [];
  const seen = new Set<string>();
  for (const account of accounts) {
    if (seen.has(account.address)) throw new Error("Duplicate reclaim account.");
    seen.add(account.address);
    if (decimalLamports(account.excess) === 0n) continue;
    if (transactionBytes([...current, account], owner, lifetime) > MAX_TRANSACTION_BYTES) {
      if (!current.length) throw new Error("Account cannot fit in a transaction.");
      groups.push(current); current = [];
    }
    current.push(account);
    if (transactionBytes(current, owner, lifetime) > MAX_TRANSACTION_BYTES) throw new Error("Transaction exceeds network size limit.");
  }
  if (current.length) groups.push(current);
  return groups;
}
export function equalBytes(left: ReadonlyUint8Array, right: ReadonlyUint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
export function assertReviewReady(review: ReclaimReview, owner: string, now = Date.now()) {
  if (review.chain !== "solana:mainnet" || review.owner !== owner) throw new Error("Review belongs to another wallet or network.");
  let total = 0n; let fees = 0n; let count = 0;
  const sources = new Set<string>();
  for (const batch of review.batches) {
    assertComputeBudget(batch.computeBudget);
    if (now >= batch.expiresAt || batch.expiresAt - batch.simulatedAt > REVIEW_LIFETIME_MS || batch.simulatedAt > now + 5000) throw new Error("Review expired. Refresh before signing.");
    let subtotal = 0n;
    for (const account of batch.accounts) {
      if (sources.has(account.address)) throw new Error("Duplicate reclaim account.");
      sources.add(account.address);
      const excess = decimalLamports(account.excess);
      if (!excess || decimalLamports(account.lamports) - decimalLamports(account.rentMinimum) !== excess) throw new Error("Inconsistent reclaim amounts.");
      subtotal += excess; count++;
    }
    if (subtotal !== decimalLamports(batch.expectedLamports) || transactionBytes(batch.accounts, owner, batch) > MAX_TRANSACTION_BYTES) throw new Error("Invalid transaction review.");
    total += subtotal; fees += decimalLamports(batch.feeLamports);
  }
  if (total !== decimalLamports(review.expectedLamports) || fees !== decimalLamports(review.feeLamports) || count !== review.eligibleAccounts) throw new Error("Invalid review totals.");
}
