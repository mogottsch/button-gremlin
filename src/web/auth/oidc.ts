import { URL } from 'node:url';
import * as oidc from 'openid-client';
import { checkedUrl, type AuthConfig } from './config.js';
import type { Identity, Transaction } from './store.js';
export class OidcRuntime {
  private constructor(
    private config: AuthConfig,
    private client: oidc.Configuration
  ) {}
  static async create(config: AuthConfig): Promise<OidcRuntime> {
    if (config.insecureTest && process.env['NODE_ENV'] === 'production')
      throw new Error('Insecure test mode forbidden');
    const safeFetch: typeof fetch = async (input, init) => {
      const url = input instanceof globalThis.Request ? input.url : String(input);
      checkedUrl(url, config.insecureTest);
      const response = await fetch(input, {
        ...init,
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(5000),
      });
      return response;
    };
    const client = await oidc.discovery(
      new URL(config.issuer),
      config.clientId,
      { client_secret: config.clientSecret, id_token_signed_response_alg: 'RS256' },
      oidc.ClientSecretBasic(config.clientSecret),
      {
        timeout: 5,
        [oidc.customFetch]: safeFetch,
        execute: config.insecureTest ? [oidc.allowInsecureRequests] : [],
      }
    );
    const metadata = client.serverMetadata();
    if (metadata.issuer !== config.issuer) throw new Error('Issuer mismatch');
    for (const field of [
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'userinfo_endpoint',
    ] as const) {
      const value = metadata[field];
      if (value) checkedUrl(value, config.insecureTest);
      else if (field !== 'userinfo_endpoint') throw new Error('Missing endpoint');
    }
    if (!metadata.id_token_signing_alg_values_supported?.includes('RS256'))
      throw new Error('RS256 required');
    oidc.enableNonRepudiationChecks(client);
    return new OidcRuntime(config, client);
  }
  async loginUrl(state: string, tx: Transaction): Promise<string> {
    const authorization = oidc.buildAuthorizationUrl(this.client, {
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile',
      state,
      nonce: tx.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(tx.verifier),
      code_challenge_method: 'S256',
    });
    const endpoint = this.client.serverMetadata().authorization_endpoint;
    if (!endpoint) throw new Error('Missing endpoint');
    const expected = new URL(endpoint);
    if (authorization.origin !== expected.origin || authorization.pathname !== expected.pathname)
      throw new Error('Unsafe authorization endpoint');
    const broker = new URL('/login', this.config.brokerBase);
    // Broker admits only a path on the configured Authentik origin; never /join.
    broker.searchParams.set('return_to', authorization.pathname + authorization.search);
    return broker.href;
  }
  async callback(url: URL, state: string, tx: Transaction): Promise<Identity> {
    if (url.origin + url.pathname !== this.config.redirectUri) throw new Error('Callback mismatch');
    // A fresh verification cache per login permits immediate JWKS rotation without
    // retrying the already-consumed authorization code or accepting unsigned tokens.
    const grantClient = new oidc.Configuration(
      this.client.serverMetadata(),
      this.config.clientId,
      { client_secret: this.config.clientSecret, id_token_signed_response_alg: 'RS256' },
      oidc.ClientSecretBasic(this.config.clientSecret)
    );
    const safeFetch = this.client[oidc.customFetch];
    if (!safeFetch) throw new Error('Secure OIDC transport missing');
    grantClient[oidc.customFetch] = safeFetch;
    grantClient.timeout = 5;
    if (this.config.insecureTest) oidc.allowInsecureRequests(grantClient);
    oidc.enableNonRepudiationChecks(grantClient);
    const tokens = await oidc.authorizationCodeGrant(grantClient, url, {
      expectedState: state,
      expectedNonce: tx.nonce,
      pkceCodeVerifier: tx.verifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (
      !claims ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Math.floor(Date.now() / 1000) ||
      !Number.isFinite(claims.iat) ||
      claims.iat > Math.floor(Date.now() / 1000) + 30
    )
      throw new Error('Required claims missing');
    const name =
      typeof claims['name'] === 'string'
        ? claims['name']
            .split('')
            .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
            .join('')
            .slice(0, 120)
        : 'Member';
    let avatarUrl: string | undefined;
    if (typeof claims['picture'] === 'string') {
      try {
        const picture = checkedUrl(claims['picture']);
        avatarUrl = picture.href;
      } catch {
        /* Optional invalid avatar is discarded. */
      }
    }
    return {
      issuer: this.config.issuer,
      subject: claims.sub,
      name,
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }
}
