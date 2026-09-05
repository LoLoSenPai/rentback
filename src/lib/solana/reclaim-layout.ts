import {
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  type Transaction,
} from "@solana/kit";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

export type ReclaimAccountOrder = "program-first-use-v1";

// Preparation only. Never normalize a wallet-returned or signed transaction.
// Keep historical receipts on Kit's original layout when the marker is absent.
export function applyReclaimAccountOrder<T extends Transaction>(
  transaction: T,
  order?: ReclaimAccountOrder,
): T {
  if (order === undefined) return transaction;
  if (order !== "program-first-use-v1") throw new Error("Invalid reclaim account order.");
  if (Object.values(transaction.signatures).some((value) => value !== null)) {
    throw new Error("Cannot reorder a signed reclaim transaction.");
  }

  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (message.version !== 0 || message.addressTableLookups?.length) {
    throw new Error("Invalid reclaim message layout.");
  }
  const readonlyStart = message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts;
  const programIndices = [...new Set(message.instructions.map((instruction) => instruction.programAddressIndex))];
  const allowedPrograms: readonly string[] = [COMPUTE_BUDGET_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS];
  if (
    programIndices.length !== message.header.numReadonlyNonSignerAccounts ||
    new Set(message.staticAccounts).size !== message.staticAccounts.length ||
    programIndices.some((index) => index < readonlyStart || !allowedPrograms.includes(message.staticAccounts[index]))
  ) {
    throw new Error("Invalid reclaim program accounts or privileges.");
  }

  // Conventional v0 compilation preserves first-use order within each role.
  // Only the readonly program group changes here. Sources, payer, signer roles,
  // instruction order and data remain untouched. Remap every reference so each
  // instruction still addresses exactly the same program and account metas.
  const staticAccounts = [
    ...message.staticAccounts.slice(0, readonlyStart),
    ...programIndices.map((index) => message.staticAccounts[index]),
  ];
  const remap = message.staticAccounts.map((account) => staticAccounts.indexOf(account));
  const instructions = message.instructions.map((instruction) => ({
    ...instruction,
    programAddressIndex: remap[instruction.programAddressIndex],
    ...(instruction.accountIndices && { accountIndices: instruction.accountIndices.map((index) => remap[index]) }),
  }));
  const messageBytes = getCompiledTransactionMessageEncoder().encode({
    ...message,
    staticAccounts,
    instructions,
  }) as T["messageBytes"];
  return { ...transaction, messageBytes };
}
