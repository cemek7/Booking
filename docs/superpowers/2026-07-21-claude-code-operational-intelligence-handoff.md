# Claude Code Handoff — Operational Intelligence Integration Pass

**Date:** 2026-07-21  
**Owner handoff target:** Claude Code  
**Branch:** `feat/operational-intelligence`  
**Worktree:** `/home/ccemeka/Techclave/Booking/boka-ops-intel`  
**HEAD:** `6e71d9e376bf04bbbfb2bcb9059ea5b192f9bd7e`  
**Status at handoff:** clean worktree

## Purpose

The 11-plan Operational Intelligence feature stack has been implemented on
`feat/operational-intelligence`. The next phase is **not more greenfield feature work**. The
next phase is:

1. a full integration pass across the whole branch,
2. a deliberate residual-gap hunt with self-review,
3. validation against the rest of the repo,
4. then a merge strategy back into `staging`.

Do **not** port this stack into `release/vps-launch`. That branch is for VPS launch hardening only.

## Branch topology

- Feature base branch: `staging`
- Feature branch: `feat/operational-intelligence`
- VPS launch branch: `release/vps-launch`
- Rule:
  - merge feature stack into `staging` only after integration is clean
  - cherry-pick only specific launch-safe fixes into `release/vps-launch` if required later

## Mandatory read order

Read these before touching anything:

1. `docs/superpowers/specs/2026-07-17-booka-operational-intelligence-consolidation.md`
2. `docs/superpowers/plans/2026-07-17-booka-business-ledger-daily-close.md`
3. the remaining plans in order `1 → 11`
4. this handoff doc

The consolidation doc carries the cross-spec items `A–Q`, dependency order, migration floor,
and shared conventions. Treat it as the integration spine.

## Implemented plan stack

Migration range implemented on this branch:

- `122` daily close / business ledger
- `123`
- `124`
- `125` commerce commands
- `126`
- `127` function
- `128` revenue assurance
- `129` granular permissions
- `130` inventory variance / stock counts
- `131` discount / refund approvals
- `132` service inventory recipes
- `133` customer commerce memory
- `134` multimodal capture
- `135` analytics / briefings
- `136` recommendations

### Plan 1 — Business ledger & daily close

Key outcome:
- daily close engine
- reservation completion snapshot hook
- owner close-report delivery/archive
- payment subject linkage

Representative commits:
- `902cd59` `feat(ops-intel): add ledger foundation and completion snapshot hook`
- `8e22bee` `feat(ops-intel): add deterministic close engine and payment subject linkage`
- `d443fb5` `feat(ops-intel): add owner close-report delivery and archive`

### Plan 2 — Owner commerce commands

Key outcome:
- idempotent owner command execution
- inventory movement wrapper
- AI action log
- atomic retail sale / refund handlers
- order, customer, staff command coverage

Representative commits:
- `1c387f1` `feat(commerce): add ai action log and inventory movement wrapper`
- `3d807a4` `feat(commerce): add atomic retail sale and refund handlers`
- `bdafa87` `feat(commerce): add order customer and staff handlers`
- `9890aa0` `feat(commerce): add owner command idempotency and gating`

### Plan 3 — Revenue assurance

Key outcome:
- anomaly table, rules, recurrence handling
- batch + realtime anomaly detection
- owner anomaly APIs and dashboard
- digest + high/critical notifications

Representative commits:
- `fdb4560` `feat(assurance): add business anomalies foundation`
- `66b6deb` `feat(assurance): add anomaly rule registry and core rules`
- `0513087` `feat(assurance): add anomaly workflow and notifications`

### Plan 4 — Granular permissions

Key outcome:
- effective-permission resolution
- tenant override storage
- command and route gating moved from stub capability checks to real permissions

Representative commits:
- `0fb323d` `feat(perms): effective-permission resolution + guards`
- `2c7f6b9` `feat(perms): resolve effective permissions at auth + expose tenant_user_id`
- `18c4593` `feat(perms): enforce granular permissions across command and owner routes`

### Plan 5 — Inventory variance & shrinkage

Key outcome:
- stock count lifecycle
- variance computation
- count adjustments
- shrinkage anomaly rule
- stock-count APIs and dashboard

Representative commits:
- `5fbebc5` `feat(inventory): add stock count locations and lifecycle foundation`
- `71ea41b` `feat(inventory): add stock count approval and count adjustments`
- `8ecf749` `feat(inventory): add shrinkage rule stock-count APIs and dashboard`

