// Thin Orderful (Mosaic v3) API client. Reads config from env.
import { requireEnv } from '../../../../core/lib/env.js';

export function orderfulGet(path) {
  const { ORDERFUL_API_TOKEN, ORDERFUL_API_BASE } = requireEnv(
    'ORDERFUL_API_TOKEN',
    'ORDERFUL_API_BASE',
  );
  const url = `${ORDERFUL_API_BASE}${path}`;
  return fetch(url, {
    headers: {
      'orderful-api-key': ORDERFUL_API_TOKEN,
      'Content-Type': 'application/json',
    },
  }).then(async (res) => {
    const body = await res.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      json = body;
    }
    return { ok: res.ok, status: res.status, url, body: json };
  });
}
