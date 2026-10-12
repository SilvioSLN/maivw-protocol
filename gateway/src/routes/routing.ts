import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { RoutingPoolService } from "../services/RoutingPoolService.js";

interface RoutingRoutesOptions {
  prisma: PrismaClient;
  routingPool: RoutingPoolService;
  internalServiceKey?: string;
}

const CreatePoolSchema = z.object({
  code: z.string().min(2).regex(/^[a-z0-9-_]+$/i, "Código do cluster deve conter apenas letras, números e hífens"),
  name: z.string().min(2),
  description: z.string().optional(),
  region: z.string().default("GLOBAL"),
  isDefault: z.boolean().default(false),
});

const UpdatePoolSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  region: z.string().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const CreateNodeSchema = z.object({
  name: z.string().min(2),
  endpointUrl: z.string().url("URL de endpoint inválida"),
  weight: z.coerce.number().int().min(1).max(1000).default(100),
  isActive: z.boolean().default(true),
});

const UpdateNodeSchema = z.object({
  name: z.string().min(2).optional(),
  endpointUrl: z.string().url().optional(),
  weight: z.coerce.number().int().min(1).max(1000).optional(),
  isActive: z.boolean().optional(),
});

const CreateRuleSchema = z.object({
  domainPattern: z.string().min(3),
  poolId: z.coerce.number().int().positive(),
  priority: z.coerce.number().int().default(0),
  notes: z.string().optional(),
});

const UpdateRuleSchema = z.object({
  domainPattern: z.string().min(3).optional(),
  poolId: z.coerce.number().int().positive().optional(),
  priority: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});

/**
 * Governança global não pode ser concedida pelo papel tenant `admin`.
 */
function requirePlatformAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  internalServiceKey?: string
): boolean {
  const reqServiceKey = request.headers["x-internal-service-key"];
  if (internalServiceKey && reqServiceKey === internalServiceKey) {
    return true;
  }

  reply.status(403).send({
    error: "Forbidden",
    message: "Acesso restrito ao serviço interno de governança da plataforma.",
  });
  return false;
}

