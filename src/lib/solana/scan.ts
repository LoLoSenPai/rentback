import { address, type Address, createSolanaRpc } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  RENT_PHASE_2_LAMPORTS_PER_BYTE,
  RENT_PHASE_FINAL_LAMPORTS_PER_BYTE,
} from "@/lib/rent-phases";
import {
  buildTokenAccountProjection,
  formatLamportsAsSol,
  sumScanTotals,
  TokenAccountProjection,
  type ScanTotals,
} from "@/lib/rent-calculations";
import { getConfiguredRpcUrl } from "@/lib/solana/rpc";

type RpcTokenAccount = {
  pubkey: string;
  account: {
    lamports: number;
    data: {
      parsed?: {
        info?: {
          mint?: string;
          isNative?: boolean | { isNative?: boolean };
        };
      };
      space?: string | number;
    };
  };
};

export type ScanAccount = TokenAccountProjection;

export type RentBackResult = {
  scannedWallet: string;
  scannedAt: string;
  accounts: ScanAccount[];
  totals: ScanTotals & {
    claimableNowSol: string;
    additionalUnlockPhase2Sol: string;
    additionalUnlockPhase5Sol: string;
  };
};

export type RentBackApiAccount = Omit<
  ScanAccount,
  | "lamports"
  | "currentRentMinimumLamports"
  | "claimableNowLamports"
  | "projectedPhase2ClaimableLamports"
  | "projectedPhase5ClaimableLamports"
  | "additionalUnlockPhase2Lamports"
  | "additionalUnlockPhase5Lamports"
> & {
  lamports: string;
  currentRentMinimumLamports: string;
  claimableNowLamports: string;
  projectedPhase2ClaimableLamports: string;
  projectedPhase5ClaimableLamports: string;
  additionalUnlockPhase2Lamports: string;
  additionalUnlockPhase5Lamports: string;
  claimableNowSol: string;
  projectedPhase2ClaimableSol: string;
  projectedPhase5ClaimableSol: string;
  additionalUnlockPhase2Sol: string;
  additionalUnlockPhase5Sol: string;
};

export type RentBackApiTotals = Omit<
  ScanTotals,
  | "claimableNowLamports"
  | "additionalUnlockPhase2Lamports"
  | "additionalUnlockPhase5Lamports"
> & {
  claimableNowLamports: string;
  additionalUnlockPhase2Lamports: string;
  additionalUnlockPhase5Lamports: string;
  claimableNowSol: string;
  additionalUnlockPhase2Sol: string;
  additionalUnlockPhase5Sol: string;
};

export type RentBackApiResult = Omit<RentBackResult, "accounts" | "totals"> & {
  accounts: RentBackApiAccount[];
  totals: RentBackApiTotals;
};

function toDecimalString(value: bigint): string {
  return value.toString();
}

function toApiAccount(account: ScanAccount): RentBackApiAccount {
  return {
    accountAddress: account.accountAddress,
    program: account.program,
    mint: account.mint,
    dataSize: account.dataSize,
    isNativeWrapped: account.isNativeWrapped,
    lamports: toDecimalString(account.lamports),
    currentRentMinimumLamports: toDecimalString(account.currentRentMinimumLamports),
    claimableNowLamports: toDecimalString(account.claimableNowLamports),
    projectedPhase2ClaimableLamports: toDecimalString(account.projectedPhase2ClaimableLamports),
    projectedPhase5ClaimableLamports: toDecimalString(account.projectedPhase5ClaimableLamports),
    additionalUnlockPhase2Lamports: toDecimalString(account.additionalUnlockPhase2Lamports),
    additionalUnlockPhase5Lamports: toDecimalString(account.additionalUnlockPhase5Lamports),
    isClaimEligible: account.isClaimEligible,
    claimableNowSol: formatLamportsAsSol(account.claimableNowLamports),
    projectedPhase2ClaimableSol: formatLamportsAsSol(account.projectedPhase2ClaimableLamports),
    projectedPhase5ClaimableSol: formatLamportsAsSol(account.projectedPhase5ClaimableLamports),
    additionalUnlockPhase2Sol: formatLamportsAsSol(account.additionalUnlockPhase2Lamports),
    additionalUnlockPhase5Sol: formatLamportsAsSol(account.additionalUnlockPhase5Lamports),
  };
}

