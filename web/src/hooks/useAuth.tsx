import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import { setCsrfToken, subscribeAuthExpired } from '../services/request';
import { isActivityLaunch, startActivity, type BrowserSession } from '../services/activity';
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
  useEffect(() => {
    localStorage.removeItem('apiKey');
    let alive = true;
    setLoading(true);
    const unsubscribe = subscribeAuthExpired(() => {
      if (!alive) return;
      setSession({ authenticated: false });
      if (activity) retry((v) => v + 1);
      else setError('Your session expired. Please sign in again.');
    });
    (activity ? startActivity() : api.auth.session())
      .then((value) => {
        if (alive) {
          setCsrfToken(value.csrfToken ?? null);
          setSession(value);
          setError('');
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
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [activity, attempt]);
  const login = useCallback(() => {
    if (activity) retry((v) => v + 1);
    else window.location.assign('/api/auth/login?returnTo=%2F');
  }, [activity]);
  const logout = useCallback(async () => {
    try {
      await api.auth.logout(activity);
      setCsrfToken(null);
      setSession({ authenticated: false });
      setError('');
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
