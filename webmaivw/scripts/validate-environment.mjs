if (process.env.VERCEL && !process.env.MAIVW_ENVIRONMENT) {
  throw new Error("MAIVW_ENVIRONMENT é obrigatório na Vercel");
}
const mode = process.env.MAIVW_ENVIRONMENT || "local";
const modes = new Set(["local", "testnet", "staging", "production"]);

if (!modes.has(mode)) throw new Error("MAIVW_ENVIRONMENT inválido");

if (mode !== "local") {
  for (const name of [
    "NEXT_PUBLIC_GATEWAY_URL",
    "NEXT_PUBLIC_WEBMAIVW_URL",
    "NEXT_PUBLIC_RPC_URL",
  ]) {
    const value = process.env[name];
    if (!value || new URL(value).protocol !== "https:") {
      throw new Error(`${name} deve usar HTTPS fora de local`);
    }
  }
  const payment = process.env.NEXT_PUBLIC_PAYMENT_API_URL;
  if (payment && new URL(payment).protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_PAYMENT_API_URL deve usar HTTPS fora de local");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS || "")) {
    throw new Error("NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS inválido");
  }
}

// Firebase é entregue em runtime pelo endpoint server-side. Isso mantém a
// imagem WebMaivw imutável entre staging e production.
for (const legacy of Object.keys(process.env).filter((name) => name.startsWith("NEXT_PUBLIC_FIREBASE_"))) {
  throw new Error(`${legacy} não deve ser incorporada no build; use FIREBASE_PUBLIC_* em runtime`);
}

console.log(`[CONFIG] WebMaivw validado para ${mode}.`);
