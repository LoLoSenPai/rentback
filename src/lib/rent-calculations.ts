export const LAMPORTS_PER_SOL = 1_000_000_000n;

export const BASE_ACCOUNT_OVERHEAD = 128n;

export type TokenAccountProjection = {
  accountAddress: string;
  program: string;
  mint: string;
  lamports: bigint;
  dataSize: number;
  isNativeWrapped: boolean;
  currentRentMinimumLamports: bigint;
  claimableNowLamports: bigint;
  projectedPhase2ClaimableLamports: bigint;
  projectedPhase5ClaimableLamports: bigint;
  additionalUnlockPhase2Lamports: bigint;
  additionalUnlockPhase5Lamports: bigint;
  isClaimEligible: boolean;
};

export type ScanTotals = {
  totalAccounts: number;
  claimableAccounts: number;
  claimableNowLamports: bigint;
  additionalUnlockPhase2Lamports: bigint;
  additionalUnlockPhase5Lamports: bigint;
};

export function projectedRentMinimum(dataSize: number): bigint {
  if (!Number.isInteger(dataSize) || dataSize < 0) {
    throw new Error("Data size must be a non-negative integer.");
  }
  return BASE_ACCOUNT_OVERHEAD + BigInt(dataSize);
}

export function projectRentMinimumFromLamportsPerByte(dataSize: number, lamportsPerByte: number): bigint {
  if (!Number.isInteger(lamportsPerByte) || lamportsPerByte < 0) {
    throw new Error("Lamports-per-byte must be a non-negative integer.");
  }
  return projectedRentMinimum(dataSize) * BigInt(lamportsPerByte);
}

export function calculateCurrentClaimableLamports(lamports: bigint, rentMinimumLamports: bigint): bigint {
  if (lamports <= rentMinimumLamports) {
    return 0n;
  }
  return lamports - rentMinimumLamports;
}

export function calculateProjectedClaimableLamports(lamports: bigint, projectedMinimumLamports: bigint): bigint {
  if (lamports <= projectedMinimumLamports) {
    return 0n;
  }
  return lamports - projectedMinimumLamports;
}

export function additionalUnlock(currentClaimableLamports: bigint, projectedClaimableLamports: bigint): bigint {
  if (projectedClaimableLamports <= currentClaimableLamports) {
    return 0n;
  }
  return projectedClaimableLamports - currentClaimableLamports;
}

export function buildTokenAccountProjection(params: {
  accountAddress: string;
  program: string;
  mint: string;
  lamports: bigint;
  dataSize: number;
  isNativeWrapped: boolean;
  currentRentMinimumLamports: bigint;
  projectedPhase2MinimumLamports: bigint;
  projectedPhase5MinimumLamports: bigint;
}): TokenAccountProjection {
  const currentClaimableLamports = params.isNativeWrapped
    ? 0n
    : calculateCurrentClaimableLamports(params.lamports, params.currentRentMinimumLamports);

  const projectedPhase2ClaimableLamports = params.isNativeWrapped
    ? 0n
    : calculateProjectedClaimableLamports(params.lamports, params.projectedPhase2MinimumLamports);

  const projectedPhase5ClaimableLamports = params.isNativeWrapped
    ? 0n
    : calculateProjectedClaimableLamports(params.lamports, params.projectedPhase5MinimumLamports);

  return {
    accountAddress: params.accountAddress,
    program: params.program,
    mint: params.mint,
    lamports: params.lamports,
    dataSize: params.dataSize,
    isNativeWrapped: params.isNativeWrapped,
    currentRentMinimumLamports: params.currentRentMinimumLamports,
    claimableNowLamports: currentClaimableLamports,
    projectedPhase2ClaimableLamports,
    projectedPhase5ClaimableLamports,
    additionalUnlockPhase2Lamports: additionalUnlock(currentClaimableLamports, projectedPhase2ClaimableLamports),
    additionalUnlockPhase5Lamports: additionalUnlock(currentClaimableLamports, projectedPhase5ClaimableLamports),
    isClaimEligible: !params.isNativeWrapped && currentClaimableLamports > 0n,
  };
}

export function sumScanTotals(accounts: TokenAccountProjection[]): ScanTotals {
  return accounts.reduce(
    (acc, account) => {
      acc.totalAccounts += 1;
      if (account.isClaimEligible) {
        acc.claimableAccounts += 1;
      }
      acc.claimableNowLamports += account.claimableNowLamports;
      acc.additionalUnlockPhase2Lamports += account.additionalUnlockPhase2Lamports;
      acc.additionalUnlockPhase5Lamports += account.additionalUnlockPhase5Lamports;
      return acc;
    },
    {
      totalAccounts: 0,
      claimableAccounts: 0,
      claimableNowLamports: 0n,
      additionalUnlockPhase2Lamports: 0n,
      additionalUnlockPhase5Lamports: 0n,
    },
  );
}

export function formatLamportsAsSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const decimal = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  const trimmedDecimal = decimal.replace(/0+$/, "");
  if (trimmedDecimal.length === 0) {
    return `${whole}.000`;
  }
  return `${whole}.${trimmedDecimal}`;
}
