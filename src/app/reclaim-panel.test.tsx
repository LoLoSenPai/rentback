// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReclaimPanel } from "./reclaim-panel";
import type { RentBackApiResult } from "@/lib/solana/scan";
import type { ReclaimReview } from "@/lib/solana/reclaim";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
const wallet = "D2FDh5vdxdnnTXaZcHjF3sqoAKt5xTxACgRSVqfZbdrw";
const mocks = vi.hoisted(() => ({ connected: null as null | { account: { address: string }; wallet: { name: string }; signer: unknown }, request: vi.fn(), execute: vi.fn() }));
vi.mock("@solana/kit-plugin-wallet/react", () => ({ useConnectedWallet: () => mocks.connected }));
vi.mock("@/lib/solana/wallet-client", () => ({ walletClient: { wallet: { getState: () => ({ connected: mocks.connected }) } } }));
vi.mock("@/lib/solana/reclaim-client", async (original) => ({ ...await original<object>(), reclaimRequest: mocks.request, executeReviewedBatch: mocks.execute }));
const scan = { scannedWallet: wallet, totals: { claimableNowLamports: "10689097" } } as RentBackApiResult;
function review(): ReclaimReview {
  return { owner: wallet, chain: "solana:mainnet", expectedLamports: "1000", eligibleAccounts: 1, feeLamports: "5000", batches: [{ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: "1000", expectedLamports: "1000", feeLamports: "5000", simulatedAt: Date.now(), expiresAt: Date.now() + 30000, wireBytes: 200, accounts: [{ address: "11111111111111111111111111111111", program: TOKEN_PROGRAM_ADDRESS, dataSize: 165, lamports: "2001000", rentMinimum: "2000000", excess: "1000" }] }] };
}
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); mocks.connected = { account: { address: wallet }, wallet: { name: "Test" }, signer: {} }; });
afterEach(cleanup);
describe("reclaim review consent", () => {
  it("shows clean recovered success with confirmed details and collapsed blocked history", async () => {
    const b = review().batches[0];
    const confirmed = [26, 26, 6].map((count, i) => ({ owner: wallet, status: "confirmed", signature: String(i + 1).repeat(88), actualLamports: ["4799685", "4787146", "1102266"][i], batch: { ...b, accounts: Array.from({ length: count }, (_, j) => ({ ...b.accounts[0], address: `source-${i}-${j}` })) } }));
    const blocked = { owner: wallet, status: "failed", batch: b, error: "Your wallet changed the transaction instructions. Nothing was submitted by RentBack." };
    sessionStorage.setItem("rentback:reclaim-receipts:v1", JSON.stringify([...confirmed, blocked]));
    render(<ReclaimPanel scan={{ ...scan, totals: { ...scan.totals, claimableNowLamports: "0" } }} onConnect={vi.fn()} onRescan={vi.fn()} />);
    await screen.findByText("0.010689097 SOL reclaimed");
    expect(screen.getByText("58 token accounts processed")).toBeTruthy();
    expect(screen.getByText("0% RentBack fee")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review reclaim" })).toBeNull();
    expect(screen.getByText("View transaction details").closest("details")?.open).toBe(false);
    expect(screen.getByText(blocked.error).closest("details")?.open).toBe(false);
    expect(screen.getByText("Blocked before submission")).toBeTruthy();
    expect(screen.queryByText("Awaiting wallet or network outcome")).toBeNull();
    expect(screen.getByRole("link", { name: "Share on X" }).getAttribute("href")).not.toContain(wallet);
    const preview = screen.getByRole("link", { name: "Preview share card" }).getAttribute("href")!;
    expect(preview).toContain("amount=0.010689097"); expect(preview).toContain("accounts=58"); expect(preview).toContain("txs=3");
    expect(preview).not.toContain(wallet);
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not prepare or sign on mount; preparation never requests a signature", async () => {
    const budgeted = review(); budgeted.feeLamports = "5014"; budgeted.batches[0].feeLamports = "5014";
    budgeted.batches[0].computeBudget = { units: 13580, microLamports: "1000" };
    mocks.request.mockResolvedValue(budgeted);
    render(<ReclaimPanel scan={scan} onConnect={vi.fn()} onRescan={vi.fn()} />);
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review reclaim" }));
    await screen.findByText("Only excess SOL will move to your connected wallet. Tokens stay untouched and token accounts stay open.");
    expect(screen.getByText("1 accounts / 1 transactions")).toBeTruthy();
    expect(screen.getByText(/Estimated network fees:/).textContent).toContain("0.000005014 SOL");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("displays simulation failure and never presents a signing action", async () => {
    mocks.request.mockRejectedValue(new Error("Reclaim simulation failed: Instruction 0: Custom 12"));
    render(<ReclaimPanel scan={scan} onConnect={vi.fn()} onRescan={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review reclaim" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Instruction 0: Custom 12");
    expect(screen.queryByRole("button", { name: /^Reclaim / })).toBeNull(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("expires prepared reviews and requires a fresh review", async () => {
    const expired = review(); expired.batches[0].expiresAt = Date.now() - 1;
    mocks.request.mockResolvedValue(expired);
    render(<ReclaimPanel scan={scan} onConnect={vi.fn()} onRescan={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review reclaim" }));
    await screen.findByRole("button", { name: "Refresh expired review" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("restores unresolved receipts and blocks a new reclaim", async () => {
    sessionStorage.setItem("rentback:reclaim-receipts:v1", JSON.stringify([{ owner: wallet, batch: review().batches[0], status: "pending" }]));
    render(<ReclaimPanel scan={scan} onConnect={vi.fn()} onRescan={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Review reclaim" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("button", { name: "Check transaction status" })).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("never offers reclaim for zero excess", () => {
    render(<ReclaimPanel scan={{ ...scan, totals: { ...scan.totals, claimableNowLamports: "0" } }} onConnect={vi.fn()} onRescan={vi.fn()} />);
    expect(screen.getByText("No excess SOL currently available to reclaim.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review reclaim" })).toBeNull();
  });
});
