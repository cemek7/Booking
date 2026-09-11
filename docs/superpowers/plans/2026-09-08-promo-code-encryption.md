# Parked: promo code lookup and storage rework

**Status:** Agreed, not started. Parked on 8 September 2026 behind lead and
outreach work. Resume when that clears.

**Repo:** Booking. Touches `wallet_promo_codes`, `walletPromo.ts`,
`walletPromoAdmin.ts`, and the superadmin promo page.

## Why

`hashPromoCode` is an unsalted SHA-256, and it has to be — redemption looks a
code up by hashing it and matching the column, so there is nowhere to put a
per-row salt. Two consequences:

- A hand-typed code (`SUMMER26`, `LAUNCH2026`) is reversible from any rainbow
  table the moment `wallet_promo_codes` leaks. The scheme is weakest exactly
  where a human is most likely to use it, because the custom-code field invites
  memorable codes.
- A generated code is 10 characters from a 31-symbol alphabet, about 8x10^14
  possibilities (~2^49). SHA-256 is fast by design; commodity GPU hardware runs
  ~10^10 hashes/second, so the whole space falls in roughly a day.

So the hashing buys less than it looks like it does, while costing the resend
and support lookup that operators actually need. A promo code is not a
password: it is a bearer token with a bounded blast radius — fixed grant,
per-tenant cap, total cap, expiry, active flag — redeemable only by an
authenticated tenant, and routinely printed on slides.

## Target design

Two columns, two different jobs.

- **`code_lookup`** — HMAC-SHA256(normalized code, server-side pepper).
  Redemption stays one indexed equality check, but a leaked table without the
  pepper is useless. This is a security improvement over what ships today.
- **`code_ciphertext`** — AES-256-GCM of the code, key held in env or KMS.
  Decrypted on demand for display, resend and support questions.

The pepper and the key live outside the database, so a database-only dump — the
realistic breach — yields nothing. Reading a code requires both.

## Rules to build in from the start

1. **Fail closed.** If the pepper is absent at runtime, redemption must error,
   never fall back to plain SHA-256. A silent fallback would reintroduce the
   exact weakness being removed and would survive unnoticed for years.
2. **No backfill is possible.** Existing codes have only their SHA-256. Keep
   the old column for redemption of outstanding codes, mark them unreadable in
   the UI, and say so plainly rather than showing a blank.
3. **Pepper rotation invalidates every outstanding code**, so it is effectively
   fixed for a campaign's life. Ciphertext rotation is cheap; the pepper is not.
   Write down where both live before shipping.
4. Keep `deliverPromoCode` as-is. Resend becomes possible, but the
   send-at-creation path and its honest per-recipient reporting stay the
   default.

## Rough shape of the work

- Migration: add `code_lookup`, `code_ciphertext`; retain `code_hash`.
- Key/pepper loading with an explicit startup check.
- `walletPromo.ts`: redeem against `code_lookup`, falling back to `code_hash`
  only for rows created before this change.
- `walletPromoAdmin.ts`: store ciphertext on create; add a reveal/resend path.
- UI: show the code for readable rows, a "created before codes were
  recoverable" note for the rest, and a resend action.
- Tests: fail-closed behaviour, legacy-row redemption, no plaintext in any
  list query.

Estimated at about half a day. Write the key-management story down and get it
approved before any code moves.
