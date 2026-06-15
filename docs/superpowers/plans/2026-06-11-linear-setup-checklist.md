# Linear Setup Checklist (manual, ops)

- [ ] Create Linear workspace / confirm team(s): Engineering, Ops.
- [ ] Connect GitHub integration; enable PR/branch auto-linking (matches branch names like `feat/instagram-channel`).
- [ ] Create projects: "Launch Readiness", "Incidents", "Compliance".
- [ ] Define severity labels: `sev1` (outage), `sev2` (degraded), `sev3` (minor), `bug`, `compliance`.
- [ ] Create a bug-intake issue template (steps to reproduce, expected, actual, env).
- [ ] Set triage workflow: new issues → Triage → Backlog/Todo → In Progress → Done.
- [ ] Import the P0/P1/P2 items from `docs/superpowers/specs/2026-06-11-launch-readiness-checklist-design.md` as issues under "Launch Readiness".
- [ ] (Optional) PostHog → Linear and Sentry → Linear integrations so issues can be created from events/errors.
