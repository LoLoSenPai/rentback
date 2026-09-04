import { describe, expect, it } from "vitest";
import { getWalletOwnershipState, isWalletMatch, shouldShowUseConnectedWalletAction } from "@/lib/solana/wallet-ownership";

const baseScanResult = {
  scannedWallet: "D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw",
  totals: {
    claimableNowLamports: "12345678",
  },
};

describe("wallet ownership state", () => {
  it("is no wallet match when wallets are different", () => {
    expect(isWalletMatch("ABC", "XYZ")).toBe(false);
  });

  it("is exact wallet match by address equality", () => {
    const wallet = "D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw";
    expect(isWalletMatch(wallet, wallet)).toBe(true);
  });

  it("shows hidden state when no scan exists", () => {
    expect(getWalletOwnershipState({ scanResult: null, connectedWalletAddress: null }).state).toBe("hidden");
  });

  it("keeps ownership checks public when disconnected", () => {
    expect(
      getWalletOwnershipState({ scanResult: baseScanResult, connectedWalletAddress: null }).state,
    ).toBe("disconnected");
  });

  it("keeps scan context independent from connect/disconnect transitions", () => {
    const connectedState = getWalletOwnershipState({ scanResult: baseScanResult, connectedWalletAddress: baseScanResult.scannedWallet });
    const disconnectedState = getWalletOwnershipState({ scanResult: baseScanResult, connectedWalletAddress: null });

    expect(connectedState.state).toBe("matching");
    expect(disconnectedState.state).toBe("disconnected");
  });

  it("supports arbitrary scanned wallets while disconnected", () => {
    const otherWalletScan = {
      ...baseScanResult,
      scannedWallet: "SomeOtherWalletAddress",
    };

    expect(
      getWalletOwnershipState({ scanResult: otherWalletScan, connectedWalletAddress: null }).state,
    ).toBe("disconnected");
    expect(
      shouldShowUseConnectedWalletAction(otherWalletScan.scannedWallet, baseScanResult.scannedWallet),
    ).toBe(true);
  });

  it("shows matching state when scanned wallet and connected wallet are identical", () => {
    expect(
      getWalletOwnershipState({
        scanResult: baseScanResult,
        connectedWalletAddress: baseScanResult.scannedWallet,
      }).state,
    ).toBe("matching");
  });

  it("shows mismatch state when connected wallet differs from scanned wallet", () => {
    expect(
      getWalletOwnershipState({
        scanResult: baseScanResult,
        connectedWalletAddress: "A1B2c3D4",
      }).state,
    ).toBe("mismatched");
  });

  it("shows no-claimable state when the scan has zero reclaimable lamports", () => {
    expect(
      getWalletOwnershipState({
        scanResult: {
          ...baseScanResult,
          totals: { claimableNowLamports: "0" },
        },
        connectedWalletAddress: baseScanResult.scannedWallet,
      }).state,
    ).toBe("no-claimable");
  });

  it("keeps use connected wallet action available when input differs from connected wallet", () => {
    expect(
      shouldShowUseConnectedWalletAction("SomeOtherAddress", baseScanResult.scannedWallet),
    ).toBe(true);
  });

  it("hides use connected wallet action when input is already the connected wallet", () => {
    expect(
      shouldShowUseConnectedWalletAction(baseScanResult.scannedWallet, baseScanResult.scannedWallet),
    ).toBe(false);
  });
});
