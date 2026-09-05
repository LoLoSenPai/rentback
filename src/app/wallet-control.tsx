"use client";

import { useEffect, useRef, useState } from "react";
import { useConnectedWallet, useWallets, useWalletStatus } from "@solana/kit-plugin-wallet/react";
import { walletClient } from "@/lib/solana/wallet-client";

export function shortWallet(value: string) { return `${value.slice(0, 5)}...${value.slice(-5)}`; }
const buttonClass = "min-h-11 rounded-xl border border-rent-border px-4 py-2 text-sm font-medium text-slate-100 hover:border-rent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-rent-accent disabled:opacity-50";

export function WalletControl({ open, onOpenChange, onUseWallet }: {
  open: boolean; onOpenChange: (open: boolean) => void; onUseWallet: (address: string) => void;
}) {
  const connection = useConnectedWallet(walletClient);
  const discovered = useWallets(walletClient);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const connected = mounted ? connection : null;
  const wallets = mounted ? discovered : [];
  const status = useWalletStatus(walletClient);
  const [chooseApp, setChooseApp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const busy = status === "connecting" || status === "disconnecting";
  const accounts = wallets.find((wallet) => wallet.name === connected?.wallet.name)?.accounts
    .filter((account) => account.chains.includes("solana:mainnet")) ?? [];

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  function close() { onOpenChange(false); setChooseApp(false); }
  async function action(run: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try { await run(); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet connection failed. Please try again."); }
    finally { inFlight.current = false; }
  }

  return <>
    <button type="button" className={buttonClass} aria-haspopup="dialog" onClick={() => { setChooseApp(false); onOpenChange(true); }}>
      {connected ? shortWallet(connected.account.address) : "Connect wallet"}
    </button>
    <dialog ref={dialog} onCancel={close} onClick={(event) => { if (event.target === dialog.current && !busy) close(); }}
      aria-labelledby="wallet-dialog-title" className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-rent-border bg-rent-panel p-6 text-slate-100 shadow-2xl backdrop:bg-black/70 sm:inset-0 sm:m-auto sm:max-w-sm sm:rounded-3xl">
      <div className="flex items-center justify-between gap-3">
        <h2 id="wallet-dialog-title" className="text-xl font-semibold">{connected && !chooseApp ? "Your wallet" : "Choose a wallet app"}</h2>
        <button type="button" onClick={close} disabled={busy} aria-label="Close wallet chooser" className={buttonClass}>Close</button>
      </div>
      {error && <p role="alert" className="mt-3 break-words text-sm text-red-300">{error}</p>}
      {connected && !chooseApp ? <div className="mt-5 space-y-3">
        <p className="text-sm text-slate-400">{connected.wallet.name}</p>
        <p className="break-all font-mono text-sm">{connected.account.address}</p>
        {accounts.length > 1 ? <label className="block text-sm text-slate-300">Authorized account
          <select aria-label="Authorized account" value={connected.account.address} disabled={busy}
            className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-rent-border bg-rent-bg p-2"
            onChange={(event) => {
              const selected = accounts.find((account) => account.address === event.target.value);
              if (selected) {
                try { walletClient.wallet.selectAccount(selected); setError(null); }
                catch (cause) { setError(cause instanceof Error ? cause.message : "Account unavailable."); }
              }
            }}>
            {accounts.map((account) => <option key={account.address} value={account.address}>{account.label ? `${account.label} - ` : ""}{shortWallet(account.address)}</option>)}
          </select>
        </label> : <p className="text-xs text-slate-400">Your wallet app controls which account it shares.</p>}
        <button type="button" className={`${buttonClass} w-full`} onClick={() => { onUseWallet(connected.account.address); close(); }}>Use this wallet</button>
        <button type="button" className={`${buttonClass} w-full`} disabled={busy} onClick={() => setChooseApp(true)}>Change wallet app</button>
        <button type="button" className={`${buttonClass} w-full`} disabled={busy} onClick={() => void action(() => walletClient.wallet.disconnect())}>Disconnect</button>
      </div> : <div className="mt-5 space-y-2">
        <p className="mb-4 text-sm text-slate-400">Choose an app, then approve the account it shares. Scanning never needs a connection.</p>
        {wallets.length === 0 && <p className="text-sm text-slate-300">No compatible wallets detected. Open RentBack in your wallet browser or Android Chrome with an installed Solana wallet.</p>}
        {wallets.map((wallet, index) => <button key={`${wallet.name}-${index}`} type="button" disabled={busy}
          className={`${buttonClass} flex w-full items-center gap-3 text-left`}
          onClick={() => void action(() => walletClient.wallet.connect(wallet))}>
          {/* Wallet Standard supplies the wallet's own data-URI icon. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={wallet.icon} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-lg" />
          <span className="min-w-0 break-words">{wallet.name === "Mobile Wallet Adapter" ? "Use installed wallet" : wallet.name}</span>
        </button>)}
        {busy && <p role="status" className="pt-3 text-sm text-rent-accent">Continue in your wallet app...</p>}
      </div>}
    </dialog>
  </>;
}
