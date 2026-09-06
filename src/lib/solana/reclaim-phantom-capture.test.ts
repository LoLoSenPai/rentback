import { describe, expect, it } from "vitest";
import { address, getAddressDecoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, getTransactionEncoder, type Transaction } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { buildReclaimTransaction, planReclaimBatches, type ReclaimAccountDto } from "./reclaim";
import { assertLighthouseData, assertWalletReclaimMessage, LIGHTHOUSE_PROGRAM, RECLAIM_WALLET_POLICY, walletMessageReserve } from "./reclaim-wallet-policy";

// Exact assertion data from the user's Phantom simulation response. Account
// addresses are synthetic: these are encoding/policy tests, not RPC simulations.
const captured = {
  owner: "0604030070f4466a000000000403000001000000000000000000",
  empty: "0a04030300000600000000000000000508",
  nonempty: "0a0404020100000000000000040300000600000000000000000508",
};
const key = (n: number) => getAddressDecoder().decode(Uint8Array.from({ length: 32 }, (_, i) => i === 0 ? n % 256 : i === 1 ? Math.floor(n / 256) : 7));
const owner = key(999);
const rows = (count: number): ReclaimAccountDto[] => Array.from({ length: count }, (_, i) => ({ address: key(i + 1), program: i % 6 === 3 ? TOKEN_2022_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS, dataSize: 165, lamports: "3000000", rentMinimum: "2000000", excess: "1000000" }));
const lifetime = { walletPolicy: RECLAIM_WALLET_POLICY, blockhash: "11111111111111111111111111111111", lastValidBlockHeight: "1000", computeBudget: { units: 106000, microLamports: "100000" } };
function augment(tx: Transaction, accounts: ReclaimAccountDto[], allNonempty = false): Transaction {
  const m = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (m.version !== 0) throw new Error("Expected v0");
  const programAddressIndex = m.staticAccounts.length;
  const guard = (target: string, hex: string) => ({ programAddressIndex, accountIndices: [m.staticAccounts.indexOf(address(target))], data: Uint8Array.from(Buffer.from(hex, "hex")) });
  const assertions = [guard(owner, captured.owner), ...accounts.map((a, i) => guard(a.address, allNonempty || i % 2 === 0 ? captured.nonempty : captured.empty))];
  return { ...tx, messageBytes: getCompiledTransactionMessageEncoder().encode({ ...m, header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts + 1 }, staticAccounts: [...m.staticAccounts, address(LIGHTHOUSE_PROGRAM)], instructions: [...m.instructions, ...assertions] }) as Transaction["messageBytes"] };
}
const bytes = (tx: Transaction) => getTransactionEncoder().encode(tx).length;

describe("captured Phantom multi-assertion sizing regression", () => {
  it("parses the actual owner, empty-token and nonempty-token predicates", () => {
    expect(assertLighthouseData(Buffer.from(captured.owner, "hex"))).toBe("account");
    expect(assertLighthouseData(Buffer.from(captured.empty, "hex"))).toBe("token");
    expect(assertLighthouseData(Buffer.from(captured.nonempty, "hex"))).toBe("token");
  });
  it("reproduces why the old 15-account allowance cannot contain all guards", () => {
    const accounts = rows(15);
    const old = { ...lifetime, walletPolicy: "lighthouse-assertions-v1" as const };
    const tx = buildReclaimTransaction(accounts, owner, old);
    expect(bytes(tx) + walletMessageReserve(old)).toBeLessThanOrEqual(1232);
    const augmented = augment(tx, accounts);
    expect(bytes(augmented)).toBeGreaterThan(1232);
    expect(() => assertWalletReclaimMessage(tx.messageBytes, augmented.messageBytes, old)).toThrow("size");
  });
  it.each([6, 58, 66, 300])("fits captured-style guards in every new transaction for %i accounts", (count) => {
    const accounts = rows(count);
    const groups = planReclaimBatches(accounts, owner, lifetime);
    expect(groups.flat()).toEqual(accounts);
    for (const group of groups) {
      const tx = buildReclaimTransaction(group, owner, lifetime);
      const augmented = augment(tx, group, true);
      expect(bytes(tx) + walletMessageReserve(lifetime)).toBeLessThanOrEqual(1232);
      expect(bytes(augmented)).toBeLessThanOrEqual(1232);
      expect(() => assertWalletReclaimMessage(tx.messageBytes, augmented.messageBytes, lifetime)).not.toThrow();
    }
    if (count === 66) console.info("Captured-style Phantom 66-account fixture", groups.map(group => ({ accounts: group.length, preparedBytes: bytes(buildReclaimTransaction(group, owner, lifetime)), guardedBytes: bytes(augment(buildReclaimTransaction(group, owner, lifetime), group, true)) })));
  });
  it("keeps v1 receipts valid and rejects them as an oversized v2 review", () => {
    const accounts = rows(15);
    const tx = buildReclaimTransaction(accounts, owner, lifetime);
    expect(() => assertWalletReclaimMessage(tx.messageBytes, tx.messageBytes, { walletPolicy: "lighthouse-assertions-v1" })).not.toThrow();
    expect(() => assertWalletReclaimMessage(tx.messageBytes, tx.messageBytes, lifetime)).toThrow("size");
    expect(walletMessageReserve({})).toBe(0);
    expect(walletMessageReserve({ walletPolicy: "lighthouse-assertions-v1" })).toBe(384);
    expect(walletMessageReserve(lifetime)).toBe(512);
  });
});
