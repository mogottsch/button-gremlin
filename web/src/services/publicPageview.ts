// Only the settled anonymous standalone entry is public. The soundboard and Activity are not.
const HOST = 'button-gremlin.moket-home.de';
const WEBSITE = 'ecf41265-6b9b-436d-83bb-094992f68815';
const CALLBACK = 'buttonGremlinBeforePageview';
const INTEGRITY = 'sha256-ZU8Sx1SL5ybrpbcdXvi//CpBo5oAU+KkmoR4aczXrD8=';
type Payload = Record<string, unknown>;
type TrackerBrowser = Window & {
  umami?: { track: (payload: Payload) => Promise<void> };
  buttonGremlinBeforePageview?: (type: string, payload: Payload) => Payload | null;
  doNotTrack?: string | number;
};

export function createPublicPageview(browser: TrackerBrowser) {
  let publicEntry = false;
  let generation = 0;
  let sent = false;
  let requested: Payload | undefined;
  let script: HTMLScriptElement | undefined;
  const allowed = () => {
    const { location, navigator } = browser;
    // Any opt-out wins: a truthy '0' in one field must not mask another field.
    const optedOut = [
      browser.doNotTrack,
      navigator.doNotTrack,
      (navigator as Navigator & { msDoNotTrack?: string | number }).msDoNotTrack,
    ].some((value) => value === 1 || value === '1' || String(value).toLowerCase() === 'yes');
    return (
      publicEntry &&
      browser.self === browser.top &&
      location.origin === `https://${HOST}` &&
      location.pathname === '/' &&
      !location.search &&
      !location.hash &&
      !optedOut
    );
  };
  const referrer = () => {
    try {
      const url = new URL(browser.document.referrer);
      return url.protocol === 'https:' && !url.username && !url.password ? url.origin : '';
    } catch {
      return '';
    }
  };
  let pending = false;
  let accepted: Payload | undefined;
  const send = () => {
    if (!allowed() || sent || pending || !browser.umami) return;
    pending = true;
    const started = generation;
    const originalFetch = browser.fetch;
    // SDK 3.4.1 awaits before-send before fetch. Scope this final dispatch guard to
    // the one pending SDK call; unrelated app requests retain their exact options.
    const guardedFetch: typeof fetch = (input, init) => {
      if (input !== 'https://stats.mogott.sh/api/send')
        return originalFetch.call(browser, input, init);
      if (
        started !== generation ||
        !allowed() ||
        sent ||
        !accepted ||
        init?.body !== JSON.stringify({ type: 'event', payload: accepted })
      )
        return Promise.reject(new Error('Public pageview cancelled'));
      sent = true;
      return originalFetch.call(browser, input, {
        ...init,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    };
    browser.fetch = guardedFetch;
    requested = { website: WEBSITE };
    void browser.umami
      .track(requested)
      .catch(() => {
        /* Analytics cannot affect the app. */
      })
      .finally(() => {
        if (browser.fetch === guardedFetch) browser.fetch = originalFetch;
        requested = accepted = undefined;
        pending = false;
      });
  };
  return {
    setPublicEntry(value: boolean) {
      if (!value) generation++;
      publicEntry = value;
      if (!allowed() || sent) return;
      if (script) {
        send();
        return;
      }
      // Do not take custody of a pre-existing tracker/global hook.
      if (browser.umami || browser[CALLBACK]) return;
      browser[CALLBACK] = (type, payload) => {
        if (
          type !== 'event' ||
          sent ||
          !requested ||
          !allowed() ||
          Object.keys(payload).length !== 1 ||
          payload.website !== WEBSITE
        )
          return null;
        accepted = {
          website: WEBSITE,
          hostname: HOST,
          url: '/',
          title: 'Button Gremlin',
          referrer: referrer(),
        };
        return accepted;
      };
      script = browser.document.createElement('script');
      script.src = 'https://stats.mogott.sh/script.js';
      script.async = true;
      script.integrity = INTEGRITY; // Released 3.4.1 bytes; version drift fails closed.
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      for (const [key, setting] of Object.entries({
        'website-id': WEBSITE,
        'host-url': 'https://stats.mogott.sh',
        domains: HOST,
        'auto-track': 'false',
        'auto-pageview': 'false',
        'do-not-track': 'true',
        'exclude-search': 'true',
        'exclude-hash': 'true',
        'fetch-credentials': 'omit',
        performance: 'false',
        'before-send': CALLBACK,
      }))
        script.setAttribute(`data-${key}`, setting);
      script.onload = send;
      browser.document.head.appendChild(script);
    },
  };
}
let controller: ReturnType<typeof createPublicPageview> | undefined;
export function setPublicEntry(value: boolean) {
  (controller ??= createPublicPageview(window)).setPublicEntry(value);
}
