import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, type ReadonlyUint8Array } from "@solana/kit";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { assertSignedMessageUnchanged } from "./reclaim-message";
import { RECLAIM_COMPUTE_CEILING, RECLAIM_COMPUTE_PRICE } from "./reclaim-budget";

export const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
export const RECLAIM_WALLET_POLICY = "lighthouse-assertions-v1" as const;
// A bounded allowance, not a fixed account batch size. The planner reserves it
// and the validator enforces it against the actual wallet-returned message.
export const WALLET_MESSAGE_RESERVE_BYTES = 384;
export const WALLET_MAX_FEE_LAMPORTS = 25_000n;
export type ReclaimWalletPolicy = typeof RECLAIM_WALLET_POLICY;
type Policy = { walletPolicy?: ReclaimWalletPolicy };

function reject(reason: string): never {
  throw new Error(`Your wallet changed the transaction instructions: ${reason}. Nothing was submitted by RentBack.`);
}

export function walletMessageReserve(policy: Policy): number {
  if (policy.walletPolicy === undefined) return 0;
  if (policy.walletPolicy !== RECLAIM_WALLET_POLICY) reject("unsupported wallet safety policy");
  return WALLET_MESSAGE_RESERVE_BYTES;
}

export function assertWalletFee(fee: bigint, policy: Policy) {
  walletMessageReserve(policy);
  if (policy.walletPolicy && (fee < 0n || fee > WALLET_MAX_FEE_LAMPORTS)) reject("network fee exceeds the reviewed maximum");
}

// Explicit subset of Lighthouse's Borsh ABI, reviewed at source revision
// 4c579479c98635e419b1b167f08be02a71604a71. No legacy SDK dependency.
// Only AccountInfo / TokenAccount single and multi assertions. No arbitrary
// account-data reads, delta/memory accounts, writes, closes, or noop-CPI logging.
export function assertLighthouseData(data: ReadonlyUint8Array): "account" | "token" {
  if (data.length < 3 || data.length > 128) reject("invalid Lighthouse assertion length");
  let offset = 0;
  const byte = () => {
    if (offset >= data.length) reject("truncated Lighthouse assertion");
    return data[offset++];
  };
  const take = (size: number) => { for (let i = 0; i < size; i++) byte(); };
  const enumeration = (max: number) => { const value = byte(); if (value > max) reject("unknown Lighthouse assertion field"); return value; };
  const kind = byte();
  if (![5, 6, 9, 10].includes(kind)) reject("unsupported Lighthouse instruction");
  // Borsh enum ordinals, NOT the Rust repr(u8) discriminant values.
  if (![0, 1, 2, 4, 5].includes(byte())) reject("unsupported Lighthouse logging mode");
  const token = kind === 9 || kind === 10;
  // Multi uses unsigned LEB128; our 1..16 bound is always one canonical byte.
  const count = kind === 6 || kind === 10 ? enumeration(16) : 1;
  if (count === 0) reject("empty Lighthouse assertion");
  for (let i = 0; i < count; i++) {
    const field = enumeration(token ? 8 : 7);
    if (token) {
      if (field === 8) continue; // TokenAccountOwnerIsDerived: reads only.
      if (field === 0 || field === 1) { take(32); enumeration(1); }
      else if (field === 2 || field === 6) { take(8); enumeration(7); }
      else if (field === 4) { enumeration(2); enumeration(7); }
      else { if (enumeration(1)) take(field === 5 ? 8 : 32); enumeration(1); }
    } else {
      if (field === 0 || field === 1 || field === 4) { take(8); enumeration(7); }
      else if (field === 2) { take(32); enumeration(1); }
      else if (field === 3) { enumeration(8); enumeration(1); }
      else { enumeration(1); enumeration(1); }
    }
  }
  if (offset !== data.length) reject("trailing Lighthouse assertion data");
  return token ? "token" : "account";
}

