const test = require('node:test');
const assert = require('node:assert/strict');

async function getWorker() {
  return (await import('../src/worker.mjs')).default;
}

const env = {
  ASSETS: {
    fetch: async () => new Response('asset', { headers: { 'content-type': 'text/plain' } })
  }
};

test('redirects the bare /aeo path to its canonical trailing-slash URL', async () => {
  const worker = await getWorker();
  const response = await worker.fetch(new Request('https://tangchingkei.com/aeo'), env);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://tangchingkei.com/aeo/');
});

test('rejects non-POST requests to the analyzer endpoint', async () => {
  const worker = await getWorker();
  const response = await worker.fetch(new Request('https://tangchingkei.com/aeo/api/analyze'), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

test('validates analyzer request input before scanning', async () => {
  const worker = await getWorker();
  const response = await worker.fetch(new Request('https://tangchingkei.com/aeo/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  }), env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Enter a website URL/);
});

test('serves assets through the binding with security headers', async () => {
  const worker = await getWorker();
  const response = await worker.fetch(new Request('https://tangchingkei.com/aeo/styles.css'), env);
  assert.equal(await response.text(), 'asset');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
