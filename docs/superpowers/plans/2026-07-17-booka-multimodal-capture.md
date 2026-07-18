# Booka Multimodal Business Record Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Create business records from receipts, voice notes, photos, stock sheets, and service notes — with confidence tracking, duplicate detection, source preservation, and human confirmation that runs through spec 2's execute pipeline.

**Architecture:** `media_inputs` → `extraction_jobs` → `extracted_records` (with per-field confidence + a `proposed_action`). Confirmation runs the `proposed_action` through spec 2's `validateAction`/`executeAction` (idempotent). The AI extracts; code validates; records link back to source.

**Tech Stack:** Next.js 16, Supabase (Storage), TypeScript, Jest. Spec: `docs/superpowers/specs/2026-07-17-booka-multimodal-capture-design.md`.

## Global Constraints
- Depends on spec 2 (validate/execute + `ai_action_log`), spec 5 (stock-sheet → stock count). Migrations after spec-8.
- Reuse `whatsapp/mediaHandler.ts` Supabase Storage upload (`whatsapp-media` bucket).
- **Financial records require human confirmation** unless the tenant enables trusted automation (off by default).
- **Duplicate receipts** matched on `file_hash` (exact) + fuzzy (amount+date+supplier+reference) → `review_required`, not auto-created.
- Original file always preserved; created records link to `media_input`. States: `pending|processing|review_required|confirmed|failed`.
- **DEPENDENCY VERIFICATION FIRST** (global rule): confirm current transcription + vision/OCR provider package names/APIs before coding (Task 4).

## File Structure
- `db/migrations/134_multimodal_capture.sql`(+rollback) — `media_inputs`, `extraction_jobs`, `extracted_records`, plus `expenses`/`purchases`/`suppliers`/`supplier_payments`/`stock_receipts` (none exist).
- `src/lib/capture/ingest.ts` — `ingestMedia(admin, tenantId, {kind, buffer/url})` (validate, hash, store).
- `src/lib/capture/extract.ts` — modality routers → structured fields + confidence.
- `src/lib/capture/duplicates.ts` — `findDuplicate(admin, tenantId, hash, fields)`.
- `src/lib/capture/confirm.ts` — `confirmExtraction(admin, recordId, actorId)` → spec 2 execute.
- `src/app/api/owner/capture/route.ts` (upload), `.../[id]/confirm/route.ts`; dashboard review queue.

---

## Task 1: Migration
- [ ] **Step 1:** `134_multimodal_capture.sql` — create `media_inputs` (`kind`, `storage_path`, `file_hash`, `mime`, `size`, `uploaded_by`), `extraction_jobs` (`media_input_id`, `status`, `model`, `prompt_version`, `error`), `extracted_records` (`job_id`, `record_type`, `fields jsonb`, `field_confidence jsonb`, `low_confidence_fields text[]`, `proposed_action jsonb`, `linked_record_type`, `linked_record_id`), and the target tables `expenses`/`purchases`/`suppliers`/`supplier_payments`/`stock_receipts` (id, tenant_id, cents amounts, created_at). RLS on all. (Full column list per spec §4.)
- [ ] **Step 2:** Apply + verify. **Commit** `feat(capture): media/extraction tables + expense/purchase/supplier targets`.

---

## Task 2: Ingest + hashing
**Interfaces:** `ingestMedia(admin, tenantId, {kind, buffer, mime, uploadedBy}): Promise<{ mediaInputId, hash }>`.
- [ ] **Step 1:** Test: ingest computes a sha256 `file_hash`, uploads to Storage (mock the bucket), inserts a `media_inputs` row (`status` via a new `extraction_jobs` `pending`). Same bytes twice → same hash.
- [ ] **Step 2:** Implement (reuse mediaHandler upload). **Commit** `feat(capture): media ingest + hashing`.

---

## Task 3: Duplicate detection
**Interfaces:** `findDuplicate(admin, tenantId, hash, {amount, date, supplier, reference}): Promise<string|null>`.
- [ ] **Step 1:** Test: exact hash match → returns existing; near-match (same amount+date+supplier, no hash) → returns existing; unrelated → null.
- [ ] **Step 2:** Implement. **Commit** `feat(capture): duplicate receipt detection`.

---

## Task 4: Extraction (dependency-verified)
- [ ] **Step 1:** **Verify dependencies** — confirm the transcription provider and vision/OCR model package names/APIs currently available in the repo (grep existing AI providers: `ls src/lib/ai/providers`; check `google-ai.ts`/`openrouter.ts`). Report findings before coding.
- [ ] **Step 2:** Implement `extract.ts` modality routers: receipt/invoice/pdf/screenshot → vision structured fields; voice → transcription → fields; each field carries a confidence. Deterministic amount/date parsing (reuse spec 2 `parseNairaAmount`). Populate `extracted_records` with `field_confidence` + `proposed_action` (a spec-2 `AIResponse`).
- [ ] **Step 3:** Test extraction populates fields + flags low-confidence fields (mock the model call). Stock-sheet router produces a spec 5 stock-count session payload; service-note router produces a completion+payment+consumption action.
- [ ] **Step 4:** PASS; **Commit** `feat(capture): modality extraction with per-field confidence`.

---

## Task 5: Confirmation → spec 2 execute + APIs
**Interfaces:** `confirmExtraction(admin, recordId, actorId): Promise<void>`.
- [ ] **Step 1:** Test: confirming a receipt record runs its `proposed_action` through spec 2 `validateAction`/`executeAction` (idempotent via `ai_action_log`), sets record `confirmed`, links `linked_record_id`, emits a business event. A duplicate stays `review_required` and is not auto-created.
- [ ] **Step 2:** Implement `confirm.ts`. APIs: `POST /api/owner/capture` (upload → ingest → enqueue extraction), `POST /api/owner/capture/[id]/confirm`. Permission = the target action's §12 permission. Trusted-automation flag (off by default) skips manual confirm for financial records only when enabled.
- [ ] **Step 3:** Dashboard review queue (thumbnail, fields, confidence, confirm/edit/reject).
- [ ] **Step 4:** PASS + typecheck; **Commit** `feat(capture): confirmation via spec 2 execute + review APIs`.

---

## Self-Review
**Spec coverage:** pipeline states + tables → Task 1; ingest → Task 2; duplicates → Task 3; extraction → Task 4; confirm+APIs+UI → Task 5. **Placeholder scan:** clean; extraction providers gated behind an explicit dependency-verification step (Task 4 Step 1). **Type consistency:** `ingestMedia`/`findDuplicate`/`confirmExtraction` consistent; reuses spec 2 execute + `parseNairaAmount`. **Cross-spec:** §K (execute through spec 2), stock-sheet→spec 5, service-note→spec 7 honored.
