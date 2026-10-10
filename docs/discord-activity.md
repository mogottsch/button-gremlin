# Discord Activity integration

Standalone Authentik OIDC remains intact and still requires its existing entitlement/invitation. Activity admission is a separate Discord-only boundary: an authenticated Discord user must currently be in the launch voice channel of a guild where this bot is installed. No Authentik enrollment, linking, group assignment or entitlement bypass is added.

## Exact environment contract

Add server runtime variables only:

| Variable                   | Value                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `DISCORD_ACTIVITY_ENABLED` | `true` to activate; absent or `false` disables all Activity routes                              |
| `DISCORD_CLIENT_SECRET`    | Private OAuth2 client secret of app **1434488648228929629**; required and nonblank when enabled |

Keep existing `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` (the bot should be app 1434488648228929629), `WEB_ENABLED`, `WEB_PORT`, `BUTTON_GREMLIN_APP_ORIGIN`, all `OIDC_*` variables, `BUTTON_GREMLIN_SESSION_SECRET` and `REDIS_URL` unchanged. Never put the Discord secret in a `VITE_*` variable. No frontend environment variables, Activity callback URI variable, extra Redis or API key are needed. The app ID and Activity origin are deliberately fixed in code; they are not configurable audience/SSRF inputs.

Portal prerequisites (not changed by this implementation):

- Enable Activities for app 1434488648228929629.
- URL mapping `/` → `button-gremlin.moket-home.de`.
- OAuth2 Redirects: the SDK guide uses placeholder `https://127.0.0.1`; SDK handles the redirect internally. This is **not** the Authentik callback.
- Installed bot in launch guild; user and bot can view/connect to launch voice channel, bot can speak. Existing bot Gateway voice-state intent must remain enabled.
- First-use Discord consent may still appear with `prompt: none`; cancellation has a retry button. Non-distributed Activities require developer team access/appropriate portal distribution configuration.

## Protocol / endpoints

1. At `https://1434488648228929629.discordsays.com` the browser reads `GET /api/activity/config` (public app ID only).
2. Real `@discord/embedded-app-sdk` 2.5.0: `ready()` → `authorize({client_id, response_type:'code', prompt:'none', scope:['identify']})`.
3. `POST /api/activity/exchange` with JSON **only** `{code,guildId,channelId}` and exact proxy `Origin`.
4. Backend exchanges code at fixed `https://discord.com/api/oauth2/token`, then validates audience, identify scope, token expiry and immutable user ID via `https://discord.com/api/v10/oauth2/@me`. HTTPS only, redirect rejection, five-second HTTP timeouts. Client identity assertions are rejected. Bot REST membership/channel and Gateway voice-state checks verify launch claims independently.
5. Response contains `{access_token}` solely for SDK `authenticate`; browser clears its local reference afterwards. No access/refresh/session token is persisted in browser storage or Redis. Redis stores opaque session's identity/context/CSRF/expiry/generation only; keys HMAC-hash bearer/code/session inputs.
6. `GET /api/activity/session` supplies authenticated identity and CSRF. Activity automatically repeats SDK authentication on authenticated API 401; errors/timeouts/cancel surface a retry UI, never an OIDC redirect inside an iframe. Concurrent bootstrap uses single-flight (including React StrictMode).
7. `POST /api/activity/logout` uses exact-origin session-bound `X-CSRF-Token` and clears only the Activity cookie.

Activity cookie: `__Secure-bg_activity`; `Secure; HttpOnly; SameSite=None; Partitioned; Path=/; Domain=1434488648228929629.discordsays.com; Max-Age=900`. It is separate from standalone `__Host-bg_session`. Mixing session/bearer credentials is denied. GET requests may omit Origin as browsers do; any supplied foreign Origin is denied, mutations require exact proxy Origin plus CSRF. CORS is not reflected/enabled.

All Activity catalog/stream/bot requests re-fetch membership and channel permissions and require presence in the launch voice channel. Global sound catalog stays unchanged. All catalog mutations (upload/delete/tags/shared metadata) require **ManageGuild** in that guild, while basic playback is available to admitted members. Status/play/disconnect are scoped to the admitted channel; never use the standalone first-occupied-channel fallback. Playback refuses an existing different-channel connection rather than moving it. Activity cannot access API docs. Standalone OIDC and opt-in automation behavior are preserved.

## Session / revocation

Absolute local session expiry is 900 seconds, never rolling. Existing operator revocation works with:

```sh
pnpm auth:revoke -- --issuer https://discord.com --subject DISCORD_USER_ID
```

Revocation invalidates existing sessions across workers; it does not withdraw Discord OAuth consent or permanently ban a currently admitted member. Fresh SDK login is allowed after revocation. Removal from the guild/channel or permission loss denies subsequent requests immediately. Exchange is limited to ten attempts per proxy IP per minute (Discord proxy egress can be shared); authorization codes have a shared ten-minute atomic replay fence. Dependency errors fail closed without exposing upstream error messages/secrets.

## Verification

```sh
REDIS_TEST_URL=redis://127.0.0.1:16381 pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --dir web test
pnpm --dir web lint
pnpm --dir web build
REDIS_TEST_URL=redis://127.0.0.1:16381 pnpm --dir web test:e2e
```

Browser tests use the actual SDK and built React bundle, a fake parent Discord RPC transport, fake server Discord OAuth transport, real Redis, and real TLS proxy cookie responses. The Activity browser harness needs OpenSSL and permission to bind loopback port 443 (or run in an isolated container with unprivileged low ports enabled). Chromium test-only host mapping routes the exact proxy host to loopback, with local-network checks disabled **only in test launch options**. It proves real Partitioned cookie storage/sending, authenticated audio blob loading, automatic reauthentication and no OIDC iframe navigation. No production bot login or real sound playback occurs. A live Discord client/portal/OAuth-secret canary remains an integration prerequisite, not something simulated tests prove.

References: [official tutorial](https://docs.discord.com/developers/activities/building-an-activity), [official networking/security/cookie guide](https://docs.discord.com/developers/activities/development-guides/networking).
