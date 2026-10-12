import { PrismaClient } from "@prisma/client";

/**
 * Serviço de Reputação Local Granular do MAIVW (Fase 7).
 * Armazena e avalia a reputação de remetentes com base na chave composta [domain, subIdentityId].
 * Isso garante que um único usuário de um grande provedor (ex: SendGrid, Google Workspace, Hotmail)
 * que envie spam seja bloqueado localmente sem afetar outros usuários legítimos do mesmo domínio.
 */
export class ReputationService {
  private prisma: PrismaClient;
  private isConnected: boolean = false;

  constructor() {
    this.prisma = new PrismaClient();
    this.init();
  }

  private async init() {
    try {
      await this.prisma.$connect();
      this.isConnected = true;
      console.log("[REPUTATION] Connected to PostgreSQL via Prisma");
    } catch (err) {
      console.warn("[REPUTATION] PostgreSQL not connected yet, operating in in-memory fallback mode");
    }
  }

  /**
   * Normaliza os valores de domínio e sub-identidade para consultas determinísticas.
   */
  private normalizeKey(domain: string, subIdentityId?: string) {
    return {
      domain: domain.toLowerCase().trim(),
      subIdentityId: (subIdentityId || "default").trim(),
    };
  }

  /**
   * Verifica se um remetente [domain, subIdentityId] está bloqueado no banco local.
   */
  async isSenderBlocked(domain: string, subIdentityId?: string): Promise<boolean> {
    const { domain: d, subIdentityId: s } = this.normalizeKey(domain, subIdentityId);

    try {
      const record = await this.prisma.reputation.findUnique({
        where: {
          domain_subIdentityId: {
            domain: d,
            subIdentityId: s,
          },
        },
      });

      return record ? record.isBlocked : false;
    } catch (err) {
      console.error("[REPUTATION] Error checking sender block status:", err);
      return false;
    }
  }

  /**
   * Registra uma infração e atualiza strikes e pontuação de reputação.
   * Se os strikes atingirem 3 ou mais, bloqueia a sub-identidade imediatamente.
   */
  async recordViolation(
    domain: string,
    subIdentityId?: string,
    reason?: string
  ): Promise<{ isBlocked: boolean; strikes: number }> {
    const { domain: d, subIdentityId: s } = this.normalizeKey(domain, subIdentityId);

    try {
      const existing = await this.prisma.reputation.findUnique({
        where: {
          domain_subIdentityId: {
            domain: d,
            subIdentityId: s,
          },
        },
      });

      const newStrikes = (existing?.strikes || 0) + 1;
      const shouldBlock = newStrikes >= 3;
      const newScore = Math.max(0, (existing?.reputationScore || 100) - 30);

      const updated = await this.prisma.reputation.upsert({
        where: {
          domain_subIdentityId: {
            domain: d,
            subIdentityId: s,
          },
        },
        create: {
          domain: d,
          subIdentityId: s,
          strikes: newStrikes,
          isBlocked: shouldBlock,
          reputationScore: newScore,
          lastViolation: new Date(),
        },
        update: {
          strikes: newStrikes,
          isBlocked: shouldBlock,
          reputationScore: newScore,
          lastViolation: new Date(),
        },
      });

      console.log(
        `[REPUTATION] Recorded violation for ${d}#${s}. Strikes: ${updated.strikes}, Blocked: ${updated.isBlocked}. Reason: ${reason || "N/A"}`
      );

      return { isBlocked: updated.isBlocked, strikes: updated.strikes };
    } catch (err) {
      console.error("[REPUTATION] Error recording violation:", err);
      return { isBlocked: false, strikes: 1 };
    }
  }

  /**
   * Força o bloqueio de uma sub-identidade específica de um provedor.
   */
  async blockIdentity(domain: string, subIdentityId: string): Promise<void> {
    const { domain: d, subIdentityId: s } = this.normalizeKey(domain, subIdentityId);

    try {
      await this.prisma.reputation.upsert({
        where: {
          domain_subIdentityId: {
            domain: d,
            subIdentityId: s,
          },
        },
        create: {
          domain: d,
          subIdentityId: s,
          isBlocked: true,
          strikes: 3,
          reputationScore: 0,
          lastViolation: new Date(),
        },
        update: {
          isBlocked: true,
          reputationScore: 0,
          lastViolation: new Date(),
        },
      });
      console.log(`[REPUTATION] Identity blocked: ${d}#${s}`);
    } catch (err) {
      console.error("[REPUTATION] Error blocking identity:", err);
    }
  }

  /**
   * Retorna os dados de reputação de uma identidade.
   */
  async getReputation(domain: string, subIdentityId?: string) {
    const { domain: d, subIdentityId: s } = this.normalizeKey(domain, subIdentityId);

    try {
      return await this.prisma.reputation.findUnique({
        where: {
          domain_subIdentityId: {
            domain: d,
            subIdentityId: s,
          },
        },
      });
    } catch (err) {
      return null;
    }
  }
}
