# Booking Hours, Reservation Safety, and Legal Identity Design

## Objective

Close three pre-pilot correctness gaps:

1. publish Techclave's verified legal identity consistently;
2. make one owner-configured business-hours schedule drive public booking and AI behaviour in the tenant's timezone; and
3. prevent overlapping active reservations at the database boundary, including concurrent requests.

The work must preserve existing tenants, the WhatsApp conversational hold flow, and the current controlled-pilot deployment model.

## Verified legal identity

The Corporate Affairs Commission certificate and status report establish these public company facts:

- Legal entity: `Techclave Ltd`
- Registration number: `RC 8489929`
- Registered address: `25, Ndola Crescent, Wuse Zone 5, FCT, Nigeria`
- Incorporation date: `16 May 2025`

`src/lib/legal/constants.ts` will become the single source for these facts. The Privacy Policy, Terms of Service, and DPA will identify the operator using the legal entity, registration number, and registered address. The legal-document update date will be changed to the publication date of this release.

The implementation will not publish the company TIN, director details, shareholder details, phone numbers, or residential/service addresses from the CAC documents. Mail delivery for `privacy@techclave.cloud`, `legal@techclave.cloud`, and `support@techclave.cloud`, DMARC configuration, and external legal-counsel review remain operator actions rather than claims made by the application.

## Current booking inconsistency

The repository currently has three representations of business-wide hours:

- the Settings UI writes `tenants.settings.business_hours`;
- AI context and out-of-hours responses read `tenants.metadata.business_hours`; and
- public availability reads rows from `public.business_hours`.

The UI and both database tables already exist, so the old comments claiming that they do not exist are stale. The actual defect is split ownership: a successful settings save does not guarantee that customer-facing booking or AI behaviour sees the saved value.

The public booking flow also constructs local date/time values in the application server timezone. That is not safe for tenants outside the server timezone.

Reservation locking has a separate schema mismatch: `DoubleBookingPrevention` writes `reservation_locks.session_id`, but the table migration does not create that column. Exact `slot_key` uniqueness also cannot reject partially overlapping ranges with different start/end values. A second table, `slot_locks`, is already the active temporary-hold mechanism for WhatsApp conversations.

## Canonical business-hours model

`tenants.settings.business_hours` is the canonical business-wide schedule.

The stored object uses the existing Settings UI shape:

```ts
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

type DayHours = {
  open: string | null;  // HH:MM
  close: string | null; // HH:MM
  closed: boolean;
};

type BusinessHours = Record<DayKey, DayHours>;
```

Rules:

- open days require valid `HH:MM` values with `open < close`;
- closed days store `open: null` and `close: null`;
- overnight shifts are not supported in this release;
- a missing schedule uses the current safe default: Monday-Friday 09:00-17:00, Saturday-Sunday closed;
- legacy values are read from `metadata.business_hours`, then `public.business_hours`, only when canonical settings are absent;
- writes go only to the canonical settings value after migration;
- the legacy table remains in place for compatibility but is no longer authoritative.

A focused booking-hours module will own validation, day-key mapping, defaulting, legacy normalization, and tenant-local time conversion. Public booking, AI context, and out-of-hours messaging must consume that module rather than parsing schedules independently.

## Timezone behaviour

Each tenant's `tenants.timezone` is an IANA timezone identifier. `Africa/Lagos` remains the fallback for missing or invalid legacy values.

Customer-facing dates and times are interpreted in the tenant timezone and converted to UTC before querying or inserting reservations. Availability windows are derived from tenant-local midnight and the configured local opening/closing time. Responses continue to expose local slot labels to customers.

Tests must cover a fixed-offset zone (`Africa/Lagos`) and a daylight-saving zone. Invalid local times during a forward clock change are rejected rather than silently shifted. For an ambiguous repeated time, the resolver uses the earlier occurrence consistently.

## Migration and compatibility

A versioned migration will backfill `tenants.settings.business_hours` only where it is absent:

1. prefer an existing valid `metadata.business_hours` value;
2. otherwise aggregate existing `public.business_hours` rows;
3. otherwise leave the value absent so the application default applies.

The migration will not overwrite an owner-configured canonical schedule. It will not drop either legacy table.

Settings validation will accept the existing snake-case field and normalize any legacy camel-case `businessHours` input to `business_hours`. Reads return the canonical snake-case field.

## Reservation concurrency boundary

Temporary conversational holds and committed reservations solve different problems:

- `slot_locks` remains the temporary, expiring hold used by the WhatsApp booking conversation;
- the broken `reservation_locks` application flow is retired from booking creation;
- committed reservation integrity is enforced directly on `public.reservations`.

The migration will enable `btree_gist` without pinning an extension version and add a GiST exclusion constraint over:

- `tenant_id` equality;
- the effective staff/resource key equality, treating an unassigned reservation as the existing shared unassigned resource; and
- `tstzrange(start_at, end_at, '[)')` overlap.

The constraint applies only to active booking states (`pending` and `confirmed`) with non-null, ordered timestamps. Adjacent reservations are allowed because the range is half-open. Cancelled and no-show reservations do not block the slot.

Before the constraint is added, the migration performs a deterministic overlap audit and aborts with an actionable exception if conflicting active production rows exist. It never deletes or rewrites reservations automatically.

All reservation creation paths retain their friendly pre-checks for useful responses, but correctness no longer depends on a read followed by a later write. PostgreSQL error `23P01` is mapped to the existing conflict response. No public or authenticated client receives direct write access to locking internals.

The currently surfaced `allowOverbooking` flag is not wired into booking creation and therefore does not bypass the constraint. Deliberate overbooking requires a separate audited design; silent bypass is unsafe for the pilot.

## Security

- The migration is versioned and applied through the existing release process.
- Existing RLS remains enabled on tenant-scoped scheduling tables.
- No new `SECURITY DEFINER` function is required.
- Service-role access remains server-only.
- Migration preflight and constraint names are deterministic and re-runnable where practical.
- Settings authorization remains owner/manager/superadmin and tenant-scoped.

## Testing

Implementation is test-first and must prove:

- verified legal facts render with no placeholder identity;
- canonical hours round-trip through Settings;
- legacy metadata/table schedules normalize without overwriting canonical values;
- closed days return no public slots;
- custom opening and closing times bound generated slots;
- public booking and AI out-of-hours logic use the same schedule;
- tenant-local times convert correctly to UTC;
- invalid and ambiguous daylight-saving times follow the documented rules;
- overlapping active reservations for the same effective resource are rejected under concurrency;
- adjacent, cancelled, no-show, and different-staff reservations are allowed;
- database exclusion errors become HTTP conflict responses;
- WhatsApp `slot_locks` behaviour remains intact.

Relevant focused tests, migration/static validation, type checking, linting, and the repository's existing quality gates must pass before merge.

## Rollout

1. Apply and validate the migration in staging.
2. Deploy the application change to staging.
3. Save non-default hours and verify public availability plus an AI out-of-hours reply.
4. Execute a concurrent booking test and verify exactly one overlapping reservation succeeds.
5. Confirm legal pages render the verified entity data.
6. Promote the same reviewed commit to production.
7. Repeat read-only schema checks and the controlled concurrency test before beginning the full pilot smoke test.

Production email-route delivery, DMARC, and legal-counsel sign-off are recorded as operator gates and are not represented as complete by this code change.
