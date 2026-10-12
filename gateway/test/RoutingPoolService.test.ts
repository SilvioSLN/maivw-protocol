import test from "node:test";
import assert from "node:assert/strict";
import { RoutingPoolService } from "../src/services/RoutingPoolService.js";

// Mock minimal Prisma client for testing RoutingPoolService in-memory logic
function createMockPrisma() {
  const pools = [
    {
      id: 1,
      code: "default",
      name: "Cluster Global Padrão",
      description: "Default Ingress Pool",
      region: "GLOBAL",
      isDefault: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      nodes: [
        {
          id: 101,
          poolId: 1,
          name: "Node Ingress 01",
          endpointUrl: "https://inbound.maivw.com/api/v1/inbox",
          weight: 70,
          isActive: true,
          isHealthy: true,
          failureCount: 0,
          lastFailure: null,
          lastChecked: null,
          responseTimeMs: 25,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 102,
          poolId: 1,
          name: "Node Ingress 02",
          endpointUrl: "https://inbound-edge.maivw.org/api/v1/inbox",
          weight: 30,
          isActive: true,
          isHealthy: true,
          failureCount: 0,
          lastFailure: null,
          lastChecked: null,
          responseTimeMs: 35,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
    {
      id: 2,
      code: "sa-east-1",
      name: "Cluster América do Sul (São Paulo)",
      description: "São Paulo Low Latency Cluster",
      region: "BR",
      isDefault: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      nodes: [
        {
          id: 201,
          poolId: 2,
          name: "Node GRU 01",
          endpointUrl: "https://gru-1.maivw.internal/api/v1/inbox",
          weight: 80,
          isActive: true,
          isHealthy: true,
          failureCount: 0,
          lastFailure: null,
          lastChecked: null,
          responseTimeMs: 12,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 202,
          poolId: 2,
          name: "Node GRU 02",
          endpointUrl: "https://gru-2.maivw.internal/api/v1/inbox",
          weight: 20,
          isActive: true,
          isHealthy: true,
          failureCount: 0,
          lastFailure: null,
          lastChecked: null,
          responseTimeMs: 15,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
  ];

  const rules = [
    {
      id: 1,
      domainPattern: "*.com.br",
      poolId: 2,
      priority: 10,
      isActive: true,
      notes: "Regra Brasil",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      domainPattern: "governo.gov.br",
      poolId: 2,
      priority: 50,
      isActive: true,
      notes: "Regra Gov",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  return {
    endpointPool: {
      count: async () => pools.length,
      findMany: async () => pools,
      create: async (args: any) => ({ id: 99, ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      delete: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    domainRouteRule: {
      findMany: async () => rules,
      create: async (args: any) => ({ id: 99, ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      delete: async () => ({}),
    },
    endpointNode: {
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      delete: async () => ({}),
    },
  } as any;
}

test("RoutingPoolService — Platform Governance & Domain Rule Resolution", async () => {
  const mockPrisma = createMockPrisma();
  const service = new RoutingPoolService(mockPrisma);
  await service.loadCacheFromDb();

  // 1. Domínio brasileiro (*.com.br) deve ser direcionado pela plataforma para o pool sa-east-1
  const brResolution = service.resolveTarget("empresa.com.br", "https://inbound.maivw.com/api/v1/inbox");
  assert.equal(brResolution.source, "rule");
  assert.equal(brResolution.poolCode, "sa-east-1");
  assert.equal(brResolution.isManagedByPlatform, true);
  assert.ok(brResolution.selectedNode);
  assert.ok(brResolution.selectedNode.endpointUrl.includes("gru-"));

  // 2. Domínio internacional sem regra específica deve cair no pool padrão (default)
  const usResolution = service.resolveTarget("company.com", "https://inbound.maivw.com/api/v1/inbox");
  assert.equal(usResolution.source, "default");
  assert.equal(usResolution.poolCode, "default");
  assert.equal(usResolution.isManagedByPlatform, true);
  assert.ok(usResolution.selectedNode);
  assert.ok(
    usResolution.selectedNode.endpointUrl === "https://inbound.maivw.com/api/v1/inbox" ||
    usResolution.selectedNode.endpointUrl === "https://inbound-edge.maivw.org/api/v1/inbox"
  );

  // 3. Domínio externo autohospedado fora da Maivw deve respeitar URL direta on-chain
  const selfHostedResolution = service.resolveTarget("bancoprivado.com", "https://gateway.bancoprivado.com/api/v1/inbox");
  assert.equal(selfHostedResolution.source, "on-chain-direct");
  assert.equal(selfHostedResolution.isManagedByPlatform, false);
  assert.equal(selfHostedResolution.targetUrl, "https://gateway.bancoprivado.com/api/v1/inbox");
  assert.equal(selfHostedResolution.selectedNode, null);

  service.destroy();
});

test("RoutingPoolService — Circuit Breaker & Automatic Failover", async () => {
  const mockPrisma = createMockPrisma();
  const service = new RoutingPoolService(mockPrisma);
  await service.loadCacheFromDb();

  // Simular falhas consecutivas no nó GRU 01 (id 201)
  await service.recordNodeFailure(201, "Timeout 6000ms");
  await service.recordNodeFailure(201, "Timeout 6000ms");

  // Após 2 falhas, ainda é tolerado (< 3)
  const pool = service.getAllPools().find((p) => p.code === "sa-east-1");
  const node201 = pool?.nodes.find((n) => n.id === 201);
  assert.equal(node201?.failureCount, 2);
  assert.equal(node201?.isHealthy, true);

  // 3ª falha -> Circuit Breaker deve disparar (isHealthy = false)
  await service.recordNodeFailure(201, "HTTP 502 Bad Gateway");
  assert.equal(node201?.failureCount, 3);
  assert.equal(node201?.isHealthy, false);

  // Agora, resoluções para *.com.br NÃO DEVEM mais selecionar o nó 201 (em quarentena)
  for (let i = 0; i < 10; i++) {
    const res = service.resolveTarget("itau.com.br", "https://inbound.maivw.com/api/v1/inbox");
    assert.equal(res.poolCode, "sa-east-1");
    // O nó selecionado deve ser exclusivamente o nó 202 saudável!
    assert.equal(res.selectedNode?.id, 202);
  }

  // Simular recuperação do nó 201 após entrega bem-sucedida ou probe
  await service.recordNodeSuccess(201, 10);
  assert.equal(node201?.isHealthy, true);
  assert.equal(node201?.failureCount, 0);

  service.destroy();
});
