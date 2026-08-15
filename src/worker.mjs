import scanner from '../server.js';

const { analyze } = scanner;
const API_PATH = '/aeo/api/analyze';
const MAX_REQUEST_BYTES = 10_000;

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extraHeaders
    }
  });
}

async function handleAnalyze(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_REQUEST_BYTES) return json(413, { error: 'Request is too large.' });

  let raw;
  try {
    raw = await request.text();
  } catch {
    return json(400, { error: 'The request body could not be read.' });
  }
  if (raw.length > MAX_REQUEST_BYTES) return json(413, { error: 'Request is too large.' });

  try {
    const { url } = JSON.parse(raw || '{}');
    if (!url || typeof url !== 'string') return json(400, { error: 'Enter a website URL to begin.' });
    return json(200, await analyze(url.trim()));
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'The website took too long to respond.' : error?.message;
    return json(422, { error: message || 'The website could not be analyzed.' });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/aeo') {
      return Response.redirect(`${url.origin}/aeo/`, 308);
    }

    if (url.pathname === API_PATH) {
      if (request.method !== 'POST') {
        return json(405, { error: 'Method not allowed.' }, { allow: 'POST' });
      }
      return handleAnalyze(request);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(405, { error: 'Method not allowed.' }, { allow: 'GET, HEAD' });
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
