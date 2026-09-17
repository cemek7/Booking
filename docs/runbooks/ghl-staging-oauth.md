# GoHighLevel OAuth on staging

A private Marketplace app, connected on staging only, for sandbox testing. It is
not listed publicly, no customer installs it, and production stays inert.

## What exists

| Piece                              | Where                                           |
| ---------------------------------- | ----------------------------------------------- |
| Authorize starter, superadmin only | `POST /api/integrations/ghl/start`              |
| Callback                           | `GET /api/integrations/ghl/callback`            |
| Signed, expiring, single-use state | `src/lib/integrations/ghl/oauthState.ts`        |
| Server-side code exchange          | `src/lib/integrations/ghl/tokenExchange.ts`     |
| Encrypted storage                  | `src/lib/integrations/ghl/connections.ts`       |
| Tables                             | migration `151_highlevel_oauth_connections.sql` |

The exact redirect URL to register in the HighLevel app:

```
https://staging.app.techclave.cloud/api/integrations/ghl/callback
```

## Environment

Names only. Never commit or print a value.

| Name                      | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `GHL_INTEGRATION_ENABLED` | `true` on staging only. Anything else makes both routes return 404.     |
| `GHL_CLIENT_ID`           | Marketplace app client id. Public by nature.                            |
| `GHL_CLIENT_SECRET`       | Marketplace app secret. Used only in the server-side token request.     |
| `GHL_REDIRECT_URI`        | Must equal the URL above, character for character.                      |
| `GHL_SCOPES`              | Space-separated. Defaults to `locations.readonly contacts.readonly`.    |
| `GHL_OAUTH_STATE_SECRET`  | Signs the state. Falls back to `NEXTAUTH_SECRET`, then `CRON_SECRET`.   |
| `ENCRYPTION_KEY`          | Already set. Encrypts stored tokens; rotating it makes them unreadable. |

## Deploying

1. Apply migration 151 to the staging database through the normal process.
2. Set the variables above in the staging stack's `.env`, then recreate the app
   container so it picks them up.
3. Confirm `GET /api/integrations/ghl/callback` returns **400**, not 404 or 500.
   400 means the route is live and refusing a request with no state, which is
   the correct answer to a bare visit.

## Connecting the sandbox

1. Christopher sets the redirect URL and the minimum scopes on the private app.
2. Call `POST /api/integrations/ghl/start` as a superadmin. It returns an
   `authorizeUrl`.
3. Open that URL, pick the sandbox sub-account, approve.
4. HighLevel returns to the callback, which should show "HighLevel is connected".
5. Confirm one row in `highlevel_oauth_connections` for that location, and that
   `encrypted_access_token` is not readable text.

## Smoke checklist

- A bare `GET` on the callback returns 400 and mentions no internals.
- Visiting the same successful callback URL twice: the second attempt returns 400. The state is single-use, so a replay connects nothing.
- A tampered `state` returns 400 and never reaches HighLevel.
- Logs from the run contain no code, state or token.
- `highlevel_oauth_connections` holds ciphertext only.

## Rollback

Set `GHL_INTEGRATION_ENABLED` to `false` and recreate the container. Both routes
return 404 immediately, and nothing else in the product touches these tables.

To remove the data as well, run
`db/migrations/151_highlevel_oauth_connections_rollback.sql`, which drops both
tables. Re-authorization is required afterwards.

## Known risk

HighLevel's docs describe `state` as something that _can_ be passed through the
authorize URL. If their redirect ever drops it, the callback refuses the
installation rather than connecting an unverified one. The symptom is a 400 with
"that link has expired" and a `state rejected` log line.
