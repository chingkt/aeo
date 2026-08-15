# SignalReady

SignalReady is a dependency-free prototype for turning a website link into an AI Readiness / Answer Engine Optimization report.

The experience uses a free diagnostic to demonstrate evidence and frames a paid, expert-led audit as the path from sampled findings to site-wide validation and implementation.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm start
```

Open [http://127.0.0.1:4173/aeo/](http://127.0.0.1:4173/aeo/), enter a public website URL, and select **Analyze my site**.

## Deploy to Cloudflare Workers

The repository is configured to serve the app at `https://tangchingkei.com/aeo/` and the scanner API at `/aeo/api/analyze`.

Cloudflare Workers Builds settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production deploy command | `npx wrangler versions upload` |

Validate without deploying:

```bash
npm ci
npm test
npm run deploy:dry
```

The build copies the browser assets into `dist/aeo`, matching Cloudflare's required subdirectory layout. `wrangler.jsonc` attaches only the exact `/aeo` and `/aeo/*` routes, so other paths on `tangchingkei.com` continue to use the existing site.

Before inviting broad public traffic, configure a Cloudflare rate-limiting rule for `POST /aeo/api/analyze`. The application blocks local/private address literals, credentials, non-standard ports, oversized responses, and unsafe redirects, but rate limiting remains an infrastructure responsibility.

## What the prototype checks

- Homepage plus up to four representative same-domain pages: content depth, headings, title, description, semantic landmarks, and image alt attributes
- JSON-LD, canonical metadata, and Open Graph title metadata
- Availability of `robots.txt` and `sitemap.xml`, including named AI user-agent rules
- Response time and a sample of up to twelve links
- Four synthesized scores: Topical Authority, Heading Clarity, Technical Health, and AI Crawling Readiness
- Auditable findings with observed facts, affected URLs, confidence, score impact, owner, effort, and recommended actions
- Disclosed point-by-point scoring, coverage, remediation roadmap, specialist-validation boundaries, local score history, and a print/PDF report view

The translated source and full product interpretation are in [OPEN_SOURCE_AI_READINESS.md](./OPEN_SOURCE_AI_READINESS.md).

## Prototype boundaries

This version uses lightweight native HTML checks so it runs without installing external packages. It does not claim to reproduce Lighthouse, Lychee, Pa11y, axe-core, or search-engine ranking systems. A production scanner should run those specialist tools in an isolated job environment, crawl representative templates, validate structured data, enforce robust SSRF protection, and retain evidence for each finding.

## Tests

```bash
npm test
```
