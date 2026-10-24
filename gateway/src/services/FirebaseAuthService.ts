import { initializeApp, cert, getApps, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import fs from "node:fs";

export interface FirebaseAuthOptions {
  enabled: boolean;
  projectId?: string;
  serviceAccountPath?: string;
  serviceAccountJsonBase64?: string;
  allowedProviders: string[];
}

function optionsFromEnvironment(): FirebaseAuthOptions {
  return {
    enabled: process.env.FIREBASE_AUTH_ENABLED === "true",
    projectId: process.env.FIREBASE_PROJECT_ID,
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    serviceAccountJsonBase64: process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
    allowedProviders: (process.env.FIREBASE_ALLOWED_PROVIDERS || "google.com,github.com")
      .split(",").map((value) => value.trim()).filter(Boolean),
  };
}

function readServiceAccount(options: FirebaseAuthOptions): ServiceAccount & { project_id?: string } {
  const raw = options.serviceAccountJsonBase64
    ? Buffer.from(options.serviceAccountJsonBase64, "base64").toString("utf8")
    : options.serviceAccountPath
      ? fs.readFileSync(options.serviceAccountPath, "utf8")
      : "";
  if (!raw) throw new Error("Credencial Firebase não configurada");
  const serviceAccount = JSON.parse(raw) as ServiceAccount & { project_id?: string };
  if (!serviceAccount.project_id || serviceAccount.project_id !== options.projectId) {
    throw new Error("Projeto da credencial Firebase diverge de FIREBASE_PROJECT_ID");
  }
  return serviceAccount;
}

export function initFirebaseAdmin(options: FirebaseAuthOptions = optionsFromEnvironment()): App {
  if (!options.enabled) throw new Error("Firebase Auth está desativado neste ambiente");
  if (!options.projectId) throw new Error("FIREBASE_PROJECT_ID não configurado");
  const appName = `maivw-firebase-${options.projectId}`;
  const existing = getApps().find((app) => app.name === appName);
  if (existing) return existing;
  const serviceAccount = readServiceAccount(options);
  return initializeApp({ credential: cert(serviceAccount), projectId: options.projectId }, appName);
}

export function validateFirebaseIdentityClaims(
  token: DecodedIdToken,
  options: Pick<FirebaseAuthOptions, "projectId" | "allowedProviders">,
): DecodedIdToken {
  const expectedIssuer = `https://securetoken.google.com/${options.projectId}`;
  const provider = token.firebase?.sign_in_provider;
  if (token.aud !== options.projectId || token.iss !== expectedIssuer) {
    throw new Error("Token Firebase pertence a outro projeto");
  }
  if (!token.email || token.email_verified !== true) {
    throw new Error("E-mail verificado é obrigatório");
  }
  if (!provider || !options.allowedProviders.includes(provider)) {
    throw new Error("Provedor social não autorizado");
  }
  return token;
}

export function createFirebaseIdTokenVerifier(options: FirebaseAuthOptions) {
  return async (idToken: string): Promise<DecodedIdToken> => {
    const app = initFirebaseAdmin(options);
    const token = await getAuth(app).verifyIdToken(idToken, true);
    return validateFirebaseIdentityClaims(token, options);
  };
}

export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  return createFirebaseIdTokenVerifier(optionsFromEnvironment())(idToken);
}
