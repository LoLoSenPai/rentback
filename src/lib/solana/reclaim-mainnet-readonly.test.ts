import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { mainnetReclaimRpc, prepareReclaim } from "./reclaim-server";
import { scanWalletRentProjection, toRentBackApiResult } from "./scan";

// Explicit opt-in READ-ONLY integration. No wallet, keypair or signing APIs.
it.runIf(process.env.RENTBACK_MAINNET_PREPARE_ONLY === "1")("confirms the completed mainnet wallet has no remaining withdrawals", async () => {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const owner = "D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw";
  const rpc = new Proxy(await mainnetReclaimRpc(), { get(target, property, receiver) {
    if (property === "sendTransaction") throw new Error("Broadcast is forbidden in read-only release verification.");
    return Reflect.get(target, property, receiver);
  } });
  const scan = toRentBackApiResult(await scanWalletRentProjection(owner));
  expect(scan.totals.claimableNowLamports).toBe("0");
  expect(scan.totals.claimableAccounts).toBe(0);
  expect(scan.totals.additionalUnlockPhase2Lamports).toBe("21361144");
  expect(scan.totals.additionalUnlockPhase5Lamports).toBe("96099576");
  const review = await prepareReclaim(rpc, owner, owner);
  expect(review.eligibleAccounts).toBe(0);
  expect(review.expectedLamports).toBe("0");
  expect(review.batches).toEqual([]);
  const report = { observedAt: new Date().toISOString(), mode: "read-only; no wallet signatures or broadcasts", owner, totals: scan.totals, reclaimPlan: { eligibleAccounts: review.eligibleAccounts, expectedLamports: review.expectedLamports, transactionCount: review.batches.length }, bothTokenProgramReadsSucceeded: true };
  writeFileSync("docs/release-readonly-result.json", JSON.stringify(report, null, 2) + "\n");
  console.info(JSON.stringify(report, null, 2));
}, 120_000);