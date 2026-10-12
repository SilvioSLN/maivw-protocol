import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import fs from "node:fs";
import path from "node:path";

let initializedApp: App | null = null;

export function initFirebaseAdmin(): App | null {
  if (initializedApp) return initializedApp;
  if (getApps().length > 0) {
    initializedApp = getApps()[0];
    return initializedApp;
  }

  const candidatePaths = [
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    "/keys/service-account.json",
    "/keys/your-firebase-project-firebase.json",
    path.resolve(process.cwd(), "keys/service-account.json"),
    path.resolve(process.cwd(), "keys/your-firebase-project-firebase.json"),
    path.resolve(process.cwd(), "../keys/your-firebase-project-firebase.json"),
    path.resolve(process.cwd(), "../../keys/your-firebase-project-firebase.json"),
  ].filter(Boolean) as string[];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const serviceAccount = JSON.parse(raw);
        initializedApp = initializeApp({
          credential: cert(serviceAccount),
          projectId: serviceAccount.project_id || "your-firebase-project",
        });
        console.log(`[FIREBASE] Firebase Admin inicializado com sucesso via: ${p}`);
        return initializedApp;
      } catch (err: any) {
        console.error(`[FIREBASE] Falha ao processar arquivo de chave ${p}:`, err.message);
      }
    }
  }

  console.warn("[FIREBASE] Nenhum arquivo de chave de serviço Firebase encontrado nos caminhos conhecidos.");
  return null;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  const app = initFirebaseAdmin();
  if (!app) {
    throw new Error("Firebase Admin não pôde ser inicializado");
  }
  return await getAuth(app).verifyIdToken(idToken);
}
