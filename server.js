const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = typeof __dirname === 'string' ? path.join(__dirname, 'public') : '';
const MAX_HTML_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function normalizeUrl(input) {
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Enter a valid public website URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links are supported.');
  if (url.username || url.password) throw new Error('URLs containing credentials cannot be scanned.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  const privateIpv4 = ipv4 && (
    ipv4.some((part) => part > 255) || ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 ||
    (ipv4[0] === 169 && ipv4[1] === 254) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
    (ipv4[0] === 192 && ipv4[1] === 168) || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127) ||
    ipv4[0] >= 224
  );
  const privateIpv6 = hostname === '::' || hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb');
  const privateName = hostname === 'localhost' || ['.localhost', '.local', '.internal', '.lan', '.home'].some((suffix) => hostname.endsWith(suffix));
  if (privateIpv4 || privateIpv6 || privateName) {
    throw new Error('Local network addresses cannot be scanned.');
  }
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Only standard web ports can be scanned.');
  url.hash = '';
  return url;
}

async function readLimitedText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error('The website response is too large to scan safely.');
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = performance.now();
  try {
    let currentUrl = normalizeUrl(url.href || String(url));
    let response;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'SignalReady-AEO-Prototype/1.0 (+public audit)' },
        ...options
      });
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
      if (redirectCount === MAX_REDIRECTS) throw new Error('The website redirected too many times.');
      currentUrl = normalizeUrl(new URL(location, currentUrl).href);
    }
    const type = response.headers.get('content-type') || '';
    let body = '';
    if (type.includes('text') || type.includes('html') || type.includes('json') || !type) {
      body = await readLimitedText(response);
    }
    return { response, body, elapsed: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

const matchCount = (text, regex) => [...text.matchAll(regex)].length;
const stripTags = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
const has = (html, regex) => regex.test(html);
const cap = (value) => Math.max(0, Math.min(100, Math.round(value)));

function getTitle(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g, ' ').trim() || '';
}

function getMeta(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find((item) => new RegExp(`(?:name|property)=["']${name}["']`, 'i').test(item));
  return tag?.match(/content=["']([^"']*)["']/i)?.[1]?.trim() || '';
}

function collectLinks(html, base) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    try {
      const url = new URL(match[1], base);
      if (['http:', 'https:'].includes(url.protocol)) links.push(url);
    } catch {}
  }
  return [...new Map(links.map((url) => [url.href, url])).values()];
}

function schemaTypes(html) {
  const types = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node['@type']) types.push(...(Array.isArray(node['@type']) ? node['@type'] : [node['@type']]));
        Object.values(node).forEach((child) => typeof child === 'object' && visit(child));
      };
      visit(value);
    } catch { types.push('Invalid JSON-LD'); }
  }
  return [...new Set(types.map(String))];
}

