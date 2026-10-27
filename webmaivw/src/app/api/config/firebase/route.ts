import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function value(name: string): string {
  return process.env[name]?.trim() || "";
}

export async function GET() {
  const enabled = value("FIREBASE_AUTH_ENABLED") === "true";
  const config = {
    apiKey: value("FIREBASE_PUBLIC_API_KEY"),
    authDomain: value("FIREBASE_PUBLIC_AUTH_DOMAIN"),
    projectId: value("FIREBASE_PROJECT_ID"),
    storageBucket: value("FIREBASE_PUBLIC_STORAGE_BUCKET"),
    messagingSenderId: value("FIREBASE_PUBLIC_MESSAGING_SENDER_ID"),
    appId: value("FIREBASE_PUBLIC_APP_ID"),
  };
  const allowedHosts = value("FIREBASE_ALLOWED_HOSTS").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);

  if (enabled && (!config.apiKey || !config.authDomain || !config.projectId || !config.appId || allowedHosts.length === 0)) {
    return NextResponse.json(
      { enabled: false, error: "Login social indisponível por configuração incompleta" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rawProviders = value("FIREBASE_PUBLIC_PROVIDERS");
  const providers = rawProviders
    ? rawProviders.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean)
    : ["google.com"];

  return NextResponse.json(
    {
      enabled,
      config: enabled ? config : undefined,
      allowedHosts: enabled ? allowedHosts : [],
      providers: enabled ? providers : [],
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

