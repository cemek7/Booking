# TechClave Capability Showcase roadmap status

Reviewed: 2026-09-07

This record closes the historical Sessions 1–12 implementation plans as a
functional delivery while keeping unfinished polish visible. The original plan
files remain unchanged as historical specifications; unchecked boxes in those
files are not the current execution tracker.

## Delivered

| Sessions | Delivered evidence |
| --- | --- |
| 1 | `/showcase` route isolation, `RootChrome`, scoped themes, canonical content types, disclosure, local lead form, illustrative estimator, SunGrid routes, work grid, case-study renderer, and deck foundation. |
| 2–8 | Eight demonstrators are registered as published. Each has public routes and a canonical case study; all use the required Capability Demonstrator disclosure model. |
| 9 | Corporate Showcase index, work, services, methodology, capabilities, and contact routes. |
| 10 | Upwork, LinkedIn, and proposal renderers plus the per-case-study export route. |
| 11 | A 35–50 slide capability deck, web renderer, print styling, and PDF export guidance. |
| 12 | Showcase sitemap, screenshot automation, 40 committed responsive review captures, accessibility and performance audit scripts, and audit records. |

## Verification recorded on 2026-09-07

- Production build completed and generated all 95 static application pages.
- TypeScript project-reference build passed on the integrated staging tree.
- Full Jest suite passed: 311 suites and 2,310 tests; two suites and three
  tests are skipped, with one todo.
- Showcase-focused Jest suite passed: 14 suites and 22 tests.
- Repository ESLint completed with zero errors and 442 warnings.
- Showcase isolation scan found no Booka data-layer imports.
- Repository-wide lint error cleanup was integrated in `ca763a9`; the lint gate
  was re-enabled in CI.

## Deferred polish — not a Booka pilot blocker

- Add licensed local source imagery for SunGrid Energy, Crestfield Academy,
  and Atelier Soso; expand Forge Build beyond its single source image.
- Extend screenshot automation from 1440px and 390px to the planned 1280px
  and 768px viewports, then manually inspect regenerated captures.
- Expand automated accessibility coverage beyond the current 18 representative
  routes and perform a manual keyboard/focus-order review.
- Re-run performance measurements on the deployed host for representative
  network timings and, if needed, add Lighthouse composite reporting.
- Migrate deprecated Next.js middleware and update Sentry instrumentation;
  review the Redis dynamic-import build warning. These warnings did not block
  the production build.

## Release decision

The Showcase is functionally complete and truthful enough to remain in the
staging release. Deferred items are visual and audit breadth, not missing Booka
pilot functionality.
