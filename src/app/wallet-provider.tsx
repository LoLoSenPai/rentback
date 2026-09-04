"use client";

import { ClientProvider } from "@solana/react";
import { ReactNode } from "react";
import { walletClient } from "@/lib/solana/wallet-client";

type WalletProviderProps = {
  children: ReactNode;
};

export function WalletProvider({ children }: WalletProviderProps) {
  return <ClientProvider client={walletClient}>{children}</ClientProvider>;
}
