"use client";

import { FormEvent, useMemo, useState } from "react";
import { useConnectedWallet, useConnect, useDisconnect, useWalletStatus, useWallets } from "@solana/kit-plugin-wallet/react";
import { RENT_PHASES } from "@/lib/rent-phases";
import { buildScanViewModel } from "@/lib/solana/scan-display";
import { walletClient } from "@/lib/solana/wallet-client";
import {
  getWalletOwnershipState,
  shouldShowUseConnectedWalletAction,
  type WalletOwnershipContext,
} from "@/lib/solana/wallet-ownership";
import { type RentBackApiResult } from "@/lib/solana/scan";

type ScanResponse = RentBackApiResult | { error: string };
type WalletScanResponse = RentBackApiResult;

const timelinePhases = RENT_PHASES.map((phase) => ({
  label: phase.label,
  percent: `${phase.reductionPercent}%`,
  current: phase.isLiveHint,
}));

function shortenAddress(address: string): string {
  if (address.length <= 13) {
    return address;
  }
  return `${address.slice(0, 5)}…${address.slice(-6)}`;
}

function formatProgramSummary(programCounts: Record<string, number>): string {
  return Object.entries(programCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([program, count]) => `${count} ${program}`)
    .join(" · ");
}

function getReclaimContext(result: WalletScanResponse | null, connectedWalletAddress: string | null): WalletOwnershipContext {
  return {
    scanResult: result
      ? {
          scannedWallet: result.scannedWallet,
          totals: {
            claimableNowLamports: result.totals.claimableNowLamports,
          },
        }
      : null,
    connectedWalletAddress,
  };
}

