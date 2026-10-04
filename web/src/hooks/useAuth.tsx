import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import { setCsrfToken, subscribeAuthExpired } from '../services/request';
interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  identity?: { subject: string; name: string; avatarUrl?: string };
  error: string;
  login: () => void;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof api.auth.session>>>({
    authenticated: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    // Remove only the obsolete browser credential, never persist IdP tokens.
    localStorage.removeItem('apiKey');
    let alive = true;
    const unsubscribe = subscribeAuthExpired(() => {
      if (alive) {
        setSession({ authenticated: false });
        setError('Your session expired. Please sign in again.');
      }
    });
    api.auth
      .session()
      .then((value) => {
        if (alive) {
          setCsrfToken(value.csrfToken ?? null);
          setSession(value);
        }
      })
      .catch(() => {
        if (alive) setError('Unable to check your session. Please retry.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  const login = useCallback(() => {
    window.location.assign('/api/auth/login?returnTo=%2F');
  }, []);
  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
      setCsrfToken(null);
      setSession({ authenticated: false });
      setError('');
    } catch {
      setError('Logout failed. Please retry.');
    }
  }, []);
  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: session.authenticated,
        loading,
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
