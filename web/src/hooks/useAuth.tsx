import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';

interface AuthContextType {
  apiKey: string | null;
  isAuthenticated: boolean;
  login: (key: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(localStorage.getItem('apiKey'));

  const login = useCallback(async (key: string) => {
    const result = await api.auth.verify(key);
    if (result.valid) {
      localStorage.setItem('apiKey', key);
      setApiKey(key);
    } else {
      throw new Error(result.error || 'Invalid API key');
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('apiKey');
    setApiKey(null);
  }, []);

  return (
    <AuthContext.Provider value={{ apiKey, login, logout, isAuthenticated: !!apiKey }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
