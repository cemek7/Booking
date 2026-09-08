# Engineering decisions

## TechClave Capability Showcase

Status: implemented, with deferred polish recorded in
`docs/showcase/ROADMAP_STATUS.md`.

- Keep the public capability site inside this repository under `/showcase/*`.
- Use `RootChrome` as the isolation boundary so Showcase routes do not render
  Booka analytics, consent, authentication, or product chrome.
- Keep Showcase code quarantined from Booka's database, booking, billing, and
  tenant services. Showcase forms are local demonstrations and send no data.
- Label every example as a **Capability Demonstrator** and use the canonical
  disclosure. Do not present illustrative outcomes as measured client results.
- Store demonstrator, case-study, deck, and export content in canonical typed
  records rather than duplicating prose across surfaces.
- Scope visual themes with CSS custom properties under each demonstrator's
  `data-theme` boundary so they do not alter Booka's product theme.
- Self-host application fonts. Production builds must not depend on fetching
  Google Fonts or another third-party font service.
- Treat Showcase imagery, expanded viewport captures, and exhaustive browser
  audits as independent polish work; they do not block the Booka controlled
  pilot. Repository-wide lint cleanup was subsequently completed in `ca763a9`.

## Staging integration on 2026-09-07

- Preserve `1a9383e` as the merge that synchronized local staging with the
  remote typecheck repair.
- Preserve `68ef9d3` as the focused Instagram OAuth and Settings product fix.
- Preserve `9ac32a9` as the merge of that fix into staging.
- Preserve `925577f` and `e454274` as the promotional-wallet integration and
  its synchronization with the newer lint-clean staging tip.
- Do not rewrite the older Showcase planning commits. Their document content
  already exists in remote history under equivalent commits, and they create
  no additional runtime diff.
