# jshoes-tools

The site behind **[joshuashew.com](https://joshuashew.com)** (and its mirror at
[tools.joshuashew.com](https://tools.joshuashew.com)).

## Contents

| Path | Description |
|------|-------------|
| [`/`](https://joshuashew.com/) | Site index |
| [`/artifacts/`](https://joshuashew.com/artifacts/) | Index of pages written by Claude |
| [`/artifacts/allston/`](https://joshuashew.com/artifacts/allston/) | The Allston Strata — a layered history of Allston, Massachusetts |
| [`/artifacts/transcript/`](https://joshuashew.com/artifacts/transcript/) | MacAskill / 80,000 Hours — synchronized transcript viewer (moved from `/transcript/`, which 301s here via `_redirects`) |
| [`/tools/`](https://joshuashew.com/tools/) | Index of interactive pages and viewers |
| [`/margin/`](https://joshuashew.com/margin/) | Margin annotations on a web page, read live from the author's AT Protocol repo |
| [`/games/`](https://joshuashew.com/games/) | Index of browser games |
| [`/games/neon-grade/`](https://joshuashew.com/games/neon-grade/) | Neon Grade — endless downhill ball game in the style of Slope 3; scores post to Bluesky as `com.joshuashew.games.score` records |
| `/games/client-metadata.json` | Not a page: the AT Protocol OAuth client metadata for Bluesky sign-in in the games. Its `client_id` is its own URL; add each game's page to `redirect_uris` |

## Infrastructure

- **Domains:** `joshuashew.com`, `www.joshuashew.com` and `tools.joshuashew.com`, all
  custom domains on the same Cloudflare Pages project, so all three serve identical content
- **Hosting:** Cloudflare Pages project `jshoes-tools`, git integration on this repo
- **Build:** none. No build command and no output directory; CF Pages serves the repo root
- **Deploy:** push to `main`, auto-deploys in roughly ten seconds

## Navigation

Every public page carries the same site bar as the first thing in `<body>`, styled by
the shared `/site-bar.css`:

```html
<link rel="stylesheet" href="/site-bar.css">   <!-- in <head> -->
<header class="site-bar" style="--sb-max:720px;--sb-pad:1.4rem"><nav aria-label="Site"><a class="sb-home" href="/">joshuashew.com</a><a href="/tools/">Tools</a><a href="/artifacts/">Artifacts</a><a href="/games/">Games</a></nav></header>
```

- The bar links to **sections**, not pages, so adding a page never touches the bar on
  other pages. A new page gets a card on its section's index (`/artifacts/`, `/tools/` or `/games/`)
  and on the home page.
- Mark the current section with `aria-current="page"` on its link (on the home page,
  on `joshuashew.com`).
- Set `--sb-max` and `--sb-pad` to the page's own column width and side padding so the
  bar lines up with the content. A page that is always dark adds `data-sb-theme="dark"`.
- The bar is not sticky, so it never fights a page's own sticky elements.
- Unlisted pages stay off the bar and the indexes: `/forward-codes/` (noindex),
  `/kit/` (files for the Kit app) and `/s/*` share links.

## Adding a page

1. Create `your-page/index.html` — self-contained HTML, CSS and JS inline, no build step
2. Add `your-page/social-card.png` (1200x630) if it should link-preview
3. Point `og:image` at `https://joshuashew.com/your-page/social-card.png`
4. Add an inline SVG favicon via `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,...">`
5. Add the site bar (see Navigation above)
6. Push to `main`, then add a row to the table above and a card to the relevant index and the home page

Pages written by Claude go under `/artifacts/` so the provenance is legible from the URL.

## Repo structure

```
jshoes-tools/
├── index.html              # site root
├── site-bar.css            # shared navigation bar (see Navigation)
├── avatar-photo.jpg        # home-page avatars: headshot and penguin (EXIF stripped)
├── avatar-penguin.png
├── _redirects              # old /transcript/ links → /artifacts/transcript/
├── 404.html
├── artifacts/
│   ├── index.html          # index of Claude-written pages
│   └── allston/
│       ├── index.html      # The Allston Strata
│       └── social-card.png
│   └── transcript/
│       └── index.html      # MacAskill transcript viewer
├── tools/
│   └── index.html          # index of interactive pages
├── margin/
│   └── index.html          # Margin annotations viewer (backed by functions/)
├── games/
│   ├── index.html          # index of games
│   ├── client-metadata.json  # Bluesky (AT Protocol) OAuth client for the games
│   └── neon-grade/
│       ├── index.html      # page, menu, leaderboard and results screens
│       ├── sim.js          # deterministic physics and track generator (no rendering)
│       ├── game.js         # Three.js renderer, audio, input, game flow
│       ├── atp.js          # Bluesky sign-in, posting scores, reading the leaderboard
│       └── social-card.png
├── functions/              # Cloudflare Pages Functions for /margin/
├── social-card.png         # OG image for the transcript page (kept at the root; the page links it by absolute URL)
└── README.md
```

## Authorship

Pages under `/artifacts/` are written by Claude and are labelled on the page itself
with the model that produced them, alongside the verbatim prompt. `/artifacts/allston/`
was researched and written by Claude Opus 5. `/artifacts/transcript/` was built by Claude Sonnet 4.6.
`/games/neon-grade/` was built by Claude.
