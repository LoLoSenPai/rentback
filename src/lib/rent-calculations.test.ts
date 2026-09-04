import { describe, expect, it } from "vitest";
import {
  additionalUnlock,
  buildTokenAccountProjection,
  calculateCurrentClaimableLamports,
  calculateProjectedClaimableLamports,
  projectRentMinimumFromLamportsPerByte,
  sumScanTotals,
} from "@/lib/rent-calculations";
import { RENT_PHASE_FINAL_LAMPORTS_PER_BYTE, RENT_PHASE_2_LAMPORTS_PER_BYTE } from "@/lib/rent-phases";
import { isValidSolanaAddress } from "@/lib/solana/scan";

describe("rent minimum projection math", () => {
  it("supports multiple token account sizes", () => {
    const normal = projectRentMinimumFromLamportsPerByte(165, RENT_PHASE_2_LAMPORTS_PER_BYTE);
    const withExtensions = projectRentMinimumFromLamportsPerByte(201, RENT_PHASE_2_LAMPORTS_PER_BYTE);

    expect(normal).toBe((128n + 165n) * BigInt(RENT_PHASE_2_LAMPORTS_PER_BYTE));
    expect(withExtensions).toBe((128n + 201n) * BigInt(RENT_PHASE_2_LAMPORTS_PER_BYTE));
  });

  it("handles projected rent minimum with explicit lamports per byte", () => {
    expect(projectRentMinimumFromLamportsPerByte(128, RENT_PHASE_FINAL_LAMPORTS_PER_BYTE)).toBe(
      (128n + 128n) * BigInt(RENT_PHASE_FINAL_LAMPORTS_PER_BYTE),
    );
  });

  it("computes zero claimable when account is at minimum", () => {
    expect(calculateCurrentClaimableLamports(5_000_000_000n, 5_000_000_000n)).toBe(0n);
    expect(calculateProjectedClaimableLamports(5_000_000_000n, 5_000_000_000n)).toBe(0n);
  });

  it("excludes wrapped SOL accounts from claiming", () => {
    const projection = buildTokenAccountProjection({
      accountAddress: "wrapped",
      program: "Token-2022",
      mint: "wrapped-mint",
      lamports: 20_000_000n,
      dataSize: 300,
      isNativeWrapped: true,
      currentRentMinimumLamports: 10_000_000n,
      projectedPhase2MinimumLamports: 8_000_000n,
      projectedPhase5MinimumLamports: 6_000_000n,
    });

    expect(projection.isClaimEligible).toBe(false);
    expect(projection.claimableNowLamports).toBe(0n);
    expect(projection.projectedPhase2ClaimableLamports).toBe(0n);
  });

  it("aggregates scan totals with bigint math", () => {
    const accounts = [
      buildTokenAccountProjection({
        accountAddress: "a",
        program: "Token",
        mint: "m",
        lamports: 20_000_000n,
        dataSize: 165,
        isNativeWrapped: false,
        currentRentMinimumLamports: 10_000_000n,
        projectedPhase2MinimumLamports: 8_000_000n,
        projectedPhase5MinimumLamports: 6_000_000n,
      }),
      buildTokenAccountProjection({
        accountAddress: "b",
        program: "Token",
        mint: "m",
        lamports: 7_000_000n,
        dataSize: 201,
        isNativeWrapped: false,
        currentRentMinimumLamports: 7_000_000n,
        projectedPhase2MinimumLamports: 6_000_000n,
        projectedPhase5MinimumLamports: 6_000_000n,
      }),
    ];
    const totals = sumScanTotals(accounts);
    expect(totals.totalAccounts).toBe(2);
    expect(totals.claimableAccounts).toBe(1);
    expect(totals.claimableNowLamports).toBe(10_000_000n);
    expect(additionalUnlock(10_000_000n, accounts[0].projectedPhase2ClaimableLamports)).toBe(2_000_000n);
  });

  it("validates Solana address strings", () => {
    expect(isValidSolanaAddress("11111111111111111111111111111112")).toBe(true);
    expect(isValidSolanaAddress("invalid-wallet-address")).toBe(false);
  });
});
