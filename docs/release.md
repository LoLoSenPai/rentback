# Release checklist

## Deployment

- Canonical URL: https://rentback.lololabs.xyz. Verify DNS, TLS, root page, favicon and /opengraph-image after deployment. Preview deployments should be access-controlled or marked noindex at the host.
- Set SOLANA_RPC_URL server-side only; confirm both token programs can be queried. No NEXT_PUBLIC credential configuration is used.
- Configure TRUST_PROXY_IP_HEADER only with a trusted proxy that overwrites it and blocks direct origin access. Otherwise the safe shared rate bucket applies. The in-memory limiter is per instance, not distributed; configure edge limits/timeouts for production scale.
- Check explorer links use mainnet, and manually open the optional X composer to inspect copy and URL without posting unless desired. Share text contains no wallet address.
- Production builds disable investigation logging. No mainnet signature or transaction is requested by validation or completion rendering.
- Commit source, new tests, public metadata/OG support, LICENSE, README, documentation, package.json, .gitignore and pnpm-lock.yaml together. No commit or push was performed by this pass.
- Review staged files and prior repository history for secrets and previously tracked generated artifacts. Ignore rules cannot retroactively untrack files. Do not include .env files, .next, node_modules, build caches, logs or generated read-only reports.
- Confirm source repository visibility and attribution. MIT is declared in README/package.json and supplied in LICENSE; builder attribution links to codersenpai, the configured X profile and portfolio.

## Physical Seeker / Seed Vault manual check

Physical-device verification has NOT been performed here. Desktop responsive checks and unit tests are not a substitute.

1. Open https://rentback.lololabs.xyz in a compatible Android browser on Seeker.
2. Paste a public address and scan while disconnected. Verify no authorization or signature is requested.
3. Open Connect wallet and explicitly select Use installed wallet (Mobile Wallet Adapter).
4. Verify the installed-wallet flow offers Seed Vault Wallet. Choose it yourself; confirm the RentBack production identity.
5. Confirm the authorized account matches the scanned owner. Switching account or disconnecting must not erase the public scan.
6. Review a reclaim only if you intentionally have an eligible test account. Inspect destination, amount, network fees and transaction count.
7. Cancel before signing if no reclaimable test account is available. The completed 58-account wallet has no current excess; do not expect another reclaim action for it.
8. Verify rejection/cancel returns cleanly, controls fit the screen, and account public keys do not overflow.

## Existing security boundary

The transaction planner, instruction allowlist, fee policy, simulations and exact signed-message checks were not relaxed for this release. Sending-only wallet APIs remain a documented limitation: the wallet itself broadcasts before RentBack can inspect returned message bytes; confirmed messages are checked before reporting reclaimed amounts. Physical MWA approval behavior still requires the manual device check.

## References

- https://docs.solanamobile.com/get-started/web/installation
- https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image

## Local release verification result

- pnpm test: 85 passed, three opt-in integration cases skipped by default. The read-only mainnet case was subsequently enabled and passed separately. The two devnet broadcast cases stayed disabled.
- pnpm lint, pnpm typecheck and pnpm build passed. Next.js reports the existing next lint deprecation; no lint warnings/errors from application code.
- Read-only mainnet scan at 2026-09-04T23:30:23.412Z: 58 token accounts still exist, zero eligible accounts, zero claimable lamports; both token-program reads succeeded. Additional Phase 2 / final projections remain 21,361,144 / 96,099,576 lamports. Fresh reclaim preparation returned zero transactions, with a guard forbidding any sendTransaction call.
- Browser production-build check restored the actual confirmed 10,689,097-lamport history and 58 processed accounts. Three mainnet explorer links are under collapsed transaction details; prior blocked attempts are under collapsed technical history. No visible error alert and no reclaim CTA remain. The public scan input is preserved.
- X share URL was inspected without opening/posting: 0.0107 SOL rounded from the exact result, canonical production URL, no wallet address.
- A 390px desktop viewport had no horizontal overflow and a 44px share target. This is NOT physical Seeker verification. No application console errors were observed; existing third-party wallet-extension warnings are outside RentBack.
- Static production client chunks contain no SOLANA_RPC_URL marker, configured private RPC URL or Phantom investigation logger. No NEXT_PUBLIC environment variables were present in the validation environment.
- No wallet signature was requested, no mainnet transaction broadcast, no commit/push performed. Physical Seeker, deployment-edge configuration and staged-file/history checks remain manual release gates.


## Dynamic share-card follow-up

Production must also expose /share/reclaim and /api/share/reclaim-image. Confirm the result page publishes matching absolute OG/Twitter image URLs and the bundled public/fonts assets are deployed. X card previews require a publicly crawlable production URL and are controlled/cached by X; a localhost preview is not an X crawler test. See share-cards.md. Parameterized results are disclosed as user-shared, not independently verified on-chain proof.
