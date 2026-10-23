import type { FastifyInstance, FastifyBaseLogger } from "fastify";

export type RuntimeLifecycleStatus = "starting" | "ready" | "draining" | "stopped";

export interface ShutdownHooks {
  app?: FastifyInstance;
  pauseQueues?: () => Promise<void>;
  drainJobs?: (timeoutMs: number) => Promise<{ drained: boolean; remainingActive: number }>;
  closeQueues?: () => Promise<void>;
  stopLoops?: () => Promise<void> | void;
  disconnectPrisma?: () => Promise<void>;
  log?: FastifyBaseLogger | Console;
}

export interface ShutdownOptions {
  timeoutMs?: number;
  jobDrainTimeoutMs?: number;
}

export class GracefulShutdownManager {
  private lifecycleStatus: RuntimeLifecycleStatus = "starting";
  private shutdownPromise: Promise<void> | null = null;
  private readonly hooks: ShutdownHooks;
  private readonly timeoutMs: number;
  private readonly jobDrainTimeoutMs: number;
  private registeredSignals: NodeJS.Signals[] = [];

  constructor(hooks: ShutdownHooks = {}, options: ShutdownOptions = {}) {
    this.hooks = hooks;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.jobDrainTimeoutMs = options.jobDrainTimeoutMs ?? Math.min(8000, Math.max(1000, this.timeoutMs - 2000));
  }

  getStatus(): RuntimeLifecycleStatus {
    return this.lifecycleStatus;
  }

  isShuttingDown(): boolean {
    return this.lifecycleStatus === "draining" || this.lifecycleStatus === "stopped";
  }

  isReady(): boolean {
    return this.lifecycleStatus === "ready";
  }

  setReady(): void {
    if (this.lifecycleStatus === "starting") {
      this.lifecycleStatus = "ready";
    }
  }

  async initiateShutdown(signal: string = "SIGTERM"): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.lifecycleStatus = "draining";
    this.shutdownPromise = this.executeShutdown(signal);
    return this.shutdownPromise;
  }

  private async executeShutdown(signal: string): Promise<void> {
    const logger = this.hooks.log ?? console;
    logger.info({ signal, timeoutMs: this.timeoutMs }, "Graceful shutdown initiated: entering draining phase");

    let forceExitTimer: NodeJS.Timeout | null = null;
    if (process.env.NODE_ENV !== "test") {
      forceExitTimer = setTimeout(() => {
        logger.error({ signal, timeoutMs: this.timeoutMs }, "Graceful shutdown deadline exceeded: forcing process exit");
        process.exit(1);
      }, this.timeoutMs);
      forceExitTimer.unref();
    }

    try {
      // 1. Pausa filas para cessar o consumo de novos jobs
      if (this.hooks.pauseQueues) {
        logger.info({}, "Graceful shutdown: pausing durable job queues");
        await this.hooks.pauseQueues();
      }

      // 2. Fecha servidor HTTP para drenar requisições ativas e rejeitar novos ingressos
      if (this.hooks.app) {
        logger.info({}, "Graceful shutdown: closing HTTP server and draining connections");
        const rawServer = this.hooks.app.server as any;
        if (typeof rawServer?.closeIdleConnections === "function") {
          rawServer.closeIdleConnections();
        }
        await this.hooks.app.close();
      }

      // 3. Aguarda conclusão dos jobs já em processamento ativo
      if (this.hooks.drainJobs) {
        logger.info({ jobDrainTimeoutMs: this.jobDrainTimeoutMs }, "Graceful shutdown: draining active in-flight jobs");
        const drainResult = await this.hooks.drainJobs(this.jobDrainTimeoutMs);
        if (!drainResult.drained) {
          logger.warn?.({ remaining: drainResult.remainingActive }, "Graceful shutdown: active jobs drain timed out");
        }
      }

      // 4. Encerra conexões com brokers de fila
      if (this.hooks.closeQueues) {
        logger.info({}, "Graceful shutdown: closing queue connections");
        await this.hooks.closeQueues();
      }

      // 5. Para loops de background (indexers, listeners, routing runners)
      if (this.hooks.stopLoops) {
        logger.info({}, "Graceful shutdown: stopping background loops");
        await this.hooks.stopLoops();
      }

      // 6. Desconecta o pool de banco relacional
      if (this.hooks.disconnectPrisma) {
        logger.info({}, "Graceful shutdown: disconnecting database client");
        await this.hooks.disconnectPrisma();
      }

      this.lifecycleStatus = "stopped";
      logger.info({}, "Graceful shutdown completed successfully: all components drained and stopped");
    } catch (error) {
      logger.error({ error }, "Error occurred during graceful shutdown execution");
      throw error;
    } finally {
      if (forceExitTimer) {
        clearTimeout(forceExitTimer);
      }
    }
  }

  bindSignals(signals: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"]): void {
    for (const signal of signals) {
      if (this.registeredSignals.includes(signal)) continue;
      this.registeredSignals.push(signal);

      process.on(signal, async () => {
        try {
          await this.initiateShutdown(signal);
          if (process.env.NODE_ENV !== "test") {
            process.exit(0);
          }
        } catch {
          if (process.env.NODE_ENV !== "test") {
            process.exit(1);
          }
        }
      });
    }
  }

  getRegisteredSignals(): readonly NodeJS.Signals[] {
    return this.registeredSignals;
  }
}
