"use client";

import { ClientProvider } from "@solana/react";
import { ReactNode, useEffect, useState } from "react";
import { registerMobileWallet } from "@/lib/solana/mobile-wallet";
import { walletClient } from "@/lib/solana/wallet-client";

type WalletProviderProps = {
  children: ReactNode;
};

export function WalletProvider({ children }: WalletProviderProps) {
  const [mobileError, setMobileError] = useState<string | null>(null);
  useEffect(() => {
    void registerMobileWallet().catch(() => setMobileError("Mobile wallet discovery is unavailable. Please reload to try again."));
  }, []);
  return <ClientProvider client={walletClient}>
    {mobileError && <p role="alert" className="bg-amber-950 p-3 text-center text-sm text-amber-100">{mobileError}</p>}
    {children}
  </ClientProvider>;
}
