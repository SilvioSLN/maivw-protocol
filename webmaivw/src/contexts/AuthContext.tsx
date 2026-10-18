"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

interface UserData {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  domainId?: number;
  domainName?: string;
  domain?: {
    id: number;
    domainName: string;
    isVerified: boolean;
    smtpConfigured: boolean;
    smtpProvider: string | null;
    accounts: Array<{
      id: number;
      email: string;
      displayName: string | null;
      isActive: boolean;
    }>;
  } | null;
  token: string;
}

export interface DomainSummary {
  id: number;
  domainName: string;
  isVerified: boolean;
  createdAt: string;
  accountsCount: number;
  apiKeysCount: number;
  smtpConfigured: boolean;
  smtpProvider: string | null;
  publicKey: string | null;
  originFamily?: "SOLANA" | "EVM";
  originNetworkName?: string;
  explorerUrl?: string;
  accounts: Array<{
    id: number;
    email: string;
    displayName: string | null;
    isActive: boolean;
  }>;
}

interface AuthContextType {
  user: UserData | null;
  isLoading: boolean;
  domains: DomainSummary[];
  selectedDomainId: number | null;
  setSelectedDomainId: (id: number | null) => void;
  refreshDomains: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  loginWithGoogle: (registrationToken?: string) => Promise<{ ok: boolean; error?: string; isNewUser?: boolean }>;
  loginWithGithub: (registrationToken?: string) => Promise<{ ok: boolean; error?: string; isNewUser?: boolean }>;
  register: (email: string, password: string, displayName?: string, registrationToken?: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  gatewayUrl: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null);
  const gatewayUrl = (process.env.NEXT_PUBLIC_GATEWAY_URL || "https://api-test.maivw.com").replace(/\/+$/, "");

  const refreshDomains = useCallback(async () => {
    const token = localStorage.getItem("maivw_token");
    if (!token) return;
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/domains`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = data.domains || [];
        setDomains(list);
        if (list.length > 0 && selectedDomainId === null) {
          setSelectedDomainId(list[0].id);
        }
      }
    } catch (err) {
      console.warn("Falha ao carregar domínios:", err);
    }
  }, [gatewayUrl, selectedDomainId]);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("maivw_token");
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setUser({ ...data, token });
        if (data.role === "admin") {
          refreshDomains();
        }
      } else {
        localStorage.removeItem("maivw_token");
        setUser(null);
      }
    } catch {
      // Gateway offline — manter sessão local se possível
      const stored = localStorage.getItem("maivw_user");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setUser(parsed);
          if (parsed.role === "admin") {
            refreshDomains();
          }
        } catch {
          setUser(null);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [gatewayUrl, refreshDomains]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        localStorage.setItem("maivw_token", data.token);
        localStorage.setItem("maivw_user", JSON.stringify(data));
        setUser(data);
        if (data.role === "admin") {
          refreshDomains();
        }
        return { ok: true };
      } else {
        return { ok: false, error: data.message || data.error || "Erro ao fazer login" };
      }
    } catch (err: any) {
      return { ok: false, error: "Não foi possível conectar ao servidor. Verifique se o Gateway está rodando." };
    }
  };

  const loginWithGoogle = async (registrationToken?: string): Promise<{ ok: boolean; error?: string; isNewUser?: boolean }> => {
    try {
      const { signInWithPopup } = await import("firebase/auth");
      const { auth, googleProvider } = await import("@/lib/firebase");

      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();

      const res = await fetch(`${gatewayUrl}/api/v1/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          registrationToken,
        }),
      });

      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("maivw_token", data.token);
        localStorage.setItem("maivw_user", JSON.stringify(data));
        setUser(data);
        if (data.role === "admin") {
          refreshDomains();
        }
        return { ok: true, isNewUser: !data.domain };
      } else {
        return { ok: false, error: data.message || data.error || "Erro ao autenticar com o Google" };
      }
    } catch (err: any) {
      if (err?.code === "auth/popup-closed-by-user") {
        return { ok: false, error: "A janela do Google foi fechada antes de concluir o login." };
      }
      return { ok: false, error: err?.message || "Não foi possível conectar ao Google." };
    }
  };

  const loginWithGithub = async (registrationToken?: string): Promise<{ ok: boolean; error?: string; isNewUser?: boolean }> => {
    try {
      const { signInWithPopup } = await import("firebase/auth");
      const { auth, githubProvider } = await import("@/lib/firebase");

      const result = await signInWithPopup(auth, githubProvider);
      const idToken = await result.user.getIdToken();

      const res = await fetch(`${gatewayUrl}/api/v1/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          registrationToken,
        }),
      });

      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("maivw_token", data.token);
        localStorage.setItem("maivw_user", JSON.stringify(data));
        setUser(data);
        if (data.role === "admin") {
          refreshDomains();
        }
        return { ok: true, isNewUser: !data.domain };
      } else {
        return { ok: false, error: data.message || data.error || "Erro ao autenticar com o GitHub" };
      }
    } catch (err: any) {
      if (err?.code === "auth/popup-closed-by-user") {
        return { ok: false, error: "A janela de login foi fechada." };
      }
      return { ok: false, error: err?.message || "Não foi possível autenticar com o GitHub." };
    }
  };

  const register = async (email: string, password: string, displayName?: string, registrationToken?: string) => {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName, registrationToken }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        localStorage.setItem("maivw_token", data.token);
        localStorage.setItem("maivw_user", JSON.stringify(data));
        setUser(data);
        if (data.role === "admin") {
          refreshDomains();
        }
        return { ok: true, data };
      } else {
        return { ok: false, error: data.message || data.error || "Erro ao registrar" };
      }
    } catch (err: any) {
      return { ok: false, error: "Não foi possível conectar ao servidor." };
    }
  };

  const logout = () => {
    localStorage.removeItem("maivw_token");
    localStorage.removeItem("maivw_user");
    setUser(null);
    setDomains([]);
    setSelectedDomainId(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        domains,
        selectedDomainId,
        setSelectedDomainId,
        refreshDomains,
        login,
        loginWithGoogle,
        loginWithGithub,
        register,
        logout,
        refreshUser,
        gatewayUrl,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
