import type { PrismaClient } from "@prisma/client";

export interface PrivateRouteEntry {
  targetDomain: string;
  privateEndpointUrl: string;
  stealthToken?: string | null;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DomainStealthConfig {
  domainName: string;
  mode?: "public" | "hybrid" | "dark";
  isStealthEnabled: boolean;
  inboundToken?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class StealthRoutingService {
  private prisma?: PrismaClient;
  // Fallback em memória para ultra-baixa latência e resiliência
  private memoryRoutes: Map<string, PrivateRouteEntry> = new Map();
  private memoryStealthConfigs: Map<string, DomainStealthConfig> = new Map();

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Normaliza o nome de domínio para minúsculas e sem espaços
   */
  private normalize(domain: string): string {
    return domain.trim().toLowerCase();
  }

  /**
   * Obtém a rota privada de saída para um Dark Endpoint
   */
  async getRoute(targetDomain: string): Promise<PrivateRouteEntry | null> {
    const domain = this.normalize(targetDomain);

    if (this.prisma) {
      try {
        const found = await this.prisma.privateRoute.findUnique({
          where: { targetDomain: domain },
        });
        if (found) {
          return {
            targetDomain: found.targetDomain,
            privateEndpointUrl: found.privateEndpointUrl,
            stealthToken: found.stealthToken,
            notes: found.notes,
            createdAt: found.createdAt,
            updatedAt: found.updatedAt,
          };
        }
      } catch (err) {
        console.error(`[STEALTH] Error querying Prisma for route "${domain}":`, err);
      }
    }

    return this.memoryRoutes.get(domain) || null;
  }

  /**
   * Salva ou atualiza uma rota privada de saída
   */
  async setRoute(
    targetDomain: string,
    privateEndpointUrl: string,
    stealthToken?: string,
    notes?: string
  ): Promise<PrivateRouteEntry> {
    const domain = this.normalize(targetDomain);
    const entry: PrivateRouteEntry = {
      targetDomain: domain,
      privateEndpointUrl: privateEndpointUrl.trim(),
      stealthToken: stealthToken?.trim() || null,
      notes: notes?.trim() || null,
      updatedAt: new Date(),
    };

    // Atualiza cache em memória
    this.memoryRoutes.set(domain, entry);

    if (this.prisma) {
      try {
        const upserted = await this.prisma.privateRoute.upsert({
          where: { targetDomain: domain },
          create: {
            targetDomain: domain,
            privateEndpointUrl: entry.privateEndpointUrl,
            stealthToken: entry.stealthToken,
            notes: entry.notes,
          },
          update: {
            privateEndpointUrl: entry.privateEndpointUrl,
            stealthToken: entry.stealthToken,
            notes: entry.notes,
          },
        });
        return {
          targetDomain: upserted.targetDomain,
          privateEndpointUrl: upserted.privateEndpointUrl,
          stealthToken: upserted.stealthToken,
          notes: upserted.notes,
          createdAt: upserted.createdAt,
          updatedAt: upserted.updatedAt,
        };
      } catch (err) {
        console.error(`[STEALTH] Error upserting Prisma route "${domain}":`, err);
      }
    }

    return entry;
  }

  /**
   * Lista todas as rotas privadas bilaterais cadastradas
   */
  async listRoutes(): Promise<PrivateRouteEntry[]> {
    if (this.prisma) {
      try {
        const routes = await this.prisma.privateRoute.findMany({
          orderBy: { updatedAt: "desc" },
        });
        return routes;
      } catch (err) {
        console.error("[STEALTH] Error listing Prisma routes:", err);
      }
    }

    return Array.from(this.memoryRoutes.values());
  }

  /**
   * Remove uma rota privada bilateral
   */
  async deleteRoute(targetDomain: string): Promise<boolean> {
    const domain = this.normalize(targetDomain);
    this.memoryRoutes.delete(domain);

    if (this.prisma) {
      try {
        await this.prisma.privateRoute.delete({
          where: { targetDomain: domain },
        });
        return true;
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Obtém a configuração de Modo Stealth do próprio domínio receptor
   */
  async getStealthConfig(domainName: string): Promise<DomainStealthConfig | null> {
    const domain = this.normalize(domainName);

    if (this.prisma) {
      try {
        const cfg: any = await this.prisma.stealthConfig.findUnique({
          where: { domainName: domain },
        });
        if (cfg) {
          return {
            ...cfg,
            mode: cfg.mode || (cfg.isStealthEnabled ? "dark" : "public"),
          };
        }
      } catch (err) {
        console.error(`[STEALTH] Error querying StealthConfig for "${domain}":`, err);
      }
    }

    return this.memoryStealthConfigs.get(domain) || null;
  }

  /**
   * Configura o Modo de Segurança (Público, Híbrido ou Dark Total) do domínio receptor
   */
  async setStealthConfig(
    domainName: string,
    isStealthEnabled: boolean,
    inboundToken?: string,
    mode?: "public" | "hybrid" | "dark"
  ): Promise<DomainStealthConfig> {
    const domain = this.normalize(domainName);
    const resolvedMode: "public" | "hybrid" | "dark" = mode || (isStealthEnabled ? "dark" : "public");
    const resolvedStealthEnabled = resolvedMode === "dark";

    const config: DomainStealthConfig = {
      domainName: domain,
      mode: resolvedMode,
      isStealthEnabled: resolvedStealthEnabled,
      inboundToken: inboundToken?.trim() || null,
      updatedAt: new Date(),
    };

    this.memoryStealthConfigs.set(domain, config);

    if (this.prisma) {
      try {
        const upserted: any = await this.prisma.stealthConfig.upsert({
          where: { domainName: domain },
          create: {
            domainName: domain,
            mode: resolvedMode,
            isStealthEnabled: resolvedStealthEnabled,
            inboundToken: config.inboundToken,
          },
          update: {
            mode: resolvedMode,
            isStealthEnabled: resolvedStealthEnabled,
            inboundToken: config.inboundToken,
          },
        });
        return {
          ...upserted,
          mode: (upserted.mode as any) || resolvedMode,
        };
      } catch (err) {
        console.error(`[STEALTH] Error saving StealthConfig for "${domain}":`, err);
      }
    }

    return config;
  }

  /**
   * Valida se a requisição recebida atende aos requisitos do Modo de Segurança.
   * Suporta:
   * - "public": Aberto a qualquer requisição P2P
   * - "hybrid": Aberto ao público geral E autentica canal VIP se o token bater
   * - "dark": Exige token pré-compartilhado obrigatoriamente (Silent Drop 404 se ausente/inválido)
   * 
   * Retorna { allowed: boolean, isStealth: boolean, mode?: string, isVipChannel?: boolean, domain?: string }
   */
  async validateInboundAccess(
    targetDomain?: string,
    providedToken?: string
  ): Promise<{ allowed: boolean; isStealth: boolean; mode?: string; isVipChannel?: boolean; domain?: string }> {
    if (targetDomain) {
      const config = await this.getStealthConfig(targetDomain);
      if (!config) {
        return { allowed: true, isStealth: false, mode: "public", domain: targetDomain };
      }

      const mode = config.mode || (config.isStealthEnabled ? "dark" : "public");

      // Modo Híbrido: Acesso público permitido; valida se token confere para tráfego VIP
      if (mode === "hybrid") {
        const isVip = Boolean(
          config.inboundToken &&
          providedToken &&
          providedToken.trim() === config.inboundToken.trim()
        );
        return { allowed: true, isStealth: false, mode: "hybrid", isVipChannel: isVip, domain: targetDomain };
      }

      // Modo Público: Sem restrições
      if (mode === "public" || !config.isStealthEnabled) {
        return { allowed: true, isStealth: false, mode: "public", domain: targetDomain };
      }

      // Modo Dark Estrito: Exige token obrigatório (Silent Drop 404 se ausente/inválido)
      if (config.inboundToken) {
        const match = Boolean(providedToken && providedToken.trim() === config.inboundToken.trim());
        return { allowed: match, isStealth: true, mode: "dark", domain: targetDomain };
      }

      return { allowed: true, isStealth: true, mode: "dark", domain: targetDomain };
    }

    // Se nenhum domínio destinatário foi informado (ex: port scan/probe bruto):
    // Verifica se este nó possui qualquer domínio com Modo Dark ativo
    let stealthConfigs: DomainStealthConfig[] = [];
    if (this.prisma) {
      try {
        const found: any = await this.prisma.stealthConfig.findMany({
          where: { isStealthEnabled: true },
        });
        stealthConfigs = found.map((f: any) => ({
          ...f,
          mode: f.mode || "dark",
        }));
      } catch (err) {
        console.error("[STEALTH] Error querying active stealth configs:", err);
      }
    }

    if (stealthConfigs.length === 0) {
      stealthConfigs = Array.from(this.memoryStealthConfigs.values()).filter((c) => c.isStealthEnabled);
    }

    // Apenas domínios com modo "dark" estrito provocam bloqueio em sondagem anônima
    const strictDarkConfigs = stealthConfigs.filter((c) => (c.mode || "dark") === "dark");
    if (strictDarkConfigs.length === 0) {
      return { allowed: true, isStealth: false, mode: "public" };
    }

    // Se houver domínios dark neste nó, valida se o token bate com qualquer um deles
    if (providedToken) {
      const match = strictDarkConfigs.find(
        (c) => c.inboundToken && c.inboundToken.trim() === providedToken.trim()
      );
      if (match) {
        return { allowed: true, isStealth: true, mode: "dark", domain: match.domainName };
      }
    }

    // Sondagem sem token em nó operando em Modo Dark estrito -> Bloqueia com 404 Silent Drop
    return { allowed: false, isStealth: true, mode: "dark" };
  }
}
