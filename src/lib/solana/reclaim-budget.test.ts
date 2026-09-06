import { describe, expect, it } from "vitest";
import { computeBudgetWithWalletReserve, computeBudgetFromSimulation, RECLAIM_COMPUTE_CEILING } from "./reclaim-budget";
import { WALLET_MAX_FEE_LAMPORTS } from "./reclaim-wallet-policy";

describe("compute reservation before wallet approval", () => {
  it("covers the observed 15-source modeled Lighthouse simulation without wallet mutation", () => {
    expect(computeBudgetFromSimulation(5494n).units).toBe(10000);
    const budget = computeBudgetWithWalletReserve(5494n, 15);
    expect(budget).toEqual({ units: 106000, microLamports: "100000" });
    expect(budget.units).toBeGreaterThan(16346);
    expect(budget.units).toBeLessThanOrEqual(RECLAIM_COMPUTE_CEILING);
    const fee = 5000n + (BigInt(budget.units) * BigInt(budget.microLamports) + 999999n) / 1000000n;
    expect(fee).toBe(15600n);
    expect(fee).toBeLessThanOrEqual(WALLET_MAX_FEE_LAMPORTS);
  });
  it("reserves compute for the final six-source batch too", () => {
    expect(computeBudgetWithWalletReserve(1920n, 6).units).toBe(52000);
  });
  it("retains measured usage plus the original upward-rounded margin", () => {
    expect(computeBudgetWithWalletReserve(12345n, 1).units).toBe(25580);
    expect(computeBudgetFromSimulation(12345n).units).toBe(13580);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 1001])("rejects invalid account count %s", (count) => {
    expect(() => computeBudgetWithWalletReserve(1000n, count)).toThrow();
  });
  it("fails closed rather than clamping an over-ceiling requirement", () => {
    expect(() => computeBudgetWithWalletReserve(180000n, 15)).toThrow("exceeds");
    expect(() => computeBudgetWithWalletReserve(undefined, 15)).toThrow();
    expect(() => computeBudgetWithWalletReserve(0n, 15)).toThrow();
  });
});
