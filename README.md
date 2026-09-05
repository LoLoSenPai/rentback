# RentBack

RentBack scans any public Solana wallet and reclaims excess SOL from overfunded SPL Token and Token-2022 accounts. Scanning requires no connection or signature. Reclaiming requires the exact owning wallet and explicit approval of each transaction.

Production: https://rentback.lololabs.xyz
Source: https://github.com/LoLoSenPai/rentback

## Current implementation

- Solana Kit, Wallet Standard and client-only Android Mobile Wallet Adapter discovery. No legacy wallet-adapter migration, auto-connect or sign-message flow.
- Fresh mainnet account ownership, actual data sizes and rent revalidation before reclaim. Wrapped/native SOL is excluded.
- Official WithdrawExcessLamports instructions, explicit conservative Compute Budget instructions, size-measured batching, simulations, exact signed-message checks and sequential consent.
- No tokens transferred or burned, no accounts closed, no RentBack transfer or tip. RentBack takes 0% reclaim fee; standard network fees apply.
- Bigint monetary accounting with explicit decimal-string API DTOs.
- Confirmed receipt accounting and partial-success recovery. A zero-excess rescan presents the confirmed total and unique processed accounts, optional X sharing and collapsed history. Receipts are local to the browser tab/session, not a global account-history service.
- Future rent phase projections are estimates, not guarantees.

The user has completed a real mainnet reclaim of 10,689,097 lamports across 58 token accounts. This is an observed test result, not a promise of returns for other wallets. Physical Seeker/Seed Vault testing remains a manual release check.

## Run and validate

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm start
```

Default tests never broadcast mainnet transactions. The devnet fixture is explicitly opt-in. See docs/reclaim.md for security boundaries, including the sending-only wallet transport limitation.

## Configuration and deployment

Set `SOLANA_RPC_URL` in the server deployment environment. A private mainnet RPC is recommended for production capacity. Do not prefix credentials with `NEXT_PUBLIC`. No credentials belong in public files, client code or committed environment files. `.env.example` contains only a public endpoint and empty optional settings.

The public canonical/share/MWA identity lives in `src/lib/site.ts`. It points to the production HTTPS URL; it is not derived from an untrusted Host header. Optional builder name and X URL can remain unset. Mainnet explorer links intentionally have no devnet/testnet override.

Public scans are limited per process: 30/minute per client (shared by default), 120/minute globally, four concurrent scans, 1 KiB JSON bodies, bounded client-bucket memory, and HTTP 429 with Retry-After. Set `TRUST_PROXY_IP_HEADER` only behind a proxy that overwrites that header and prevents direct origin access. Without it, requests share one bucket. This lightweight limiter resets on process restart and is not shared across replicas. Configure deployment-edge rate limits and request timeouts for hostile traffic or scale; no database is required.

API errors preserve safe actionable application messages but suppress transport URLs, credentials, stack text and unknown SDK internals. Phantom investigation logging is disabled in every production build. Scanning and reclaim execution stay separate.

## Release

See docs/release.md for deployment hygiene and the physical Seeker checklist. Build artifacts, environment files, logs and generated read-only reports are ignored. Commit the pnpm lockfile with source changes. Ignore rules do not remove files already tracked by Git: inspect the staged release and repository history for secrets before publishing.

## License

MIT. See LICENSE. Third-party packages retain their respective licenses.
## Dynamic result cards

Successful reclaims include an optional dynamic 1200x630 share card and matching X action. See docs/share-cards.md for payloads, complete/partial variants, local preview URLs and the public parameterized-card integrity boundary. Cards are shareable presentation, not independent proof of a transaction.

