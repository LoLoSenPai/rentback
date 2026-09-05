# RentBack wallet and reclaim implementation

## Wallets and public scanning

RentBack uses Solana Kit, kit-plugin-wallet, Wallet Standard and client-only Solana Mobile Wallet Standard registration. Discovery never selects or connects a wallet automatically. Scanning remains public and independent of the connected account. Account-change events update the connected state without replacing the scan.

MWA identity uses https://rentback.lololabs.xyz and the relative icon URI `rentback-icon.svg`. The Android entry is "Use installed wallet"; Android/wallet applications control app/account selection. The user has successfully reclaimed on a physical Seeker with Seed Vault Wallet and with Phantom on localhost. This does not certify every wallet, device or production augmentation flow.

## Reclaim invariants

- Mainnet genesis hash is checked. Both SPL Token and Token-2022 are queried using raw base64 account data.
- Accounts and rent minima are fetched again for every preparation and submission, using actual account sizes. Wrapped/native SOL and zero-excess accounts are excluded.
- All lamport accounting uses bigint; API and persisted receipt monetary values use decimal strings.
- Source token accounts must belong to the exact connected/scanned owner. Destination, fee payer and signer are that owner.
- RentBack builds one SetComputeUnitLimit, one SetComputeUnitPrice and official WithdrawExcessLamports instructions (discriminator 38) for each account's actual token program.
- RentBack never adds transfers, tips, closes, burns, approvals, swaps or authority changes. RentBack fee is 0%.
- Each batch needs an explicit click. Preparation simulates with a 200,000-CU probe, chooses measured consumption plus 10% rounded up (floor 10,000), then simulates the final message and requests an RPC fee estimate. Reviews expire after 30 seconds.

## Versioned wallet safety policy

New reviews and their persisted batches carry `walletPolicy: "lighthouse-assertions-v1"`. The shared validator is used on the client before submission, on the server before signed simulation/broadcast, and for confirmed receipt reconciliation. It never edits a signed message or removes wallet protections.

Permitted wallet differences are limited to:

- Static account-table reordering with all existing addresses and effective signer/writable privileges unchanged and all references resolved before comparison.
- Added assertions to Lighthouse `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`, the only permitted additional readonly, nonsigning program account.
- Lighthouse discriminators 5/6 (AssertAccountInfo/AssertAccountInfoMulti) and 9/10 (AssertTokenAccount/AssertTokenAccountMulti). Each has exactly one target, already a withdrawal source or, for AccountInfo only, the owner/destination.
- An increased CU limit, at least the prepared simulated limit and at most 200,000. Price remains exactly 100,000 micro-lamports/CU. The two budget instructions must stay first, with exact formats and no account metas. Additional budget instructions are rejected.

All original withdrawal instructions must remain byte-identical in their data and semantically identical in program, ordered account metas and relative instruction order. Payer and blockhash cannot change. Missing/duplicated/replaced withdrawals, unrelated accounts, changed privileges, lookup tables, noncanonical messages and other programs are rejected.

### Lighthouse parser scope and source basis

The explicit bounded Borsh parser is based on official source revision `4c579479c98635e419b1b167f08be02a71604a71` of https://github.com/Jac0xb/lighthouse. Reviewed files include `instruction.rs`, the account-info/token-account assertion types, target/token processors, operators, assertion-result logging and LEB128 vector encoding.

This is source review, not a new independent audit or verification that deployed executable bytes match the source revision. Future upstream/program changes require review; do not expand acceptance based solely on a program name.

The permitted processors evaluate readonly assertions. The parser permits AccountInfo fields 0..7 (not VerifyDatahash) and TokenAccount fields 0..8, validates enum/operator/option values, requires complete consumption, limits each payload to 128 bytes and multis to 1..16 assertions, and rejects trailing data. Multi lengths use canonical single-byte unsigned LEB128 within that bound.

Logging accepts Borsh ordinals 0/1/2/4/5. EncodedNoop modes 3/6 are rejected because they invoke another program. MemoryWrite, MemoryClose, account-data/delta, mint, stake, clock and all other top-level variants are rejected. There is no blanket Lighthouse program allowlist.

Guards may be interleaved without changing the relative withdrawal order, at most twice the number of sources plus destination. They may only add predicates; they cannot change the approved withdrawal operations. An unsupported guard fails closed rather than being silently removed.

### Fees and size

The review displays estimated fees AND a maximum of 25,000 lamports (0.000025 SOL) per transaction, plus the aggregate maximum for the review. Priority fee is `ceil(CU limit * 100000 / 1000000)` using bigint. The validator enforces budget bounds; the server also checks the actual signed-message RPC fee estimate before broadcast and the actual confirmed metadata fee during reconciliation.

The planner measures complete serialized transactions including the signature and both budget instructions, and reserves 384 additional bytes for wallet augmentation. This is an explicit maximum accepted message growth, not a fixed number of accounts per batch. Final wallet-returned messages must fit both that allowance and Solana's 1,232-byte limit. Assertion count/data limits also apply. Larger additions are rejected.

The offline 58-account mixed-program fixture packs as 15/15/15/13 accounts: prepared sizes 837/837/837/759 bytes; modeled assertions produce 1125/1125/1125/1015 bytes. Source/program distribution can change sizes. These are deterministic fixture measurements, not captured Phantom transactions.

### Submission and compatibility

The server re-fetches eligibility and rent, validates the returned message, simulates that exact signed transaction with signature verification, checks its RPC fee, then submits with preflight enabled. Failed simulation or fee validation stops submission. No mainnet transactions are broadcast by automated tests.

New-policy reviews require a signer that returns the signed transaction. Sending-only wallets are rejected before authorization because their automatic broadcast would bypass pre-broadcast validation. Historical sending-only receipts retain their old reconciliation path; this is not a fallback for new reviews.

Historical receipts without the policy marker retain byte-exact message checks and their original budget/account layout. The budget-less reconstruction path is confirmation-only. Existing receipt history is never cleared by this change.

Partial completion preserves signatures, uses confirmed balance deltas for actual reclaimed totals, rescans remaining accounts and requires an explicit click for each retry. Successful sources are excluded. Pre-broadcast rejection is shown as "Blocked before submission", not an on-chain failure.

## Evidence and manual release check

The user observed Phantom production changing 14 instructions to 27 and CU limit 10,000 to 82,428 while price stayed 100,000. Phantom localhost succeeded. Lighthouse augmentation is documented and consistent with that observation, but the actual rejected additional instruction bytes/program IDs were not captured. The test fixture models the supported assertion pattern; it is not a recording of that failed attempt.

After deployment, a user-controlled Phantom production test is still required to establish compatibility with its exact emitted assertions. Inspect the maximum fee in review, approve only an intended reclaim, and check the confirmed receipt and fresh remaining balance. Retest Seeker separately when a reclaimable account is available. Never claim physical/mobile testing from desktop viewport tests.

## References

- https://docs.phantom.com/developer-powertools/lighthouse
- https://docs.phantom.com/developer-powertools/solana-priority-fees
- https://github.com/Jac0xb/lighthouse/tree/4c579479c98635e419b1b167f08be02a71604a71
- https://solana.com/docs/core/fees
- https://solana.com/docs/tokens/advanced/withdraw-excess-lamports
- https://docs.solanamobile.com/get-started/web/apps
- https://www.solanakit.com/docs/guides/setting-up-signers
