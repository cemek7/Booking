# Self-hosted brand fonts

These woff2 files are the **latin-subset, variable-weight** cuts of the brand
typefaces, committed to the repo so `next build` never has to reach Google Fonts
at build time (that external fetch previously made builds fail on any network
hiccup).

| File | Family | Axis / weight range | Used as |
|------|--------|---------------------|---------|
| `Mulish-latin-var.woff2` | Mulish | `wght 200..1000` (variable) | `--font-booka-sans-loaded` (body/sans) |
| `Fraunces-latin-var.woff2` | Fraunces | `wght 400..700` (variable) | `--font-booka-display-loaded` (display) |

Wired up via `next/font/local` in `src/app/layout.tsx`.

## Refreshing / adding subsets

Both are pulled from Google Fonts' `fonts.gstatic.com` latin cut (the block whose
`unicode-range` starts `U+0000-00FF`). To refresh or add a subset (e.g. `latin-ext`):

```
# get the CSS with a browser UA, then download the woff2 for the wanted subset
curl -A "<browser UA>" "https://fonts.googleapis.com/css2?family=Mulish:wght@200..1000&display=swap"
curl -A "<browser UA>" "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&display=swap"
```

Both fonts are licensed under the SIL Open Font License 1.1.
