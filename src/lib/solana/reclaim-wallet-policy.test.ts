import { describe, expect, it, vi } from "vitest";
import {
  address, getAddressDecoder, getBase64Decoder, getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getSignatureFromTransaction,
  getTransactionEncoder, type Transaction, type TransactionSigner,
} from "@solana/kit";
import { getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { buildReclaimTransaction, planReclaimBatches, transactionBytes, type ReclaimAccountDto, type ReclaimBatchDto, type ReclaimReceipt, type ReclaimReview } from "./reclaim";
import { assertLighthouseData, assertWalletFee, assertWalletReclaimMessage, LIGHTHOUSE_PROGRAM, RECLAIM_WALLET_POLICY, WALLET_MESSAGE_RESERVE_BYTES } from "./reclaim-wallet-policy";
import { executeReviewedBatch, remainingCandidates } from "./reclaim-client";
import { readReclaimReceipt, submitReclaim, type ReclaimRpc } from "./reclaim-server";

const owner = address("D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw");
const key = (n: number) => getAddressDecoder().decode(Uint8Array.from({ length: 32 }, (_, i) => i === 0 ? n % 256 : i === 1 ? Math.floor(n / 256) : 7));
const accounts = (count = 12): ReclaimAccountDto[] => Array.from({ length: count }, (_, i) => ({ address: key(i + 1), program: i % 6 === 5 ? TOKEN_2022_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS, dataSize: 165, lamports: "3000000", rentMinimum: "2000000", excess: "1000000" }));
const lifetime = { walletPolicy: RECLAIM_WALLET_POLICY, blockhash: "11111111111111111111111111111111", lastValidBlockHeight: "1000", computeBudget: { units: 10000, microLamports: "100000" } };
const batch = (rows = accounts()): ReclaimBatchDto => ({ ...lifetime, accounts: rows, expectedLamports: (BigInt(rows.length) * 1000000n).toString(), feeLamports: "6000", simulatedAt: Date.now(), expiresAt: Date.now() + 30000, wireBytes: transactionBytes(rows, owner, lifetime) });
const review = (batches: ReclaimBatchDto[]): ReclaimReview => ({ owner, chain: "solana:mainnet", batches, eligibleAccounts: batches.reduce((n, b) => n + b.accounts.length, 0), expectedLamports: batches.reduce((n, b) => n + BigInt(b.expectedLamports), 0n).toString(), feeLamports: batches.reduce((n, b) => n + BigInt(b.feeLamports), 0n).toString() });
function message(transaction: Transaction) {
  const value = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (value.version !== 0) throw new Error("Expected v0 fixture");
  return value;
}
type Message = ReturnType<typeof message>;
function change(transaction: Transaction, transform: (value: Message) => Message): Transaction {
  return { ...transaction, messageBytes: getCompiledTransactionMessageEncoder().encode(transform(message(transaction))) as Transaction["messageBytes"] };
}
function signed(transaction: Transaction): Transaction {
  return { ...transaction, signatures: { [owner]: new Uint8Array(64).fill(7) as NonNullable<Transaction["signatures"][typeof owner]> } };
}
function guarded(transaction: Transaction, rows = accounts()): Transaction {
  return change(transaction, (m) => {
    const programAddressIndex = m.staticAccounts.length;
    const guards = [...rows.map((row) => ({ programAddressIndex, accountIndices: [m.staticAccounts.indexOf(address(row.address))], data: Uint8Array.from([9, 0, 2, ...Array(8).fill(0), 0]) })), { programAddressIndex, accountIndices: [0], data: Uint8Array.from([5, 0, 0, ...Array(8).fill(0), 4]) }];
    const instructions = [...m.instructions];
    const limit = Uint8Array.from(instructions[0].data!);
    new DataView(limit.buffer).setUint32(1, 82428, true);
    instructions[0] = { ...instructions[0], data: limit };
    return { ...m, staticAccounts: [...m.staticAccounts, address(LIGHTHOUSE_PROGRAM)], header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts + 1 }, instructions: [...instructions, ...guards] };
  });
}
const prepared = () => buildReclaimTransaction(accounts(), owner, lifetime);
const validate = (tx: Transaction, original = prepared()) => assertWalletReclaimMessage(original.messageBytes, tx.messageBytes, lifetime);

