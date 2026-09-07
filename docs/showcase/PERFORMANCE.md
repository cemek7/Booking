# Performance metrics (Playwright + Performance API)

Tool: Playwright driving a headless Chromium against a live production build, reading the browser
Performance API. These are **real measured load signals**, reported instead of a Lighthouse composite
score — no score is fabricated. Numbers vary by host/network; capture on your deploy target for
representative figures.

| Route | FCP (ms) | DOMContentLoaded (ms) | Load (ms) |
| --- | ---: | ---: | ---: |
| `/showcase` | 92 | 91 | 91 |
| `/showcase/work` | 68 | 30 | 43 |
| `/showcase/demos/sungrid-energy` | 60 | 21 | 49 |
| `/showcase/demos/haven-realty/properties` | 92 | 46 | 77 |
| `/showcase/demos/ember-table` | 64 | 26 | 61 |
| `/showcase/demos/atelier-soso` | 56 | 25 | 47 |
| `/showcase/capability-deck` | 52 | 38 | 52 |

Notes: measured on the local production server; timings are low because there is no network latency
locally — capture on the deploy target for representative numbers. Transfer size is omitted because
headless Chromium reports `transferSize` as 0 for these responses; measure payload with the deploy
host's tooling. For a full Lighthouse-style composite (SEO/best-practices/PWA), run Lighthouse against
the deployed URL; this script covers the load-timing signals without it.
