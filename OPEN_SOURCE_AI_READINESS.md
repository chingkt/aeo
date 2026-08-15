# Open-Source AI Readiness (AEO) Packaging

> English translation of “1.3 Open-Source AI Readiness (AEO) Packaging.”

## 1. Strategy Name and Core Concept

The core of this strategy is to combine several **free, dual-licensed, open-source command-line tools** into a proprietary **AI Readiness scoring dashboard**.

The analysis is then packaged as a professional **Answer Engine Optimization (AEO) audit report** and sold to enterprise marketing teams.

## 2. The Underlying Market Inefficiency

Large language models (LLMs) and AI search engines actively downweight the credibility of websites with:

- Large numbers of 404 or broken links
- Incorrectly formatted structured data
- Poor accessibility
- Other technical issues that indicate inadequate site maintenance

These issues suggest that a website has:

- Poor content freshness
- Low-quality site management
- Weak integrity as an information source

Many free and open-source tools can already detect these issues, but most marketing teams do not know how to use them. For example, they may not know Node.js, Rust command-line tools, or command-line interfaces in general.

This creates a significant **information-arbitrage opportunity**. Someone who is willing to run these free tools for a company and package the results into a polished, easy-to-understand AI Readiness report can sell a high-value AEO audit service.

### Open-Source Tools Mentioned

| Tool | Primary purpose | License |
| --- | --- | --- |
| Lychee | Rust-based broken-link checker for websites | Apache-2.0 / MIT |
| Pa11y | Command-line accessibility testing, using axe-core internally | LGPL-3.0-only |
| axe-core | Accessibility rules engine | MPL-2.0 |
| Schema-dts | TypeScript definitions for JSON-LD structured data | Apache-2.0 |

## 3. Step-by-Step Execution Blueprint

### Build a local scanning pipeline

1. Use **Lychee** to check the site for broken links.
2. Use **Pa11y** to test website accessibility.
3. Use **Google Lighthouse** to collect performance and technical metrics.
4. Build a script that combines the JSON output from all of these command-line tools.
5. Normalize the results into an overall **AI Readiness Score**.

The score can include:

- **Topical Authority** — how clearly and credibly the site demonstrates subject expertise
- **Heading Clarity** — how well headings organize and describe the content
- **Technical Health** — the health of links, metadata, performance, accessibility, and other technical foundations
- **AI Crawling Readiness** — how easily AI crawlers can access, parse, and understand the site

### Package the findings

Turn the analysis into a well-designed PDF report that clearly identifies the factors preventing AI crawlers from understanding the site.

For example, dead outbound citation links may reduce authority signals similar to PageRank.

### Commercialize the audit

1. Identify content-heavy B2B websites.
2. Send a short, free preview that highlights one or two serious issues.
3. Sell the complete **AI Readiness Audit** and a full **remediation roadmap**.

The suggested price for the report is **US$2,500–US$5,000**.

## Prototype Product Interpretation

The accompanying prototype turns this blueprint into a link-first web experience:

1. A user submits a public website URL.
2. The scanner fetches the homepage and a small sample of same-domain pages.
3. It evaluates four report pillars: Topical Authority, Heading Clarity, Technical Health, and AI Crawling Readiness.
4. It presents an overall score, supporting evidence, prioritized issues, and a remediation roadmap.

This prototype uses lightweight native checks to demonstrate the workflow. A production implementation should replace or supplement these checks with Lychee, Pa11y/axe-core, Lighthouse, structured-data validation, robots.txt inspection, sitemap analysis, content freshness analysis, and a controlled crawler.
