// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
const mwa = vi.hoisted(() => ({ registerMwa: vi.fn(), createDefaultChainSelector: vi.fn(() => ({})), createDefaultWalletNotFoundHandler: vi.fn(() => vi.fn()) }));
vi.mock("@solana-mobile/wallet-standard-mobile", () => mwa);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); vi.clearAllMocks(); });
describe("MWA browser registration", () => {
  it("does not register on desktop", async () => {
    const { registerMobileWallet } = await import("./mobile-wallet");
    await registerMobileWallet(); expect(mwa.registerMwa).not.toHaveBeenCalled();
  });
  it("registers once on Android with RentBack identity and no restored authorization", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile Safari");
    vi.stubGlobal("isSecureContext", true);
    const { registerMobileWallet } = await import("./mobile-wallet");
    await Promise.all([registerMobileWallet(), registerMobileWallet()]);
    expect(mwa.registerMwa).toHaveBeenCalledTimes(1);
    const config = mwa.registerMwa.mock.calls[0][0];
    expect(config.appIdentity).toEqual({ name: "RentBack", uri: "https://rentback.lololabs.xyz", icon: "https://rentback.lololabs.xyz/rentback-icon.svg" });
    expect(config.chains).toEqual(["solana:mainnet"]);
    expect(await config.authorizationCache.get()).toBeUndefined();
  });
});
