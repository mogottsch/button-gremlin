# Umami SDK test fixture

`umami-3.4.1.js` is the unmodified released browser tracker served by the existing collector (`https://stats.mogott.sh/script.js`). The running collector image was read as `ghcr.io/umami-software/umami:3.4.1@sha256:e69d1a7932e9dab0fc523edc7be1f3a53f3c261f57856fc2167ae74a8fc022e8`.

Upstream source: https://github.com/umami-software/umami/blob/v3.4.1/src/tracker/index.ts

SHA256: `654f12c7548be726eba5b71d5ef8bffc2a41a39a0053e2a49a847869ccd7ac3f`

The app's SRI pins these exact bytes. The fixture is test-only, not self-hosted or imported into the application bundle. Tests execute this real SDK and intercept every collection request; they never send analytics to the live collector. See `umami-LICENSE.txt` for the upstream MIT license. Updating SDK bytes requires reviewing its transport/lifecycle behavior, updating SRI and rerunning the payload and cancellation regressions.