function pageFacts(html, url, elapsed = 0) {
  const text = stripTags(html);
  const headingMatches = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const headingLevels = headingMatches.map((match) => Number(match[1]));
  const headingText = headingMatches.map((match) => stripTags(match[2]));
  const schemas = schemaTypes(html);
  const images = matchCount(html, /<img\b[^>]*>/gi);
  const imagesWithAlt = matchCount(html, /<img\b(?=[^>]*\balt=["'][^"']*["'])[^>]*>/gi);
  const links = collectLinks(html, url);
  return {
    url: url.href,
    title: getTitle(html),
    description: getMeta(html, 'description'),
    words: text ? text.split(/\s+/).length : 0,
    h1: headingLevels.filter((level) => level === 1).length,
    headings: headingLevels.length,
    headingSkip: headingLevels.some((level, index) => index && level > headingLevels[index - 1] + 1),
    questionHeadings: headingText.filter((value) => /\?|^(how|what|why|when|where|who|can|does|is|are)\b/i.test(value)).length,
    images,
    missingAlt: images - imagesWithAlt,
    schemas,
    invalidSchema: schemas.includes('Invalid JSON-LD'),
    canonical: has(html, /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i),
    lang: has(html, /<html\b[^>]*\blang=["'][^"']+["']/i),
    main: has(html, /<main\b/i),
    article: has(html, /<article\b/i),
    viewport: has(html, /<meta\b[^>]*name=["']viewport["']/i),
    author: has(html, /(?:rel=["']author["']|name=["']author["']|class=["'][^"']*author)/i),
    dated: has(html, /<time\b|datePublished|dateModified/i),
    directAnswer: has(html, /<(?:p|dd)[^>]*>\s*[^<]{80,360}<\/(?:p|dd)>/i),
    externalLinks: links.filter((link) => link.hostname !== url.hostname).length,
    elapsed
  };
}

function crawlerAccess(robotsText, bot) {
  if (!robotsText) return 'unknown';
  const groups = robotsText.split(/\n\s*\n/).map((group) => group.toLowerCase());
  const specific = groups.find((group) => group.split('\n').some((line) => line.trim() === `user-agent: ${bot.toLowerCase()}`));
  const wildcard = groups.find((group) => group.split('\n').some((line) => line.trim() === 'user-agent: *'));
  const rules = specific || wildcard || '';
  return /^\s*disallow:\s*\/\s*$/im.test(rules) ? 'blocked' : 'allowed';
}

const ratio = (pages, predicate) => pages.length ? pages.filter(predicate).length / pages.length : 0;
const points = (label, earned, max, evidence) => ({ label, earned: Math.round(earned), max, evidence });

function buildReport(pages, rootUrl, linkResults, robots, sitemap) {
  const count = pages.length;
  const totalWords = pages.reduce((sum, page) => sum + page.words, 0);
  const totalHeadings = pages.reduce((sum, page) => sum + page.headings, 0);
  const schemaSet = [...new Set(pages.flatMap((page) => page.schemas))];
  const brokenLinks = linkResults.filter((item) => item.status >= 400 || item.error);
  const avgResponse = Math.round(pages.reduce((sum, page) => sum + page.elapsed, 0) / count);
  const aiBots = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'Google-Extended', 'PerplexityBot'].map((name) => ({ name, status: robots.ok ? crawlerAccess(robots.body, name) : 'unknown' }));
  const allowedBots = aiBots.filter((bot) => bot.status === 'allowed').length;

  const scoring = {
    authority: [
      points('Content depth', Math.min(35, totalWords / count / 17), 35, `${Math.round(totalWords / count)} average words per page`),
      points('Answer-led headings', Math.min(15, pages.reduce((sum, p) => sum + p.questionHeadings, 0) * 4), 15, `${pages.reduce((sum, p) => sum + p.questionHeadings, 0)} question-oriented headings`),
      points('Outbound citations', Math.min(15, pages.reduce((sum, p) => sum + p.externalLinks, 0) * 1.5), 15, `${pages.reduce((sum, p) => sum + p.externalLinks, 0)} external links observed`),
      points('Authorship and freshness', ratio(pages, (p) => p.author && p.dated) * 15, 15, `${pages.filter((p) => p.author && p.dated).length}/${count} pages show authorship and date signals`),
      points('Structured entities', ratio(pages, (p) => p.schemas.length && !p.invalidSchema) * 20, 20, `${pages.filter((p) => p.schemas.length && !p.invalidSchema).length}/${count} pages contain parseable JSON-LD`)
    ],
    headings: [
      points('Single primary H1', ratio(pages, (p) => p.h1 === 1) * 40, 40, `${pages.filter((p) => p.h1 === 1).length}/${count} pages have exactly one H1`),
      points('Logical hierarchy', ratio(pages, (p) => !p.headingSkip) * 25, 25, `${pages.filter((p) => !p.headingSkip).length}/${count} pages avoid heading-level skips`),
      points('Descriptive structure', Math.min(20, totalHeadings / count * 3), 20, `${Math.round(totalHeadings / count)} headings per page on average`),
      points('Title clarity', ratio(pages, (p) => p.title.length >= 20 && p.title.length <= 70) * 15, 15, `${pages.filter((p) => p.title.length >= 20 && p.title.length <= 70).length}/${count} titles are 20–70 characters`)
    ],
    technical: [
      points('Responsive delivery', avgResponse <= 500 ? 20 : avgResponse <= 1200 ? 14 : avgResponse <= 2500 ? 8 : 2, 20, `${avgResponse} ms average HTML response`),
      points('Link integrity', linkResults.length ? (1 - brokenLinks.length / linkResults.length) * 25 : 12, 25, `${brokenLinks.length}/${linkResults.length} sampled links failed`),
      points('Page metadata', ratio(pages, (p) => p.description) * 20, 20, `${pages.filter((p) => p.description).length}/${count} pages include descriptions`),
      points('Image alternatives', pages.reduce((sum, p) => sum + p.images, 0) ? (1 - pages.reduce((sum, p) => sum + p.missingAlt, 0) / pages.reduce((sum, p) => sum + p.images, 0)) * 15 : 15, 15, `${pages.reduce((sum, p) => sum + p.missingAlt, 0)} images lack alt attributes`),
      points('Document basics', (ratio(pages, (p) => p.lang) + ratio(pages, (p) => p.viewport)) * 10, 20, 'Language and viewport declarations')
    ],
    crawling: [
      points('robots.txt', robots.ok ? 20 : 0, 20, robots.ok ? `Available (HTTP ${robots.status})` : 'Not available at /robots.txt'),
      points('Named AI crawler access', robots.ok ? allowedBots / aiBots.length * 20 : 10, 20, `${allowedBots}/${aiBots.length} tested user agents appear allowed`),
      points('XML sitemap', sitemap.ok ? 20 : 0, 20, sitemap.ok ? 'Available at /sitemap.xml' : 'Not available at /sitemap.xml'),
      points('Canonical coverage', ratio(pages, (p) => p.canonical) * 15, 15, `${pages.filter((p) => p.canonical).length}/${count} pages declare canonicals`),
      points('Schema coverage', ratio(pages, (p) => p.schemas.length) * 15, 15, `${pages.filter((p) => p.schemas.length).length}/${count} pages include JSON-LD`),
      points('Semantic main content', ratio(pages, (p) => p.main) * 10, 10, `${pages.filter((p) => p.main).length}/${count} pages expose a main landmark`)
    ]
  };

  const pillarMeta = [
    ['authority', 'Topical authority'], ['headings', 'Heading clarity'], ['technical', 'Technical health'], ['crawling', 'AI crawling readiness']
  ];
  const pillars = pillarMeta.map(([key, label]) => ({ key, label, score: cap(scoring[key].reduce((sum, check) => sum + check.earned, 0)), note: scoring[key][0].evidence, checks: scoring[key] }));
  const overall = cap(pillars.reduce((sum, pillar) => sum + pillar.score, 0) / pillars.length);
  const pageUrls = (predicate) => pages.filter(predicate).map((p) => p.url);
  const findings = [];
  const add = (condition, item) => condition && findings.push({ confidence: 'High', ...item });
  const missingH1 = pageUrls((p) => p.h1 !== 1);
  add(missingH1.length, { severity: 'high', category: 'Structure', title: 'Primary heading structure is inconsistent', observed: `${missingH1.length} of ${count} scanned pages do not have exactly one H1.`, impact: 'Ambiguous page hierarchy can make the primary subject harder for parsers and assistive technology to identify.', action: 'Use one descriptive H1 per indexable page and keep subsequent headings in a logical hierarchy.', evidence: missingH1.slice(0, 3).map((url) => ({ url, detail: 'H1 count is not exactly one' })), affected: `${missingH1.length}/${count} pages`, scoreImpact: 'Up to 40 heading points', effort: 'Small', owner: 'Content / Frontend', phase: 'Now' });
  const noSchema = pageUrls((p) => !p.schemas.length || p.invalidSchema);
  add(noSchema.length, { severity: 'high', category: 'Entities', title: 'Structured entity coverage is incomplete', observed: `${noSchema.length} of ${count} scanned pages have no parseable JSON-LD. Types found: ${schemaSet.join(', ') || 'none'}.`, impact: 'Entity, publisher, and content-type relationships must be inferred from unstructured markup.', action: 'Add valid Organization schema globally and appropriate page-level types; validate output against visible content.', evidence: noSchema.slice(0, 3).map((url) => ({ url, detail: 'No parseable JSON-LD block detected' })), affected: `${noSchema.length}/${count} pages`, scoreImpact: 'Up to 35 points across two pillars', effort: 'Medium', owner: 'SEO / Engineering', phase: '30 days' });
  const noCanonical = pageUrls((p) => !p.canonical);
  add(noCanonical.length, { severity: 'medium', category: 'Crawling', title: 'Canonical coverage is incomplete', observed: `${noCanonical.length} of ${count} pages do not declare a canonical URL.`, impact: 'Search systems may have less explicit guidance for consolidating duplicate URL signals.', action: 'Add an absolute, self-referencing canonical to every canonical indexable page.', evidence: noCanonical.slice(0, 3).map((url) => ({ url, detail: 'Canonical link element not detected' })), affected: `${noCanonical.length}/${count} pages`, scoreImpact: 'Up to 15 crawl points', effort: 'Small', owner: 'Engineering', phase: '1–2 weeks' });
  const noDescriptions = pageUrls((p) => !p.description);
  add(noDescriptions.length, { severity: 'medium', category: 'Metadata', title: 'Page summaries are missing', observed: `${noDescriptions.length} of ${count} pages have no meta description.`, impact: 'Publisher-controlled summaries are unavailable to search and downstream preview systems.', action: 'Write a unique, factual summary for each important template and page.', evidence: noDescriptions.slice(0, 3).map((url) => ({ url, detail: 'Meta description not detected' })), affected: `${noDescriptions.length}/${count} pages`, scoreImpact: 'Up to 20 technical points', effort: 'Small', owner: 'Content / SEO', phase: '1–2 weeks' });
  add(brokenLinks.length, { severity: 'high', category: 'Integrity', title: 'Sampled links returned errors', observed: `${brokenLinks.length} of ${linkResults.length} sampled links failed or returned HTTP 4xx/5xx.`, impact: 'Broken navigation or citations reduce user trust and can interrupt crawler discovery.', action: 'Repair, redirect, or replace each failing URL, prioritizing citations and primary navigation.', evidence: brokenLinks.slice(0, 4).map((link) => ({ url: link.url, detail: link.error || `HTTP ${link.status}` })), affected: `${brokenLinks.length}/${linkResults.length} links`, scoreImpact: 'Up to 25 technical points', effort: 'Small', owner: 'Web operations', phase: 'Now' });
  const missingAlt = pages.reduce((sum, p) => sum + p.missingAlt, 0);
  add(missingAlt, { severity: 'high', category: 'Accessibility', title: 'Images lack text alternatives', observed: `${missingAlt} images across the scanned pages have no alt attribute.`, impact: 'Meaningful images become less accessible and carry less machine-readable context.', action: 'Add contextual alt text to meaningful images and empty alt attributes to decorative images.', evidence: pageUrls((p) => p.missingAlt).slice(0, 3).map((url) => ({ url, detail: 'One or more image elements lack alt attributes' })), affected: `${missingAlt} images`, scoreImpact: 'Up to 15 technical points', effort: 'Medium', owner: 'Content / Frontend', phase: '30 days' });
  add(!robots.ok, { severity: 'medium', category: 'Crawling', title: 'Crawler policy could not be verified', observed: 'No accessible robots.txt was found at the conventional root location.', impact: 'The site does not provide a centralized, auditable crawler policy at the expected URL.', action: 'Publish robots.txt and explicitly review policies for search, retrieval, and training user agents.', evidence: [{ url: new URL('/robots.txt', rootUrl).href, detail: `HTTP ${robots.status || 'request failed'}` }], affected: 'Site-wide', scoreImpact: '20 crawl points', effort: 'Small', owner: 'SEO / Engineering', phase: 'Now' });
  add(!sitemap.ok, { severity: 'medium', category: 'Discovery', title: 'Sitemap discovery could not be verified', observed: 'No accessible XML sitemap was found at /sitemap.xml.', impact: 'Discovery and freshness metadata are less explicit without a machine-readable URL inventory.', action: 'Publish an XML sitemap containing canonical indexable URLs and accurate last-modified dates; reference it from robots.txt.', evidence: [{ url: new URL('/sitemap.xml', rootUrl).href, detail: `HTTP ${sitemap.status || 'request failed'}` }], affected: 'Site-wide', scoreImpact: '20 crawl points', effort: 'Small', owner: 'SEO / Engineering', phase: '1–2 weeks' });
  const blockedBots = aiBots.filter((bot) => bot.status === 'blocked');
  add(blockedBots.length, { severity: 'medium', category: 'AI access', title: 'Named AI user agents appear blocked', observed: `${blockedBots.map((bot) => bot.name).join(', ')} ${blockedBots.length === 1 ? 'is' : 'are'} disallowed at the root.`, impact: 'Those specific services may be unable to retrieve public pages; training and search retrieval policies should be decided separately.', action: 'Confirm the intended policy with legal and marketing stakeholders, then document explicit rules per user agent.', evidence: blockedBots.map((bot) => ({ url: new URL('/robots.txt', rootUrl).href, detail: `${bot.name}: blocked by detected rule` })), affected: `${blockedBots.length}/${aiBots.length} tested agents`, scoreImpact: 'Up to 20 crawl points', effort: 'Small', owner: 'Legal / SEO', phase: 'Now' });
  const weakAnswerPages = pageUrls((p) => !p.directAnswer || p.words < 250);
  add(weakAnswerPages.length, { severity: 'medium', category: 'Content', title: 'Answer-ready content signals are limited', observed: `${weakAnswerPages.length} of ${count} pages have limited copy or no concise paragraph-sized answer detected.`, impact: 'Important answers may be difficult to extract without additional context. This is a heuristic, not a ranking diagnosis.', action: 'Lead key sections with concise factual answers, then support them with expertise, examples, and primary evidence.', evidence: weakAnswerPages.slice(0, 3).map((url) => ({ url, detail: 'Content-depth or concise-answer heuristic not met' })), affected: `${weakAnswerPages.length}/${count} pages`, scoreImpact: 'Up to 35 authority points', effort: 'Large', owner: 'Content / Subject experts', phase: '60–90 days', confidence: 'Medium' });

  const severityRank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const strengths = [
    ratio(pages, (p) => p.h1 === 1) === 1 && 'Every scanned page uses exactly one primary H1',
    ratio(pages, (p) => p.canonical) === 1 && 'Canonical URLs are consistently declared',
    robots.ok && 'A site-level robots.txt policy is available',
    sitemap.ok && 'An XML sitemap is available for discovery',
    !brokenLinks.length && linkResults.length && `All ${linkResults.length} sampled links responded successfully`,
    schemaSet.length && `Structured data types found: ${schemaSet.join(', ')}`
  ].filter(Boolean).slice(0, 5);

  return {
    url: rootUrl.href,
    hostname: rootUrl.hostname.replace(/^www\./, ''),
    scannedAt: new Date().toISOString(),
    title: pages[0].title || rootUrl.hostname,
    overall,
    grade: overall >= 85 ? 'Excellent' : overall >= 70 ? 'Ready with gaps' : overall >= 50 ? 'Needs attention' : 'At risk',
    summary: overall >= 85 ? 'Your sampled pages show a strong foundation. The next opportunity is turning that readiness into consistent, site-wide answer visibility.' : overall >= 70 ? 'You have credible foundations—but a few unresolved gaps may still limit how confidently machines interpret and reuse your expertise.' : overall >= 50 ? 'Your expertise is present, but important technical and structural friction may be making it harder for answer engines to recognize its full value.' : 'The sampled evidence reveals foundational gaps that can leave valuable expertise difficult for answer engines to discover, interpret, and trust.',
    pillars,
    findings: findings.slice(0, 10),
    strengths,
    metrics: { responseMs: avgResponse, words: totalWords, headings: totalHeadings, schemas: schemaSet.length, linksChecked: linkResults.length, brokenLinks: brokenLinks.length },
    coverage: { pagesScanned: count, pagesDiscovered: collectLinks(pages[0].html || '', rootUrl).filter((link) => link.hostname === rootUrl.hostname).length, linksChecked: linkResults.length, pageUrls: pages.map((p) => p.url), note: `Representative sample of ${count} pages; results are not a complete site crawl.` },
    aiBots,
    schemaTypes: schemaSet,
    roadmap: ['Now', '1–2 weeks', '30 days', '60–90 days'].map((phase) => ({ phase, actions: findings.filter((f) => f.phase === phase).map((f) => ({ title: f.title, owner: f.owner, effort: f.effort })) })).filter((group) => group.actions.length),
    validations: [
      { name: 'Native HTML and HTTP checks', status: 'Completed', detail: 'Evidence shown in this report' },
      { name: 'Lighthouse performance', status: 'Not run', detail: 'Requires production worker integration' },
      { name: 'Pa11y / axe-core accessibility', status: 'Not run', detail: 'Native alt checks are not a WCAG audit' },
      { name: 'Schema.org validator', status: 'Partial', detail: 'JSON parsing and types only; semantic validation not run' },
      { name: 'Full Lychee link crawl', status: 'Not run', detail: `${linkResults.length} links sampled with native HTTP requests` }
    ],
    methodology: 'Four equally weighted pillars. Each pillar totals 100 disclosed points; the overall score is their arithmetic mean. Scores describe this sample only and are not issued by a search or AI platform.',
    scope: `${count} representative pages, robots.txt, sitemap.xml, and ${linkResults.length} sampled links`
  };
}

function analyzeHtml(html, url, elapsed, linkResults, robots, sitemap) {
  const page = { ...pageFacts(html, url, elapsed), html };
  return buildReport([page], url, linkResults, { body: '', ...robots }, sitemap);
}

async function analyze(input) {
  const requestedUrl = normalizeUrl(input);
  const main = await fetchText(requestedUrl);
  if (!main.response.ok) throw new Error(`The website returned HTTP ${main.response.status}.`);
  if (!main.body || !main.response.headers.get('content-type')?.includes('html')) throw new Error('The link did not return an HTML page.');
  const rootUrl = new URL(main.response.url);
  const discovered = collectLinks(main.body, rootUrl);
  const internalPages = discovered.filter((link) => link.hostname === rootUrl.hostname && !/\.(?:pdf|jpe?g|png|gif|svg|zip|xml)$/i.test(link.pathname)).slice(0, 4);
  const linkSample = discovered.slice(0, 12);
  const [robotsResult, sitemapResult, pageResults, linkResults] = await Promise.all([
    fetchText(new URL('/robots.txt', rootUrl)).then((r) => ({ ok: r.response.ok, status: r.response.status, body: r.body })).catch(() => ({ ok: false, body: '' })),
    fetchText(new URL('/sitemap.xml', rootUrl)).then((r) => ({ ok: r.response.ok, status: r.response.status })).catch(() => ({ ok: false })),
    Promise.all(internalPages.map((url) => fetchText(url).then((r) => r.response.ok && r.response.headers.get('content-type')?.includes('html') ? { html: r.body, url: new URL(r.response.url), elapsed: r.elapsed } : null).catch(() => null))),
    Promise.all(linkSample.map(async (link) => {
      try {
        let result = await fetchText(link, { method: 'HEAD' });
        if (result.response.status === 405) result = await fetchText(link);
        return { url: link.href, status: result.response.status };
      } catch (error) {
        return { url: link.href, error: error.name };
      }
    }))
  ]);
  const rawPages = [{ html: main.body, url: rootUrl, elapsed: main.elapsed }, ...pageResults.filter(Boolean)];
  const pages = rawPages.map((page) => ({ ...pageFacts(page.html, page.url, page.elapsed), html: page.html }));
  return buildReport(pages, rootUrl, linkResults, robotsResult, sitemapResult);
}

async function handleApi(req, res) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) return json(res, 413, { error: 'Request is too large.' });
  }
  try {
    const { url } = JSON.parse(raw || '{}');
    if (!url || typeof url !== 'string') return json(res, 400, { error: 'Enter a website URL to begin.' });
    json(res, 200, await analyze(url.trim()));
  } catch (error) {
    const message = error.name === 'AbortError' ? 'The website took too long to respond.' : error.message;
    json(res, 422, { error: message || 'The website could not be analyzed.' });
  }
}

async function serveStatic(req, res) {
  if (req.url === '/' || req.url === '/aeo') {
    res.writeHead(302, { location: '/aeo/' });
    return res.end();
  }
  const pathname = req.url.split('?')[0];
  const requested = pathname === '/aeo/' ? '/index.html' : pathname.startsWith('/aeo/') ? pathname.slice(4) : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden' });
  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(file);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && ['/api/analyze', '/aeo/api/analyze'].includes(req.url)) return handleApi(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  json(res, 405, { error: 'Method not allowed' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`SignalReady is running at http://${HOST}:${PORT}`));
}

module.exports = { analyze, analyzeHtml, normalizeUrl, collectLinks };