const sameBytes = (a: ReadonlyUint8Array, b: ReadonlyUint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

function decode(bytes: ReadonlyUint8Array) {
  const message = getCompiledTransactionMessageDecoder().decode(bytes);
  if (message.version !== 0 || message.addressTableLookups?.length) reject("unsupported message version or lookup tables");
  if (!sameBytes(getCompiledTransactionMessageEncoder().encode(message), bytes)) reject("noncanonical message encoding");
  const { numSignerAccounts: signers, numReadonlySignerAccounts: readonlySigners, numReadonlyNonSignerAccounts: readonly } = message.header;
  const keys = message.staticAccounts;
  if (signers !== 1 || readonlySigners !== 0 || readonly > keys.length - signers || new Set(keys).size !== keys.length) reject("invalid signer or account table");
  const metas = keys.map((address, index) => ({ address, signer: index < signers, writable: index < signers || index < keys.length - readonly }));
  const at = (index: number) => { if (!metas[index]) reject("invalid instruction account index"); return metas[index]; };
  const instructions = message.instructions.map((instruction) => ({
    program: at(instruction.programAddressIndex).address,
    accounts: (instruction.accountIndices ?? []).map(at),
    data: instruction.data ?? new Uint8Array(),
  }));
  return { message, metas, instructions };
}

/** Validate, never rewrite/recompile the signed message. Old receipts stay strict. */
export function assertWalletReclaimMessage(preparedBytes: ReadonlyUint8Array, signedBytes: ReadonlyUint8Array, policy: Policy) {
  const reserve = walletMessageReserve(policy);
  if (!reserve) return assertSignedMessageUnchanged(preparedBytes, signedBytes);
  // One signature + shortvec signature count. Both messages must fit, including
  // the reserved wallet envelope for the original review.
  if (preparedBytes.length + 65 + reserve > 1232 || signedBytes.length + 65 > 1232 || signedBytes.length - preparedBytes.length > reserve) reject("wallet additions exceed the reserved transaction size");
  let prepared: ReturnType<typeof decode>, signed: ReturnType<typeof decode>;
  try { prepared = decode(preparedBytes); signed = decode(signedBytes); }
  catch { reject("invalid or unsupported transaction message"); }
  if (prepared.message.lifetimeToken !== signed.message.lifetimeToken || prepared.metas[0].address !== signed.metas[0].address) reject("fee payer or recent blockhash changed");
  const originalMetas = new Map(prepared.metas.map((meta) => [meta.address, meta]));
  for (const meta of prepared.metas) {
    if (JSON.stringify(meta) !== JSON.stringify(signed.metas.find((entry) => entry.address === meta.address))) reject("original account addresses or privileges changed");
  }
  for (const meta of signed.metas) {
    if (!originalMetas.has(meta.address) && (meta.address !== LIGHTHOUSE_PROGRAM || meta.signer || meta.writable)) reject("unapproved account added");
  }
  const readBudget = (instructions: typeof prepared.instructions) => {
    const [limit, price] = instructions;
    if (!limit || !price || limit.program !== COMPUTE_BUDGET_PROGRAM_ADDRESS || price.program !== COMPUTE_BUDGET_PROGRAM_ADDRESS || limit.accounts.length || price.accounts.length || limit.data.length !== 5 || limit.data[0] !== 2 || price.data.length !== 9 || price.data[0] !== 3) reject("invalid Compute Budget instructions or ordering");
    const units = new DataView(Uint8Array.from(limit.data).buffer).getUint32(1, true);
    const microLamports = new DataView(Uint8Array.from(price.data).buffer).getBigUint64(1, true);
    if (units < 10000 || units > RECLAIM_COMPUTE_CEILING || microLamports !== BigInt(RECLAIM_COMPUTE_PRICE)) reject("Compute Budget exceeds the reviewed policy");
    return { units, microLamports };
  };
  const beforeBudget = readBudget(prepared.instructions);
  const afterBudget = readBudget(signed.instructions);
  if (afterBudget.units < beforeBudget.units) reject("compute limit reduced below the simulated requirement");
  assertWalletFee(5000n + (BigInt(afterBudget.units) * afterBudget.microLamports + 999999n) / 1000000n, policy);
  const withdrawals = prepared.instructions.slice(2);
  const owner = prepared.metas[0].address;
  const sources = new Set<string>();
  for (const ix of withdrawals) {
    if (![TOKEN_PROGRAM_ADDRESS as string, TOKEN_2022_PROGRAM_ADDRESS as string].includes(ix.program) || ix.data.length !== 1 || ix.data[0] !== 38 || ix.accounts.length !== 3 || ix.accounts[0].address === owner || !ix.accounts[0].writable || ix.accounts[0].signer || ix.accounts[1].address !== owner || ix.accounts[2].address !== owner || sources.has(ix.accounts[0].address)) reject("invalid original withdrawal plan");
    sources.add(ix.accounts[0].address);
  }
  if (!withdrawals.length) reject("empty withdrawal plan");
  let cursor = 0, assertions = 0;
  for (const ix of signed.instructions.slice(2)) {
    if (ix.program === LIGHTHOUSE_PROGRAM) {
      if (++assertions > 2 * (sources.size + 1) || ix.accounts.length !== 1) reject("invalid Lighthouse assertion accounts or count");
      const kind = assertLighthouseData(ix.data);
      const target = ix.accounts[0].address;
      if (!sources.has(target) && (kind === "token" || target !== owner)) reject("Lighthouse assertion targets an unrelated account");
      continue;
    }
    const original = withdrawals[cursor++];
    if (!original || ix.program !== original.program || JSON.stringify(ix.accounts) !== JSON.stringify(original.accounts) || !sameBytes(ix.data, original.data)) reject("withdrawal instructions changed or an unapproved instruction was added");
  }
  if (cursor !== withdrawals.length) reject("withdrawal instructions were removed");
  if (signed.metas.some((meta) => meta.address === LIGHTHOUSE_PROGRAM) && !assertions) reject("unused Lighthouse program account");
}
