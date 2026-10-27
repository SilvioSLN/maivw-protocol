import type { Address, PublicClient } from "viem";
import type { PrismaClient } from "@prisma/client";
import { REGISTRY_ABI } from "../config.js";
import type { LedgerService } from "./LedgerService.js";

/**
 * EventListenerService — Observabilidade de Eventos On-Chain em Tempo Real
 * 
 * Monitora eventos críticos:
 * - ProviderSuspended: Saldo zerado pela Opção Nuclear -> Corte imediato de tráfego
 * - ProviderReactivated: Saldo recarregado via topUpBalance -> Liberação de tráfego
 * - GenesisDomainRegistered: Consumo da Cota Gênesis do Fundador
 * - DomainDeactivated / DomainSlashed: Banimento on-chain -> Invalidação retrospectiva imediata de e-mails
 */
export class EventListenerService {
  private client: PublicClient;
  private contractAddress: Address | null;
  private unwatchList: Array<() => void> = [];
  private suspendedDomains: Set<string> = new Set();
  private deactivatedDomains: Set<string> = new Set();
  private stopped = false;
  private pending = new Set<Promise<void>>();
  private track(task: () => Promise<void>): void {
    if (this.stopped) return;
    const pending = task().catch(() => { console.error("[EVENT-LISTENER] Background event failed"); });
    this.pending.add(pending);
    void pending.finally(() => this.pending.delete(pending));
  }

  constructor(private ledger: LedgerService, private prisma?: PrismaClient) {
    this.client = ledger.getClient();
    this.contractAddress = ledger.getContractAddress();
  }

  /**
   * Inicia a escuta de eventos on-chain
   */
  start(): void {
    this.stopped = false;
    if (!this.contractAddress) {
      console.warn("[EVENT-LISTENER] ⚠️ Endereço do contrato não configurado. Listener aguardando deploy.");
      return;
    }

    try {
      // 1. Escutar ProviderSuspended (Opção Nuclear acionada on-chain)
      const unwatchSuspended = this.client.watchContractEvent({
        address: this.contractAddress,
        abi: REGISTRY_ABI,
        eventName: "ProviderSuspended",
        onLogs: (logs) => {
          for (const log of logs) {
            const { domain, timestamp } = log.args as { domain: string; timestamp: bigint };
            this.suspendedDomains.add(domain.toLowerCase());
            console.error(
              `\n🚨 [OPÇÃO NUCLEAR ACIONADA] Domínio "${domain}" foi SUSPENSO pelo contrato inteligente!` +
              `\n   Motivo: Saldo de caução zerado após infrações repetidas.` +
              `\n   Ação: Todo o tráfego de envio deste provedor foi CORTADO imediatamente.` +
              `\n   Horário: ${new Date(Number(timestamp) * 1000).toISOString()}` +
              `\n   Recarga: Para reativar o tráfego, o provedor deve chamar topUpBalance("${domain}").\n`
            );
          }
        },
      });
      this.unwatchList.push(unwatchSuspended);

      // 2. Escutar ProviderReactivated (Recarga via topUpBalance bem sucedida)
      const unwatchReactivated = this.client.watchContractEvent({
        address: this.contractAddress,
        abi: REGISTRY_ABI,
        eventName: "ProviderReactivated",
        onLogs: (logs) => {
          for (const log of logs) {
            const { domain, newBalance } = log.args as { domain: string; newBalance: bigint };
            this.suspendedDomains.delete(domain.toLowerCase());
            console.log(
              `\n✅ [PROVEDOR REATIVADO] Domínio "${domain}" efetuou recarga de saldo no contrato!` +
              `\n   Novo Saldo: ${newBalance.toString()} wei` +
              `\n   Status: Tráfego de envio RESTAURADO com sucesso.\n`
            );
          }
        },
      });
      this.unwatchList.push(unwatchReactivated);

      // 3. Escutar GenesisDomainRegistered
      const unwatchGenesis = this.client.watchContractEvent({
        address: this.contractAddress,
        abi: REGISTRY_ABI,
        eventName: "GenesisDomainRegistered",
        onLogs: (logs) => {
          for (const log of logs) {
            const { domain, genesisIndex } = log.args as { domain: string; genesisIndex: bigint };
            console.log(
              `🌟 [COTA GÊNESIS] Domínio subsidiado registrado: "${domain}" (Vaga ${genesisIndex.toString()}/1000)`
            );
          }
        },
      });
      this.unwatchList.push(unwatchGenesis);

      // 4. Escutar DomainDeactivated (Invalidação Retrospectiva On-Chain)
      const unwatchDeactivated = this.client.watchContractEvent({
        address: this.contractAddress,
        abi: REGISTRY_ABI,
        eventName: "DomainDeactivated",
        onLogs: (logs) => this.track(async () => {
          for (const log of logs) {
            const { domain, timestamp } = log.args as { domain: string; timestamp: bigint };
            await this.handleDomainRevocation(domain, Number(timestamp));
          }
        }),
      });
      this.unwatchList.push(unwatchDeactivated);

      // 5. Escutar DomainSlashed
      const unwatchSlashed = this.client.watchContractEvent({
        address: this.contractAddress,
        abi: REGISTRY_ABI,
        eventName: "DomainSlashed",
        onLogs: (logs) => this.track(async () => {
          for (const log of logs) {
            const { domain, redistributed, burned } = log.args as {
              domain: string;
              redistributed: bigint;
              burned: bigint;
            };
            console.error(
              `\n🔥 [DOMAIN SLASHED] Domínio "${domain}" foi penalizado por fraude on-chain!` +
              `\n   Recompensa a denunciantes: ${redistributed.toString()} wei` +
              `\n   Valor Queimado (DEAD): ${burned.toString()} wei\n`
            );
            await this.handleDomainRevocation(domain);
          }
        }),
      });
      this.unwatchList.push(unwatchSlashed);

      console.log(`[EVENT-LISTENER] 🎧 Escutando eventos on-chain do contrato: ${this.contractAddress}`);
    } catch (error) {
      console.error("[EVENT-LISTENER] Erro ao registrar watchers de eventos:", error);
    }
  }

