# jshoes-tools

Static tools and artifacts hosted at **[tools.joshuashew.com](https://tools.joshuashew.com)**.

Built and deployed by Claude Sonnet 4.6 in the Claude web interface.

## Tools

| Path | Description |
|------|-------------|
| [`/transcript/`](https://tools.joshuashew.com/transcript/) | MacAskill · 80k Hours — three-section synchronized transcript viewer with speaker attribution |

## Infrastructure

- **Domain:** `tools.joshuashew.com` (Cloudflare-managed, CNAME → `jython1415.github.io` temporarily)
- **Target:** Cloudflare Pages project `jshoes-tools` — pending [claude-ai-skills PR #292](https://github.com/Jython1415/claude-ai-skills/pull/292) which fixes multipart upload through the credential proxy
- **Migration:** Once PR #292 is merged and deployed, run the deploy script below to cut over from GitHub Pages to Cloudflare Pages and update the CNAME

## Adding a new tool

1. Create `your-tool/index.html` in this repo (self-contained HTML, no build step)
2. Add an OG image at `your-tool/social-card.png` (1200×630)
3. Reference `https://tools.joshuashew.com/your-tool/social-card.png` in `og:image`
4. Push to `main` — GitHub Pages auto-deploys (until CF Pages migration)
5. After CF Pages migration: `POST /proxy/cloudflare_pages/accounts/{ACCOUNT_ID}/pages/projects/jshoes-tools/deployments` with multipart form (see cloudflare MODULE.md)

## CF Pages deploy (after PR #292 merges)

```python
import requests, hashlib, json

SESSION = create_session(['cloudflare_pages'])
PROXY   = 'https://proxy.joshuashew.com'
ACCT    = 'a850a77e105ae2c7e7339e8af0e1ec7d'

def deploy_file(path, html_bytes):
    sha = hashlib.sha256(html_bytes).hexdigest()
    manifest = json.dumps({path: sha})
    r = requests.post(
        f'{PROXY}/proxy/cloudflare_pages/accounts/{ACCT}/pages/projects/jshoes-tools/deployments',
        headers={'X-Session-Id': SESSION},
        files={
            'manifest': (None, manifest, 'application/json'),
            sha: (sha, html_bytes, 'application/octet-stream'),
        }
    )
    return r.json()
```

## Repo structure

```
jshoes-tools/
├── transcript/
│   └── index.html          # MacAskill transcript viewer
├── social-card.png         # OG image for the transcript page
└── README.md
```
