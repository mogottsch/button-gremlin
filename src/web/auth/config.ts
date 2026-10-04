import { URL } from 'node:url';
export interface AuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  brokerBase: string;
  origin: string;
  sessionSecret: string;
  redisUrl: string;
  insecureTest: boolean;
  automationEnabled: boolean;
  automationKey: string;
}
export function bool(value: string | undefined): boolean {
  if (value !== undefined && value !== 'true' && value !== 'false')
    throw new Error('Invalid boolean');
  return value === 'true';
}
export function checkedUrl(value: string, insecure = false): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        insecure &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error('Unsafe URL');
  return url;
}
export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const required = (key: string): string => {
    const v = env[key];
    if (!v?.trim()) throw new Error(`Missing ${key}`);
    return v;
  };
  const insecureTest = bool(env['OIDC_ALLOW_INSECURE_TEST']);
  if (insecureTest && env['NODE_ENV'] === 'production')
    throw new Error('Insecure test mode forbidden');
  const issuer = required('OIDC_ISSUER');
  checkedUrl(issuer, insecureTest);
  const origin = required('BUTTON_GREMLIN_APP_ORIGIN');
  if (checkedUrl(origin, insecureTest).origin !== origin)
    throw new Error('Canonical origin required');
  const redirectUri = required('OIDC_REDIRECT_URI');
  const redirect = checkedUrl(redirectUri, insecureTest);
  if (redirect.origin !== origin || redirect.pathname !== '/api/auth/callback' || redirect.search)
    throw new Error('Exact callback required');
  const brokerBase = required('OIDC_BROKER_BASE_URL');
  if (checkedUrl(brokerBase, insecureTest).origin !== brokerBase)
    throw new Error('Broker origin required');
  const sessionSecret = required('BUTTON_GREMLIN_SESSION_SECRET');
  if (Buffer.byteLength(sessionSecret) < 32) throw new Error('Session secret too short');
  const redisUrl = required('REDIS_URL');
  if (!['redis:', 'rediss:'].includes(new URL(redisUrl).protocol))
    throw new Error('Redis URL required');
  const automationEnabled = bool(env['AUTOMATION_API_ENABLED']);
  const automationKey = automationEnabled ? required('WEB_API_KEY') : '';
  return {
    issuer,
    origin,
    redirectUri,
    brokerBase,
    sessionSecret,
    redisUrl,
    insecureTest,
    automationEnabled,
    automationKey,
    clientId: required('OIDC_CLIENT_ID'),
    clientSecret: required('OIDC_CLIENT_SECRET'),
  };
}
export function safeReturnTo(value: string, origin: string): string {
  if (value.length > 2048 || !value.startsWith('/') || value.startsWith('//'))
    throw new Error('Invalid return path');
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  // Reject decoded control bytes and URL-parser normalization tricks.
  // eslint-disable-next-line no-control-regex
  if (/[\\\x00-\x20\x7f]/.test(decoded) || decoded.startsWith('//'))
    throw new Error('Invalid return path');
  const url = new URL(value, origin);
  const decodedUrl = new URL(decoded, origin);
  if (
    url.origin !== origin ||
    decodedUrl.origin !== origin ||
    decodedUrl.pathname.startsWith('/api/auth')
  )
    throw new Error('Invalid return path');
  return url.pathname + url.search + url.hash;
}
