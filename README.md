# RentBack

RentBack is a public utility for scanning token accounts on Solana and showing **read-only excess rent** currently reclaimable from each account.

This first iteration intentionally stops at:

1. address validation
2. on-chain read-only scanning for SPL Token and Token-2022 token accounts
3. rent projection math and projections UI
4. no wallet connection and no `WithdrawExcessLamports` execution

## What it does (today)

- Validates a provided Solana wallet address.
- Scans both SPL Token and Token-2022 accounts for that owner.
- Reads each account’s actual account size and lamport balance.
- Queries `getMinimumBalanceForRentExemption` by unique size from RPC.
- Computes claimable claimable lamports using bigint arithmetic.
- Displays current claimable totals and phase projections:
  - phase 2 expected unlock
  - final phase (phase 5, planned 90% reduction) unlock
- Excludes wrapped/native SOL token accounts from claiming logic.
- Renders a dark single-screen UI with account details in a collapsible section.

## Tech stack

- Next.js App Router (TypeScript)
- Tailwind CSS
- `@solana/kit`
- `@solana/react`
- `@solana/kit-plugin-rpc`
- `@solana/kit-plugin-wallet`
- `@solana-program/token`
- `@solana-program/token-2022`

## Configuration

Set `SOLANA_RPC_URL` in your environment for a custom RPC endpoint.
Keep production credentials in server-side environment only.

```bash
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

Do not commit secrets.

## Validation

- Unit tests cover bigint rent/excess calculations and wrapped-native exclusion.
- The project includes:
  - `pnpm test`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`

## Project structure

- `src/app/page.tsx`: scanner UI
- `src/app/api/scan/route.ts`: server-side scanner endpoint
- `src/lib/solana/scan.ts`: read-only scan orchestration
- `src/lib/rent-calculations.ts`: bigint rent/projection helpers
- `src/lib/rent-phases.ts`: SIMD-0437 phase configuration

## License

MIT
