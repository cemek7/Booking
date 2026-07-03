# Legal → PDF export

Generates `Boka-Legal-Policies-DRAFT.pdf` (all 10 legal/policy pages, consolidated) for counsel review.

## Regenerate (e.g. after filling `src/lib/legal/constants.ts`)
```bash
pip install --break-system-packages reportlab pypdf   # one-time
node scripts/legal-pdf/extract-legal.mjs               # -> /tmp/legal.json
python3 scripts/legal-pdf/render-legal.py              # -> repo-root PDF
```
Source of truth = the `.tsx` pages under `src/app/*/page.tsx` + `src/lib/legal/constants.ts`.
The PDF itself is a build artifact (not committed).
