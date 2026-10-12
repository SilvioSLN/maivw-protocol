import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";

export interface EndpointNodeData {
  id: number;
  poolId: number;
  name: string;
  endpointUrl: string;
  weight: number;
  isActive: boolean;
  isHealthy: boolean;
  failureCount: number;
  lastFailure: Date | null;
  lastChecked: Date | null;
  responseTimeMs: number | null;
}

export interface EndpointPoolData {
  id: number;
  code: string;
  name: string;
  description: string | null;
  region: string | null;
  isDefault: boolean;
  isActive: boolean;
  nodes: EndpointNodeData[];
}

export interface DomainRouteRuleData {
  id: number;
  domainPattern: string;
  poolId: number;
  priority: number;
  isActive: boolean;
  notes: string | null;
}

export interface ResolvedRoute {
  source: "rule" | "default" | "on-chain-direct" | "fallback";
  poolCode?: string;
  poolName?: string;
  selectedNode: EndpointNodeData | null;
  candidateNodes: EndpointNodeData[];
  targetUrl: string;
  isManagedByPlatform: boolean;
}

const REDIS_ROUTING_CHANNEL = "maivw:routing:reload";
const CONFIG_PLATFORM_INGRESS = (process.env.PLATFORM_INGRESS_HOSTS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const PLATFORM_INGRESS_HOSTS = [
  ...CONFIG_PLATFORM_INGRESS,
  "inbound.maivw.org",
  "inbound.maivw.com",
  "p2p.maivw.org",
  "p2p.maivw.com",
  "gateway",
  "localhost",
  "127.0.0.1",
];

export class RoutingPoolService {
  private prisma: PrismaClient;
  private redisPub: Redis | null = null;
  private redisSub: Redis | null = null;
  private isRedisConnected = false;

  // Cache em memória de alta performance (<0.1ms por resolução)
  private pools = new Map<number, EndpointPoolData>();
  private poolsByCode = new Map<string, EndpointPoolData>();
  private domainRules: DomainRouteRuleData[] = [];
  private defaultPoolId: number | null = null;

  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor(prisma: PrismaClient, redisUrl?: string) {
    this.prisma = prisma;
    this.initRedis(redisUrl);
  }

  async checkRedisHealth(): Promise<void> {
    if (!this.redisPub || this.redisPub.status !== "ready") {
      throw new Error("Redis is not ready");
    }
    if (await this.redisPub.ping() !== "PONG") {
      throw new Error("Unexpected Redis ping response");
    }
  }

  private initRedis(redisUrl?: string) {
    if (!redisUrl) return;

    try {
      this.redisPub = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        retryStrategy: (times: number) => Math.min(times * 500, 5000),
      });

      this.redisSub = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        retryStrategy: (times: number) => Math.min(times * 500, 5000),
      });

      this.redisPub.connect().catch((err: any) => {
        console.warn(`[ROUTING-POOL] Redis Pub connection failed: ${err.message}. Using local memory cache.`);
      });

      this.redisSub.connect().then(() => {
        this.isRedisConnected = true;
        this.redisSub?.subscribe(REDIS_ROUTING_CHANNEL, (err: any) => {
          if (err) {
            console.warn(`[ROUTING-POOL] Redis Subscribe error: ${err.message}`);
          } else {
            console.log(`[ROUTING-POOL] 🚀 Subscribed to Redis channel "${REDIS_ROUTING_CHANNEL}" for live hot-reload`);
          }
        });

        this.redisSub?.on("message", (channel: string, message: string) => {
          if (channel === REDIS_ROUTING_CHANNEL) {
            console.log(`[ROUTING-POOL] 🔄 Hot-reload signal received from Redis: ${message}`);
            this.loadCacheFromDb().catch((e) => {
              console.error("[ROUTING-POOL] Error during Redis-triggered cache reload:", e);
            });
          }
        });
      }).catch((err: any) => {
        console.warn(`[ROUTING-POOL] Redis Sub connection failed: ${err.message}.`);
      });
    } catch (e: any) {
      console.warn(`[ROUTING-POOL] Redis initialization warning: ${e.message}`);
    }
  }

  /**
   * Inicializa o serviço, realiza seed se necessário e inicia o health-check runner
   */
  async start(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.ensureSeedData();
      await this.loadCacheFromDb();
      this.startHealthCheckRunner();
      this.isInitialized = true;
      console.log(`[ROUTING-POOL] ✅ RoutingPoolService initialized with ${this.pools.size} pools and ${this.domainRules.length} rules`);
    } catch (error) {
      console.error("[ROUTING-POOL] ❌ Error starting RoutingPoolService:", error);
    }
  }

  /**
   * Garante a criação de pools e nós padrão se o banco estiver vazio
   */
  private async ensureSeedData(): Promise<void> {
    try {
      const count = await this.prisma.endpointPool.count();
      if (count === 0) {
        console.log("[ROUTING-POOL] 📦 Banco vazio de pools. Criando Pools e Nós P2P padrão da plataforma MAIVW...");

        const defaultPool = await this.prisma.endpointPool.create({
          data: {
            code: "default",
            name: "Cluster Global Padrão (Anycast Ingress)",
            description: "Pool global de entrada padrão da plataforma MAIVW com failover resiliente",
            region: "GLOBAL",
            isDefault: true,
            isActive: true,
            nodes: {
              create: [
                {
                  name: "Node Ingress 01 (Principal)",
                  endpointUrl: "https://inbound.maivw.com/api/v1/inbox",
                  weight: 70,
                  isActive: true,
                  isHealthy: true,
                },
                {
                  name: "Node Ingress 02 (Secundário)",
                  endpointUrl: process.env.DEFAULT_SECONDARY_INGRESS_URL || "https://inbound-edge.maivw.org/api/v1/inbox",
                  weight: 30,
                  isActive: true,
                  isHealthy: true,
                },
              ],
            },
          },
        });

        await this.prisma.endpointPool.create({
          data: {
            code: "sa-east-1",
            name: "Cluster América do Sul (São Paulo)",
            description: "Nós de baixa latência e alta densidade para o mercado brasileiro e latino-americano",
            region: "BR",
            isDefault: false,
            isActive: true,
            nodes: {
              create: [
                {
                  name: "Node GRU Edge-01",
                  endpointUrl: "https://inbound.maivw.com/api/v1/inbox",
                  weight: 60,
                  isActive: true,
                  isHealthy: true,
                },
                {
                  name: "Node GRU Edge-02",
                  endpointUrl: process.env.DEFAULT_SECONDARY_INGRESS_URL || "https://inbound-edge.maivw.org/api/v1/inbox",
                  weight: 40,
                  isActive: true,
                  isHealthy: true,
                },
              ],
            },
            domainRules: {
              create: [
                {
                  domainPattern: "*.com.br",
                  priority: 10,
                  isActive: true,
                  notes: "Domínios corporativos brasileiros direcionados para cluster São Paulo",
                },
                {
                  domainPattern: "*.gov.br",
                  priority: 20,
                  isActive: true,
                  notes: "Domínios governamentais e regulados com baixa latência nacional",
                },
              ],
            },
          },
        });

        console.log(`[ROUTING-POOL] ✅ Seed concluído. Default pool ID: ${defaultPool.id}`);
      }
    } catch (err: any) {
      console.warn(`[ROUTING-POOL] Seed check warning: ${err.message}`);
    }
  }

  /**
   * Recarrega todos os pools, nós e regras do PostgreSQL para a memória
   */
  async loadCacheFromDb(): Promise<void> {
    const dbPools = await this.prisma.endpointPool.findMany({
      include: {
        nodes: true,
      },
      orderBy: { id: "asc" },
    });

    const dbRules = await this.prisma.domainRouteRule.findMany({
      where: { isActive: true },
      orderBy: { priority: "desc" },
    });

    const newPools = new Map<number, EndpointPoolData>();
    const newPoolsByCode = new Map<string, EndpointPoolData>();
    let newDefaultPoolId: number | null = null;

    for (const p of dbPools) {
      const poolData: EndpointPoolData = {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        region: p.region,
        isDefault: p.isDefault,
        isActive: p.isActive,
        nodes: p.nodes.map((n) => ({
          id: n.id,
          poolId: n.poolId,
          name: n.name,
          endpointUrl: n.endpointUrl,
          weight: n.weight,
          isActive: n.isActive,
          isHealthy: n.isHealthy,
          failureCount: n.failureCount,
          lastFailure: n.lastFailure,
          lastChecked: n.lastChecked,
          responseTimeMs: n.responseTimeMs,
        })),
      };

      newPools.set(p.id, poolData);
      newPoolsByCode.set(p.code, poolData);
      if (p.isDefault && p.isActive) {
        newDefaultPoolId = p.id;
      }
    }

    // Se nenhum pool tem isDefault, seleciona o primeiro ativo
    if (!newDefaultPoolId && dbPools.length > 0) {
      newDefaultPoolId = dbPools[0].id;
    }

    this.pools = newPools;
    this.poolsByCode = newPoolsByCode;
    this.domainRules = dbRules;
    this.defaultPoolId = newDefaultPoolId;

    console.log(
      `[ROUTING-POOL] 🔄 Cache atualizado em memória: ${this.pools.size} pools carregados, defaultPoolId=${this.defaultPoolId}`
    );
  }

  /**
   * Notifica todas as instâncias do Gateway para recarregar o cache via Redis
   */
  async publishReloadNotification(reason = "mutation"): Promise<void> {
    // 1. Recarrega a própria instância
    await this.loadCacheFromDb();

    // 2. Notifica as outras instâncias via Redis Pub/Sub
    if (this.redisPub) {
      try {
        await this.redisPub.publish(
          REDIS_ROUTING_CHANNEL,
          JSON.stringify({ timestamp: Date.now(), reason })
        );
      } catch (err: any) {
        console.warn(`[ROUTING-POOL] Could not publish reload to Redis: ${err.message}`);
      }
    }
  }

  /**
   * Verifica se a URL on-chain informada pertence à infraestrutura gerenciada do Maivw
   */
  isPlatformManagedEndpoint(endpointUrl: string | null | undefined): boolean {
    if (!endpointUrl) return true;
    try {
      const url = new URL(endpointUrl);
      const hostname = url.hostname.toLowerCase();
      if (hostname === "gateway" || hostname === "localhost" || hostname === "127.0.0.1") {
        return true;
      }
      if (hostname === "maivw.com" || hostname.endsWith(".maivw.com")) {
        return true;
      }
      if (hostname === "maivw.org" || hostname.endsWith(".maivw.org")) {
        return true;
      }
      if (CONFIG_PLATFORM_INGRESS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Resolve o endpoint alvo para um determinado domínio.
   * 
   * Diretrizes do Maivw:
   * 1. Se o domínio tem um endpoint on-chain personalizado (ex: servidor autohospedado fora da Maivw),
   *    respeitamos diretamente a URL on-chain.
   * 2. Se o domínio está sob gestão da Maivw (Smart Ingress) ou usa o Ingress oficial:
   *    A PLATAFORMA DECIDE O ROTEAMENTO (o cliente não escolhe).
   *    A plataforma consulta regras de domínio (ex: *.com.br -> sa-east-1),
   *    aplica Weighted Round-Robin nos nós saudáveis e fornece candidatos de failover imediato.
   */
  resolveTarget(
    targetDomain: string,
    onChainEndpointUrl?: string | null
  ): ResolvedRoute {
    const cleanDomain = targetDomain.trim().toLowerCase();

    // 1. Caso seja um endpoint externo privado/autohospedado fora da rede gerenciada Maivw
    if (onChainEndpointUrl && !this.isPlatformManagedEndpoint(onChainEndpointUrl)) {
      return {
        source: "on-chain-direct",
        targetUrl: onChainEndpointUrl,
        selectedNode: null,
        candidateNodes: [],
        isManagedByPlatform: false,
      };
    }

    // 2. Domínio sob governança da Plataforma Maivw -> Roteamento Inteligente
    let matchedPoolId: number | null = null;
    let matchedRule: DomainRouteRuleData | null = null;

    for (const rule of this.domainRules) {
      if (!rule.isActive) continue;
      const pattern = rule.domainPattern.toLowerCase().trim();

      // Correspondência exata: "itau.com.br"
      if (pattern === cleanDomain) {
        matchedPoolId = rule.poolId;
        matchedRule = rule;
        break;
      }

      // Correspondência wildcard com prefixo: "*.com.br" ou "*.gov.br"
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(1); // ".com.br"
        if (cleanDomain.endsWith(suffix)) {
          matchedPoolId = rule.poolId;
          matchedRule = rule;
          break;
        }
      }

      // Correspondência por herança de subdomínio: ex. "empresa.com" abrange "mail.empresa.com"
      if (cleanDomain.endsWith(`.${pattern}`)) {
        matchedPoolId = rule.poolId;
        matchedRule = rule;
        break;
      }
    }

    // Se nenhuma regra bater, usa o pool padrão (defaultPoolId)
    const effectivePoolId = matchedPoolId || this.defaultPoolId;
    let targetPool = effectivePoolId ? this.pools.get(effectivePoolId) : null;

    // Se o pool alvo estiver inativo, recorre ao defaultPool
    if (targetPool && !targetPool.isActive && this.defaultPoolId) {
      targetPool = this.pools.get(this.defaultPoolId) || null;
    }

    if (!targetPool) {
      // Fallback de emergência caso nenhum pool esteja configurado
      const fallbackUrl = onChainEndpointUrl || "https://inbound.maivw.com/api/v1/inbox";
      return {
        source: "fallback",
        targetUrl: fallbackUrl,
        selectedNode: null,
        candidateNodes: [],
        isManagedByPlatform: true,
      };
    }

    // Filtrar nós ativos e saudáveis (Circuit Breaker)
    const healthyNodes = targetPool.nodes.filter((n) => n.isActive && n.isHealthy);
    
    // Se todos os nós do pool estiverem em quarentena/fora, tentar nós saudáveis do pool padrão
    let candidateNodes = healthyNodes;
    if (candidateNodes.length === 0 && this.defaultPoolId && targetPool.id !== this.defaultPoolId) {
      const defaultPool = this.pools.get(this.defaultPoolId);
      if (defaultPool) {
        candidateNodes = defaultPool.nodes.filter((n) => n.isActive && n.isHealthy);
      }
    }

    // Se ainda assim não houver nós saudáveis, usar qualquer nó ativo (degradação graciosa com tentativa)
    if (candidateNodes.length === 0) {
      candidateNodes = targetPool.nodes.filter((n) => n.isActive);
    }

    if (candidateNodes.length === 0) {
      const fallbackUrl = onChainEndpointUrl || "https://inbound.maivw.com/api/v1/inbox";
      return {
        source: "fallback",
        poolCode: targetPool.code,
        poolName: targetPool.name,
        targetUrl: fallbackUrl,
        selectedNode: null,
        candidateNodes: [],
        isManagedByPlatform: true,
      };
    }

    // Seleção via Weighted Round-Robin
    const selectedNode = this.selectWeightedNode(candidateNodes);
    
    // Lista ordenada de candidatos para failover imediato (o selecionado primeiro, seguido dos outros)
    const orderedCandidates = [
      selectedNode,
      ...candidateNodes.filter((n) => n.id !== selectedNode.id),
    ];

    return {
      source: matchedRule ? "rule" : "default",
      poolCode: targetPool.code,
      poolName: targetPool.name,
      selectedNode,
      candidateNodes: orderedCandidates,
      targetUrl: selectedNode.endpointUrl,
      isManagedByPlatform: true,
    };
  }

  /**
   * Seleciona um nó dentre os candidatos com base em seus pesos relativos
   */
  private selectWeightedNode(nodes: EndpointNodeData[]): EndpointNodeData {
    if (nodes.length === 1) return nodes[0];

    const totalWeight = nodes.reduce((sum, n) => sum + Math.max(n.weight, 1), 0);
    let randomVal = Math.random() * totalWeight;

    for (const node of nodes) {
      const w = Math.max(node.weight, 1);
      if (randomVal < w) {
        return node;
      }
      randomVal -= w;
    }

    return nodes[0];
  }

  /**
   * Registra uma falha de entrega (timeout 6s ou HTTP 5xx).
   * Incrementa contagem de falhas. Se failureCount >= 3, aciona o Circuit Breaker (isHealthy = false).
   */
  async recordNodeFailure(nodeId: number, reason: string): Promise<void> {
    for (const pool of this.pools.values()) {
      const node = pool.nodes.find((n) => n.id === nodeId);
      if (node) {
        node.failureCount += 1;
        node.lastFailure = new Date();
        const tripped = node.failureCount >= 3;
        if (tripped) {
          node.isHealthy = false;
          console.warn(
            `[ROUTING-POOL] 🚨 Circuit Breaker acionado para Nó #${node.id} (${node.name} - ${node.endpointUrl})! Falhas: ${node.failureCount}. Motivo: ${reason}`
          );
        } else {
          console.warn(
            `[ROUTING-POOL] ⚠️ Falha registrada para Nó #${node.id} (${node.name}): falha ${node.failureCount}/3. Motivo: ${reason}`
          );
        }

        // Atualizar no banco de dados de forma assíncrona
        this.prisma.endpointNode
          .update({
            where: { id: nodeId },
            data: {
              failureCount: node.failureCount,
              isHealthy: node.isHealthy,
              lastFailure: node.lastFailure,
            },
          })
          .catch((err) => {
            console.error(`[ROUTING-POOL] Error persisting node failure: ${err.message}`);
          });

        break;
      }
    }
  }

  /**
   * Registra uma entrega bem-sucedida. Zera contador de falhas e atualiza latência.
   */
  async recordNodeSuccess(nodeId: number, responseTimeMs?: number): Promise<void> {
    for (const pool of this.pools.values()) {
      const node = pool.nodes.find((n) => n.id === nodeId);
      if (node) {
        const wasDown = !node.isHealthy;
        node.failureCount = 0;
        node.isHealthy = true;
        node.lastChecked = new Date();
        if (responseTimeMs !== undefined) {
          node.responseTimeMs = responseTimeMs;
        }

        if (wasDown) {
          console.log(`[ROUTING-POOL] 🟢 Nó #${node.id} (${node.name}) recuperado com sucesso após entrega OK!`);
        }

        this.prisma.endpointNode
          .update({
            where: { id: nodeId },
            data: {
              failureCount: 0,
              isHealthy: true,
              lastChecked: node.lastChecked,
              responseTimeMs: node.responseTimeMs,
            },
          })
          .catch((err) => {
            console.error(`[ROUTING-POOL] Error persisting node success: ${err.message}`);
          });

        break;
      }
    }
  }

  /**
   * Runner periódico de Health-Check (a cada 15 segundos)
   * Projeta sondas /health em nós degradados ou inativos para restaurá-los automaticamente.
   */
  private startHealthCheckRunner(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      for (const pool of this.pools.values()) {
        for (const node of pool.nodes) {
          if (!node.isActive) continue;

          // Se estiver não saudável ou sem checagem há mais de 60 segundos
          const shouldProbe = !node.isHealthy || !node.lastChecked || (Date.now() - node.lastChecked.getTime() > 60000);
          if (shouldProbe) {
            this.probeNodeHealth(node).catch(() => {});
          }
        }
      }
    }, 15000);
  }

  /**
   * Realiza probe HTTP em um nó
   */
  private async probeNodeHealth(node: EndpointNodeData): Promise<void> {
    const healthUrl = this.buildHealthUrl(node.endpointUrl);
    const start = Date.now();

    try {
      const res = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(4000),
      });

      const latency = Date.now() - start;

      if (res.ok) {
        const wasUnhealthy = !node.isHealthy;
        node.isHealthy = true;
        node.failureCount = 0;
        node.lastChecked = new Date();
        node.responseTimeMs = latency;

        if (wasUnhealthy) {
          console.log(
            `[ROUTING-POOL] 🟢 Nó #${node.id} (${node.name}) RESTAURADO pelo Health Check! Latência: ${latency}ms`
          );
        }

        await this.prisma.endpointNode.update({
          where: { id: node.id },
          data: {
            isHealthy: true,
            failureCount: 0,
            lastChecked: node.lastChecked,
            responseTimeMs: latency,
          },
        });
      } else {
        node.lastChecked = new Date();
      }
    } catch {
      node.lastChecked = new Date();
    }
  }

  private buildHealthUrl(endpointUrl: string): string {
    try {
      const url = new URL(endpointUrl);
      return `${url.origin}/health`;
    } catch {
      return `${endpointUrl.replace(/\/api\/v1\/inbox.*$/, "")}/health`;
    }
  }

  /**
   * Retorna os dados completos dos Pools e Nós para a API administrativa
   */
  getAllPools(): EndpointPoolData[] {
    return Array.from(this.pools.values());
  }

  getAllRules(): DomainRouteRuleData[] {
    return this.domainRules;
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.redisSub?.disconnect();
    this.redisPub?.disconnect();
  }
}
