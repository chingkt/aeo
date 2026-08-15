const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeHtml, normalizeUrl, collectLinks } = require('../server');

test('normalizes a bare domain', () => {
  assert.equal(normalizeUrl('example.com').href, 'https://example.com/');
});

test('rejects localhost', () => {
  assert.throws(() => normalizeUrl('http://localhost:3000'), /Local network/);
});

test('rejects private, credentialed, and non-standard-port targets', () => {
  assert.throws(() => normalizeUrl('http://169.254.169.254/latest/meta-data'), /Local network/);
  assert.throws(() => normalizeUrl('https://user:pass@example.com'), /credentials/);
  assert.throws(() => normalizeUrl('https://example.com:8443'), /standard web ports/);
});

test('deduplicates and resolves links', () => {
  const links = collectLinks('<a href="/one">One</a><a href="/one">Again</a><a href="https://other.test/two">Two</a>', new URL('https://example.com'));
  assert.deepEqual(links.map((link) => link.href), ['https://example.com/one', 'https://other.test/two']);
});

test('builds a four-pillar report from HTML evidence', () => {
  const html = `<!doctype html><html lang="en"><head><title>A useful and descriptive test page</title><meta name="description" content="Summary"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script></head><body><main><article><h1>Primary subject</h1><h2>What is the evidence?</h2><p>${'useful evidence '.repeat(200)}</p><img src="x" alt="Example"></article></main></body></html>`;
  const result = analyzeHtml(html, new URL('https://example.com'), 400, [], { ok: true }, { ok: true });
  assert.equal(result.pillars.length, 4);
  assert.equal(result.pillars.every((pillar) => pillar.checks.reduce((sum, check) => sum + check.max, 0) === 100), true);
  assert.equal(result.metrics.schemas, 1);
  assert.equal(result.coverage.pagesScanned, 1);
  assert.match(result.methodology, /equally weighted/);
  assert.equal(result.validations.some((item) => item.name.includes('Lighthouse') && item.status === 'Not run'), true);
  assert.equal(result.aiBots.every((bot) => bot.status === 'unknown'), true);
});
