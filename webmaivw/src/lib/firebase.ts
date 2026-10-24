import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, type Auth } from "firebase/auth";

interface RuntimeFirebaseConfig {
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
  error?: string;
}

let authPromise: Promise<Auth> | null = null;

export function getFirebaseAuth(): Promise<Auth> {
  if (authPromise) return authPromise;
  authPromise = (async () => {
    const response = await fetch("/api/config/firebase", { cache: "no-store", credentials: "same-origin" });
    const runtime = await response.json() as RuntimeFirebaseConfig;
    if (!response.ok || !runtime.enabled || !runtime.config) {
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
