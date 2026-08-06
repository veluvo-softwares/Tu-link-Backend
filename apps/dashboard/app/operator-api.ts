const apiBaseUrl = process.env.TULINK_API_URL ?? 'http://localhost:3000';

export function operatorFetch(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(5_000),
  });
}
