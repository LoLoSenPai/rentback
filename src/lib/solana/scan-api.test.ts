import { describe, expect, it } from "vitest";
import { buildTokenAccountProjection, formatLamportsAsSol, sumScanTotals } from "@/lib/rent-calculations";
import { buildScanViewModel } from "@/lib/solana/scan-display";
import { toRentBackApiResult, type RentBackResult } from "@/lib/solana/scan";

describe("RentBack API DTO serialization", () => {
  const wallet = "11111111111111111111111111111112";
  const largeLamports = 12_345_678_901_234_567_890n;
  const account = buildTokenAccountProjection({
    accountAddress: "token-account-1",
    program: "SPL Token",
    mint: "mint-1",
    lamports: largeLamports,
    dataSize: 165,
    isNativeWrapped: false,
    currentRentMinimumLamports: 4_000_000_000n,
    projectedPhase2MinimumLamports: 3_500_000_000n,
    projectedPhase5MinimumLamports: 2_000_000_000n,
  });
  const totals = sumScanTotals([account]);

  const domainResult: RentBackResult = {
    scannedWallet: wallet,
    scannedAt: "2026-09-04T00:00:00.000Z",
    accounts: [account],
    totals: {
      ...totals,
      claimableNowSol: formatLamportsAsSol(totals.claimableNowLamports),
      additionalUnlockPhase2Sol: formatLamportsAsSol(totals.additionalUnlockPhase2Lamports),
      additionalUnlockPhase5Sol: formatLamportsAsSol(totals.additionalUnlockPhase5Lamports),
    },
  };

  it("serializes a scan result to JSON-safe API DTOs", () => {
    const apiResult = toRentBackApiResult(domainResult);
    expect(() => JSON.stringify(apiResult)).not.toThrow();

    expect(typeof apiResult.totals.claimableNowLamports).toBe("string");
    expect(typeof apiResult.totals.additionalUnlockPhase2Lamports).toBe("string");
    expect(typeof apiResult.accounts[0].lamports).toBe("string");
  });

  it("stringifies nested account-detail monetary fields", () => {
    const apiResult = toRentBackApiResult(domainResult);

    expect(apiResult.accounts).toHaveLength(1);
    expect(apiResult.accounts[0]).toMatchObject({
      lamports: largeLamports.toString(),
      currentRentMinimumLamports: account.currentRentMinimumLamports.toString(),
      claimableNowLamports: account.claimableNowLamports.toString(),
      projectedPhase2ClaimableLamports: account.projectedPhase2ClaimableLamports.toString(),
      projectedPhase5ClaimableLamports: account.projectedPhase5ClaimableLamports.toString(),
      additionalUnlockPhase2Lamports: account.additionalUnlockPhase2Lamports.toString(),
      additionalUnlockPhase5Lamports: account.additionalUnlockPhase5Lamports.toString(),
      claimableNowSol: formatLamportsAsSol(account.claimableNowLamports),
    });
  });

  it("supports lamport values beyond Number.MAX_SAFE_INTEGER", () => {
    expect(largeLamports > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);

    const apiResult = toRentBackApiResult(domainResult);
    const payload = JSON.stringify(apiResult);

    expect(payload).toContain(largeLamports.toString());
    expect(payload).toContain(account.claimableNowLamports.toString());
  });
});