### Plan 6 — Discount, refund & adjustment controls

Key outcome:
- approval policies
- approval requests/actions
- command gating for discounts/refunds
- approvals queue/dashboard/notifications

Representative commits:
- `0b83014` `feat(approvals): add approval policy engine and command gating`
- `3454afb` `feat(approvals): add approvals queue notifications and dashboard`
- `a1fb5b8` `fix(approvals): require discount permission for discounted orders`

### Plan 7 — Service inventory recipes

Key outcome:
- UoM conversion
- recipe editor APIs
- service consumption on reservation completion
- unusual consumption anomaly and reporting

Representative commits:
- `90e60fb` `feat(recipes): add UoM conversion and recipe editor API`
- `0bfbb17` `feat(recipes): consume materials on reservation completion`
- `1d2ca40` `feat(recipes): add consumption anomaly and report`

### Plan 8 — Customer commerce memory

Key outcome:
- canonical customer identity by normalized phone
- profile recompute + profile subscriber
- duplicate detection
- atomic merge workflow
- owner customer profile + merge APIs
- main booking/retail/public-booking paths consolidated onto shared identity/profile layer

Representative commit:
- `273d58a` `feat(customers): unify customer memory and merge workflow`

### Plan 9 — Multimodal capture

Key outcome:
- ingest + hashing
- duplicate detection
- extraction routers + confidence persistence
- processing runner
- review queue foundation
- confirmation path through plan-2 execute pipeline
- owner capture APIs

Representative commits:
- `005e9d1` `feat(capture): add multimodal ingest and duplicate foundation`
- `602d54c` `feat(capture): add extraction routers and confidence persistence`
- `5d9783b` `feat(capture): add confirmation actions and owner capture APIs`
- `3911207` `feat(capture): add processing runner and review queue`

### Plan 10 — Conversational analytics & briefings

Key outcome:
- deterministic metric registry
- owner ask API
- NL-to-metric mapping
- morning + weekly briefings
- scheduling/job surface

Representative commits:
- `6326af6` `feat(analytics): metric registry framework + log/schedule tables`
- `84dedbb` `feat(analytics): core metric implementations`
- `1977967` `feat(analytics): NL-to-metric mapping + ask API`
- `5b18630` `feat(analytics): morning/weekly briefings + scheduler`

### Plan 11 — Recommendations

Key outcome:
- recommendation + outcome tables
- deterministic generator framework
- grounded explanation layer
- lifecycle APIs
- outcome observation
- deterministic threshold tuning
- recommendation scheduler
- weekly briefing integration

Representative commits:
- `853ffb7` `feat(reco): recommendation + outcome tables`
- `bdfe727` `feat(reco): generator framework + inventory/customer generators`
- `3d5b8d3` `feat(reco): grounded explanations + service/sales generators`
- `6e71d9e` `feat(reco): lifecycle + outcome tracking + APIs + scheduling`

## What was already validated

During implementation, focused tests and focused lint were run per plan slice. The branch was
built in TDD slices and self-reviewed repeatedly. That said, the branch still needs a **true
integration pass**.

Assume these are already true:

- many plan-local Jest suites passed during implementation
- focused `eslint` on touched files passed during implementation
- the branch is currently clean

Do **not** assume these are true yet:

- full branch-wide test suite is green
- full branch-wide lint is green
- full typecheck is green
- cross-plan event/action vocab is perfect everywhere
- all owner/staff/dashboard surfaces behave correctly together
- all new migrations are safe against the latest live DB state

## Claude’s mission

Claude should take over from here and do this in order:

1. **Integration pass**
2. **Residual gap hunt**
3. **Self-review against code + plans + consolidation items**
4. **Staging merge strategy**

Not:
- a blind merge
- speculative new features outside the 11-plan scope
- any direct work on `release/vps-launch`

## Integration checklist

### 1. Ground the branch again before editing

- confirm branch is still `feat/operational-intelligence`
- confirm worktree is clean or inspect any drift
- confirm migration floor in `db/migrations`
- confirm the consolidation doc’s items `A–Q` still match the code

### 2. Run branch-wide validation

Run all of these from `/home/ccemeka/Techclave/Booking/boka-ops-intel`:

```bash
npm test
npx eslint .
npx tsc --noEmit
```

