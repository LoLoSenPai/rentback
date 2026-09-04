"use client";

import { FormEvent, useMemo, useState } from "react";
import { RENT_PHASES } from "@/lib/rent-phases";
import { buildScanViewModel } from "@/lib/solana/scan-display";
import { RentBackApiResult } from "@/lib/solana/scan";

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

export default function HomePage() {
  const [walletAddress, setWalletAddress] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalletScanResponse | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!walletAddress.trim() || isScanning) {
      return;
    }

    setIsScanning(true);
    setError(null);
    setShowTechnicalDetails(false);
    setShowAllAccounts(false);
    setResult(null);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ walletAddress: walletAddress.trim() }),
      });

      const payload = (await response.json()) as ScanResponse;
      if (!response.ok) {
        throw new Error((payload as { error: string }).error ?? "Scan failed.");
      }

      setResult(payload as WalletScanResponse);
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
          <p className="mt-2 text-sm text-slate-400">
            No wallet connection required. No tokens moved. No accounts closed.
          </p>
        </header>

        <form
          className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-rent-border bg-rent-panel/60 px-4 py-4 shadow-panel md:flex-row md:items-center"
          onSubmit={handleSubmit}
        >
          <input
            className="rent-input flex-1 rounded-xl px-4 py-3 text-base outline-none placeholder:text-slate-400"
            value={walletAddress}
            onChange={(event) => setWalletAddress(event.target.value)}
            placeholder="Enter Solana wallet address"
            aria-label="Wallet address"
          />
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
            {educationalSection}
            <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
              <p className="text-sm text-slate-300">
                Paste a wallet and click <span className="font-semibold text-white">Check wallet</span> to calculate reclaimable SOL from all
                SPL Token and Token-2022 accounts.
              </p>
            </section>
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
            <li>✓ Only excess SOL is withdrawn</li>
            <li>✓ RentBack takes 0% reclaim fee</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            The reclaim transaction flow is intentionally not implemented in this version.
          </p>
        </section>

        <section className="mx-auto w-full max-w-3xl rounded-2xl border border-rent-border bg-rent-panel/90 p-5 shadow-panel">
          <h2 className="text-lg font-semibold text-white">Built because Solana rent changed.</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            When Solana&apos;s first rent reduction went live, I wanted to see what it actually meant for a real wallet. So I built RentBack.
          </p>
          <p className="mt-2 text-sm text-slate-300">Free to scan. 0% reclaim fee. Open source.</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <a className="rounded-lg border border-rent-border px-3 py-2 text-slate-200" href="https://x.com/LoicDlugosz" aria-label="X">
              X
            </a>
            <a className="rounded-lg border border-rent-border px-3 py-2 text-slate-200" href="https://github.com/LoLoSenPai/rentback" aria-label="GitHub">
              GitHub
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}