function toApiTotals(totals: RentBackResult["totals"]): RentBackApiTotals {
  return {
    totalAccounts: totals.totalAccounts,
    claimableAccounts: totals.claimableAccounts,
    claimableNowLamports: toDecimalString(totals.claimableNowLamports),
    additionalUnlockPhase2Lamports: toDecimalString(totals.additionalUnlockPhase2Lamports),
    additionalUnlockPhase5Lamports: toDecimalString(totals.additionalUnlockPhase5Lamports),
    claimableNowSol: totals.claimableNowSol,
    additionalUnlockPhase2Sol: totals.additionalUnlockPhase2Sol,
    additionalUnlockPhase5Sol: totals.additionalUnlockPhase5Sol,
  };
}

export function toRentBackApiResult(scanResult: RentBackResult): RentBackApiResult {
  return {
    scannedWallet: scanResult.scannedWallet,
    scannedAt: scanResult.scannedAt,
    accounts: scanResult.accounts.map(toApiAccount),
    totals: toApiTotals(scanResult.totals),
  };
}

const PROGRAM_NAME_SPL = "SPL Token";
const PROGRAM_NAME_TOKEN_2022 = "Token-2022";

const RENT_MINIMUM_CACHE_TTL_MS = 60 * 1000;

type RentMinimumCacheEntry = {
  minimumLamports: bigint;
  fetchedAt: number;
};

const rentMinimumCache = new Map<number, RentMinimumCacheEntry>();

function toLamports(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(Math.max(0, Math.trunc(value)));
  }
  if (typeof value === "string") {
    return BigInt(value);
  }
  throw new Error("Unexpected lamport value from RPC");
}

function toStringNumber(value: unknown): number {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber < 0) {
    throw new Error("Invalid data size");
  }
  return Math.trunc(asNumber);
}

export function isValidSolanaAddress(candidate: string): boolean {
  try {
    address(candidate);
    return true;
  } catch {
    return false;
  }
}

function isWrappedNativeTokenInfo(info: unknown): boolean {
  if (info === true) {
    return true;
  }
  if (info && typeof info === "object") {
    const nested = (info as Record<string, unknown>)["isNative"];
    return nested === true;
  }
  return false;
}

async function fetchCachedRentMinimum(
  rpc: ReturnType<typeof createSolanaRpc>,
  dataSize: number,
): Promise<bigint> {
  const cached = rentMinimumCache.get(dataSize);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < RENT_MINIMUM_CACHE_TTL_MS) {
    return cached.minimumLamports;
  }
  const minimum = toLamports(await rpc.getMinimumBalanceForRentExemption(BigInt(dataSize)).send());
  rentMinimumCache.set(dataSize, { minimumLamports: minimum, fetchedAt: now });
  return minimum;
}

type RawProgramAccount = {
  accountAddress: string;
  lamports: bigint;
  dataSize: number;
  mint: string;
  isNativeWrapped: boolean;
  program: string;
};

function parseNativeWrapped(account: RpcTokenAccount): boolean {
  const parsed = account.account?.data?.parsed;
  return isWrappedNativeTokenInfo(parsed?.info?.isNative);
}

function parseMint(account: RpcTokenAccount): string {
  return account.account?.data?.parsed?.info?.mint ?? "unknown";
}

function sortByClaimableDesc(a: ScanAccount, b: ScanAccount): number {
  if (a.claimableNowLamports > b.claimableNowLamports) return -1;
  if (a.claimableNowLamports < b.claimableNowLamports) return 1;
  return 0;
}

function projectedRentMinimumLamports(dataSize: number, lamportsPerByte: number): bigint {
  return (128n + BigInt(dataSize)) * BigInt(lamportsPerByte);
}

