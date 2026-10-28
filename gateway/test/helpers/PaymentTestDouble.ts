/**
 * PaymentTestDouble.ts
 *
 * Provedor de componentes de pagamento para testes do gateway.
 * Em ambiente monorepo completo, importa de cloud/payment.
 * Em instalacao standalone (Community/protocol puro), fornece test doubles em memoria (R10).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadPaymentComponents() {
  const candidatePath = path.resolve(__dirname, "../../../../../cloud/payment/src/services/PaymentRepository.ts");
  const candidateJsPath = path.resolve(__dirname, "../../../../../cloud/payment/src/services/PaymentRepository.js");

  if (fs.existsSync(candidatePath) || fs.existsSync(candidateJsPath)) {
    try {
      const pRepo = await import("../../../../../cloud/payment/src/services/PaymentRepository.js");
      const oStore = await import("../../../../../cloud/payment/src/services/OrderStore.js");
      const auth = await import("../../../../../cloud/payment/src/utils/auth.js");
      return {
        InMemoryPaymentRepository: pRepo.InMemoryPaymentRepository,
        OrderStore: oStore.OrderStore,
        signJwtToken: auth.signJwtToken,
        isStandaloneFallback: false,
      };
    } catch {
      // Fallback para standalone se importacao falhar
    }
  }

  // Standalone doubles para suite de testes do protocolo community
  const signJwtToken = (
    payload: { id: number; email?: string; role?: "admin" | "user"; domainId?: number; domainName?: string },
    secret: string,
    expiresInSeconds: number = 7 * 86400
  ): string => {
    const header = { alg: "HS256", typ: "JWT" };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
    const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest("base64url");
    return `${headerB64}.${payloadB64}.${sig}`;
  };

  class StandalonePaymentRepository {
    private orders = new Map<string, any>();
    private webhooks = new Set<string>();

    async init(): Promise<void> {}

    async createOrder(data: any): Promise<any> {
      const id = "ord_" + crypto.randomUUID().slice(0, 8);
      const order = {
        id,
        ...data,
        status: "PENDING",
        createdAt: new Date(),
        paidAt: null,
      };
      this.orders.set(id, order);
      return order;
    }

    async getOrder(orderId: string): Promise<any | null> {
      return this.orders.get(orderId) || null;
    }

    async recordWebhookEvent(event: {
      provider: string;
      eventId: string;
      eventType: string;
      orderId: string;
      payload: any;
    }): Promise<{ isDuplicate: boolean }> {
      const key = `${event.provider}:${event.eventId}`;
      if (this.webhooks.has(key)) {
        return { isDuplicate: true };
      }
      this.webhooks.add(key);
      return { isDuplicate: false };
    }

    async fulfillOrder(orderId: string, fulfillFn: () => Promise<any>): Promise<{ order: any; alreadyPaid: boolean }> {
      const order = this.orders.get(orderId);
      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }
      if (order.status === "PAID") {
        return { order, alreadyPaid: true };
      }
      const res = await fulfillFn();
      order.status = "PAID";
      order.paidAt = new Date();
      order.txHash = res.txHash;
      order.domainId = res.domainId;
      return { order, alreadyPaid: false };
    }
  }

  class StandaloneOrderStore {
    constructor(private getRepo: () => StandalonePaymentRepository) {}

    async createOrder(data: any): Promise<any> {
      return this.getRepo().createOrder(data);
    }
  }

  return {
    InMemoryPaymentRepository: StandalonePaymentRepository,
    OrderStore: StandaloneOrderStore,
    signJwtToken,
    isStandaloneFallback: true,
  };
}
