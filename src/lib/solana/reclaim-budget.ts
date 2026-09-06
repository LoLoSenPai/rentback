import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";

export type ReclaimComputeBudget = { units: number; microLamports: string };
export const RECLAIM_COMPUTE_CEILING = 200_000;
// Observed in the Seeker wallet's returned message. This is an application
// policy, not a documented wallet minimum. Set it BEFORE planning, simulation
// and review; never accept a wallet's post-signature fee edits automatically.
export const RECLAIM_COMPUTE_PRICE = "100000";
// Planning allowance, not a protocol guarantee. The wallet policy permits at
// most two assertions per source/destination. Reserve compute before review,
// rather than relying on the wallet to raise the withdrawal-only CU limit.
export const WALLET_ASSERTION_COMPUTE_RESERVE = 3_000;
// Fixed-width instructions are present during packing as well as simulation.
export const PLANNING_COMPUTE_BUDGET: ReclaimComputeBudget = { units: RECLAIM_COMPUTE_CEILING, microLamports: RECLAIM_COMPUTE_PRICE };

export function assertComputeBudget(budget: ReclaimComputeBudget | undefined): asserts budget is ReclaimComputeBudget {
  if (!budget || !Number.isSafeInteger(budget.units) || budget.units < 10_000 || budget.units > RECLAIM_COMPUTE_CEILING || (budget.microLamports !== RECLAIM_COMPUTE_PRICE && budget.microLamports !== "1000")) {
    throw new Error("Invalid reclaim compute budget. Refresh the reclaim review.");
  }
}

export function computeBudgetFromSimulation(consumed: bigint | undefined): ReclaimComputeBudget {
  if (typeof consumed !== "bigint" || consumed <= 0n) throw new Error("Simulation did not report compute usage. No signature was requested.");
  const withMargin = (consumed * 110n + 99n) / 100n;
  if (withMargin > BigInt(RECLAIM_COMPUTE_CEILING)) throw new Error("Reclaim exceeds the conservative compute limit. No signature was requested.");
  // Only bounded, non-monetary CU counts become numbers for the official u32 API.
  const units = Number(withMargin < 10_000n ? 10_000n : withMargin);
  return { units, microLamports: RECLAIM_COMPUTE_PRICE };
}

export function buildComputeBudgetInstructions(budget: ReclaimComputeBudget) {
  assertComputeBudget(budget);
  return [getSetComputeUnitLimitInstruction({ units: budget.units }), getSetComputeUnitPriceInstruction({ microLamports: BigInt(budget.microLamports) })];
}

export function computeBudgetWithWalletReserve(consumed: bigint | undefined, accountCount: number): ReclaimComputeBudget {
  if (!Number.isSafeInteger(accountCount) || accountCount < 1 || accountCount > 1000) {
    throw new Error("Invalid reclaim account count for compute planning.");
  }
  const base = computeBudgetFromSimulation(consumed);
  const reserve = 2n * (BigInt(accountCount) + 1n) * BigInt(WALLET_ASSERTION_COMPUTE_RESERVE);
  const units = BigInt(base.units) + reserve;
  if (units > BigInt(RECLAIM_COMPUTE_CEILING)) {
    throw new Error("Reclaim plus wallet safety checks exceeds the conservative compute limit. No signature was requested.");
  }
  return { ...base, units: Number(units) }; // Bounded CU count, never lamports.
}