async function fetchProgramAccounts(
  owner: Address,
  programAddress: string,
  programName: string,
  rpc: ReturnType<typeof createSolanaRpc>,
): Promise<RawProgramAccount[]> {
  const response = await rpc
    .getTokenAccountsByOwner(owner, { programId: address(programAddress) }, { encoding: "jsonParsed" })
    .send();

  const value = response?.value;
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as RpcTokenAccount[]).map((rawAccount) => {
    const lamports = toLamports(rawAccount.account?.lamports);
    const dataSize = toStringNumber(rawAccount.account?.data?.space);
    return {
      accountAddress: rawAccount.pubkey,
      lamports,
      dataSize,
      mint: parseMint(rawAccount),
      isNativeWrapped: parseNativeWrapped(rawAccount),
      program: programName,
    };
  });
}

async function getRentMinimumsForSizes(
  rpc: ReturnType<typeof createSolanaRpc>,
  sizes: number[],
): Promise<Map<number, bigint>> {
  const minimums = new Map<number, bigint>();
  await Promise.all(
    sizes.map(async (dataSize) => {
      minimums.set(dataSize, await fetchCachedRentMinimum(rpc, dataSize));
    }),
  );
  return minimums;
}

function toProjectionAccount(
  rawAccount: RawProgramAccount,
  currentRentMinimumBySize: Map<number, bigint>,
): ScanAccount {
  const currentRentMinimumLamports = currentRentMinimumBySize.get(rawAccount.dataSize);
  if (currentRentMinimumLamports === undefined) {
    throw new Error("Missing rent minimum for scanned data size");
  }

  const projectedPhase2MinimumLamports = projectedRentMinimumLamports(
    rawAccount.dataSize,
    RENT_PHASE_2_LAMPORTS_PER_BYTE,
  );
  const projectedPhase5MinimumLamports = projectedRentMinimumLamports(
    rawAccount.dataSize,
    RENT_PHASE_FINAL_LAMPORTS_PER_BYTE,
  );

  return buildTokenAccountProjection({
    accountAddress: rawAccount.accountAddress,
    program: rawAccount.program,
    mint: rawAccount.mint,
    lamports: rawAccount.lamports,
    dataSize: rawAccount.dataSize,
    isNativeWrapped: rawAccount.isNativeWrapped,
    currentRentMinimumLamports,
    projectedPhase2MinimumLamports,
    projectedPhase5MinimumLamports,
  });
}

export async function scanWalletRentProjection(walletAddress: string): Promise<RentBackResult> {
  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana address");
  }

  const rpc = createSolanaRpc(getConfiguredRpcUrl());
  const owner = address(walletAddress);

  const [tokenAccounts, token2022Accounts] = await Promise.all([
    fetchProgramAccounts(owner, TOKEN_PROGRAM_ADDRESS, PROGRAM_NAME_SPL, rpc),
    fetchProgramAccounts(owner, TOKEN_2022_PROGRAM_ADDRESS, PROGRAM_NAME_TOKEN_2022, rpc),
  ]);

  const allAccounts = [...tokenAccounts, ...token2022Accounts];
  const uniqueSizes = [...new Set(allAccounts.map((account) => account.dataSize))];
  const rentMinimumBySize = await getRentMinimumsForSizes(rpc, uniqueSizes);

  const projections = allAccounts.map((rawAccount) => toProjectionAccount(rawAccount, rentMinimumBySize)).sort(sortByClaimableDesc);
  const totals = sumScanTotals(projections);

  return {
    scannedWallet: walletAddress,
    scannedAt: new Date().toISOString(),
    accounts: projections,
    totals: {
      ...totals,
      claimableNowSol: formatLamportsAsSol(totals.claimableNowLamports),
      additionalUnlockPhase2Sol: formatLamportsAsSol(totals.additionalUnlockPhase2Lamports),
      additionalUnlockPhase5Sol: formatLamportsAsSol(totals.additionalUnlockPhase5Lamports),
    },
  };
}
