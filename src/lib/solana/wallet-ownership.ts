import { type RentBackApiResult } from "@/lib/solana/scan";

type ScanOwnershipInput = {
  scannedWallet: RentBackApiResult["scannedWallet"];
  totals: Pick<RentBackApiResult["totals"], "claimableNowLamports">;
};

export type WalletMatchState =
  | "hidden"
  | "no-claimable"
  | "disconnected"
  | "matching"
  | "mismatched";

export type WalletOwnershipContext = {
  scanResult: ScanOwnershipInput | null;
  connectedWalletAddress: string | null;
};

export function isWalletMatch(scannedWallet: string, connectedWallet: string): boolean {
  return scannedWallet === connectedWallet;
}

export function getWalletOwnershipState(context: WalletOwnershipContext): {
  state: WalletMatchState;
} {
  if (!context.scanResult) {
    return { state: "hidden" };
  }

  if (context.scanResult.totals.claimableNowLamports === "0") {
    return { state: "no-claimable" };
  }

  if (!context.connectedWalletAddress) {
    return { state: "disconnected" };
  }

  return isWalletMatch(context.scanResult.scannedWallet, context.connectedWalletAddress)
    ? { state: "matching" }
    : { state: "mismatched" };
}

export function shouldShowUseConnectedWalletAction(inputWallet: string, connectedWalletAddress: string | null): boolean {
  if (!connectedWalletAddress) {
    return false;
  }
  return inputWallet !== connectedWalletAddress;
}
