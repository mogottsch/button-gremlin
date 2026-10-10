# Authentik SSO (application implementation, not production activation)

Button Gremlin uses the existing **Discord → invitation broker → Authentik** login system. The browser never receives an API key or provider token. No enrollment, user creation, group assignment, invitations, or Authentik administration are performed by this app.

## Required infrastructure approval

Before enabling web mode, provision a **dedicated confidential** provider/application `button-gremlin` and bind it to the `button-gremlin-users` allow-group. The approved audience is existing Theatron users via group ancestry: **Theatron's parent is `button-gremlin-users`**. **Filmrunde's parent remains Theatron**, unchanged. Effective membership inherited through this chain intentionally grants admission; an account without effective membership does not. The app must not create users or assign groups. Verify inherited membership and effective provider policies on the deployed Authentik version, not only blueprint YAML.

Exact callback: `https://button-gremlin.moket-home.de/api/auth/callback`, matching the provisioned provider and application route. The former `/api/auth/oidc/callback` route is not supported.

Normal login goes through `https://identity.moket-home.de/login?return_to=...`, wrapping the entire verified Authentik authorization path/query. It never uses `/join`. Verify that the configured broker and Authentik authorization endpoint refer to the same Authentik instance. No invitation must not enroll an unknown Discord identity. Zero-entitlement identities must fail provider authorization without mutation. Local fake-provider denial tests are **not** evidence that the live broker/source/application policies are correct.

## Configuration

Use `.env.example` as the name reference. `WEB_ENABLED=true` requires all OIDC, canonical origin, private Redis and session-secret values. Bot-only mode needs none. The issuer is compared **exactly**, including its trailing slash. Client authentication is pinned to `client_secret_basic`; ID-token signing is pinned to **RS256**. Scope is only `openid profile`; no email, guilds, refresh token or offline access is requested.

Production requires HTTPS URLs (no credentials/fragments), a canonical origin and the exact callback. All discovered authorization/token/JWKS/userinfo endpoints and OIDC network requests must use the exact configured issuer origin (including port); foreign origins, including private/link-local hosts, are rejected before use. Redirects are forbidden. `OIDC_ALLOW_INSECURE_TEST=true` only permits loopback HTTP and changes test cookie names/flags; startup rejects it with `NODE_ENV=production`. Keep it false outside isolated fixtures. Configure `BUTTON_GREMLIN_SESSION_SECRET` with at least 32 random bytes of secret-manager material; do not use a human password. Both app workers and the revoke CLI must share its exact value.

Use a dedicated private Redis, or a reviewed private ACL restricted to `bg:auth:*`. No auth data belongs on the sounds PVC. Redis generations/sessions must share one consistent restore boundary; never restore old sessions separately from generations. Redis restart without persistence logs users out. Redis runtime/network failure returns **503**, never anonymous access; commands and OIDC network calls are bounded to five seconds. This implementation does not reconnect a failed Redis client silently; restart healthy workers after dependency recovery.

## Browser and HTTP security

- Authorization Code + PKCE S256, random state/nonce, exact issuer/audience, required subject/expiry/issued-at and **signature verification** (`openid-client.enableNonRepudiationChecks`). Token responses are discarded after sanitized profile extraction.
- Browser-bound ten-minute transactions are atomically compared-and-deleted with Redis Lua. Wrong binding cannot burn another browser's state. Up to eight outstanding per-state transaction cookies support parallel tabs.
- Session cookie `__Host-bg_session`: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. It holds a 32-byte opaque random value; Redis keys use its HMAC. **900-second absolute, non-sliding** sessions; no automatic refresh.
- Transaction cookie `__Secure-bg_oidc_tx_<state hash>`: Secure/HttpOnly/Lax, Path=/api/auth, 600 seconds. This scope makes outstanding cookies visible at both login and callback, so Chromium enforces the eight-start bound. Consumed or expired callbacks clear only their own cookie at the same scope.
- Authenticated reads, writes, streams, docs and schema are gated by the app itself, including direct NodePort access. Assets and the static shell are public. Unknown auth/API paths are JSON 404, not SPA fallback. `/api/auth/verify` is gone.
- Cookie mutations, multipart uploads and logout require the **exact canonical Origin** and session-bound `X-CSRF-Token`. No reflected CORS; same-origin browser API fetches only. API denial is JSON 401/403/503, not an HTML redirect.
- Callback/logout/session responses are no-store. Query strings, credentials and upstream exception text are excluded from application logs. Ingress callback-query logging must be controlled independently before activation.
- Local auth expiry unmounts private UI/audio, stops playback, aborts in-flight downloads and releases object URLs. Bytes already downloaded cannot be retroactively revoked.

## Revocation

Every protected request checks its subject's persistent opaque **generation revision**. Random generation replacement is used instead of a resettable numeric counter: deleting a generation and issuing a fresh session cannot resurrect a restored old session. Session issuance/generation initialization is atomic relative to revocation.