export async function routingRoutes(app: FastifyInstance, options: RoutingRoutesOptions) {
  const { prisma, routingPool, internalServiceKey } = options;

  // ============================================
  //  1. Listar todos os Pools e Nós
  // ============================================
  app.get("/api/v1/routing/pools", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const pools = await prisma.endpointPool.findMany({
      include: {
        nodes: {
          orderBy: [{ weight: "desc" }, { id: "asc" }],
        },
        domainRules: {
          orderBy: { priority: "desc" },
        },
      },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    });

    return reply.send({
      success: true,
      pools,
    });
  });

  // ============================================
  //  2. Criar Novo Pool de Roteamento
  // ============================================
  app.post("/api/v1/routing/pools", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const parseResult = CreatePoolSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parseResult.error.flatten(),
      });
    }

    const { code, name, description, region, isDefault } = parseResult.data;

    // Se for default, desmarcar outros
    if (isDefault) {
      await prisma.endpointPool.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    try {
      const newPool = await prisma.endpointPool.create({
        data: {
          code: code.toLowerCase().trim(),
          name,
          description,
          region,
          isDefault,
        },
      });

      await routingPool.publishReloadNotification("create_pool");

      return reply.status(201).send({
        success: true,
        pool: newPool,
      });
    } catch (err: any) {
      return reply.status(400).send({
        error: "Falha ao criar pool",
        message: err.message.includes("Unique constraint")
          ? "Já existe um pool com esse código"
          : err.message,
      });
    }
  });

  // ============================================
  //  3. Atualizar Pool existente
  // ============================================
  app.put("/api/v1/routing/pools/:id", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const { id } = request.params as { id: string };
    const poolId = parseInt(id, 10);

    const parseResult = UpdatePoolSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parseResult.error.flatten(),
      });
    }

    if (parseResult.data.isDefault) {
      await prisma.endpointPool.updateMany({
        where: { id: { not: poolId }, isDefault: true },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.endpointPool.update({
      where: { id: poolId },
      data: parseResult.data,
    });

    await routingPool.publishReloadNotification("update_pool");

    return reply.send({
      success: true,
      pool: updated,
    });
  });

  // ============================================
  //  4. Excluir Pool
  // ============================================
  app.delete("/api/v1/routing/pools/:id", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const { id } = request.params as { id: string };
    const poolId = parseInt(id, 10);

    const pool = await prisma.endpointPool.findUnique({ where: { id: poolId } });
    if (!pool) {
      return reply.status(404).send({ error: "Pool não encontrado" });
    }

    if (pool.isDefault) {
      return reply.status(400).send({
        error: "Operação não permitida",
        message: "Não é possível excluir o pool marcado como padrão. Defina outro pool como padrão primeiro.",
      });
    }

    await prisma.endpointPool.delete({ where: { id: poolId } });
    await routingPool.publishReloadNotification("delete_pool");

    return reply.send({ success: true, message: `Pool ${pool.code} removido.` });
  });

  // ============================================
  //  5. Adicionar Nó a um Pool
  // ============================================
  app.post("/api/v1/routing/pools/:poolId/nodes", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const { poolId } = request.params as { poolId: string };
    const pId = parseInt(poolId, 10);

    const parseResult = CreateNodeSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parseResult.error.flatten(),
      });
    }

    const pool = await prisma.endpointPool.findUnique({ where: { id: pId } });
    if (!pool) {
      return reply.status(404).send({ error: "Pool não encontrado" });
    }

    const node = await prisma.endpointNode.create({
      data: {
        poolId: pId,
        ...parseResult.data,
      },
    });

    await routingPool.publishReloadNotification("create_node");

    return reply.status(201).send({
      success: true,
      node,
    });
  });

  // ============================================
  //  6. Atualizar Nó
  // ============================================
  app.put("/api/v1/routing/nodes/:id", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const { id } = request.params as { id: string };
    const nodeId = parseInt(id, 10);

    const parseResult = UpdateNodeSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parseResult.error.flatten(),
      });
    }

    const updated = await prisma.endpointNode.update({
      where: { id: nodeId },
      data: parseResult.data,
    });

    await routingPool.publishReloadNotification("update_node");

    return reply.send({
      success: true,
      node: updated,
    });
  });

  // ============================================
  //  7. Remover Nó
  // ============================================
  app.delete("/api/v1/routing/nodes/:id", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const { id } = request.params as { id: string };
    const nodeId = parseInt(id, 10);

    await prisma.endpointNode.delete({ where: { id: nodeId } });
    await routingPool.publishReloadNotification("delete_node");

    return reply.send({ success: true, message: `Nó #${nodeId} removido.` });
  });

  // ============================================
  //  8. Resetar Circuit Breaker / Restaurar Saúde do Nó
  // ============================================
  app.post("/api/v1/routing/nodes/:id/reset-health", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const { id } = request.params as { id: string };
    const nodeId = parseInt(id, 10);

    const node = await prisma.endpointNode.update({
      where: { id: nodeId },
      data: {
        isHealthy: true,
        failureCount: 0,
        lastFailure: null,
        lastChecked: new Date(),
      },
    });

    await routingPool.publishReloadNotification("reset_node_health");

    return reply.send({
      success: true,
      message: `Circuit Breaker do Nó #${nodeId} (${node.name}) resetado com sucesso.`,
      node,
    });
  });

  // ============================================
  //  9. Regras de Domínio: Listar
  // ============================================
  app.get("/api/v1/routing/rules", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const rules = await prisma.domainRouteRule.findMany({
      include: {
        pool: true,
      },
      orderBy: [{ priority: "desc" }, { id: "asc" }],
    });

    return reply.send({ success: true, rules });
  });

  // ============================================
  //  10. Regras de Domínio: Criar
  // ============================================
  app.post("/api/v1/routing/rules", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const parseResult = CreateRuleSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parseResult.error.flatten(),
      });
    }

    const { domainPattern, poolId, priority, notes } = parseResult.data;

    try {
      const rule = await prisma.domainRouteRule.create({
        data: {
          domainPattern: domainPattern.toLowerCase().trim(),
          poolId,
          priority,
          notes,
        },
        include: { pool: true },
      });

      await routingPool.publishReloadNotification("create_rule");

      return reply.status(201).send({ success: true, rule });
    } catch (err: any) {
      return reply.status(400).send({
        error: "Falha ao criar regra",
        message: err.message.includes("Unique constraint")
          ? "Já existe uma regra para este padrão de domínio"
          : err.message,
      });
    }
  });

  // ============================================
  //  11. Regras de Domínio: Atualizar
  // ============================================
  app.put("/api/v1/routing/rules/:id", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const { id } = request.params as { id: string };
    const ruleId = parseInt(id, 10);

    const parseResult = UpdateRuleSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parseResult.error.flatten(),
      });
    }

    const updated = await prisma.domainRouteRule.update({
      where: { id: ruleId },
      data: parseResult.data,
      include: { pool: true },
    });

    await routingPool.publishReloadNotification("update_rule");

    return reply.send({ success: true, rule: updated });
  });

  // ============================================
  //  12. Regras de Domínio: Excluir
  // ============================================
  app.delete("/api/v1/routing/rules/:id", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const { id } = request.params as { id: string };
    const ruleId = parseInt(id, 10);

    await prisma.domainRouteRule.delete({ where: { id: ruleId } });
    await routingPool.publishReloadNotification("delete_rule");

    return reply.send({ success: true, message: `Regra #${ruleId} removida.` });
  });

  // ============================================
  //  13. Teste / Simulador de Resolução de Roteamento em Tempo Real
  // ============================================
  app.post("/api/v1/routing/test-resolve", async (request, reply) => {
    if (!requirePlatformAdmin(request, reply, internalServiceKey)) return;

    const body = request.body as { domain?: string; onChainEndpointUrl?: string };
    if (!body?.domain) {
      return reply.status(400).send({ error: "Campo 'domain' é obrigatório" });
    }

    const resolved = routingPool.resolveTarget(body.domain, body.onChainEndpointUrl);

    return reply.send({
      success: true,
      simulation: {
        domain: body.domain,
        onChainEndpointUrl: body.onChainEndpointUrl || null,
        routeSource: resolved.source,
        poolCode: resolved.poolCode || null,
        poolName: resolved.poolName || null,
        isManagedByPlatform: resolved.isManagedByPlatform,
        selectedEndpoint: resolved.targetUrl,
        selectedNode: resolved.selectedNode
          ? {
              id: resolved.selectedNode.id,
              name: resolved.selectedNode.name,
              weight: resolved.selectedNode.weight,
              isHealthy: resolved.selectedNode.isHealthy,
              failureCount: resolved.selectedNode.failureCount,
            }
          : null,
        failoverCandidates: resolved.candidateNodes.map((c) => ({
          id: c.id,
          name: c.name,
          endpointUrl: c.endpointUrl,
          weight: c.weight,
          isHealthy: c.isHealthy,
        })),
      },
    });
  });
}