function rpcFixture(tx = signed(guarded(prepared())), rows = accounts(), fee = 13243n) {
  const method = <T,>(value: T) => vi.fn(() => ({ send: vi.fn(async () => value) }));
  const raw = rows.map((row) => ({ pubkey: address(row.address), account: { owner: row.program, executable: false, lamports: BigInt(row.lamports), data: [getBase64Decoder().decode(getTokenEncoder().encode({ mint: key(999), owner, amount: 0n, delegate: null, state: 1, isNative: null, delegatedAmount: 0n, closeAuthority: null })), "base64"] as const } }));
  const m = message(tx);
  const preBalances = m.staticAccounts.map((k) => k === owner ? 100000000n : rows.some((r) => r.address === k) ? 3000000n : 0n);
  const postBalances = m.staticAccounts.map((k, i) => k === owner ? preBalances[i] + BigInt(rows.length) * 1000000n - fee : rows.some((r) => r.address === k) ? 2000000n : 0n);
  const methods = {
    getTokenAccountsByOwner: vi.fn((_owner: unknown, filter: { programId: string }) => ({ send: async () => ({ value: raw.filter((r) => r.account.owner === filter.programId) }) })),
    getMinimumBalanceForRentExemption: method(2000000n), getBlockHeight: method(10n),
    simulateTransaction: method({ value: { err: null, unitsConsumed: 75000n } }),
    getFeeForMessage: method({ value: fee }), sendTransaction: method(getSignatureFromTransaction(signed(tx))),
    getTransaction: method({ transaction: [getBase64EncodedWireTransaction(tx), "base64"], meta: { err: null, fee, preBalances, postBalances } }),
  };
  return { rpc: methods as unknown as ReclaimRpc, methods };
}

