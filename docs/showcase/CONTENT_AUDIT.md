# Content and isolation audit

- All eight published demonstrators use the `Capability Demonstrator` project type and canonical disclosure.
- Case studies contain designed outcomes and limitations; no `measuredScores` field is available in the schema.
- Local forms use `LeadForm`, which makes no network request.
- Showcase source is quarantined from Booka data-layer imports (verified with the handover isolation grep).
- `scripts/showcase-screenshots.mjs` captures desktop home/detail/form and mobile home/form for every demonstrator once a deployable server is available. It was not run here: the known offline font dependency blocks a valid production build, and no placeholder screenshots are committed.
- Remaining release verification: run the capture script against `npm run build && npm start`, then inspect the resulting files in `public/mockups/` for broken routes, clipping, and image failures.
