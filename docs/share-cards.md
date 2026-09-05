# Dynamic reclaim share cards

## Architecture

- `src/lib/share/reclaim-share.ts`: bounded payload validation, exact SOL formatting, confirmed-result mapping, card view model, versioned URL encoding and X text/intent generation.
- `src/lib/share/reclaim-card.tsx`: reusable 1200x630 landscape composition, rendered to PNG with Next.js `ImageResponse`. The same composition serves X large-image cards and Open Graph previews.
- `GET /api/share/reclaim-image?...`: public PNG, Node runtime, locally bundled OFL-licensed Barlow fonts, no remote fetch or database. Valid images cache for one day. Rendering has its own bounded per-process limiter, separate from wallet scans.
- `GET /share/reclaim?...`: public preview page with per-result Open Graph/Twitter metadata pointing at the corresponding image. This is the URL placed into the X intent. A raw PNG or the homepage URL alone would not provide the matching result-page metadata.
- The existing successful-reclaim panel maps confirmed receipts through its completion DTO, then exposes Share on X and Preview share card. It never uses the original reclaim estimate. No request to a wallet, new transaction or automatic post is introduced.

## Payload

`ReclaimSharePayload` contains `amountReclaimedSol` (exact base-10 string), `accountsProcessed`, `rentBackFeePercent` (0), `network` (mainnet), `hasRemainingExcess`; optional `txCount`, `walletShort`, `confirmedSignatures`, `timestamp` (canonical ISO UTC), `remainingClaimableSol`.

The default completion mapping publishes only amount, account count, transaction count, zero fee and mainnet/completion status. It omits wallet identity, signatures and timestamp. Optional short identity must have the form `D2FD...Zbdrw`; full addresses are rejected. Optional transaction references may indirectly identify a wallet on a block explorer, so they are never included automatically.

SOL retains up to nine decimals, strips unnecessary trailing zeros and uses grouping for large numbers. Short X copy rounds to four decimals using bigint, retaining tiny nonzero values instead of displaying zero. Amounts never pass through Number. Counts use bounded safe integers.

`sharePayloadFromSuccess(result, remainingLamports?)` accepts confirmed-result aggregates and optional actual remaining lamports. The default app success state uses the complete variant. The partial renderer is available for future partial-result sharing without changes to reclaim execution.

## URL contract (v1)

Required: `amount`, `accounts`.

Optional: `v=1`, `fee=0`, `network=mainnet`, `txs`, `partial=0|1`, `remaining`, `walletShort`, `timestamp`, `signatures` (comma-separated, max 10). Unknown or duplicate parameters are rejected. Query length is limited to 1800 encoded characters, SOL has at most 12 whole digits and 9 fractional digits, account count is capped at 1,000,000, transaction count at 10,000. Invalid images return a non-cacheable 400; invalid preview pages return 404. No arbitrary remote URLs, HTML, fonts or image sources are accepted.

Complete:

```
http://localhost:3000/share/reclaim?amount=0.010689097&accounts=58&txs=3
http://localhost:3000/api/share/reclaim-image?amount=0.010689097&accounts=58&txs=3
```

Partial:

```
http://localhost:3000/share/reclaim?amount=0.009586831&accounts=52&txs=2&partial=1&remaining=0.001102266
```

Minimal:

```
http://localhost:3000/share/reclaim?amount=0.1&accounts=1
```

These are sample preview URLs, not hardcoded results. Production URLs use `SITE_URL` from `src/lib/site.ts`, never the request Host header.

## Integrity, privacy and sharing limitations

This is a presentation system, not an attestation service. Parameters are public and editable. The app generates them from actual confirmed results, but anyone can construct a different public URL. The preview page explicitly discloses that the result is user-shared and not independently verified. No verified-proof badge is rendered. Signing arbitrary browser inputs would not prove on-chain truth; no signing secret or database is added just to create that false assurance. A future verified-card service would need to revalidate transaction references server-side before issuing a signed payload.

Share payloads are never accepted by reclaim construction or authorization. No full wallet address is needed or accepted for rendering. Public URLs must contain no secrets. Do not use this card as financial proof or authentication.

X intent composes a post with the public result-page link. It does not upload an image attachment or guarantee that X displays a card. Production must be deployed and publicly crawlable; X controls caching and preview display. For local checking, inspect the preview page and PNG. For actual X preview checking, use the deployed production result URL. Opening the image also permits a user to save it manually if they want to attach it themselves.

## Supported composition variants

1. Complete: reclaim-complete status, exact amount, accounts, optional confirmed transaction count, zero fee.
2. Partial: partial-reclaim status and exact remaining amount, or a neutral remaining-excess line when the secondary amount is absent.
3. Minimal: missing wallet/date/transaction count removes those elements cleanly.
4. Large values: grouped amounts and reduced hero typography; optional short wallet/date remain secondary.

## Validation

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`. Tests cover pure formatting/text, absent fields, confirmed DTO mapping, all rejected query classes, PNG generation/dimensions for complete/partial/minimal/large variants, live success-panel URL mapping, and safe footer links.

## References and font license

- https://nextjs.org/docs/app/api-reference/functions/image-response
- https://github.com/vercel/satori
- https://github.com/google/fonts/tree/main/ofl/barlow
- https://github.com/google/fonts/tree/main/ofl/barlowcondensed

Font licenses are shipped in `public/fonts/OFL-Barlow.txt` and `public/fonts/OFL-BarlowCondensed.txt`.

## Completed validation

- pnpm test: 119 passed; three opt-in chain-integration cases skipped. No chain integration or signing was needed for this presentation milestone.
- pnpm lint, pnpm typecheck, pnpm build: passed. Existing next lint deprecation remains.
- Actual PNG generation tests verify the PNG header and 1200x630 dimensions for complete, partial, minimal and largest-supported values.
- Local production browser inspection checked complete, partial and largest-supported cards visually, with no layout clipping observed. Both og:image and twitter:image referenced the matching dynamic production image URL; twitter:card was summary_large_image.
- The existing real-wallet confirmed history generated amount=0.010689097, accounts=58, txs=3 in the preview URL after a read-only public rescan. The 0.010689097 SOL success state remained intact. No wallet signature or transaction was requested.
- GitHub/X icon links and codersenpai portfolio attribution were checked in the actual page. Preview and application browser consoles had no application errors.
- No X intent was opened and no post/upload was performed. Live X crawler behavior still requires the routes to be deployed publicly.

## Files changed in this milestone

- src/lib/share/reclaim-share.ts
- src/lib/share/reclaim-share.test.ts
- src/lib/share/reclaim-card.tsx
- src/lib/share/share-fonts.ts
- src/app/api/share/reclaim-image/route.tsx
- src/app/api/share/reclaim-image/route.test.ts
- src/app/share/reclaim/page.tsx
- src/lib/reclaim-result.ts
- src/lib/reclaim-result.test.ts
- src/app/reclaim-panel.tsx
- src/app/reclaim-panel.test.tsx
- src/app/builder-links.tsx
- src/app/builder-links.test.tsx
- src/app/page.tsx
- src/lib/site.ts
- public/fonts/Barlow-Regular.ttf
- public/fonts/BarlowCondensed-SemiBold.ttf
- public/fonts/OFL-Barlow.txt
- public/fonts/OFL-BarlowCondensed.txt
- next.config.mjs
- README.md
- docs/release.md
- docs/share-cards.md