describe("client scan view model rendering", () => {
  it("renders successful non-zero scan response data without bigint operations", () => {
    const vm = buildScanViewModel({
      scannedWallet: "11111111111111111111111111111112",
      scannedAt: "2026-09-04T00:00:00.000Z",
      totals: {
        totalAccounts: 1,
        claimableAccounts: 1,
        claimableNowLamports: "2500000000",
        additionalUnlockPhase2Lamports: "300000000",
        additionalUnlockPhase5Lamports: "400000000",
        claimableNowSol: "2.5",
        additionalUnlockPhase2Sol: "0.3",
        additionalUnlockPhase5Sol: "0.4",
      },
      accounts: [
        {
          accountAddress: "token-account-1",
          program: "Token-2022",
          mint: "mint-1",
          lamports: "12345678900",
          dataSize: 201,
          isNativeWrapped: false,
          currentRentMinimumLamports: "900000000",
          claimableNowLamports: "1000000000",
          projectedPhase2ClaimableLamports: "1500000000",
          projectedPhase5ClaimableLamports: "2000000000",
          additionalUnlockPhase2Lamports: "500000000",
          additionalUnlockPhase5Lamports: "1000000000",
          isClaimEligible: true,
          claimableNowSol: "1",
          projectedPhase2ClaimableSol: "1.5",
          projectedPhase5ClaimableSol: "2",
          additionalUnlockPhase2Sol: "0.5",
          additionalUnlockPhase5Sol: "1",
        },
      ],
    });

    expect(vm.totals.claimableNowSol).toBe("2.5 SOL");
    expect(vm.totals.projectedPhase2TotalSol).toBe("2.8 SOL");
    expect(vm.totals.projectedPhase5TotalSol).toBe("2.9 SOL");
    expect(vm.claimableProgramCounts).toEqual({ "Token-2022": 1 });
    expect(vm.accountRows).toHaveLength(1);
    expect(vm.accountRows[0]).toMatchObject({
      accountAddress: "token-account-1",
      claimableNow: "1 SOL",
      projectedPhase2: "1.5 SOL",
      isNativeWrapped: false,
      isClaimEligible: true,
    });
  });

  it("builds totals with bigint-safe projected totals from lamport amounts", () => {
    const phase2Projected = formatLamportsAsSol(
      BigInt("9999999999999999999") + BigInt("1111111111111111111"),
    );
    const phase5Projected = formatLamportsAsSol(
      BigInt("9999999999999999999") + BigInt("2222222222222222222"),
    );

    const vm = buildScanViewModel({
      scannedWallet: "11111111111111111111111111111112",
      scannedAt: "2026-09-04T00:00:00.000Z",
      totals: {
        totalAccounts: 2,
        claimableAccounts: 2,
        claimableNowLamports: "9999999999999999999",
        additionalUnlockPhase2Lamports: "1111111111111111111",
        additionalUnlockPhase5Lamports: "2222222222222222222",
        claimableNowSol: "9.999999999",
        additionalUnlockPhase2Sol: "1.111111111",
        additionalUnlockPhase5Sol: "2.222222222",
      },
      accounts: [
        {
          accountAddress: "token-account-1",
          program: "SPL Token",
          mint: "mint-1",
          lamports: "10000000000",
          dataSize: 165,
          isNativeWrapped: false,
          currentRentMinimumLamports: "100",
          claimableNowLamports: "0",
          projectedPhase2ClaimableLamports: "0",
          projectedPhase5ClaimableLamports: "0",
          additionalUnlockPhase2Lamports: "0",
          additionalUnlockPhase5Lamports: "0",
          isClaimEligible: true,
          claimableNowSol: "0",
          projectedPhase2ClaimableSol: "0",
          projectedPhase5ClaimableSol: "0",
          additionalUnlockPhase2Sol: "0",
          additionalUnlockPhase5Sol: "0",
        },
        {
          accountAddress: "token-account-2",
          program: "Token-2022",
          mint: "mint-2",
          lamports: "10000000000",
          dataSize: 165,
          isNativeWrapped: false,
          currentRentMinimumLamports: "100",
          claimableNowLamports: "0",
          projectedPhase2ClaimableLamports: "0",
          projectedPhase5ClaimableLamports: "0",
          additionalUnlockPhase2Lamports: "0",
          additionalUnlockPhase5Lamports: "0",
          isClaimEligible: true,
          claimableNowSol: "0",
          projectedPhase2ClaimableSol: "0",
          projectedPhase5ClaimableSol: "0",
          additionalUnlockPhase2Sol: "0",
          additionalUnlockPhase5Sol: "0",
        },
      ],
    });

    expect(vm.totals.projectedPhase2TotalSol).toBe(`${phase2Projected} SOL`);
    expect(vm.totals.projectedPhase5TotalSol).toBe(`${phase5Projected} SOL`);
  });
});
