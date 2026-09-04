import type { RentBackApiAccount, RentBackApiResult } from "@/lib/solana/scan";
import { formatLamportsAsSol } from "@/lib/rent-calculations";

type ScanAccountDisplayRow = {
  accountAddress: string;
  program: string;
  mint: string;
  dataSizeText: string;
  claimableNow: string;
  projectedPhase2: string;
  isNativeWrapped: boolean;
  isClaimEligible: boolean;
};

export type ScanDisplayViewModel = {
  totals: {
    claimableNowSol: string;
    projectedPhase2TotalSol: string;
    projectedPhase5TotalSol: string;
    additionalUnlockPhase2Sol: string;
    additionalUnlockPhase5Sol: string;
    claimableAccounts: number;
  };
  accountRows: ScanAccountDisplayRow[];
  claimableProgramCounts: Record<string, number>;
};

export function buildScanViewModel(scanResult: RentBackApiResult): ScanDisplayViewModel {
  const claimableNowLamports = BigInt(scanResult.totals.claimableNowLamports);
  const projectedPhase2TotalSol = formatLamportsAsSol(
    claimableNowLamports + BigInt(scanResult.totals.additionalUnlockPhase2Lamports),
  );
  const projectedPhase5TotalSol = formatLamportsAsSol(
    claimableNowLamports + BigInt(scanResult.totals.additionalUnlockPhase5Lamports),
  );

  const claimableProgramCounts: Record<string, number> = {};
  const accountRows = scanResult.accounts.map((account: RentBackApiAccount) => {
    if (account.isClaimEligible) {
      claimableProgramCounts[account.program] = (claimableProgramCounts[account.program] ?? 0) + 1;
    }

    return {
      accountAddress: account.accountAddress,
      program: account.program,
      mint: account.mint,
      dataSizeText: `${account.dataSize} bytes`,
      claimableNow: `${account.claimableNowSol} SOL`,
      projectedPhase2: `${account.projectedPhase2ClaimableSol} SOL`,
      isNativeWrapped: account.isNativeWrapped,
      isClaimEligible: account.isClaimEligible,
    };
  });

  return {
    totals: {
      claimableNowSol: `${scanResult.totals.claimableNowSol} SOL`,
      projectedPhase2TotalSol: `${projectedPhase2TotalSol} SOL`,
      projectedPhase5TotalSol: `${projectedPhase5TotalSol} SOL`,
      additionalUnlockPhase2Sol: `${scanResult.totals.additionalUnlockPhase2Sol} SOL`,
      additionalUnlockPhase5Sol: `${scanResult.totals.additionalUnlockPhase5Sol} SOL`,
      claimableAccounts: scanResult.totals.claimableAccounts,
    },
    accountRows,
    claimableProgramCounts,
  };
}
