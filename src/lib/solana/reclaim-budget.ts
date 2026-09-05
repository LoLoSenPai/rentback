import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";

export type ReclaimComputeBudget = { units: number; microLamports: string };
export const RECLAIM_COMPUTE_CEILING = 200_000;
export const RECLAIM_COMPUTE_PRICE = "1000";
// Fixed-width instructions are present during packing as well as simulation.
export const PLANNING_COMPUTE_BUDGET: ReclaimComputeBudget = { units: RECLAIM_COMPUTE_CEILING, microLamports: RECLAIM_COMPUTE_PRICE };

export function assertComputeBudget(budget: ReclaimComputeBudget | undefined): asserts budget is ReclaimComputeBudget {
  if (!budget || !Number.isSafeInteger(budget.units) || budget.units < 10_000 || budget.units > RECLAIM_COMPUTE_CEILING || budget.microLamports !== RECLAIM_COMPUTE_PRICE) {
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
