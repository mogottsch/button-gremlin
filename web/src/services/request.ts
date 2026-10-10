let csrfToken: string | null = null;
const expiredListeners = new Set<() => void>();
export function setCsrfToken(value: string | null) {
  csrfToken = value;
}
export function subscribeAuthExpired(callback: () => void) {
  expiredListeners.add(callback);
  return () => {
    expiredListeners.delete(callback);
  };
}
export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!url.startsWith('/api/') || url.includes('\\'))
    throw new Error('Same-origin API URL required');
  const headers = new Headers(init.headers);
  headers.delete('Authorization');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(init.method ?? 'GET') && csrfToken)
    headers.set('X-CSRF-Token', csrfToken);
  return fetch(url, { ...init, headers, credentials: 'same-origin' }).then((response) => {
    if (response.status === 401) {
      csrfToken = null;
      for (const listener of expiredListeners) listener();
    }
    return response;
  });
}
