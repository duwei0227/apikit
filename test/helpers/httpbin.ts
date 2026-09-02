// Deterministic, offline httpbin mock.
//
// Replaces the previous live `fetch` to https://httpbin.org so the workflow /
// http-request test suites run fast and are not flaky under rate-limiting.
// Mirrors only the subset of httpbin behavior the tests rely on, returning the
// same shape the Rust `send_http_request` command produces.

export const HTTPBIN_BASE_URL = 'https://httpbin.org';

export const httpbinUrl = (path: string) => `${HTTPBIN_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

export const httpbinInvocations: any[] = [];

export const resetHttpbinMock = () => {
  httpbinInvocations.length = 0;
};

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  500: 'Internal Server Error',
};

// httpbin echoes request header names in HTTP "Title-Case" (x-apikit-test -> X-Apikit-Test).
const titleCaseHeader = (key: string) =>
  key
    .split('-')
    .map(part => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join('-');

const echoHeaders = (headers: Record<string, string> = {}) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[titleCaseHeader(k)] = v;
  return out;
};

const parsePairs = (search: string) => {
  const out: Record<string, string> = {};
  for (const pair of search.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? '' : pair.slice(eq + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
};

const findHeader = (headers: Record<string, string> = {}, name: string) => {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
};

interface MockResult {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

const buildResponse = (options: any): MockResult => {
  const method = (options.method || 'GET').toUpperCase();
  const reqHeaders: Record<string, string> = options.headers || {};
  const contentType = findHeader(reqHeaders, 'content-type') || '';
  const fullUrl: string = options.url || '';
  const withoutBase = fullUrl.startsWith(HTTPBIN_BASE_URL) ? fullUrl.slice(HTTPBIN_BASE_URL.length) : fullUrl;
  const qIndex = withoutBase.indexOf('?');
  const path = qIndex === -1 ? withoutBase : withoutBase.slice(0, qIndex);
  const query = qIndex === -1 ? '' : withoutBase.slice(qIndex + 1);
  const args = parsePairs(query);

  // /status/{code} -> that status, empty body
  const statusMatch = path.match(/^\/status\/(\d+)/);
  if (statusMatch) {
    return { status: Number(statusMatch[1]), body: '' };
  }

  // /bearer -> 200 when an Authorization: Bearer header is present
  if (path === '/bearer') {
    const auth = findHeader(reqHeaders, 'authorization') || '';
    if (auth.startsWith('Bearer ')) {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authenticated: true, token: auth.slice('Bearer '.length) }),
      };
    }
    return { status: 401, body: '' };
  }

  // /basic-auth/{user}/{pass} -> 200 when an Authorization: Basic header is present
  const basicMatch = path.match(/^\/basic-auth\/([^/]+)\/([^/]+)/);
  if (basicMatch) {
    const auth = findHeader(reqHeaders, 'authorization') || '';
    if (auth.startsWith('Basic ')) {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authenticated: true, user: decodeURIComponent(basicMatch[1]) }),
      };
    }
    return { status: 401, body: '' };
  }

  // /response-headers -> sets response headers from the query params, echoes them as JSON body
  if (path === '/response-headers') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...args };
    return { status: 200, headers, body: JSON.stringify(args) };
  }

  // /html -> Moby-Dick excerpt (tests assert the body contains "Herman")
  if (path === '/html') {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<!DOCTYPE html><html><body><h1>Herman Melville - Moby-Dick</h1><p>Call me Ishmael.</p></body></html>',
    };
  }

  // /json -> httpbin's sample slideshow (tests assert $.slideshow.title contains "Sample")
  if (path === '/json') {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slideshow: {
          author: 'Yours Truly',
          date: 'date of publication',
          title: 'Sample Slide Show',
          slides: [
            { title: 'Wake up to WonderWidgets!', type: 'all' },
            { title: 'Overview', type: 'all', items: ['Why WonderWidgets are great', 'Who buys WonderWidgets'] },
          ],
        },
      }),
    };
  }

  // Default: httpbin "echo" endpoints (/get, /anything, /post, ...) reflect the request.
  let json: any = null;
  let form: Record<string, string> = {};
  const data = options.body || '';
  if (data) {
    if (contentType.includes('application/json')) {
      try {
        json = JSON.parse(data);
      } catch {
        json = null;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      form = parsePairs(data);
    }
  }

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method,
      args,
      headers: echoHeaders(reqHeaders),
      url: fullUrl,
      data,
      json,
      form,
      origin: '127.0.0.1',
    }),
  };
};

export const handleTauriInvoke = async (command: string, payload: any) => {
  if (command === 'cancel_http_request') {
    return true;
  }

  if (command !== 'send_http_request') {
    throw new Error(`Unexpected Tauri command: ${command}`);
  }

  const options = payload?.options || {};
  httpbinInvocations.push(options);

  const { status, headers = {}, body = '' } = buildResponse(options);
  const bytes = Buffer.from(body);

  return {
    status,
    statusText: STATUS_TEXT[status] || '',
    // reqwest lowercases response header names; mirror that so case-insensitive
    // lookups (e.g. responseHeaders['content-type']) behave like the real backend.
    headers: Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    body: bytes.toString('base64'),
    bodyBytes: bytes.length,
    durationMs: 0,
    requestContentType: options.multipart
      ? 'multipart/form-data; boundary=mock-boundary'
      : null,
  };
};
