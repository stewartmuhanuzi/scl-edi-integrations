// Thin ApparelMagic API client. Auth is `time` (unix timestamp) + `token` as
// query string parameters on every request, including GET — confirmed
// against the live API; the docs' JSON-body example does not work in
// practice, the app only reads $_GET.
import { requireEnv } from '../../../../core/lib/env.js';

// PHP parses nested query params via bracket notation, e.g.
// pagination[page_size]=5 -> $_GET['pagination']['page_size']. Recurse
// objects/arrays into that form rather than JSON-encoding the value.
function appendParam(searchParams, key, value) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => appendParam(searchParams, `${key}[${i}]`, v));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) appendParam(searchParams, `${key}[${k}]`, v);
  } else {
    searchParams.set(key, String(value));
  }
}

export async function apparelmagicGet(path, extra = {}) {
  const { APPARELMAGIC_API_KEY, APPARELMAGIC_BASE } = requireEnv(
    'APPARELMAGIC_API_KEY',
    'APPARELMAGIC_BASE',
  );
  const url = new URL(`${APPARELMAGIC_BASE}${path}`);
  url.searchParams.set('time', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('token', APPARELMAGIC_API_KEY);
  for (const [key, value] of Object.entries(extra)) appendParam(url.searchParams, key, value);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = raw;
  }
  return { ok: res.ok, status: res.status, url: url.toString(), body: json };
}

// Writes (POST/PUT) send time + token + payload as a JSON body, matching the
// docs' request-array structure. Auth is also mirrored into the query string
// so it works whether the app reads the body or $_GET for auth.
async function apparelmagicWrite(method, path, payload = {}) {
  const { APPARELMAGIC_API_KEY, APPARELMAGIC_BASE } = requireEnv(
    'APPARELMAGIC_API_KEY',
    'APPARELMAGIC_BASE',
  );
  const url = new URL(`${APPARELMAGIC_BASE}${path}`);
  url.searchParams.set('time', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('token', APPARELMAGIC_API_KEY);

  const body = JSON.stringify({
    time: String(Math.floor(Date.now() / 1000)),
    token: APPARELMAGIC_API_KEY,
    ...payload,
  });

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  });
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = raw;
  }
  return { ok: res.ok, status: res.status, url: url.toString(), body: json };
}

export const apparelmagicPost = (path, payload) => apparelmagicWrite('POST', path, payload);
export const apparelmagicPut = (path, payload) => apparelmagicWrite('PUT', path, payload);
