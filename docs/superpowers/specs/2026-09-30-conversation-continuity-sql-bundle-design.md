# Conversation Continuity SQL Bundle — Design

**Date:** 2026-09-30
**Status:** Implemented and locally verified; not yet executed in Supabase
**Target:** Staging Supabase SQL Editor first; production requires a separate release gate

## 1. Problem

Conversation continuity ships as six ordered, reviewed Supabase release files. Running them individually is safe but unnecessarily error-prone for an owner-operated release: a file can be skipped, run out of order, or confused with the similarly named migration source.

The existing rollout runbook deliberately forbids ad-hoc concatenation because each release currently owns its own transaction. Simply pasting all six files together can commit early releases before a later release fails. The required artifact is therefore not a loose concatenation; it is a generated, atomic SQL Editor bundle with one transaction and a final verification gate.

## 2. Source of truth

The canonical inputs, in order, remain:

1. `db/releases/2026-09-28-conversation-continuity.sql`
2. `db/releases/2026-09-28-channel-identity-runtime-hardening.sql`
3. `db/releases/2026-09-28-conversation-ingest-replay-hardening.sql`
4. `db/releases/2026-09-29-conversation-effect-delivery-hardening.sql`
5. `db/releases/2026-09-29-verified-customer-memory.sql`
6. `db/releases/2026-09-29-handoff-thread-continuity.sql`

The final verifier remains:

- `scripts/sql/verify_conversation_continuity.sql`

The generated output is:

- `db/releases/2026-09-30-conversation-continuity-all-in-one.sql`

The generated file must never become an independent source of schema logic.

## 3. Generation contract

A small repository script will:

1. Read the six source files in the fixed order above.
2. Require every source file to contain exactly one top-level `BEGIN;` and one top-level `COMMIT;` wrapper.
3. Remove only those exact top-level wrapper lines.
4. Preserve every other statement byte-for-byte, including verification blocks, grants, revokes, RLS, function search paths and status rows.
5. Wrap the combined body in one outer `BEGIN;` / `COMMIT;` transaction.
6. Append the complete final verifier before the outer commit.
7. Add generated-file warnings and source-boundary comments.

If any source no longer matches the wrapper contract, generation must fail rather than guessing.

## 4. Atomic behavior

The Supabase SQL Editor receives one script and one outer transaction. A duplicate preflight, unsafe function, missing relation, permission error, or failed final verification aborts the transaction. No migration in the bundle remains committed when a later gate fails.

Expected status rows include:

- `conversation_continuity_schema_ready`
- `channel_identity_runtime_ready`
- `conversation_ingest_replay_ready`
- final `conversation_continuity_schema_ready`

The absence of a status row from release files 156–158 is expected; their statements and inline verification still execute inside the same transaction.

## 5. Validation

Automated tests must prove:

- the generator uses the exact ordered source list;
- all source bodies are present and ordered;
- the bundle contains one outer transaction and no retained source transaction wrappers;
- the final verification runs before the outer commit;
- generation fails when a source wrapper is missing or duplicated;
- the generated artifact is current and reproducible;
- the bundle contains no psql-only commands such as `\i`, so it is compatible with Supabase SQL Editor.

Existing migration-numbering, schema-manifest and continuity migration tests must remain green.

## 6. Operator flow

1. Confirm a current staging backup or PITR recovery point.
2. Open the staging Supabase SQL Editor.
3. Run the complete generated bundle once.
4. Require the final `conversation_continuity_schema_ready` result.
5. Run `npm run db:validate` from the matching immutable release image.
6. Deploy only after both gates pass.

Production remains a separate approved operation. No bundle execution, deployment, or environment mutation is performed by generating the file.

## 7. Rollback

The bundle changes no rollback policy. Runtime continuity flags remain off by default. Incident response disables flags first, rolls back the application image second, and considers destructive schema rollback only when every continuity table is empty and the existing rollback preflight passes.

## 8. Generated artifact evidence

- Output: `db/releases/2026-09-30-conversation-continuity-all-in-one.sql`
- Generator: `scripts/build-conversation-continuity-bundle.cjs`
- SHA-256: `9c933f9b0dcd171a67675bb5a51a00092ed629eadf10d0962b37008958f8bd3d`
- Static transaction check: one line-only `BEGIN;`, one line-only `COMMIT;`, no psql `\i` command
- Local verification: bundle tests, handoff migration tests, handoff continuity tests and CI typecheck passed on 2026-09-30

This evidence proves reproducible generation and local compatibility only. It does not claim that the SQL has been run in staging or production.
