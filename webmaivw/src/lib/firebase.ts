import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, type Auth } from "firebase/auth";

export interface RuntimeFirebaseConfig {
  enabled: boolean;
  config?: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId: string;
  };
  allowedHosts: string[];
  providers?: string[];
  error?: string;
}

let configPromise: Promise<RuntimeFirebaseConfig> | null = null;

export function getFirebaseRuntimeConfig(): Promise<RuntimeFirebaseConfig> {
  if (configPromise) return configPromise;
  configPromise = (async () => {
    const response = await fetch("/api/config/firebase", { cache: "no-store", credentials: "same-origin" });
    const runtime = (await response.json()) as RuntimeFirebaseConfig;
    return runtime;
  })().catch((err) => {
    configPromise = null;
    throw err;
  });
  return configPromise;
}

let authPromise: Promise<Auth> | null = null;

export function getFirebaseAuth(): Promise<Auth> {
  if (authPromise) return authPromise;
  authPromise = (async () => {
    const runtime = await getFirebaseRuntimeConfig();
    if (!runtime.enabled || !runtime.config) {
      throw new Error(runtime.error || "Login social não configurado neste ambiente.");
    }
    const hostname = window.location.hostname.toLowerCase();
    if (!runtime.allowedHosts.includes(hostname)) {
      throw new Error("Este domínio não está autorizado a iniciar login social.");
    }
    const appName = `maivw-${runtime.config.projectId}`;
    const app = getApps().find((candidate) => candidate.name === appName)
      || initializeApp(runtime.config, appName);
    return getAuth(app);
  })().catch((error) => {
    authPromise = null;
    throw error;
  });
  return authPromise;
}

export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

