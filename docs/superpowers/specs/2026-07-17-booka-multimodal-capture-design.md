# Booka Multimodal Business Record Capture — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Ninth sub-project (§2, Phase 4). Create records from receipts, voice notes, photos,
stock sheets, etc. Depends on specs 2 (validation/execution pipeline), 5 (stock counts).

**Scope decisions (self-made):** reuse spec 2's structured-intent → validate → confirm →
execute pipeline as the *back half*; extraction only produces the same structured intent
(never writes directly); receipts/voice/service-notes/stock-sheets in scope; trusted
auto-finalize off by default.

---

## 1. Objective
Turn messy real-world inputs (text, voice, receipt/invoice photos, PDFs, handwritten stock
sheets, screenshots) into confirmed business records, with confidence tracking, duplicate
detection, source preservation, and audit.

## 2. Current-state findings
`whatsapp/mediaHandler.ts` already uploads media to Supabase Storage (`whatsapp-media`
bucket). Spec 2 provides the deterministic validate/execute path + `ai_action_log`. No
extraction pipeline or media-record tables exist.

## 3. Pipeline
`input → file validation → secure storage → text/metadata extraction → AI structured
extraction → schema validation → duplicate detection → human confirmation → record creation
(via spec 2's execute) → audit`. Processing states: `pending | processing | review_required
| confirmed | failed`.

## 4. Data model (new; RLS tenant-scoped)
- **`media_inputs`**: `tenant_id`, `source` (whatsapp|dashboard), `kind` (receipt|invoice|
  voice|photo|pdf|stock_sheet|screenshot), `storage_path`, `file_hash`, `mime`, `size`,
  `uploaded_by`, `created_at`. Original file **always preserved**.
- **`extraction_jobs`**: `media_input_id`, `status` (pending|processing|review_required|
  confirmed|failed), `model`, `prompt_version`, `error`, timestamps.
- **`extracted_records`**: `job_id`, `record_type` (expense|purchase|stock_receipt|
  supplier_payment|retail_sale|service|stock_count), `fields jsonb`,
  `field_confidence jsonb` (per-field), `low_confidence_fields text[]`,
  `proposed_action jsonb` (a spec-2 `AIResponse`), `linked_record_type`/`linked_record_id`
  (after confirm), `created_at`.

## 5. Extraction & modality routing
- **Receipts/invoices/PDFs/screenshots**: vision-model OCR → structured fields (merchant,
  date, items, qty, unit price, tax, total, payment method, reference).
- **Voice notes**: transcription (verify provider — Whisper-class) → structured extraction.
- **Handwritten stock sheets**: vision OCR → product names + counts → feeds a **spec 5 stock
  count session** (not a direct stock write).
- **Service notes**: → completed service + payment + staff + consumption (spec 5) — as a
  spec-2 proposed action.
- Deterministic parsing (amounts, dates, Naira) in code; the model extracts, code validates.

## 6. Confidence, duplicates, confirmation
- Per-field confidence stored; low-confidence fields flagged in the review UI.
- **Duplicate receipts**: match on `file_hash` (exact) + fuzzy (amount + date + supplier +
  reference). Duplicate → `review_required`, not auto-created.
- **Financial records require human confirmation** unless the tenant explicitly enables
  trusted automation (off by default). On confirm, the `proposed_action` runs through spec 2's
  `validateAction`/`executeAction` (idempotent via `ai_action_log`).
- Every created record links back to its `media_input` (source traceability); audit via
  `business_events`.

## 7. Permissions & surface
Upload: any staff with the relevant record permission (e.g. `RECORD_SALES`, `PERFORM_STOCK_COUNTS`).
Confirmation gated by the target action's §12 permission. Dashboard: review queue (thumbnail,
extracted fields, confidence, confirm/edit/reject). WhatsApp: media messages route here.

## 8. Testing
File validation + hash · storage + original preserved · extraction populates fields +
confidence · low-confidence flagged · **duplicate receipt → review_required, no double-create** ·
confirmation runs spec 2 execute (idempotent) · voice → structured sale · stock sheet → spec 5
session · trusted-automation off by default · source linkage · tenant isolation + access control.

## 9. Dependency verification (pre-implementation)
Confirm current package/API for: transcription provider, vision/OCR model (per global
dependency-verification rule) before coding.

## 10. Implementation order
1. Migrations: `media_inputs`, `extraction_jobs`, `extracted_records` (+ RLS, rollbacks).
2. Upload + validation + hashing (reuse mediaHandler) → `media_inputs`.
3. Extraction workers (vision/transcription) → `extraction_jobs`/`extracted_records`, per-field confidence.
4. Duplicate detection.
5. Review UI + confirm → spec 2 execute; source linkage + audit.
6. Modality routing (receipt/voice/stock-sheet/service-note); trusted-automation flag.
7. Docs.