Local logout deletes the exact session across all workers. Subject revocation invalidates **all already-issued** sessions on their next request. A login issued after revocation is valid if the provider still grants admission; therefore immediate removal is two actions:

1. Remove all effective admission paths to Authentik's `button-gremlin-users` group, including inherited Theatron/Filmrunde membership, and verify effective removal/fresh authorization denial. Removing only direct membership does not remove inherited admission.
2. With private Redis configuration supplied securely, execute:

```sh
pnpm auth:revoke -- --issuer 'https://authentik.moket-home.de/application/o/button-gremlin/' --subject '<exact immutable sub>'
```

Inside the production image, use `node dist/web/auth/revoke-session.js --issuer '<exact issuer>' --subject '<exact sub>'`. No public admin endpoint exists. Never link by email or mutable display name. Verify old cookies fail through another worker/direct backend request. Restoring membership permits fresh login; old revoked cookies stay invalid.

**Group removal alone** can leave a local session valid for at most **900 seconds from issuance**. Discord/IdP logout or token expiry does not independently revoke the app cookie. Automatic immediate IdP revocation is not implemented; it needs a reviewed trusted event/reconciliation integration if required.

## Optional machine compatibility

`AUTOMATION_API_ENABLED=false` by default. Enabling it requires explicit nonblank `WEB_API_KEY` and consumer inventory/approval. A constant-time digest comparison accepts bearer-only calls on sound/bot routes. It is never accepted on session/logout/login/callback/docs. Mixed session+bearer credentials and foreign browser Origins are denied; bearer is never read from query/cookie. Machine requests do not use cookie CSRF.

This service-wide credential is **not user-bound**: removing group membership or revoking subject sessions does not revoke it. Disable automation or rotate/remove the key independently. The browser login UI never offers this bypass. Rate limits for login/callback and failed automation credentials are shared Redis counters (not per-process memory).

## Local verification

Node >=22.12, pnpm 8.15.0 and an **isolated disposable Redis** are required. Never point `REDIS_TEST_URL` at live/shared application Redis. The browser fixture writes temporary audio/metadata/tags under `TMPDIR` (default host scratch `/opt/data/cache/scratch`; CI can set `TEST_SCRATCH_DIR`) and runs a fake signed OIDC provider/broker and fake Discord client. It never runs `main`, migrations, bot login, or uses the production PVC.

```sh
pnpm install --frozen-lockfile
pnpm --dir web install --frozen-lockfile
export REDIS_TEST_URL=redis://127.0.0.1:16379
pnpm test
pnpm --dir web test
pnpm typecheck
pnpm lint
pnpm --dir web lint
pnpm build:all
pnpm --dir web exec playwright install chromium
pnpm --dir web test:e2e
```

Without `REDIS_TEST_URL`, store/HTTP integration tests explicitly skip; such a run is **not** the full security gate. CI supplies isolated Redis and runs both lockfiles, all gates and browser tests before image publication. Browser tests exercise the eight-pending-login bound/ninth-start rejection using real Chromium cookies, login/reload, denied admission, audio decoding without stored key, logout/replay, revocation/fresh login, tags/metadata/upload/stream/delete on fixtures and bot status. Redis TTL expiry clears only the matching transaction cookie; duplicate concurrent HTTP callbacks yield exactly one session and clear their own transaction cookies. Storage tests reopen the configured PVC-shaped tags path in a separate process and preserve legacy tags, audio and metadata naming/listing. Separate Node workers race state consumption and prove shared session deletion/revocation; denial tests enumerate every protected route. Production cookie flags are asserted using HTTPS-configured app injection, but local browser tests use HTTP fixture cookies: actual TLS ingress/Secure-cookie semantics still require a separately approved canary.

## Production rollout remains blocked until separately reviewed

No cluster/GitOps/Authentik/secrets changes are part of this commit. Before deployment: approve explicit members, provider policy/broker exact-version canaries, private Redis/ACL/secrets, optional automation consumers, 900-second residual access, and restore readiness. Preserve sounds/metadata and the existing **cwd `tags.json`** before rollout. `BUTTON_GREMLIN_TAGS_FILE` defaults to legacy cwd `tags.json`; the planned production value is **`/app/sounds/metadata/tags.json`** on the existing sounds PVC. The configured parent is created on writes; sound files and `<name>_meta.json` naming/listing remain unchanged. Infrastructure owns a separately reviewed, backed-up, atomic migration of existing live tags before enabling that value. This app does not migrate, merge, or delete existing tags, and no live/PVC changes are performed here. Avoid concurrent bot/PVC writers during rollout. Node 22 Alpine runtime correction is included, but the native-Opus container must be built and exercised separately if a Docker daemon is unavailable locally. The existing three voice-race tests remain unchanged.

Rollback to the old image intentionally restores shared-key authentication; preserve its encrypted key only during an explicitly bounded rollback window. Do not casually delete new Authentik objects, Redis or the sounds PVC. Independent code review, TLS/real-provider canaries and exact native image QA are required before production approval.
