# jshoes-tools

The site behind **[joshuashew.com](https://joshuashew.com)** (and its mirror at
[tools.joshuashew.com](https://tools.joshuashew.com)).

## Contents

| Path | Description |
|------|-------------|
| [`/`](https://joshuashew.com/) | Site index |
| [`/artifacts/`](https://joshuashew.com/artifacts/) | Index of pages written by Claude |
| [`/artifacts/allston/`](https://joshuashew.com/artifacts/allston/) | The Allston Strata — a layered history of Allston, Massachusetts |
| [`/transcript/`](https://joshuashew.com/transcript/) | MacAskill / 80,000 Hours — synchronized transcript viewer |

## Infrastructure

- **Domains:** `joshuashew.com`, `www.joshuashew.com` and `tools.joshuashew.com`, all
  custom domains on the same Cloudflare Pages project, so all three serve identical content
- **Hosting:** Cloudflare Pages project `jshoes-tools`, git integration on this repo
- **Build:** none. No build command and no output directory; CF Pages serves the repo root
- **Deploy:** push to `main`, auto-deploys in roughly ten seconds

## Adding a page

1. Create `your-page/index.html` — self-contained HTML, CSS and JS inline, no build step
2. Add `your-page/social-card.png` (1200x630) if it should link-preview
3. Point `og:image` at `https://joshuashew.com/your-page/social-card.png`
4. Add an inline SVG favicon via `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,...">`
5. Push to `main`, then add a row to the table above and a card to the relevant index

Pages written by Claude go under `/artifacts/` so the provenance is legible from the URL.

## Repo structure

```
jshoes-tools/
├── index.html              # site root
├── artifacts/
│   ├── index.html          # index of Claude-written pages
│   └── allston/
│       ├── index.html      # The Allston Strata
│       └── social-card.png
├── transcript/
│   └── index.html          # MacAskill transcript viewer
├── social-card.png         # OG image for the transcript page
└── README.md
```

## Authorship

Pages under `/artifacts/` are written by Claude and are labelled on the page itself
with the model that produced them, alongside the verbatim prompt. `/artifacts/allston/`
was researched and written by Claude Opus 5. `/transcript/` was built by Claude Sonnet 4.6.
