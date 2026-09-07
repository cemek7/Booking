# Accessibility audit (axe-core via Playwright)

Tool: axe-core @axe-core/playwright — the same rule engine Lighthouse uses for its accessibility
category — run against a live production server. WCAG 2.0/2.1 A & AA tags. Real measured results, not estimates.

**Totals across 18 routes:** 0 violations (0 critical, 0 serious).

| Route | Violations | Critical | Serious | Rule ids (impact, nodes) |
| --- | ---: | ---: | ---: | --- |
| `/showcase` | 0 | 0 | 0 | none |
| `/showcase/work` | 0 | 0 | 0 | none |
| `/showcase/services` | 0 | 0 | 0 | none |
| `/showcase/methodology` | 0 | 0 | 0 | none |
| `/showcase/capabilities` | 0 | 0 | 0 | none |
| `/showcase/contact` | 0 | 0 | 0 | none |
| `/showcase/demos/sungrid-energy` | 0 | 0 | 0 | none |
| `/showcase/demos/sungrid-energy/contact` | 0 | 0 | 0 | none |
| `/showcase/demos/northstar-clinic` | 0 | 0 | 0 | none |
| `/showcase/demos/ember-table` | 0 | 0 | 0 | none |
| `/showcase/demos/haven-realty` | 0 | 0 | 0 | none |
| `/showcase/demos/haven-realty/properties` | 0 | 0 | 0 | none |
| `/showcase/demos/meridian-legal` | 0 | 0 | 0 | none |
| `/showcase/demos/forge-build` | 0 | 0 | 0 | none |
| `/showcase/demos/crestfield-academy` | 0 | 0 | 0 | none |
| `/showcase/demos/atelier-soso` | 0 | 0 | 0 | none |
| `/showcase/case-studies/sungrid-energy` | 0 | 0 | 0 | none |
| `/showcase/capability-deck` | 0 | 0 | 0 | none |

Notes: automated axe checks cover a large share of WCAG success criteria but not all (e.g. meaningful
focus order, sensible reading order, and content quality still need a manual pass). This is an automated
baseline, not a full manual audit.

## Fixes applied (2026-08-14)

A prior run reported 9 serious violations. All are now resolved:

- **`color-contrast` (northstar, ember, haven, haven/properties, meridian) — fixed.** Root cause was
  three patterns, not one: (a) small eyebrow/kicker labels using raw brand `--sc-primary`/`--sc-accent`
  as 12px text (e.g. haven's gold accent at 2.96:1); (b) section kickers faded with `opacity-60`, which
  composited muted text below 4.5:1; (c) Ember's primary button (`#f4ece2` on `#c8542b` = 3.77:1). Fixes:
  added an AA-safe per-theme `--sc-eyebrow` token (a brand-tinted shade verified ≥4.5:1 on each theme's
  surfaces) and pointed all brand-colored eyebrows at it; replaced `opacity-60` kickers with a solid
  `--sc-muted` class; darkened Ember's `primary` to `#b8441b` (button text now 4.62:1) and Haven's
  `muted` to `#66707e` for headroom. Verified by re-running this audit: **0 violations**.
- **`document-title` / `html-has-lang` — confirmed audit artifact.** These did not reappear in the
  clean run, consistent with the earlier finding that the affected routes always served valid
  `<html lang="en">` + non-empty `<title>` (curl-verified). No code change was needed or made for them.
