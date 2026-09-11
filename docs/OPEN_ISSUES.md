# Open issues

Reviewed: 2026-09-07

There is no known Showcase source blocker to the Booka controlled pilot. The
production build, TypeScript project build, full Jest suite, repository lint,
Showcase lint, and Showcase isolation checks pass on the integrated staging
line.

Deferred work is tracked in `docs/showcase/ROADMAP_STATUS.md`:

- complete source imagery for the three image-light demonstrators and expand
  Forge Build imagery;
- add 1280px and 768px screenshot coverage and manually inspect new captures;
- expand accessibility coverage beyond the current representative route set;
- rerun performance measurements on the deployed host;
- migrate the deprecated Next.js middleware convention, modernize Sentry
  instrumentation, and review the Redis dynamic-import build warning.
