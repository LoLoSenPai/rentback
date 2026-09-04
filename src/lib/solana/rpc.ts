const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

export function getConfiguredRpcUrl(): string {
  const configured = process.env.SOLANA_RPC_URL?.trim();
  if (!configured || configured.length === 0) {
    return DEFAULT_RPC_URL;
  }
  return configured;
}
