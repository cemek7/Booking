# Content and isolation audit

Reviewed: 2026-09-07

- All eight published demonstrators use the `Capability Demonstrator` project type and canonical disclosure.
- Case studies contain designed outcomes and limitations; no `measuredScores` field is available in the schema.
- Local forms use `LeadForm`, which makes no network request.
- Showcase source is quarantined from Booka data-layer imports. The isolation scan was rerun successfully on 2026-09-07.
- `scripts/showcase-screenshots.mjs` captures desktop home/detail/form and mobile home/form for every demonstrator. Forty captures are committed under `public/mockups/`.
- The prior external-font build blocker is resolved through self-hosted fonts. The production build completed on 2026-09-07 and generated all Showcase routes.
- Source imagery remains incomplete for SunGrid Energy, Crestfield Academy, and Atelier Soso; Forge Build currently has one source image. Existing routes do not hotlink imagery.
- Remaining visual verification is non-blocking polish: add the missing source imagery, extend captures to 1280px and 768px, regenerate the screenshots, and manually inspect them for clipping and image failures.
