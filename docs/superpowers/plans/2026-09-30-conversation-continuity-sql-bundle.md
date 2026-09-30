# Conversation Continuity SQL Bundle Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task by task with verification after every task.

**Goal:** Generate one reproducible, atomic Supabase SQL file containing continuity migrations 153–158 plus the final verifier, so the owner can paste and run it once without accidentally replaying unrelated migrations.

**Architecture:** A small Node generator reads the six reviewed release files in a fixed allowlist, removes only each file's outer transaction markers, preserves every migration body in order, appends the existing verifier, and writes one outer `BEGIN`/`COMMIT` bundle. Jest proves source equivalence, order, transaction shape and deterministic output.

**Tech stack:** Node 20, Jest, PostgreSQL/Supabase SQL.

---

### Task 1: Lock the generator contract with failing tests

**Files:**
- Create: `src/__tests__/scripts/conversationContinuityBundle.test.ts`
- Reference: `db/releases/2026-09-28-conversation-continuity.sql`
- Reference: `db/releases/2026-09-28-channel-identity-runtime-hardening.sql`
- Reference: `db/releases/2026-09-28-conversation-ingest-replay-hardening.sql`
- Reference: `db/releases/2026-09-29-conversation-effect-delivery-hardening.sql`
- Reference: `db/releases/2026-09-29-verified-customer-memory.sql`
- Reference: `db/releases/2026-09-29-handoff-thread-continuity.sql`
- Reference: `scripts/sql/verify_conversation_continuity.sql`

**Step 1: Write the failing test**

Test an exported pure `buildBundle()` function with fixtures that contain comments, internal PL/pgSQL blocks, verification statements after `COMMIT`, and one line-only top-level `BEGIN;`/`COMMIT;` pair. Assert:

- sources appear exactly once and in the allowlisted order;
- only the outer transaction markers are removed;
- body text is otherwise byte-for-byte equal after newline normalization;
- the verifier appears after all six bodies and before the final commit;
- output contains exactly one top-level `BEGIN;` and one final `COMMIT;`;
- output contains no psql `\i` directives;
- two builds from the same inputs are identical.

**Step 2: Run the test to verify it fails**

Run: `npm test -- --runInBand src/__tests__/scripts/conversationContinuityBundle.test.ts`

Expected: FAIL because the generator module does not exist.

**Step 3: Commit the red test**

```bash
git add src/__tests__/scripts/conversationContinuityBundle.test.ts
git commit -m "test(db): define continuity bundle contract"
```

### Task 2: Implement the deterministic generator

**Files:**
- Create: `scripts/build-conversation-continuity-bundle.cjs`
- Modify: `package.json`
- Test: `src/__tests__/scripts/conversationContinuityBundle.test.ts`

**Step 1: Implement the minimum generator**

Export:

```js
export const continuityReleaseFiles = [/* exact six paths in migration order */];
export function buildBundle({ releases, verifier }) { /* deterministic text */ }
```

The CLI resolves paths from the repository root, requires exactly one line-only `BEGIN;` and one later line-only `COMMIT;` in each source, removes only those two lines, normalizes only line endings, preserves any source verifier that follows its original commit, adds source-boundary comments, and writes `db/releases/2026-09-30-conversation-continuity-all-in-one.sql`.

Add:

```json
"db:bundle:conversation-continuity": "node scripts/build-conversation-continuity-bundle.cjs"
```

Do not parse or rewrite PL/pgSQL bodies, dollar quotes, grants, policies or verifier statements.

**Step 2: Run the focused test**

Run: `npm test -- --runInBand src/__tests__/scripts/conversationContinuityBundle.test.ts`

Expected: PASS.

**Step 3: Generate the bundle twice and prove reproducibility**

```bash
npm run db:bundle:conversation-continuity
sha256sum db/releases/2026-09-30-conversation-continuity-all-in-one.sql
npm run db:bundle:conversation-continuity
sha256sum db/releases/2026-09-30-conversation-continuity-all-in-one.sql
```

Expected: both hashes match.

**Step 4: Commit**

```bash
git add package.json scripts/build-conversation-continuity-bundle.cjs src/__tests__/scripts/conversationContinuityBundle.test.ts db/releases/2026-09-30-conversation-continuity-all-in-one.sql
git commit -m "build(db): add atomic continuity SQL bundle"
```

### Task 3: Self-review the generated SQL and operator handoff

**Files:**
- Verify: `db/releases/2026-09-30-conversation-continuity-all-in-one.sql`
- Modify: `docs/superpowers/specs/2026-09-30-conversation-continuity-sql-bundle-design.md`

**Step 1: Run static safety gates**

```bash
rg -n '^BEGIN;|^COMMIT;|\\i|DROP TABLE|TRUNCATE|DELETE FROM' db/releases/2026-09-30-conversation-continuity-all-in-one.sql
git diff --check
```

Expected: one `BEGIN;`, one `COMMIT;`, no `\i`, and no unexpected destructive statements.

**Step 2: Run continuity regression tests**

```bash
npm test -- --runInBand src/__tests__/scripts/conversationContinuityBundle.test.ts src/__tests__/scripts/handoffContinuityMigration.test.ts src/__tests__/lib/whatsapp/v2/handoffContinuity.test.ts
npm run typecheck:ci
```

Expected: PASS.

**Step 3: Mark the design implemented and record the generated path/hash**

Update only status and reproducibility evidence; do not embed environment secrets or claim that production/staging SQL has run.

**Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-30-conversation-continuity-sql-bundle-design.md
git commit -m "docs(db): record continuity bundle verification"
```

**Operator gate after merge:** Back up the target Supabase project, paste the single generated SQL file into the Supabase SQL editor, run it once, then run `scripts/sql/verify_conversation_continuity.sql` and `npm run db:validate` against that same environment. Do not run the bundle automatically from local development.
