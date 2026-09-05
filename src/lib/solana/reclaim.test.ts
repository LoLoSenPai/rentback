import { PLANNING_COMPUTE_BUDGET, computeBudgetFromSimulation, assertComputeBudget } from './reclaim-budget';
import { assertSignedMessageUnchanged, compareReclaimMessages, describeReclaimMessage } from './reclaim-message';
import { describe, expect, it, vi } from "vitest";
import { address, getAddressDecoder, getBase64Decoder, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, getTransactionEncoder, getSignatureFromTransaction, type TransactionModifyingSigner, type TransactionSendingSigner } from "@solana/kit";
import { getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { assertOwnerMatch, assertReviewReady, buildLegacyReceiptTransaction, assertWithdrawOnly, buildReclaimTransaction, buildWithdrawInstructions, planReclaimBatches, toReclaimAccountDto, transactionBytes, type ReclaimAccountDto, type ReclaimBatchDto, type ReclaimReceipt, type ReclaimReview } from "./reclaim";
import { decodeReclaimAccount, fetchFreshReclaimAccounts, prepareReclaim, readReclaimReceipt, submitReclaim, type ReclaimRpc } from "./reclaim-server";
import { executeReviewedBatch, hasUnresolvedReclaim, remainingCandidates } from "./reclaim-client";

const owner = "D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw";
const other = "11111111111111111111111111111111";
const key = (n: number) => getAddressDecoder().decode(Uint8Array.from({ length: 32 }, (_, i) => i === 0 ? n % 256 : i === 1 ? Math.floor(n / 256) : 7));
const lifetime = { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: "1000" };
function account(n = 1, program = TOKEN_PROGRAM_ADDRESS as ReclaimAccountDto["program"]): ReclaimAccountDto {
  return { address: key(n), program, dataSize: 165, lamports: "3000000", rentMinimum: "2000000", excess: "1000000" };
}
function batch(accounts = [account()]): ReclaimBatchDto {
  return { ...lifetime, computeBudget: { ...PLANNING_COMPUTE_BUDGET }, accounts, expectedLamports: accounts.reduce((sum, a) => sum + BigInt(a.excess), 0n).toString(), feeLamports: "5000", simulatedAt: Date.now(), expiresAt: Date.now() + 30_000, wireBytes: transactionBytes(accounts, owner, lifetime) };
}
function review(batches = [batch()]): ReclaimReview { return { owner, chain: "solana:mainnet", batches, eligibleAccounts: batches.reduce((sum, b) => sum + b.accounts.length, 0), expectedLamports: batches.reduce((sum, b) => sum + BigInt(b.expectedLamports), 0n).toString(), feeLamports: batches.reduce((sum, b) => sum + BigInt(b.feeLamports), 0n).toString() }; }
function raw(program = TOKEN_PROGRAM_ADDRESS as string, options: { owner?: string; native?: boolean; size?: number; lamports?: bigint } = {}) {
  const base = getTokenEncoder().encode({ mint: key(99), owner: address(options.owner ?? owner), amount: 987654321012345678n, delegate: null, state: 1, isNative: options.native ? 2000000n : null, delegatedAmount: 0n, closeAuthority: null });
  const data = new Uint8Array(options.size ?? 165); data.set(base); if (data.length > 165) data[165] = 2;
  return { pubkey: key(1), account: { owner: address(program), executable: false, lamports: options.lamports ?? 3000000n, data: [getBase64Decoder().decode(data), "base64"] as const } };
}
function rpcFixture(rows = [raw()]) {
  const methods = { getTokenAccountsByOwner: vi.fn(async (_owner, filter) => ({ value: rows.filter((row) => row.account.owner === filter.programId) })), getMinimumBalanceForRentExemption: vi.fn(async () => 2000000n), getLatestBlockhash: vi.fn(async () => ({ value: { blockhash: lifetime.blockhash, lastValidBlockHeight: 1000n } })), simulateTransaction: vi.fn(async () => ({ value: { unitsConsumed: 10000n, err: null as unknown } })), getFeeForMessage: vi.fn(async () => ({ value: 5000n })), sendTransaction: vi.fn(async () => "signature"), getBlockHeight: vi.fn(async () => 10n), getTransaction: vi.fn(async () => null as unknown), getSignatureStatuses: vi.fn(async () => ({ value: [null as unknown] })) };
  const rpc = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, (...args: unknown[]) => ({ send: () => (method as (...params: unknown[]) => unknown)(...args) })])) as unknown as ReclaimRpc;
  return { rpc, methods };
}

