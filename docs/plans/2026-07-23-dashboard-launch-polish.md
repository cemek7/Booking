# Dashboard launch polish — batch plan (2026-07-23)

Owner-dashboard cosmetic + functional cleanup for launch readiness. All work
batched; single deploy at the end. Decisions confirmed with the user.

## Confirmed decisions
1. **Sales nav** → add Products, Inventory, Orders to the "Manage" section (all pages exist; Orders = sales view).
2. **Social mentions/listening** → hide from nav + gate the page (redirect away). Keep code/APIs dormant, reversible.
3. **Settings AI** → remove all model/provider controls (STT/TTS provider, LLM/model toggles). Keep tone, greeting, sample phrases, language. Relabel "LLM" → plain language.
4. **Main dashboard** → fix data endpoints (analytics/wallet 500s + 401s) AND add friendly empty states.

## Work items

### A. Functional bugs
- [ ] A1. Chats crash: `useChatRealtime.ts:242` `supabase.channel(...).on` — browser client not realtime-capable. Fix client acquisition / guard.
- [ ] A2. `/api/analytics/staff` 500: `getStaffPerformance` queries non-existent `staff` table → rewrite against `tenant_users` + `reservations`, or fail soft with empty perf.
- [ ] A3. `/api/billing/wallet` 500: tables exist → null-handling for a tenant with no wallet row. Return a zeroed summary instead of throwing.
- [ ] A4. Dashboard/staff 401s: client GETs missing auth/x-tenant-id on first load. Ensure tenant header on those fetches.

### B. Navigation
- [ ] B1. Add Products (`/dashboard/products`), Inventory (`/dashboard/products/inventory`), Orders (`/dashboard/orders`) to owner+manager "Manage".
- [ ] B2. Remove "Mentions" nav item (owner + manager).
- [ ] B3. Gate `/dashboard/mentions` → redirect to dashboard home.

### C. Settings
- [ ] C1. Remove STT/TTS provider dropdowns + any model/LLM technical control from AgentConfigSection.
- [ ] C2. Relabel "LLM settings"/"LLM Tone & Guidance" → plain language ("Assistant voice & replies").

### D. Billing
- [ ] D1. Remove internal COGS: revenue-vs-cost, token usage, cost ledger, margin. Keep customer-relevant: wallet balance, top-up, plan/usage in plain terms.

### E. Copy
- [ ] E1. Rewrite owner dashboard copy to customer-facing tone (stop-slop). Headings, intro, section subtitles.

### F. UI/UX polish
- [ ] F1. Analytics dropdown overlay (z-index/portal).
- [ ] F2. Empty states for main dashboard widgets (new-tenant friendly).
- [ ] F3. Staff page tidy.
- [ ] F4. Analytics page tidy.

## Verify before deploy
- typecheck:ci PASS, `npm test` PASS, local `next build` (ipv4first) PASS.
- Deploy: `sudo bash /tmp/booka-deploy.sh` (single deploy after all items).
