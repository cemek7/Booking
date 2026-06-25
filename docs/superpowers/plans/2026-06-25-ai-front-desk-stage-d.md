# AI Front Desk Stage D

Stage D operationalizes AI training-event review for the first seeded tenant.

## Added

- `db/migrations/097_ai_front_desk_stage_d_training_views.sql`
- `scripts/sql/apply_ai_front_desk_stage_d.sql`
- `scripts/sql/verify_ai_front_desk_stage_d.sql`
- `deployment/scripts/verify-ai-front-desk-stage-d.sh`
- `deployment/scripts/post-deploy-ai-front-desk-stage-d.sh`

## Purpose

- make `ai_training_events` inspectable without ad hoc SQL
- summarize daily capture quality by tenant, channel, role, and intent
- highlight failures, missing intents, missing backend actions, and corrections
- give a repeatable post-deploy check for the first seeded tenant

## Verify After Seeding

1. Apply Stage D:
   - `npm run db:apply:ai-front-desk-stage-d`
2. Send seeded owner + customer front-desk messages.
3. Verify one tenant:
   - `npm run db:verify:ai-front-desk-stage-d -- <TENANT_UUID>`

## First Seeded Tenant Capture Checks

Send at least one message in each category:

- customer booking request
- customer availability question
- customer cancel/reschedule request
- owner summary question
- owner relationship question

Expected capture signs:

- each message creates an `ai_training_events` row
- `intent` is populated for most rows
- `backend_action` is populated for action-oriented rows
- invalid actions appear in `ai_training_failure_review_view`
- corrected retries show `correction` text

## Expected Healthy Signs

- recent `ai_training_events` rows exist
- `ai_training_event_daily_summary_view` shows nonzero counts
- `ai_training_capture_health_view` shows low missing-intent / missing-backend-action counts
- `ai_training_failure_review_view` only contains genuine failures/corrections