describe("Phantom mutation regression and complete-message planning", () => {
  it("includes an explicit limit and bigint price even for the final six accounts", () => {
    const accounts = Array.from({ length: 6 }, (_, i) => account(i + 1));
    const tx = buildReclaimTransaction(accounts, owner, { ...lifetime, computeBudget: { units: 12000, microLamports: "1000" } });
    const message = describeReclaimMessage(tx.messageBytes);
    expect(message.instructionCount).toBe(8);
    expect(message.instructions.slice(0, 2).map((ix) => ix.kind)).toEqual(["SetComputeUnitLimit", "SetComputeUnitPrice"]);
    expect(message.instructions[0].units).toBe(12000);
    expect(message.instructions[1].microLamports).toBe("1000");
    expect(getTransactionEncoder().encode(tx)).toHaveLength(454);
    expect(() => JSON.stringify(message)).not.toThrow();
  });
  it("reproduces rejection of budget-only mutation without allowing it", () => {
    const accounts = Array.from({ length: 6 }, (_, i) => account(i + 1));
    const old = buildLegacyReceiptTransaction(accounts, owner, lifetime);
    const enhanced = buildReclaimTransaction(accounts, owner, lifetime);
    const diff = compareReclaimMessages(old.messageBytes, enhanced.messageBytes);
    expect(diff.prepared?.instructionCount).toBe(6);
    expect(diff.returned?.instructionCount).toBe(8);
    expect(diff.prepared?.feePayer).toBe(diff.returned?.feePayer);
    expect(diff.prepared?.recentBlockhash).toBe(diff.returned?.recentBlockhash);
    expect(diff.differences).toContain("Compute Budget instructions changed");
    expect(diff.differences.some((d) => d.startsWith("withdrawal"))).toBe(false);
    expect(() => assertSignedMessageUnchanged(old.messageBytes, enhanced.messageBytes)).toThrow(/Compute Budget/);
  });
  it("re-packs 58 accounts with all final overhead and preserves identical signed messages", () => {
    const accounts = Array.from({ length: 58 }, (_, i) => account(i + 1, i < 6 ? TOKEN_2022_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS));
    const groups = planReclaimBatches(accounts, owner, lifetime);
    expect(groups.map((g) => g.length)).toEqual([25, 25, 8]);
    expect(groups.map((g) => transactionBytes(g, owner, lifetime))).toEqual([1227, 1195, 532]);
    for (const group of groups) {
      const tx = buildReclaimTransaction(group, owner, lifetime);
      const signed = { ...tx, signatures: { [owner]: new Uint8Array(64).fill(1) } };
      expect(() => assertSignedMessageUnchanged(tx.messageBytes, signed.messageBytes)).not.toThrow();
      expect(getTransactionEncoder().encode(tx).length).toBeLessThanOrEqual(1232);
    }
  });
  it("derives a bounded limit with upward-rounded 10% margin and refuses unsafe/missing budgets", () => {
    expect(computeBudgetFromSimulation(12345n)).toEqual({ units: 13580, microLamports: "1000" });
    expect(computeBudgetFromSimulation(1n).units).toBe(10000);
    expect(() => computeBudgetFromSimulation(undefined)).toThrow(/compute usage/);
    expect(() => computeBudgetFromSimulation(200000n)).toThrow(/conservative/);
    expect(() => assertComputeBudget({ units: 200000, microLamports: "1000000000" })).toThrow();
    expect(() => assertReviewReady(review([{ ...batch(), computeBudget: undefined }]), owner)).toThrow(/compute budget/);
  });
  it("simulates the final budgeted message again and estimates fees for that exact message", async () => {
    const { rpc, methods } = rpcFixture();
    methods.simulateTransaction.mockResolvedValue({ value: { unitsConsumed: 12345n, err: null } });
    methods.getFeeForMessage.mockResolvedValue( { value: 5014n } );
    const prepared = await prepareReclaim(rpc, owner, owner);
    const b = prepared.batches[0];
    const final = buildReclaimTransaction(b.accounts, owner, b);
    expect(b.computeBudget?.units).toBe(13580);
    expect(methods.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(methods.simulateTransaction).toHaveBeenNthCalledWith(2, getBase64EncodedWireTransaction(final), { encoding: "base64", sigVerify: false, commitment: "confirmed" });
    expect(methods.getFeeForMessage).toHaveBeenCalledWith(getBase64Decoder().decode(final.messageBytes), { commitment: "confirmed" });
    expect(prepared.feeLamports).toBe("5014");
    expect(b.wireBytes).toBe(getTransactionEncoder().encode(final).length);
  });
  it.each(["arbitrary instruction", "destination", "authority", "source", "fee payer", "blockhash", "withdraw data", "compute price"])("rejects wallet-changed %s before submission", async (change) => {
    const submit = vi.fn();
    const signer: TransactionModifyingSigner = { address: address(owner), modifyAndSignTransactions: vi.fn(async (txs) => {
      const tx = txs[0];
      const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
      if (message.version !== 0) throw new Error("Expected v0");
      const instructions = message.instructions.map((ix) => ({ ...ix }));
      const withdrawal = instructions[2];
      let changed = { ...message, instructions };
      if (change === "arbitrary instruction") instructions.push({ ...withdrawal, data: new Uint8Array([9]) });
      if (change === "withdraw data") instructions[2] = { ...withdrawal, data: new Uint8Array([8]) };
      if (change === "compute price") instructions[1] = { ...instructions[1], data: new Uint8Array([3, 1, 0, 0, 0, 0, 0, 0, 0]) };
      if (change === "destination" || change === "authority" || change === "source") {
        const indices = [...withdrawal.accountIndices!];
        const position = change === "source" ? 0 : change === "destination" ? 1 : 2;
        indices[position] = position === 0 ? 0 : indices[0];
        instructions[2] = { ...withdrawal, accountIndices: indices };
      }
      if (change === "fee payer") changed = { ...changed, staticAccounts: [address(other), ...message.staticAccounts.slice(1)] };
      if (change === "blockhash") changed = { ...changed, lifetimeToken: key(88) as typeof message.lifetimeToken };
      return [{ ...tx, messageBytes: getCompiledTransactionMessageEncoder().encode(changed), signatures: { [owner]: new Uint8Array(64).fill(1) } }] as never;
    }) };
    await expect(executeReviewedBatch(review(), owner, { getConnection: () => ({ address: owner, walletId: "Fixture", signer }), onReceipt: vi.fn(), submit })).rejects.toThrow(/changed the transaction/);
    expect(submit).not.toHaveBeenCalled();
  });
  it("preserves the original 58 -> 52 confirmed -> six remaining accounting exactly", async () => {
    // Synthetic per-source funding, with the user's exact aggregate history.
    const all = Array.from({ length: 58 }, (_, i) => {
      const excess = i < 26 ? 184603n + (i < 7 ? 1n : 0n) : i < 52 ? 184121n : 183711n;
      return { ...account(i + 1), excess: excess.toString(), lamports: (2000000n + excess).toString() };
    });
    const historicalBatch = (accounts: ReclaimAccountDto[]) => ({ ...batch(accounts), computeBudget: undefined, wireBytes: getTransactionEncoder().encode(buildLegacyReceiptTransaction(accounts, owner, lifetime)).length });
    const original = review([historicalBatch(all.slice(0, 26)), historicalBatch(all.slice(26, 52)), historicalBatch(all.slice(52))]);
    expect(original.expectedLamports).toBe("10689097");
    expect(original.batches.map((b) => b.expectedLamports)).toEqual(["4799685", "4787146", "1102266"]);
    const history: ReclaimReceipt[] = original.batches.slice(0, 2).map((b, i) => ({ owner, batch: { ...b, computeBudget: undefined }, status: "confirmed", actualLamports: i === 0 ? "4799685" : "4787146" }));
    const remaining = remainingCandidates(original, history);
    expect(remaining).toHaveLength(6);
    const { rpc, methods } = rpcFixture(remaining.map((pubkey) => ({ ...raw(TOKEN_PROGRAM_ADDRESS, { lamports: 2183711n }), pubkey: address(pubkey) })));
    const retry = await prepareReclaim(rpc, owner, owner, remaining);
    expect(retry.expectedLamports).toBe("1102266");
    expect(history.reduce((sum, r) => sum + BigInt(r.actualLamports!), 0n)).toBe(9586831n);
    expect(9586831n + BigInt(retry.expectedLamports)).toBe(10689097n);
    expect(retry.batches[0].computeBudget).toEqual({ units: 11000, microLamports: "1000" });
    const submit = vi.fn();
    const signer: TransactionModifyingSigner = { address: address(owner), modifyAndSignTransactions: vi.fn(async (txs: Parameters<TransactionModifyingSigner["modifyAndSignTransactions"]>[0]) => txs.map((tx) => ({ ...tx, signatures: { [owner]: new Uint8Array(64).fill(1) } }))) as unknown as TransactionModifyingSigner["modifyAndSignTransactions"] };
    await executeReviewedBatch(retry, owner, { getConnection: () => ({ address: owner, walletId: "Fixture", signer }), onReceipt: vi.fn(), submit });
    expect(submit).toHaveBeenCalledOnce(); // Local stub, never network submission.
    expect(methods.sendTransaction).not.toHaveBeenCalled();
    expect(history.every((r) => r.status === "confirmed")).toBe(true);
  });
  it("still reconciles historical budget-less confirmed receipts", async () => {
    const b = { ...batch(), computeBudget: undefined };
    const tx = buildLegacyReceiptTransaction(b.accounts, owner, b);
    const signed = { ...tx, signatures: { [owner]: new Uint8Array(64).fill(1) } } as unknown as typeof tx;
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if (message.version !== 0) throw new Error("Expected v0");
    const pre = message.staticAccounts.map(() => 3000000n); const post = [...pre];
    post[message.staticAccounts.indexOf(address(key(1)))] -= 1000000n;
    post[0] += 995000n;
    const { rpc, methods } = rpcFixture();
    methods.getTransaction.mockResolvedValue({ transaction: [getBase64EncodedWireTransaction(signed), "base64"], meta: { err: null, preBalances: pre, postBalances: post, fee: 5000n } });
    expect((await readReclaimReceipt(rpc, { owner, batch: b, status: "pending", signature: getSignatureFromTransaction(signed) })).actualLamports).toBe("1000000");
    await expect(submitReclaim(rpc, owner, owner, b, getBase64EncodedWireTransaction(signed))).rejects.toThrow(/compute budget/);
  });
});

describe("reclaim instruction firewall", () => {
  it.each([TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS])("uses official WithdrawExcessLamports for %s", (program) => {
    const [ix] = buildWithdrawInstructions([account(1, program)], owner);
    expect(ix.programAddress).toBe(program); expect([...ix.data]).toEqual([38]);
    expect(ix.accounts.map((a) => [a.address, a.role])).toEqual([[key(1), 1], [owner, 1], [owner, 2]]);
  });
  it("rejects mismatched authority, destination and forbidden instruction data", () => {
    expect(() => assertOwnerMatch(other, owner)).toThrow();
    expect(() => assertOwnerMatch(owner.toLowerCase(), owner)).toThrow();
    expect(() => assertOwnerMatch(null, owner)).toThrow();
    const [ix] = buildWithdrawInstructions([account()], owner);
    for (const data of [3, 4, 6, 8, 9]) expect(() => assertWithdrawOnly([{ ...ix, data: new Uint8Array([data]) }], owner)).toThrow(/allowlist/);
    expect(() => assertWithdrawOnly([{ ...ix, programAddress: address(other) }], owner)).toThrow();
    expect(() => assertWithdrawOnly([{ ...ix, accounts: [ix.accounts[0], { ...ix.accounts[1], address: address(other) }, ix.accounts[2]] }], owner)).toThrow();
    expect(() => buildWithdrawInstructions([account()], owner, { address: address(other), signTransactions: vi.fn() })).toThrow(/signer/);
    expect(() => buildWithdrawInstructions([account(), account()], owner)).toThrow(/source/);
  });
  it("plans hundreds of accounts by actual wire bytes, with only the two explicit budget instructions and withdrawals", () => {
    const accounts = Array.from({ length: 300 }, (_, i) => account(i + 1, i % 2 ? TOKEN_PROGRAM_ADDRESS : TOKEN_2022_PROGRAM_ADDRESS));
    const groups = planReclaimBatches(accounts, owner, lifetime);
    expect(groups.length).toBeGreaterThan(1); expect(groups.flat()).toEqual(accounts);
    groups.forEach((group, index) => {
      const transaction = buildReclaimTransaction(group, owner, lifetime);
      expect(getTransactionEncoder().encode(transaction).length).toBeLessThanOrEqual(1232);
      const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
      if (message.version !== 0) throw new Error("Expected v0 transaction.");
      expect(message.instructions).toHaveLength(group.length + 2);
      message.instructions.slice(2).forEach((ix) => expect([...ix.data!]).toEqual([38]));
      if (index < groups.length - 1) expect(transactionBytes([...group, groups[index + 1][0]], owner, lifetime)).toBeGreaterThan(1232);
    });
  });
  it("rejects expired or inconsistent reviews and ignores zero amounts", () => {
    expect(() => assertReviewReady(review(), owner)).not.toThrow();
    expect(() => assertReviewReady(review(), other)).toThrow();
    expect(() => assertReviewReady(review(), owner, Date.now() + 31_000)).toThrow(/expired/);
    expect(() => assertReviewReady({ ...review(), expectedLamports: "9000" }, owner)).toThrow(/totals/);
    expect(planReclaimBatches([{ ...account(), excess: "0" }], owner, lifetime)).toEqual([]);
  });
});

describe("fresh account and rent revalidation", () => {
  it("excludes wrapped SOL and current zero excess", () => {
    const native = raw(TOKEN_PROGRAM_ADDRESS, { native: true });
    expect(decodeReclaimAccount(owner, native.pubkey, native.account, 2000000n)).toBeNull();
    expect(decodeReclaimAccount(owner, key(1), raw().account, 3000000n)).toBeNull();
  });
  it("rejects changed owners and wrong account types/programs", () => {
    expect(() => decodeReclaimAccount(owner, key(1), raw(TOKEN_PROGRAM_ADDRESS, { owner: other }).account, 1n)).toThrow(/owner/);
    expect(() => decodeReclaimAccount(owner, key(1), raw(other).account, 1n)).toThrow(/Invalid/);
    expect(() => decodeReclaimAccount(owner, key(1), raw(TOKEN_PROGRAM_ADDRESS, { size: 166 }).account, 1n)).toThrow(/size/);
  });
  it("keeps huge lamports exact and nested DTOs JSON safe", () => {
    const huge = 9007199254740993123n;
    const item = decodeReclaimAccount(owner, key(1), raw(TOKEN_PROGRAM_ADDRESS, { lamports: huge }).account, 2n)!;
    expect(item.excess).toBe(huge - 2n);
    const dto = toReclaimAccountDto(item);
    expect(JSON.parse(JSON.stringify({ accounts: [dto] })).accounts[0].excess).toBe("9007199254740993121");
  });
  it("queries both programs and uses actual account sizes with uncached rent", async () => {
    const spl = raw(); const extended = { ...raw(TOKEN_2022_PROGRAM_ADDRESS, { size: 170 }), pubkey: key(2) };
    const { rpc, methods } = rpcFixture([spl, extended]);
    const first = await fetchFreshReclaimAccounts(rpc, owner);
    expect(first).toHaveLength(2); expect(first.map((a) => a.dataSize)).toEqual([165, 170]);
    expect(methods.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(165n, { commitment: "confirmed" });
    expect(methods.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(170n, { commitment: "confirmed" });
    methods.getMinimumBalanceForRentExemption.mockResolvedValue(3000000n);
    expect(await fetchFreshReclaimAccounts(rpc, owner)).toEqual([]);
    expect(methods.getTokenAccountsByOwner).toHaveBeenCalledTimes(4);
  });
  it("recomputes stale candidates and stops on simulation failure before signing", async () => {
    const { rpc, methods } = rpcFixture();
    const prepared = await prepareReclaim(rpc, owner, owner, [key(1), key(8)]);
    expect(prepared.eligibleAccounts).toBe(1); expect(prepared.expectedLamports).toBe("1000000");
    expect(methods.sendTransaction).not.toHaveBeenCalled();
    methods.simulateTransaction.mockResolvedValue({ value: { unitsConsumed: 10000n, err: { InstructionError: [0n, { Custom: 12n }] } } });
    await expect(prepareReclaim(rpc, owner, owner)).rejects.toThrow(/Instruction 0: Custom 12/);
  });
  it("refuses submission when account balance or rent changed after review", async () => {
    const { rpc } = rpcFixture([raw(TOKEN_PROGRAM_ADDRESS, { lamports: 4000000n })]);
    const b = batch(); const tx = buildReclaimTransaction(b.accounts, owner, b);
    const signed = { ...tx, signatures: { [owner]: new Uint8Array(64).fill(1) } } as unknown as typeof tx;
    await expect(submitReclaim(rpc, owner, owner, b, getBase64EncodedWireTransaction(signed))).rejects.toThrow(/balance or rent changed/);
  });
  it("submits only a fully signed exact allowlisted message after fresh revalidation and signed simulation", async () => {
    const { rpc, methods } = rpcFixture();
    const b = batch(); const tx = buildReclaimTransaction(b.accounts, owner, b);
    const signed = { ...tx, signatures: { [owner]: new Uint8Array(64).fill(1) } } as unknown as typeof tx;
    const expectedSignature = getSignatureFromTransaction(signed);
    methods.sendTransaction.mockResolvedValue(expectedSignature);
    const wire = getBase64EncodedWireTransaction(signed);
    expect(await submitReclaim(rpc, owner, owner, b, wire)).toBe(expectedSignature);
    expect(methods.getTokenAccountsByOwner).toHaveBeenCalledTimes(2);
    expect(methods.simulateTransaction).toHaveBeenCalledWith(wire, { encoding: "base64", sigVerify: true, commitment: "confirmed" });
    expect(methods.sendTransaction).toHaveBeenCalledWith(wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0n });
  });
  it("rejects malicious destination/program substitutions and simulation failures before sending", async () => {
    const { rpc, methods } = rpcFixture(); const b = batch();
    const wrongOwnerTx = buildReclaimTransaction(b.accounts, other, b);
    const wrongOwnerSigned = { ...wrongOwnerTx, signatures: { [other]: new Uint8Array(64).fill(1) } } as unknown as typeof wrongOwnerTx;
    await expect(submitReclaim(rpc, owner, owner, b, getBase64EncodedWireTransaction(wrongOwnerSigned))).rejects.toThrow(/differs/);
    const wrongProgramTx = buildReclaimTransaction([{ ...account(), program: TOKEN_2022_PROGRAM_ADDRESS }], owner, b);
    const wrongProgramSigned = { ...wrongProgramTx, signatures: { [owner]: new Uint8Array(64).fill(1) } } as unknown as typeof wrongProgramTx;
    await expect(submitReclaim(rpc, owner, owner, b, getBase64EncodedWireTransaction(wrongProgramSigned))).rejects.toThrow(/differs/);
    const tx = buildReclaimTransaction(b.accounts, owner, b);
    await expect(submitReclaim(rpc, owner, owner, b, getBase64EncodedWireTransaction(tx))).rejects.toThrow();
    const signed = { ...tx, signatures: { [owner]: new Uint8Array(64).fill(1) } } as unknown as typeof tx;
    methods.simulateTransaction.mockResolvedValue({ value: { unitsConsumed: 10000n, err: "InsufficientFundsForFee" } });
    await expect(submitReclaim(rpc, owner, owner, b, getBase64EncodedWireTransaction(signed))).rejects.toThrow(/InsufficientFundsForFee/);
    expect(methods.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("consent, partial failures and retry", () => {
  function connection(signer?: TransactionModifyingSigner | TransactionSendingSigner) {
    const signing: TransactionModifyingSigner = signer as TransactionModifyingSigner ?? { address: address(owner), modifyAndSignTransactions: vi.fn(async (transactions: Parameters<TransactionModifyingSigner["modifyAndSignTransactions"]>[0]) => transactions.map((tx) => ({ ...tx, signatures: { [owner]: new Uint8Array(64).fill(1) } }))) as unknown as TransactionModifyingSigner["modifyAndSignTransactions"] };
    const current = { address: owner, walletId: "Test", signer: signing };
    return { current, signing };
  }
  it("signs only one reviewed transaction, retaining signature before submission", async () => {
    const { current, signing } = connection(); const saved: ReclaimReceipt[] = [];
    const submit = vi.fn(async () => { expect(saved.at(-1)?.signature).toBeTruthy(); });
    await executeReviewedBatch(review([batch(), batch([account(2)])]), owner, { getConnection: () => current, onReceipt: (r) => saved.push(r), submit });
    expect(signing.modifyAndSignTransactions).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("preserves successful signatures, re-fetches remaining excess and excludes completed sources", async () => {
    const reviewed = review([batch([account(1)]), batch([account(2)]), batch([account(3)])]);
    const history: ReclaimReceipt[] = reviewed.batches.map((b, index) => ({ owner, batch: b, status: index < 2 ? "confirmed" : "failed", signature: `signature-${index}`, actualLamports: index < 2 ? "1000000" : "0" }));
    expect(remainingCandidates(reviewed, history)).toEqual([key(3)]);
    const { rpc } = rpcFixture([{ ...raw(), pubkey: key(3) }]);
    const retry = await prepareReclaim(rpc, owner, owner, remainingCandidates(reviewed, history));
    expect(retry.batches.flatMap((b) => b.accounts.map((a) => a.address))).toEqual([key(3)]);
    expect(history.slice(0, 2).map((r) => r.signature)).toEqual(["signature-0", "signature-1"]);
  });
  it("blocks unknown send outcomes until reconciliation instead of claiming failure", async () => {
    const { current } = connection(); const saved: ReclaimReceipt[] = [];
    await expect(executeReviewedBatch(review(), owner, { getConnection: () => current, onReceipt: (r) => saved.push(r), submit: async () => { throw new Error("Response lost"); } })).rejects.toThrow(/lost/);
    expect(saved.at(-1)?.signature).toBeTruthy(); expect(hasUnresolvedReclaim([saved.at(-1)!], owner)).toBe(true);
    const { rpc, methods } = rpcFixture();
    expect((await readReclaimReceipt(rpc, saved.at(-1)!)).status).toBe("pending");
    methods.getBlockHeight.mockResolvedValue(1033n);
    expect((await readReclaimReceipt(rpc, saved.at(-1)!)).status).toBe("expired");
  });
  it("blocks modified instructions and account changes while the wallet signs", async () => {
    const { current, signing } = connection(); const submit = vi.fn(); const saved: ReclaimReceipt[] = [];
    vi.mocked(signing.modifyAndSignTransactions).mockImplementation(async (txs) => [{ ...txs[0], messageBytes: new Uint8Array([0]) }] as never);
    await expect(executeReviewedBatch(review(), owner, { getConnection: () => current, onReceipt: (r) => saved.push(r), submit })).rejects.toThrow(/changed the transaction/);
    expect(submit).not.toHaveBeenCalled(); expect(saved.at(-1)?.status).toBe("failed");
    vi.mocked(signing.modifyAndSignTransactions).mockImplementation(async () => { current.address = other; return [] as never; });
    await expect(executeReviewedBatch(review(), owner, { getConnection: () => current, onReceipt: vi.fn(), submit })).rejects.toThrow(/account changed/);
  });
  it("supports an MWA sending-only signer, without fallback or automatic retry", async () => {
    const signer: TransactionSendingSigner = { address: address(owner), signAndSendTransactions: vi.fn(async () => [new Uint8Array(64).fill(2)] as never) };
    const submit = vi.fn(); const saved: ReclaimReceipt[] = [];
    await executeReviewedBatch(review(), owner, { getConnection: () => ({ address: owner, walletId: "MWA", signer }), onReceipt: (r) => saved.push(r), submit });
    expect(signer.signAndSendTransactions).toHaveBeenCalledTimes(1); expect(submit).not.toHaveBeenCalled(); expect(saved.at(-1)?.signature).toBeTruthy();
  });
  it("derives actual withdrawn amount from confirmed metadata, net of network fee separately", async () => {
    const b = batch(); const tx = buildReclaimTransaction(b.accounts, owner, b);
    const signed = { ...tx, signatures: { [owner]: new Uint8Array(64).fill(1) } } as unknown as typeof tx;
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if (message.version !== 0) throw new Error("fixture version");
    const pre = message.staticAccounts.map(() => 3000000n); const post = [...pre];
    post[message.staticAccounts.indexOf(address(key(1)))] -= 900000n;
    post[message.staticAccounts.indexOf(address(owner))] += 895000n;
    const { rpc, methods } = rpcFixture();
    methods.getTransaction.mockResolvedValue({ transaction: [getBase64EncodedWireTransaction(signed), "base64"], meta: { err: null, preBalances: pre, postBalances: post, fee: 5000n } });
    const receipt = await readReclaimReceipt(rpc, { owner, batch: b, status: "pending", signature: getSignatureFromTransaction(signed) });
    expect(receipt.status).toBe("confirmed"); expect(receipt.actualLamports).toBe("900000"); expect(receipt.feeLamports).toBe("5000");
  });
});
