import { SITE_URL } from "../site";
// Registration discovers MWA; it never authorizes a wallet or requests a signature.
let registration: Promise<void> | undefined;

export function registerMobileWallet(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!/Android/i.test(navigator.userAgent) || !window.isSecureContext) return Promise.resolve();
  registration ??= import("@solana-mobile/wallet-standard-mobile").then((mwa) => {
    mwa.registerMwa({
      // MWA requires icon to be relative to the application's identity URI.
      appIdentity: { name: "RentBack", uri: SITE_URL, icon: "rentback-icon.svg" },
      chains: ["solana:mainnet"],
      chainSelector: mwa.createDefaultChainSelector(),
      // No authorization is restored across reloads. The adapter holds the
      // current authorization in memory after the user explicitly connects.
      authorizationCache: {
        async get() { return undefined; },
        async set() {},
        async clear() {},
      },
      onWalletNotFound: mwa.createDefaultWalletNotFoundHandler(),
    });
  }).catch((error) => { registration = undefined; throw error; });
  return registration;
}
