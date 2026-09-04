import * as solanaKit from "@solana/kit";
import { walletSigner } from "@solana/kit-plugin-wallet";

type SolanaKitClient = ReturnType<typeof solanaKit["createClient"]>;
type SolanaKitFactory = {
  createClient: () => SolanaKitClient;
};

const createClient = (solanaKit as unknown as SolanaKitFactory).createClient;

export const walletClient = createClient()
  .use(
    walletSigner({
      chain: "solana:mainnet",
      autoConnect: false,
      storage: null,
    }),
  );