describe("bounded Lighthouse assertion policy", () => {
  it("accepts an unchanged signed message and the modeled 14 -> 27 Phantom assertion message", () => {
    validate(signed(prepared()));
    const tx = guarded(prepared());
    expect(message(tx).instructions).toHaveLength(27);
    validate(tx);
    expect(getTransactionEncoder().encode(tx).length).toBeLessThanOrEqual(1232);
  });
  it("retains byte-exact validation for old reviews without an opt-in marker", () => {
    expect(() => assertWalletReclaimMessage(prepared().messageBytes, guarded(prepared()).messageBytes, {})).toThrow("Your wallet changed");
  });
  it.each([5, 6, 9, 10])("decodes only the reviewed single/multi assertion %i", (kind) => {
    const multi = kind === 6 || kind === 10;
    const field = kind < 9 ? 0 : 2;
    expect(assertLighthouseData(Uint8Array.from([kind, 0, ...(multi ? [1] : []), field, ...Array(8).fill(0), 0]))).toBe(kind < 9 ? "account" : "token");
  });
  it.each([0, 1, 2, 3, 4, 7, 8, 11, 12, 13, 14, 15, 16, 17, 255])("rejects nonallowlisted Lighthouse discriminator %i", (kind) => {
    expect(() => assertLighthouseData(Uint8Array.from([kind, 0, 0]))).toThrow();
  });
  it.each([
    [5, 3, 0, ...Array(8).fill(0), 0], [5, 6, 0, ...Array(8).fill(0), 0],
    [6, 0, 0], [6, 0, 129, 0], [6, 0, 17], [5, 0, 8],
    [9, 0, 3, 2, 0], [9, 0, 2, ...Array(8).fill(0), 8],
    [5, 0, 5, 2, 0], [5, 0, 0], [5, 0, 0, ...Array(8).fill(0), 0, 0],
  ])("rejects malformed data, unsupported fields and noop-CPI logging (%j)", (...data: number[]) => {
    expect(() => assertLighthouseData(Uint8Array.from(data))).toThrow();
  });
  it("parses optional pubkeys, u64, booleans, known owners and derived-account assertions", () => {
    for (const field of [0, 1, 3, 7]) assertLighthouseData(Uint8Array.from([9, 0, field, ...([3, 7].includes(field) ? [1] : []), ...Array(32).fill(7), 0]));
    for (const field of [3, 7]) assertLighthouseData(Uint8Array.from([9, 0, field, 0, 0]));
    assertLighthouseData(Uint8Array.from([9, 0, 5, 1, ...Array(8).fill(0), 0]));
    assertLighthouseData(Uint8Array.from([9, 0, 8]));
    assertLighthouseData(Uint8Array.from([5, 0, 3, 8, 0]));
    assertLighthouseData(Uint8Array.from([5, 0, 7, 0, 0]));
  });
  it("accepts only semantic account-table reordering, never privilege changes", () => {
    const tx = change(guarded(prepared()), (m) => {
      const order = m.staticAccounts.map((_, i) => i);
      [order[1], order[2]] = [order[2], order[1]];
      return { ...m, staticAccounts: order.map((i) => m.staticAccounts[i]), instructions: m.instructions.map((ix) => ({ ...ix, programAddressIndex: order.indexOf(ix.programAddressIndex), accountIndices: ix.accountIndices?.map((i) => order.indexOf(i)) })) };
    });
    validate(tx);
    expect(() => validate(change(tx, (m) => ({ ...m, header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts - 1 } })))).toThrow();
  });
  it.each(["destination", "authority", "source", "program", "data", "ordering", "removed", "arbitrary", "payer", "blockhash", "new account", "guard target", "extra guard meta", "price", "limit", "low limit", "extra budget", "unknown policy"])("rejects changed %s before submission", (kind) => {
    const original = prepared();
    if (kind === "unknown policy") {
      expect(() => assertWalletReclaimMessage(original.messageBytes, original.messageBytes, { walletPolicy: "anything" } as never)).toThrow(); return;
    }
    const tx = change(guarded(original), (m) => {
      const instructions = [...m.instructions];
      const ix = instructions[2];
      if (["destination", "authority", "source"].includes(kind)) {
        const indices = [...ix.accountIndices!]; indices[{ source: 0, destination: 1, authority: 2 }[kind as "source"]] = 2;
        if (kind === "source" && indices[0] === ix.accountIndices![0]) indices[0] = 3;
        instructions[2] = { ...ix, accountIndices: indices };
      }
      if (kind === "program") instructions[2] = { ...ix, programAddressIndex: instructions[0].programAddressIndex };
      if (kind === "data") instructions[2] = { ...ix, data: Uint8Array.of(9) };
      if (kind === "ordering") [instructions[2], instructions[3]] = [instructions[3], instructions[2]];
      if (kind === "removed") instructions.splice(2, 1);
      if (kind === "arbitrary") instructions.push({ ...ix, data: Uint8Array.of(3) });
      if (kind === "extra budget") instructions.push(instructions[0]);
      if (kind === "guard target" || kind === "extra guard meta") instructions[14] = { ...instructions[14], accountIndices: kind === "guard target" ? [instructions[0].programAddressIndex] : [0, 1] };
      if (kind === "price") { const data = Uint8Array.from(instructions[1].data!); new DataView(data.buffer).setBigUint64(1, 100001n, true); instructions[1] = { ...instructions[1], data }; }
      if (kind === "limit" || kind === "low limit") { const data = Uint8Array.from(instructions[0].data!); new DataView(data.buffer).setUint32(1, kind === "limit" ? 200001 : 9999, true); instructions[0] = { ...instructions[0], data }; }
      if (kind === "payer" || kind === "new account") { const staticAccounts = [...m.staticAccounts]; staticAccounts[kind === "payer" ? 0 : staticAccounts.length - 1] = key(123); return { ...m, staticAccounts }; }
      if (kind === "blockhash") return { ...m, lifetimeToken: key(123) };
      return { ...m, instructions };
    });
    expect(() => validate(tx, original)).toThrow();
  });
  it("enforces actual fee and size ceilings", () => {
    expect(() => assertWalletFee(25000n, lifetime)).not.toThrow();
    expect(() => assertWalletFee(25001n, lifetime)).toThrow();
    expect(() => assertWalletFee(-1n, lifetime)).toThrow();
    const oversized = change(guarded(prepared()), (m) => ({ ...m, instructions: [...m.instructions, ...m.instructions.slice(14), ...m.instructions.slice(14)] }));
    expect(() => validate(oversized)).toThrow();
  });
  it("packs 58 and hundreds of accounts by measured size plus the bounded wallet envelope", () => {
    for (const count of [58, 300]) {
      const rows = accounts(count);
      const groups = planReclaimBatches(rows, owner, lifetime);
      expect(groups.flat()).toEqual(rows);
      for (const group of groups) {
        const base = buildReclaimTransaction(group, owner, lifetime);
        expect(transactionBytes(group, owner, lifetime) + WALLET_MESSAGE_RESERVE_BYTES).toBeLessThanOrEqual(1232);
        assertWalletReclaimMessage(base.messageBytes, guarded(base, group).messageBytes, lifetime);
      }
      if (count === 58) console.info("Lighthouse 58-account sizing fixture:", groups.map((group) => ({ accounts: group.length, preparedBytes: transactionBytes(group, owner, lifetime), withAssertionsBytes: getTransactionEncoder().encode(guarded(buildReclaimTransaction(group, owner, lifetime), group)).length, reservedBytes: WALLET_MESSAGE_RESERVE_BYTES })));
    }
  });
  it("preserves 52 confirmed accounts and validates a six-account retry without repeating withdrawals", () => {
    const rows = accounts(58), first = batch(rows.slice(0, 26)), second = batch(rows.slice(26, 52)), last = batch(rows.slice(52));
    const receipts: ReclaimReceipt[] = [{ owner, batch: first, status: "confirmed", actualLamports: "4799685" }, { owner, batch: second, status: "confirmed", actualLamports: "4787146" }];
    expect(remainingCandidates(review([first, second, last]), receipts)).toEqual(last.accounts.map((a) => a.address));
    expect(receipts.reduce((n, r) => n + BigInt(r.actualLamports!), 0n) + 1102266n).toBe(10689097n);
    const base = buildReclaimTransaction(last.accounts, owner, last);
    assertWalletReclaimMessage(base.messageBytes, guarded(base, last.accounts).messageBytes, last);
  });
  it("client validates the wallet-returned message before handing it to server submission", async () => {
    const approved = signed(guarded(prepared()));
    const signer = { address: owner, modifyAndSignTransactions: vi.fn(async () => [approved]) } as unknown as TransactionSigner;
    const submit = vi.fn(async () => undefined);
    const onReceipt = vi.fn();
    await executeReviewedBatch(review([batch()]), owner, { getConnection: () => ({ address: owner, signer, walletId: "Fixture" }), submit, onReceipt });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]).toContain(getBase64EncodedWireTransaction(approved));
  });
  it("blocks sending-only wallets before a request that could bypass signed-message checks", async () => {
    const send = vi.fn();
    const signer = { address: owner, signAndSendTransactions: send } as unknown as TransactionSigner;
    await expect(executeReviewedBatch(review([batch()]), owner, { getConnection: () => ({ address: owner, signer, walletId: "Fixture" }), submit: vi.fn(), onReceipt: vi.fn() })).rejects.toThrow("sign-only");
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects Lighthouse memory instructions at client, submission and receipt boundaries", async () => {
    const bad = signed(change(guarded(prepared()), (m) => {
      const instructions = [...m.instructions];
      instructions[14] = { ...instructions[14], data: Uint8Array.of(0, 0, 0) };
      return { ...m, instructions };
    }));
    const signer = { address: owner, modifyAndSignTransactions: vi.fn(async () => [bad]) } as unknown as TransactionSigner;
    const submit = vi.fn(), onReceipt = vi.fn();
    await expect(executeReviewedBatch(review([batch()]), owner, { getConnection: () => ({ address: owner, signer, walletId: "Fixture" }), submit, onReceipt })).rejects.toThrow("unsupported Lighthouse instruction");
    expect(submit).not.toHaveBeenCalled();
    expect(onReceipt.mock.lastCall?.[0]).toMatchObject({ status: "failed" });
    expect(onReceipt.mock.lastCall?.[0].signature).toBeUndefined();
    const { rpc, methods } = rpcFixture(bad);
    await expect(submitReclaim(rpc, owner, owner, batch(), getBase64EncodedWireTransaction(bad))).rejects.toThrow("unsupported Lighthouse instruction");
    expect(methods.simulateTransaction).not.toHaveBeenCalled();
    expect(methods.sendTransaction).not.toHaveBeenCalled();
    await expect(readReclaimReceipt(rpc, { owner, batch: batch(), signature: getSignatureFromTransaction(bad), status: "pending" })).rejects.toThrow("differs from the reviewed reclaim");
  });
  it("server revalidates and simulates the exact signed message, then reconciles its confirmed balances", async () => {
    const tx = signed(guarded(prepared()));
    const { rpc, methods } = rpcFixture(tx);
    await submitReclaim(rpc, owner, owner, batch(), getBase64EncodedWireTransaction(tx));
    expect(methods.simulateTransaction).toHaveBeenCalledWith(getBase64EncodedWireTransaction(tx), expect.objectContaining({ sigVerify: true }));
    expect(methods.sendTransaction).toHaveBeenCalledTimes(1);
    const receipt = await readReclaimReceipt(rpc, { owner, batch: batch(), signature: getSignatureFromTransaction(tx), status: "pending" });
    expect(receipt).toMatchObject({ status: "confirmed", actualLamports: "12000000", feeLamports: "13243" });
  });
  it("blocks failed signed simulation and over-cap RPC fees without any broadcast", async () => {
    const tx = signed(guarded(prepared()));
    const highFee = rpcFixture(tx, accounts(), 25001n);
    await expect(submitReclaim(highFee.rpc, owner, owner, batch(), getBase64EncodedWireTransaction(tx))).rejects.toThrow("maximum");
    expect(highFee.methods.sendTransaction).not.toHaveBeenCalled();
    const failure = rpcFixture(tx);
    failure.methods.simulateTransaction.mockImplementation(() => ({ send: vi.fn(async () => ({ value: { err: { InstructionError: [14, "Custom"] }, unitsConsumed: 0n } })) }) as never);
    await expect(submitReclaim(failure.rpc, owner, owner, batch(), getBase64EncodedWireTransaction(tx))).rejects.toThrow("simulation failed");
    expect(failure.methods.sendTransaction).not.toHaveBeenCalled();
  });
});
