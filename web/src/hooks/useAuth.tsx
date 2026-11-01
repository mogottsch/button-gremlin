import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import { setCsrfToken, subscribeAuthExpired } from '../services/request';
import { isActivityLaunch, startActivity, type BrowserSession } from '../services/activity';
import { setPublicEntry } from '../services/publicPageview';
import {
  standaloneLogin,
  standaloneAuthenticated,
  suppressStandalone,
} from '../services/standalone';
interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  activity: boolean;
  identity?: { subject: string; name: string; avatarUrl?: string };
  error: string;
  login: () => void;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BrowserSession>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activity = isActivityLaunch();
  const [attempt, retry] = useState(0);
  const analyticsGeneration = useRef(0);
  useEffect(() => {
    // A restored snapshot must revalidate cookies, not display an old signed-in UI.
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted && !activity) window.location.reload();
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, [activity]);
  useEffect(() => {
    localStorage.removeItem('apiKey');
    let alive = true;
    let publicEntry = false;
    const generation = ++analyticsGeneration.current;
    setPublicEntry(false);
    setLoading(true);
    const unsubscribe = subscribeAuthExpired(() => {
      if (!alive) return;
      analyticsGeneration.current++;
      setPublicEntry(false);
      setSession({ authenticated: false });
      if (activity) retry((v) => v + 1);
      else if (!standaloneLogin()) setError('Your session expired. Please sign in again.');
    });
    (activity ? startActivity() : api.auth.session())
      .then((value) => {
        if (alive) {
          setCsrfToken(value.csrfToken ?? null);
          setSession(value);
          setError('');
          if (!activity) {
            if (value.authenticated) standaloneAuthenticated();
            else publicEntry = !standaloneLogin();
          }
        }
      })
      .catch(() => {
        if (alive)
          setError(
            activity
              ? 'Discord authorization was cancelled or unavailable. Retry in your launch voice channel.'
              : 'Unable to check your session. Please retry.'
          );
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
          if (generation === analyticsGeneration.current) setPublicEntry(publicEntry);
        }
      });
    return () => {
      alive = false;
      setPublicEntry(false);
      unsubscribe();
    };
  }, [activity, attempt]);
  const login = useCallback(() => {
    analyticsGeneration.current++;
    setPublicEntry(false);
    if (activity) retry((v) => v + 1);
    else standaloneLogin(true);
  }, [activity]);
  const logout = useCallback(async () => {
    analyticsGeneration.current++;
    setPublicEntry(false);
    // Suppress before the POST so racing 401s cannot start an automatic login.
    if (!activity) suppressStandalone();
    try {
      await api.auth.logout(activity);
      setCsrfToken(null);
      setSession({ authenticated: false });
      setError('');
      if (!activity) window.location.assign('/?loggedOut=1');
    } catch {
      setError('Logout failed. Please retry.');
    }
  }, [activity]);
  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: session.authenticated,
        loading,
        activity,
        identity: session.identity,
        error,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