export default function HomePage() {
  const [walletAddress, setWalletAddress] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalletScanResponse | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);

  const connectedWallet = useConnectedWallet(walletClient);
  const wallets = useWallets(walletClient);
  const walletStatus = useWalletStatus(walletClient);
  const { dispatch: connectWallet, isRunning: isConnecting } = useConnect(walletClient);
  const { dispatch: disconnectWallet, isRunning: isDisconnecting } = useDisconnect(walletClient);
  const connectedWalletAddress = connectedWallet?.account.address ?? null;

  const isWalletActioning = isConnecting || isDisconnecting;
  const isWalletReadinessPending = walletStatus === "pending" || walletStatus === "reconnecting";

  const reclaimContext = useMemo(
    () => getReclaimContext(result, connectedWalletAddress),
    [connectedWalletAddress, result],
  );
  const walletState = getWalletOwnershipState(reclaimContext);

  const viewModel = useMemo(() => (result ? buildScanViewModel(result) : null), [result]);
  const eligibleAccounts = useMemo(() => viewModel?.accountRows.filter((account) => account.isClaimEligible) ?? [], [viewModel]);
  const shownAccounts = useMemo(
    () => (showAllAccounts ? eligibleAccounts : eligibleAccounts.slice(0, 10)),
    [eligibleAccounts, showAllAccounts],
  );
  const hasMoreAccounts = eligibleAccounts.length > 10;

  const hasScanned = result !== null;
  const claimableNow = viewModel?.totals.claimableNowSol ?? "0 SOL";
  const nextPhaseAdditional = viewModel?.totals.additionalUnlockPhase2Sol ?? "0 SOL";
  const nextPhaseTotal = viewModel?.totals.projectedPhase2TotalSol ?? "0 SOL";
  const finalPhaseAdditional = viewModel?.totals.additionalUnlockPhase5Sol ?? "0 SOL";
  const finalPhaseTotal = viewModel?.totals.projectedPhase5TotalSol ?? "0 SOL";
  const eligibleCount = viewModel?.totals.claimableAccounts ?? 0;
  const programSummary = viewModel ? formatProgramSummary(viewModel.claimableProgramCounts) : "";
  const showTechnicalSummary = hasScanned && viewModel !== null;

  const shouldShowUseConnectedWallet = shouldShowUseConnectedWalletAction(walletAddress, connectedWalletAddress);
  const showWalletPicker = walletPickerOpen;

  const hasClaimableResult = result?.totals.claimableNowLamports !== "0";

  const educationalSection = (
    <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
      <h2 className="text-xl font-semibold text-white">Why is there SOL to reclaim?</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">
        Solana has started reducing account rent. Token accounts created before the change were funded for the old rent requirement, so
        many now hold more SOL than they need.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">
        That excess SOL can be withdrawn while keeping the token account open and its token balance unchanged.
      </p>
      <p className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-400">Based on official Solana documentation</p>
      <ul className="mt-3 space-y-2 text-sm text-slate-300">
        <li>
          <a
            className="text-rent-accent underline decoration-dotted underline-offset-4"
            href="https://solana.com/news/how-to-reclaim-excess-sol-after-rent-reduction"
            target="_blank"
            rel="noopener noreferrer"
          >
            Rent reduction / reclaim article
          </a>
        </li>
        <li>
          <a
            className="text-rent-accent underline decoration-dotted underline-offset-4"
            href="https://solana.com/docs/tokens/advanced/withdraw-excess-lamports"
            target="_blank"
            rel="noopener noreferrer"
          >
            WithdrawExcessLamports documentation
          </a>
        </li>
      </ul>
    </section>
  );

  const walletStatusPanel = (
    <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Wallet connection</h2>
        <p className="text-xs text-slate-400">
          {connectedWalletAddress ? `Connected: ${shortenAddress(connectedWalletAddress)}` : "No wallet connected"}
        </p>
      </div>

      {!connectedWalletAddress && !isWalletReadinessPending ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setWalletPickerOpen((open) => !open)}
            disabled={isWalletActioning}
            className="rounded-lg border border-rent-border bg-rent-bg/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-rent-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Connect wallet
          </button>
          <p className="mt-2 text-sm text-slate-300">Choose a wallet from Wallet Standard discovery.</p>
        </div>
      ) : null}

      {connectedWalletAddress ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await disconnectWallet();
              } catch {
                setError("Unable to disconnect wallet.");
              }
            }}
            disabled={isWalletActioning}
            className="rounded-lg border border-rent-border px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-rent-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Disconnect wallet
          </button>
          <button
            type="button"
            onClick={() => setWalletPickerOpen((open) => !open)}
            disabled={isWalletActioning}
            className="rounded-lg border border-rent-border px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-rent-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {walletPickerOpen ? "Hide wallets" : "Switch wallet"}
          </button>
        </div>
      ) : null}

      {isWalletReadinessPending ? (
        <p className="mt-3 text-sm text-slate-400">Checking wallet availability...</p>
      ) : null}

      {showWalletPicker ? (
        wallets.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No Wallet Standard wallets were discovered.</p>
        ) : (
          <div className="mt-3">
            {wallets.length === 1 ? (
              <p className="mb-2 text-xs uppercase tracking-[0.15em] text-slate-400">
                {wallets.length} compatible wallet detected
              </p>
            ) : (
              <p className="mb-2 text-xs uppercase tracking-[0.15em] text-slate-400">
                {wallets.length} compatible wallets detected
              </p>
            )}
            <div className="flex flex-wrap gap-2">
            {wallets.map((wallet, index) => (
              <button
                key={`${wallet.name}-${index}`}
                type="button"
                disabled={isWalletActioning}
                onClick={() => {
                  void handleConnectWallet(wallet);
                  setWalletPickerOpen(false);
                }}
                className="rounded-lg border border-rent-border px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-rent-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {wallet.name}
              </button>
            ))}
            </div>
          </div>
        )
      ) : null}

      {walletState.state === "disconnected" && hasClaimableResult ? (
        <div className="mt-4 rounded-xl border border-rent-border bg-rent-bg/70 p-3">
          <p className="text-sm text-slate-200">
            {claimableNow} available to reclaim.
          </p>
          <p className="mt-1 text-xs text-slate-400">Connect the scanned wallet to prepare the reclaim.</p>
        </div>
      ) : null}

      {walletState.state === "matching" ? (
        <div className="mt-4 rounded-xl border border-rent-border bg-rent-bg/70 p-3">
          <p className="text-sm text-slate-200">{claimableNow} ready to reclaim.</p>
          <p className="mt-1 text-xs text-rent-accent">Wallet connected to scanned address.</p>
          <button
            type="button"
            disabled
            className="mt-3 rounded-lg border border-rent-accent/70 px-3 py-2 text-sm font-semibold text-rent-accent"
          >
            Reclaim {claimableNow}
          </button>
          <p className="mt-1 text-[11px] text-slate-400">Reclaim flow is prepared for a later milestone.</p>
        </div>
      ) : null}

      {walletState.state === "mismatched" ? (
        <div className="mt-4 rounded-xl border border-rent-border bg-rent-bg/70 p-3">
          <p className="text-sm text-white">This is not the wallet you scanned.</p>
          <p className="mt-2 text-xs text-slate-300">Scanned: {shortenAddress(result?.scannedWallet ?? "")}</p>
          <p className="text-xs text-slate-300">Connected: {shortenAddress(connectedWalletAddress ?? "")}</p>
          <button
            type="button"
            onClick={async () => {
              try {
                if (connectedWallet) {
                  await disconnectWallet();
                }
                setWalletPickerOpen(true);
              } catch {
                setError("Unable to switch wallet.");
              }
            }}
            disabled={isWalletActioning}
            className="mt-3 rounded-lg border border-rent-accent/80 px-3 py-2 text-sm font-semibold text-rent-accent transition hover:border-rent-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Connect scanned wallet
          </button>
        </div>
      ) : null}

      {walletState.state === "no-claimable" ? (
        <div className="mt-4 rounded-xl border border-rent-border bg-rent-bg/70 p-3">
          <p className="text-sm text-slate-200">No excess SOL currently available to reclaim.</p>
        </div>
      ) : null}
    </section>
  );

  async function handleConnectWallet(selectedWallet: Parameters<typeof connectWallet>[0]) {
    try {
      await connectWallet(selectedWallet);
      setWalletPickerOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect wallet.");
    }
  }

  function handleUseConnectedWallet() {
    if (!connectedWalletAddress) {
      return;
    }
    setWalletAddress(connectedWalletAddress);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!walletAddress.trim() || isScanning) {
      return;
    }

    const walletToScan = walletAddress.trim();
    setIsScanning(true);
    setError(null);
    setShowTechnicalDetails(false);
    setShowAllAccounts(false);
    setWalletPickerOpen(false);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ walletAddress: walletToScan }),
      });

      const payload = (await response.json()) as ScanResponse;
      if (!response.ok) {
        throw new Error((payload as { error: string }).error ?? "Scan failed.");
      }

      const scanPayload = payload as WalletScanResponse;
      setResult(scanPayload);
      setWalletAddress(walletToScan);
      setError(null);
      setWalletPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error while scanning.");
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-rent-bg text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 left-1/4 h-[420px] w-[420px] rounded-full bg-cyan-400/20 blur-[130px]" />
        <div className="absolute top-20 right-[-18rem] h-[360px] w-[360px] rounded-full bg-indigo-500/18 blur-[130px]" />
        <div className="absolute bottom-[-18rem] left-1/2 h-[460px] w-[460px] -translate-x-1/2 rounded-full bg-blue-500/12 blur-[150px]" />
      </div>

      <section className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 md:px-8">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">SOLANA RENT UTILITY</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-white md:text-5xl">Solana rent just dropped.</h1>
          <p className="mt-3 text-base leading-relaxed text-slate-300 md:text-lg">
            See how much SOL your wallet can reclaim from token accounts.
          </p>
          <p className="mt-2 text-sm text-slate-400">No wallet connection required for scan. No tokens moved. No accounts closed.</p>
        </header>

        <form
          className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-rent-border bg-rent-panel/60 px-4 py-4 shadow-panel"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-1 flex-col gap-2 md:gap-3">
            <input
              className="rent-input flex-1 rounded-xl px-4 py-3 text-base outline-none placeholder:text-slate-400"
              value={walletAddress}
              onChange={(event) => setWalletAddress(event.target.value)}
              placeholder="Enter Solana wallet address"
              aria-label="Wallet address"
            />
            {shouldShowUseConnectedWallet ? (
              <button
                type="button"
                className="self-start text-sm text-rent-accent underline decoration-dotted underline-offset-4"
                onClick={handleUseConnectedWallet}
              >
                Use connected wallet
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={isScanning}
            className="rounded-xl bg-rent-accent px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isScanning ? "Scanning..." : "Check wallet"}
          </button>
        </form>

        {error && (
          <p role="alert" className="mx-auto w-full max-w-3xl rounded-xl border border-red-500/45 bg-red-500/10 p-3 text-sm text-red-100">
            {error}
          </p>
        )}

        {!hasScanned ? (
          <>
            <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
              <p className="text-sm text-slate-300">
                Paste a wallet and click <span className="font-semibold text-white">Check wallet</span> to calculate reclaimable SOL from all
                SPL Token and Token-2022 accounts.
              </p>
            </section>
            {walletStatusPanel}
            {educationalSection}
          </>
        ) : (
          <>
            <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Available to reclaim now</p>
              <p className="mt-1 text-5xl font-black tracking-tight text-white">{claimableNow}</p>
              <p className="mt-2 text-sm text-slate-300">Across {eligibleCount} eligible token accounts</p>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <article className="rounded-xl border border-rent-border bg-rent-bg/70 p-4">
                  <p className="text-xs uppercase text-slate-400">Next rent drop</p>
                  <p className="mt-2 text-2xl font-black text-white">{nextPhaseAdditional}</p>
                  <p className="mt-2 text-sm text-slate-300">+ additional unlock</p>
                  <p className="mt-1 text-sm text-slate-100">Projected total: {nextPhaseTotal}</p>
                  <p className="mt-2 text-[11px] text-slate-500">Phase 2 estimate, not a guaranteed outcome.</p>
                </article>
                <article className="rounded-xl border border-rent-border bg-rent-bg/70 p-4">
                  <p className="text-xs uppercase text-slate-400">Full planned rollout</p>
                  <p className="mt-2 text-2xl font-black text-white">{finalPhaseAdditional}</p>
                  <p className="mt-2 text-sm text-slate-300">+ additional unlock</p>
                  <p className="mt-1 text-sm text-slate-100">Projected total: {finalPhaseTotal}</p>
                  <p className="mt-2 text-[11px] text-slate-500">Final phase estimate, for planning only.</p>
                </article>
              </div>
            </section>

            {walletStatusPanel}
            {educationalSection}

            <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Rent rollout timeline</h2>
                <p className="text-xs text-slate-400">Progressive rent reductions</p>
              </div>
              <div className="relative mt-4">
                <div className="absolute left-0 right-0 top-3 h-[2px] bg-rent-border" />
                <div className="relative grid grid-cols-5">
                  {timelinePhases.map((phase, index) => (
                    <div key={phase.label} className="flex flex-col items-center text-xs">
                      <span
                        className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                          phase.current
                            ? "border-rent-accent bg-rent-accent/20 text-rent-accent shadow-[0_0_0_4px_rgba(86,182,247,0.08)]"
                            : "border-slate-500/70 bg-rent-bg text-slate-400"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className={`mt-2 ${phase.current ? "text-white" : "text-slate-400"}`}>{phase.label}</span>
                      <span className={`mt-1 font-medium ${phase.current ? "text-rent-accent" : "text-slate-500"}`}>
                        {phase.percent}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400">● LIVE is active now. Future phases are estimates and may change.</p>
            </section>
          </>
        )}

        {showTechnicalSummary ? (
          <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Account details</h2>
              <button
                type="button"
                className="text-sm text-rent-accent underline decoration-dotted underline-offset-4 transition hover:opacity-80"
                onClick={() => setShowTechnicalDetails((value) => !value)}
              >
                {showTechnicalDetails ? "Hide technical details" : "View technical details"}
              </button>
            </div>

            <p className="mt-3 text-sm text-slate-300">
              {eligibleCount} eligible accounts
              {programSummary ? ` · ${programSummary}` : ""}
            </p>

            {showTechnicalDetails && (
              <div className="mt-4 overflow-hidden rounded-xl border border-rent-border bg-rent-bg/70">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs sm:text-sm">
                    <thead className="bg-rent-panel/80 text-slate-300">
                      <tr>
                        <th className="px-3 py-2 font-medium">Account</th>
                        <th className="px-3 py-2 font-medium">Program</th>
                        <th className="px-3 py-2 font-medium">Size</th>
                        <th className="px-3 py-2 font-medium">Reclaimable SOL</th>
                        <th className="px-3 py-2 font-medium">Wrapped?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownAccounts.map((account) => (
                        <tr key={account.accountAddress} className="border-t border-rent-border/70">
                          <td className="px-3 py-2 text-slate-200">{shortenAddress(account.accountAddress)}</td>
                          <td className="px-3 py-2 text-slate-200">{account.program}</td>
                          <td className="px-3 py-2 text-slate-200">{account.dataSizeText}</td>
                          <td className="px-3 py-2 font-medium text-white">{account.claimableNow}</td>
                          <td className="px-3 py-2 text-slate-300">{account.isNativeWrapped ? "wrapped SOL" : "token account"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasMoreAccounts && (
                  <div className="border-t border-rent-border/70 p-3">
                    <button
                      type="button"
                      onClick={() => setShowAllAccounts((value) => !value)}
                      className="rounded-lg border border-rent-border px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-rent-accent/80 hover:text-rent-accent"
                    >
                      {showAllAccounts ? `Show first 10 accounts` : `Show all ${eligibleAccounts.length} accounts`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : null}

        <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
          <h2 className="text-lg font-semibold text-white">Nothing gets deleted.</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li>✓ Tokens stay in your wallet</li>
            <li>✓ Token accounts stay open</li>
            <li>✓ Only excess SOL will be reclaimed</li>
            <li>✓ RentBack takes 0% reclaim fee</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Reclaim transactions are not available in this milestone. Wallet connection only prepares eligibility checks.
          </p>
        </section>

        <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
          <h2 className="text-lg font-semibold text-white">Built because Solana rent changed.</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            When Solana&apos;s first rent reduction went live, I wanted to see what it actually meant for a real wallet. So I built RentBack.
          </p>
          <p className="mt-2 text-sm text-slate-300">Free to scan. 0% reclaim fee. Open source.</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <a className="rounded-lg border border-rent-border px-3 py-2 text-slate-200" href="#" aria-label="X placeholder">
              X
            </a>
            <a className="rounded-lg border border-rent-border px-3 py-2 text-slate-200" href="#" aria-label="GitHub placeholder">
              GitHub
            </a>
            <a className="rounded-lg border border-rent-border px-3 py-2 text-slate-200" href="#" aria-label="Builder attribution placeholder">
              Builder
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}




