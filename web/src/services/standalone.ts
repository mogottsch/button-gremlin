// Non-secret UI suppression only; never used as an authorization decision.
const ATTEMPT = 'bg.sso.attempt';
const LOGGED_OUT = 'bg.sso.loggedOut';
export function standaloneLogin(explicit = false): boolean {
  const query = new URLSearchParams(window.location.search);
  try {
    if (explicit) {
      localStorage.removeItem(LOGGED_OUT);
      sessionStorage.removeItem(ATTEMPT);
    } else if (
      query.has('authError') ||
      query.has('loggedOut') ||
      localStorage.getItem(LOGGED_OUT) ||
      sessionStorage.getItem(ATTEMPT)
    ) {
      return false;
    }
    // Persist before navigation: reload/back/error can never create a grant loop.
    sessionStorage.setItem(ATTEMPT, '1');
  } catch {
    // If durable loop protection is unavailable, require a user gesture.
    if (!explicit) return false;
  }
  const destination = new URL(window.location.href);
  destination.searchParams.delete('authError');
  destination.searchParams.delete('loggedOut');
  window.location.assign(
    '/api/auth/login?returnTo=' + encodeURIComponent(destination.pathname + destination.search)
  );
  return true;
}
export function standaloneAuthenticated(): void {
  try {
    sessionStorage.removeItem(ATTEMPT);
  } catch {
    /* No automatic entry without storage. */
  }
}
export function suppressStandalone(): void {
  try {
    localStorage.setItem(LOGGED_OUT, '1');
  } catch {
    /* The logged-out landing URL is also inert. */
  }
}
