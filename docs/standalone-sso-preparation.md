# Standalone session-first SSO — prepared candidate, ACTIVATION HOLD

This is source preparation, not independent release approval or a working deployment.
No merge, auto-merge, main push, deployment, image promotion, provider/Discord change,
credential rotation or live user authentication experiment is authorized.

## Protocol and ownership

Implements the client algorithm in common contract 1.1.0:
https://github.com/moket-labs/authentik-discord-invite-broker/blob/1c652c9065833b3067055a4b411c18c07b65a997/docs/COMMON-LOGIN-CONTRACT.md
SHA256: 5834fc4b3d50e260c309ada39c26a5841cc8eeb29f459f13bf303df89e8a6d30.
The immutable remote document was fetched independently and hash-checked.

A valid local standalone session wins, including at `/api/auth/login`; no provider
navigation, transaction creation or session replacement is needed. Anonymous browser
entry starts one top-level Authentik code/PKCE S256 probe with `prompt=none`.
Only a one-use browser/state-validated, code-less `login_required` in PROBE phase
creates a FALLBACK with a NEW coherent state, nonce, verifier/challenge and binding.
It preserves the trusted client/callback/scopes and server-side safe destination,
and enters broker `/login` with the complete Authentik-relative request WITHOUT prompt.
No iframe, second routing strategy, offline_access, refresh token or Discord custody.

Denial, cancellation, other provider errors, duplicate/ambiguous parameters, foreign
issuer, missing/wrong browser/state, expired/replayed transaction or a second
login_required stop on an inert error page. No automatic retry. Network/store errors
on session lookup do not start login. Explicit Sign in is the only retry on errors or
logout; sessionStorage bounds each automatic episode. If that protection cannot be
persisted, only explicit sign-in is allowed. No bearer/key or token is stored there.

Button has no app-side invitation claim endpoint in this source. This change NEVER
substitutes `/login` for `/join` or creates public enrollment. Broker invitation/source
linking/admission remain A/F-owned; real invitation and identity tests are dependencies,
not claims made by the app's fake-provider fixtures.

Concurrency is per-transaction, not a global app login lock: existing per-state
HttpOnly cookies and atomic Redis consumption are retained (maximum eight pending
starts). Two tabs with an established browser marker can complete out of order;
initially cookieless marker replacement fails the losing callback closed and offers
explicit retry, never a wrong identity/destination. No broker-global serialization is
implemented or assumed. Coordinator REJECTED the broker's source-wide 600s lease as
final UX/availability design: A's C3 correction and F's actual full source-generation
flow interoperability test remain pre-merge dependencies. Do not accept that global
lock as the rollout design or ask users to accept ten-minute unrelated-login waits.

## Remembered access without broadening local authorization

Chosen minimal renewal is RE-ESTABLISHMENT, not a longer local cookie:

- `__Host-bg_session` remains Secure/HttpOnly/host-only/SameSite=Lax, fixed 900s.
  The Redis record and expiresAt remain fixed at issuance. Reads never slide it.
- On a missing/expired cookie, or a protected HTTP401, the standalone browser may
  make one new top-level SSO authorization. It is not a periodic manual login button.
  Current provider application policy is checked on that NEW authorization.
- No automatic login on 429/5xx/network failure, no extension during provider outage,
  no background refresh lease, no app refresh credentials and no scope widening.
- The proposed ordinary-Friends shared-session absolute 30d maximum is F's guarded
  IdP persistence decision, not an implemented 30d local grant here. There is no
  assertion that a dual-role/private identity now survives browser restart for 30d.
  Each independent local lease can outlive its originating IdP session by its remaining
  900s. Private/default/admin flows and automation opt-out are unchanged.
- A separate `__Host-bg_browser` Secure/HttpOnly/host-only/Lax marker (30d cookie)
  binds logout epochs only. It carries NO identity, CSRF, access or refresh credential,
  and cannot authorize any request. Server epoch keys expire after 30d+1500s from
  creation, are not slid by reads, and missing keys fail closed. The marker's cookie
  age is NOT an app session lifetime. Existing unguarded legacy sessions still expire
  at their original fixed 900s; old pending OIDC transactions fail closed after rollout.
- OIDC transactions retain 600s store/cookie deadlines. FALLBACK is a fresh 600s
  transaction, not an indefinite grant loop. Original Redis-clock startedAt is carried
  forward, so operator revocation during the first leg also blocks a late second leg.

### Revocation and residual access (different mechanisms)

Existing standalone sessions check exact issuer/subject generation on EVERY protected
request. Operator generation revoke remains separate from Friends-group removal.
A Redis-clock revokedAt marker now also prevents an authorization started before
operator revoke from issuing a late new standalone session, including a paused token
exchange; issuance/epoch/revoke tests exercise the real store. Fresh explicit/current
provider authorization after revoke can grant a NEW session: operator revoke is session
revocation, not a permanent user ban.

For a session already issued, Friends removal or user disablement leaves no more than
its remaining 900s local lease, absent explicit generation revoke. New authorization
must pass current provider admission after group convergence. Do NOT conflate this with
a guaranteed universal 900s removal SLA: an authorization code minted before removal
can still arrive within its outstanding 600s app transaction plus bounded processing
and obtain a final 900s lease. Actual upstream code validity, group-convergence delay
and real removal/disablement behavior are pending provider checks. Fixture evidence
measures fixed expiresAt/Redis TTL, rejects expired protected access and simulates
policy denial on re-establishment; it is not a production membership-removal experiment.

