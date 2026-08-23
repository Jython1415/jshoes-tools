# jshoes-tools

Static pages and artifacts hosted at **[tools.joshuashew.com](https://tools.joshuashew.com)**.

## Contents

| Path | Description |
|------|-------------|
| [`/transcript/`](https://tools.joshuashew.com/transcript/) | MacAskill / 80k Hours — three-section synchronized transcript viewer with speaker attribution |
| [`/allston/`](https://tools.joshuashew.com/allston/) | The Allston Strata — a layered history of Allston, Massachusetts, with the failed proposals and the contested dates |

## Infrastructure

- **Domain:** `tools.joshuashew.com` — Cloudflare-proxied CNAME to `jshoes-tools.pages.dev`
- **Hosting:** Cloudflare Pages project `jshoes-tools`, git integration on this repo
- **Build:** none. No build command and no output directory; CF Pages serves the repo root
- **Deploy:** push to `main`, auto-deploys in roughly ten seconds

## Adding a page

1. Create `your-page/index.html` — self-contained HTML, CSS and JS inline, no build step
2. Add `your-page/social-card.png` (1200x630) if it should link-preview
3. Point `og:image` at `https://tools.joshuashew.com/your-page/social-card.png`
4. Add an inline SVG favicon via `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,...">`
5. Push to `main`, then add a row to the table above

## Repo structure

```
jshoes-tools/
├── transcript/
│   └── index.html          # MacAskill transcript viewer
├── allston/
│   ├── index.html          # The Allston Strata
│   └── social-card.png     # OG image for the Allston page
├── social-card.png         # OG image for the transcript page
└── README.md
```

## Authorship

Pages here are written by Claude and are labelled on the page itself with the model that produced them, alongside the prompt that was used. `/transcript/` was built by Claude Sonnet 4.6; `/allston/` was researched and written by Claude Opus 5.