If any of those are too large/noisy, produce a triage report:
- feature-branch failures introduced by this stack
- pre-existing failures inherited from `staging`
- runtime-critical vs non-blocking

### 3. Run feature smoke checks

At minimum verify these flows against the feature branch:

- reservation completion:
  - writes `price_cents_snapshot`
  - triggers recipe consumption
  - emits business event(s)
- retail sale + refund:
  - inventory movements route through canonical path
  - AI action log/idempotency works
- anomaly pipeline:
  - batch reconciliation produces anomalies
  - realtime subscriber produces deduped anomalies
  - owner anomaly resolution works
- permissions:
  - owner routes use real permission IDs
  - denied actions emit the correct audit/access-denied events
- approvals:
  - over-threshold discounts/refunds become approval requests
  - approval resolution replays original action exactly once
- customer memory:
  - customer identity resolves consistently across booking/retail/public-booking
  - merge path repoints safely
- multimodal capture:
  - ingest → extraction job → review queue → confirm → plan-2 execution
- analytics:
  - `POST /api/owner/ask`
  - briefings job route
  - metrics honor permissions
- recommendations:
  - generation job creates grounded recommendations
  - accept/dismiss/snooze/outcome flows work
  - weekly briefing includes recommendation output

### 4. Do a real residual-gap hunt

Claude should explicitly look for these classes of gaps.

#### Cross-plan consistency gaps

- `BUSINESS_EVENT_ACTIONS` vocabulary drift
- action names emitted in one plan but not recognized in another
- duplicated permission constants or mismapped permission IDs
- direct DB writes that should have gone through the plan-2 execution spine
- reservation completion side effects split across separate call paths
- inventory movement types drifting from the canonical shared vocabulary

#### Migration / schema gaps

- missing rollback symmetry
- missing RLS on any new table
- additive migration assumptions that conflict with current live migration floor
- enum/check extension mismatches on shared tables

#### Runtime gaps

- owner APIs not using service-role/admin clients where required
- stale dashboard paths that still use old data shapes
- notification paths that double-send instead of folding into shared digests
- recommendation acceptance paths that should be manual but accidentally auto-execute
- multimodal capture paths that assume provider support without guardrails

#### Observability / audit gaps

- actions that mutate state but do not emit a business event
- missing anomaly / approval / recommendation audit trails
- ledger-affecting flows that skip event or reconciliation hooks

### 5. Self-review loop

Claude should do a final self-review against:

- this handoff doc
- the consolidation doc `A–Q`
- each spec’s “done” surface
- each plan’s migration + API + UI + tests promise

Only if no material gaps remain should Claude move to merge prep.

## Possible hot spots worth inspecting first

These are not confirmed bugs. They are the most likely places to hide integration debt.

- `src/lib/audit/businessEvents.ts`
- reservation completion path(s) and shared hook fan-out
- `src/lib/whatsapp/v2/flows/ownerCommands.ts`
- approval request resolution / replay path
- capture runner + confirmation path
- weekly briefing composition
- recommendation scheduler + outcome observation
- any owner dashboard page that consumes newly shaped data from more than one plan

## Merge strategy back to `staging`

Only do this after integration is clean.

Recommended strategy:

1. keep the feature branch intact
2. produce an integration report:
   - what passed
   - what was fixed during integration
   - what remains intentionally deferred
3. merge `feat/operational-intelligence` into `staging` with a normal merge commit
4. do **not** squash unless there is a strong repo policy requiring it
   - the per-plan commit history is useful
   - migration history and review slices are easier to audit with preserved commits
5. after merge, decide case-by-case whether anything from this stack belongs on `release/vps-launch`

Do not:
- rebase this large feature stack onto `release/vps-launch`
- cherry-pick the whole feature stack into the VPS branch
- collapse the commit history unless someone explicitly wants that tradeoff

## Finish criteria

Claude’s takeover is complete only when all of these are true:

- branch-wide validation is run and triaged
- integration bugs found during the pass are fixed
- residual gaps are either closed or explicitly documented as deferred
- self-review against plans/specs/consolidation is done
- a merge recommendation back to `staging` is written down
- the branch is clean again

## Short status summary for Claude

You are **not** starting implementation from scratch. The feature stack is already built.
Your job is to act like the first hard integrator:

- distrust happy path assumptions
- verify cross-plan seams
- close real residual gaps
- then prepare the branch for merge into `staging`

