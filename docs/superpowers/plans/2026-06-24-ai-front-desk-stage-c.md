# AI Front Desk Stage C

## Scope

Stage C adds relationship intelligence views on PostgreSQL:

- `customer_service_history_view`
- `staff_customer_history_view`
- `followup_candidates_view`
- `tenant_revenue_view`

These are read models for owner insights, retention prompts, and future front-desk recommendations.

## Deliverables

| Area | Status | Path |
|---|---|---|
| relationship views migration | implemented | `db/migrations/094_ai_front_desk_relationship_views.sql` |
| Stage C hardening migration | implemented | `db/migrations/096_ai_front_desk_stage_c_hardening.sql` |
| apply helper | implemented | `scripts/sql/apply_ai_front_desk_stage_c.sql` |
| verification SQL | implemented | `scripts/sql/verify_ai_front_desk_stage_c.sql` |
| post-deploy verification helper | implemented | `deployment/scripts/verify-ai-front-desk-stage-c.sh` |
| post-deploy apply + verify helper | implemented | `deployment/scripts/post-deploy-ai-front-desk-stage-c.sh` |

## View Purposes

| View | Purpose |
|---|---|
| `customer_service_history_view` | what each customer books, how often, and what it is worth |
| `staff_customer_history_view` | loyalty/affinity between customers and staff |
| `followup_candidates_view` | who should be re-engaged and why |
| `tenant_revenue_view` | revenue and booking summaries by date/service/staff/customer |

## Verification

Run after deploy:

```bash
bash deployment/scripts/verify-ai-front-desk-stage-c.sh <TENANT_UUID>
```

Or apply and verify in one step:

```bash
bash deployment/scripts/post-deploy-ai-front-desk-stage-c.sh <TENANT_UUID>
```
