// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { WalletControl } from "./wallet-control";
import HomePage from "./page";

const state = vi.hoisted(() => ({ connected: null as null | { account: { address: string }; wallet: { name: string } }, wallets: [] as { name: string; icon: string; accounts: { address: string; chains: string[] }[] }[], connect: vi.fn(), disconnect: vi.fn(), selectAccount: vi.fn() }));
vi.mock("@/lib/solana/wallet-client", () => ({ walletClient: { wallet: { connect: state.connect, disconnect: state.disconnect, selectAccount: state.selectAccount } } }));
vi.mock("@solana/kit-plugin-wallet/react", () => ({ useConnectedWallet: () => state.connected, useWallets: () => state.wallets, useWalletStatus: () => "disconnected" }));
const wallet = "D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw";
const other = "11111111111111111111111111111111";
const scan = { scannedWallet: wallet, scannedAt: "2026-09-05", accounts: [], totals: { totalAccounts: 58, claimableAccounts: 58, claimableNowLamports: "10689097", claimableNowSol: "0.010689097", additionalUnlockPhase2Lamports: "21361144", additionalUnlockPhase2Sol: "0.021361144", additionalUnlockPhase5Lamports: "96099576", additionalUnlockPhase5Sol: "0.096099576" } };
function Harness() { const [open, setOpen] = useState(false); return <WalletControl open={open} onOpenChange={setOpen} onUseWallet={vi.fn()} />; }
beforeEach(() => {
  state.connected = null; state.wallets = [{ name: "Test wallet", icon: "data:image/svg+xml;base64,", accounts: [{ address: wallet, chains: ["solana:mainnet"] }] }];
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("explicit wallet choice", () => {
  it("does not connect on load or when opening chooser, even with one discovered wallet", async () => {
    render(<Harness />);
    expect(state.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(state.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Test wallet" }));
    await waitFor(() => expect(state.connect).toHaveBeenCalledWith(state.wallets[0]));
  });
  it("offers account selection only for multiple authorized accounts", () => {
    state.connected = { account: { address: wallet }, wallet: { name: "Test wallet" } };
    const view = render(<WalletControl open onOpenChange={vi.fn()} onUseWallet={vi.fn()} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    state.wallets[0].accounts.push({ address: other, chains: ["solana:mainnet"] });
    view.rerender(<WalletControl open onOpenChange={vi.fn()} onUseWallet={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: other } });
    expect(state.selectAccount).toHaveBeenCalledWith(state.wallets[0].accounts[1]);
  });
  it("scans publicly and retains input/results through connection, account changes and disconnect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => scan }));
    const view = render(<HomePage />);
    fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: wallet } });
    fireEvent.click(screen.getByRole("button", { name: "Check wallet" }));
    await waitFor(() => expect(screen.getAllByText("0.010689097 SOL").length).toBeGreaterThan(0));
    for (const address of [other, wallet, null]) {
      state.connected = address ? { account: { address }, wallet: { name: "Test wallet" } } : null;
      view.rerender(<HomePage />);
      expect((screen.getByLabelText("Wallet address") as HTMLInputElement).value).toBe(wallet);
      expect(screen.getAllByText("0.010689097 SOL").length).toBeGreaterThan(0);
      if (address === other) expect(screen.getByText("This is not the wallet you scanned.")).toBeTruthy();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.connect).not.toHaveBeenCalled();
  });
  it("Use this wallet fills input without submitting or erasing the previous result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => scan }));
    render(<HomePage />);
    fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: wallet } });
    fireEvent.click(screen.getByRole("button", { name: "Check wallet" }));
    await waitFor(() => expect(screen.getAllByText("0.010689097 SOL").length).toBeGreaterThan(0));
    state.connected = { account: { address: other }, wallet: { name: "Test wallet" } };
    fireEvent.click(screen.getAllByRole("button", { name: "Connect wallet" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Use this wallet" }));
    expect((screen.getByLabelText("Wallet address") as HTMLInputElement).value).toBe(other);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("0.010689097 SOL").length).toBeGreaterThan(0);
  });
});