There is no standalone app WebSocket auth channel. Protected HTTP requests already
admitted, downloaded audio blobs and bot/voice actions already started are not recalled
by app logout or membership removal. Native Discord commands/voice admission remain
separate; no universal media/native revocation promise is made.

## Local logout and races

Exact Origin plus existing CSRF are still mandatory. Logout atomically deletes the
session and invalidates its browser epoch (and the current browser binding when they
differ), then clears owned pending cookies. Epoch checks cover new issuance AND lookup
of already-issued sibling sessions; a callback finishing before deletion is invalidated,
a callback finishing afterward cannot recreate the old grant. A fresh login gets a
new random epoch; it never revives a stale callback. Existing separate-worker session
and subject-generation checks remain, with additional independent-client races.

The standalone UI suppresses automatic entry BEFORE sending logout (racing401 safety),
lands on `/?loggedOut=1`, and keeps a non-secret browser-local suppression marker for
reload/back/new tabs. Restored back-forward-cache pages revalidate. A failed logout
shows an error and retains access; it does NOT claim success or clear its valid session.
Explicit Sign in clears suppression and can reuse the still-live Authentik identity.
This is app-local/browser-epoch logout, NOT logout-everywhere or Discord deauthorization.

## Separate Discord Activity boundary — unchanged

Embedded Activity still uses the SDK/direct Discord OAuth identify path, automatic
bootstrap and repeated single-flight bootstrap after401, with its separate partitioned
`__Secure-bg_activity` cookie and transient SDK access token. It never calls standalone
SSO helpers or redirects to Authentik. Activity's local fixed900s lease is NOT extended.
Its issuer/token/cookie cannot be used as a standalone app session or vice versa.

Current guild membership, voice-channel/current voice-state, ViewChannel/Connect/Speak
and ManageGuild mutation protections are unchanged. There is NO configured fixed-guild
allowlist in the baseline; none was invented and the eligible bot-cached guild audience
was not silently widened/restricted. This is NOT Friends-group admission. C2 remains
the separate centrally owned audience decision. A Friends removal is not Activity revoke.
Activity logout retains its existing automatic-on-next-launch SDK behavior; standalone
inert logout does not change it. Cookie partition/mobile/Discord in-app browser context
is distinct from the ordinary browser/profile SSO target.

## Executed evidence and limits

Regressions were added and run BEFORE implementation: baseline failed direct probe,
local-session-first and logout callback handling. Tests exercise actual Fastify routes,
actual OIDC signature/PKCE library and actual isolated local Redis (never production).
Coverage includes fresh fallback parameter coherence, wrong-browser/replay/ambiguous
errors, denial/cancel/outage, warm local, reordered tabs/cookieless failure, fixed expiry,
renewal admission denial, provider/store outage and paused-exchange logout/revoke races.
Existing bot/audio/runtime tests are unchanged; Activity admission/cookie isolation
regressions are executed alongside standalone changes.

Chromium runs the actual built frontend and local fake provider/Redis: automatic warm
SSO without broker, warm local reload, cold two-leg entry without a second click,
protected401 recovery, inert denial/outage, logout reload/back/new tabs and explicit
retry. Existing actual SDK iframe + local HTTPS proxy fixture passes for partitioned
Activity cookies and automatic recovery. These are local integration fixtures, NOT a
real Discord portal launch or live Authentik flow. Test logs and exact-head CI status
are recorded in the native source handoff rather than guessed here.

Pending NOT passed: real provider/Discord consent, signed-out/revoked Discord canaries,
full isolated exact-version source flow (F), same-profile real cross-app browser tests,
Safari/mobile/Activity portal launch, browser/store restart, elapsed30days, real
membership/disablement/stream/native residual-access measurements, private/dual-role
persistence approval, independent G review and authorized private CI route availability.

## Publication, dependency and rollback hold

Base is current remote main == deployed e09535013f199fd7edf213af6c6a9e81996096a2.
Only the feature branch is pushed. Bot, voice, audio and runtime source are untouched.
Before PR publication, inspect current workflow triggers and runner availability; the
legacy workflow uses hosted ubuntu-latest on PRs and push=false for its container job.
Do not silently use a forbidden route, publish images or waive required checks.
The preparation head uses GitHub's documented `[skip ci]` publication guard to avoid
triggering that unauthorized hosted workflow when the draft PR opens. This is NOT a
check waiver or green CI: exact-head CI remains pending/blocked until F supplies an
existing authorized PRIVATE build/test-only route (with publishing disabled). No runner
registration or infrastructure was added. Independent review/release must not treat
local green fixtures or skipped hosted checks as completed remote CI.

Eventual order ONLY after fresh Moritz authority and G exact-head review: resolve C1-C4
and broker C3 correction; coordinate reviewed broker+F generation/source config; prepare
verified private artifacts separately; staged broker canaries; roll out apps separately;
guarded persistence last. Do not activate broker against unchanged source binding.
For this app rollback, stop new auth entry and drain the fixed900s candidate sessions
BEFORE downgrading auth code: the old lookup does not understand browser logout epochs
and must not revive a sibling session invalidated only by the new epoch. Then restore
exact prior source/image/config; old pending transactions may fail closed and require
explicit retry. Preserve subject generations, immutable source links
and permanent invitation reservations. Drain broker600s transactions before broker
rollback. No bulk Redis deletion, credential rotation or unrelated native/media rollback.