  /**
   * Executa a invalidação retrospectiva de mensagens no banco de dados local
   */
  private async handleDomainRevocation(domain: string, timestamp?: number): Promise<void> {
    const cleanDomain = domain.toLowerCase().trim();
    this.deactivatedDomains.add(cleanDomain);

    console.error(
      `\n🚨 [INVALIDEZ RETROSPECTIVA ACIONADA] Domínio "${cleanDomain}" foi BANIDO on-chain!` +
      `\n   Ação: Marcando retrospectivamente todas as mensagens deste remetente como FRAUDE REVOGADA.`
    );

    if (this.prisma) {
      try {
        const updateResult = await this.prisma.message.updateMany({
          where: {
            from: { contains: cleanDomain, mode: "insensitive" },
            isRevoked: false,
          },
          data: {
            status: "revoked_fraud",
            isRevoked: true,
            revocationReason: "Domínio banido por fraude on-chain após a entrega da mensagem",
          },
        });

        console.warn(
          `🛡️ [INVALIDEZ RETROSPECTIVA CONCLUÍDA] ${updateResult.count} mensagem(ns) do domínio "${cleanDomain}" foram marcadas como REVOGADAS e quarentenadas com sucesso!`
        );
      } catch (err: any) {
        console.error(`[EVENT-LISTENER] Erro ao invalidar mensagens do domínio ${cleanDomain}:`, err);
      }
    }
  }

  /**
   * Força a revogação local de mensagens de um domínio (útil para testes ou oráculo local)
   */
  async revokeDomainLocally(domain: string, reason?: string): Promise<number> {
    const cleanDomain = domain.toLowerCase().trim();
    this.deactivatedDomains.add(cleanDomain);

    if (!this.prisma) return 0;

    const res = await this.prisma.message.updateMany({
      where: {
        from: { contains: cleanDomain, mode: "insensitive" },
      },
      data: {
        status: "revoked_fraud",
        isRevoked: true,
        revocationReason: reason || "Domínio banido por fraude on-chain após a entrega da mensagem",
      },
    });

    return res.count;
  }

  /**
   * Verifica se o domínio está em suspensão local imediata
   */
  isSuspended(domain: string): boolean {
    return this.suspendedDomains.has(domain.toLowerCase());
  }

  /**
   * Verifica se o domínio foi desativado on-chain
   */
  isDeactivated(domain: string): boolean {
    return this.deactivatedDomains.has(domain.toLowerCase());
  }

  /**
   * Para os listeners ao encerrar o servidor
   */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const unwatch of this.unwatchList) {
      unwatch();
    }
    this.unwatchList = [];
    await Promise.all(this.pending);
    console.log("[EVENT-LISTENER] ⏹️ Listeners de eventos encerrados.");
  }
}

