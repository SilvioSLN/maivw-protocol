import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, '../../../releases/production/post-launch-surveillance-manifest.json');

test('AWS-052: Integridade declarativa do manifesto de vigilancia e janelas de observacao', () => {
    assert.strictEqual(fs.existsSync(manifestPath), true, 'Manifesto post-launch-surveillance-manifest.json deve existir');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    assert.strictEqual(manifest.environment, 'production');
    assert.ok(manifest.windows.window24h, 'Janela 24h deve existir');
    assert.ok(manifest.windows.window72h, 'Janela 72h deve existir');
    assert.ok(manifest.windows.window7d, 'Janela 7d deve existir');

    assert.strictEqual(manifest.deviationOwnersAndResponses.length, 8, 'Devem existir 8 dimensoes de desvios');
    assert.ok(manifest.cellCapacityModel.readyForPilotScale, 'Capacidade da celula deve estar confirmada');
});

test('AWS-052: Janela 24h: Estabilidade imediata, latencia, erro e idade de jobs BullMQ', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const w24 = manifest.windows.window24h.metrics;

    assert.ok(w24.observedGatewayLatencyP95LocalMs <= w24.maxGatewayLatencyP95LocalMs, 'Latencia local p95 <= 20ms');
    assert.ok(w24.observedEnvelopeV2LatencyP95Ms <= w24.maxEnvelopeV2LatencyP95Ms, 'Latencia Envelope V2 <= 30ms');
    assert.ok(w24.observedErrorRatePercent <= w24.maxErrorRatePercent, 'Taxa de erro <= 0.05%');
    assert.ok(w24.observedBullmqJobAgeMs <= w24.maxBullmqJobAgeMs, 'Idade de job BullMQ <= 60ms');
    assert.ok(w24.observedRdsConnectionPoolUsagePercent <= w24.maxRdsConnectionPoolUsagePercent, 'Pool RDS <= 50%');
    assert.ok(w24.observedCostFirstDayUsd <= w24.maxCostFirstDayUsd, 'Custo do 1o dia dentro da projecao');
});

test('AWS-052: Janela 72h: Sincronismo de cursores EVM/Solana e estabilidade de RPCs', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const w72 = manifest.windows.window72h.metrics;

    assert.ok(w72.observedEvmIndexerLagBlocks <= w72.maxEvmIndexerLagBlocks, 'Lag indexador EVM <= 16 blocos');
    assert.ok(w72.observedSolanaIndexerLagSlots <= w72.maxSolanaIndexerLagSlots, 'Lag indexador Solana <= 32 slots');
    assert.ok(w72.observedRpcErrorRatePercent <= w72.maxRpcErrorRatePercent, 'Taxa de erro RPC <= 0.1%');
    assert.strictEqual(w72.r2OrphanMultipartUploads, 0, 'Zero uploads multipartes orfaos no R2');
    assert.strictEqual(w72.openIncidentsP1, 0, 'Zero incidentes P1 em 72h');
    assert.strictEqual(w72.openIncidentsP2, 0, 'Zero incidentes P2 em 72h');
});

test('AWS-052: Janela 7d: Auditoria financeira, modelo de custos e runway de creditos AWS', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const w7d = manifest.windows.window7d.metrics;

    // Respeito ao teto de US$ 100/mes do AWS Budget
    assert.ok(w7d.projectedMonthlySpendUsd <= w7d.budgetCeilingMonthlyUsd, 'Custo projetado deve estar abaixo de US$ 100/mes');
    assert.ok(w7d.baselineMonthlyCostSavingsPlansUsd < w7d.baselineMonthlyCostOnDemandUsd, 'Savings Plans deve ser inferior ao On-Demand');
    assert.strictEqual(w7d.budgetCreditsCapUsd, 0.0, 'Total de creditos concedidos deve ser US$ 0,00');
    assert.ok(w7d.estimatedRunwayMonths >= 12.0, 'Runway garantido deve ser de no minimo 12 meses');
});

test('AWS-052: Janela 7d: Capacidade de host EC2 Graviton e RDS PostgreSQL', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const w7d = manifest.windows.window7d.metrics;
    const capacity = manifest.cellCapacityModel;

    assert.ok(w7d.observedEc2CpuUtilizationAveragePercent <= w7d.maxEc2CpuUtilizationAveragePercent, 'Media CPU Graviton <= 35%');
    assert.ok(w7d.observedEc2MemoryUtilizationAveragePercent <= w7d.maxEc2MemoryUtilizationAveragePercent, 'Media memoria RAM <= 60%');
    assert.ok(w7d.observedRdsStorageUtilizationPercent <= w7d.maxRdsStorageUtilizationPercent, 'Utilizacao disco RDS <= 25%');

    assert.ok(capacity.headroomCpuPercent >= 50.0, 'Folga de CPU deve ser >= 50%');
    assert.ok(capacity.headroomMemoryPercent >= 30.0, 'Folga de memoria deve ser >= 30%');
    assert.ok(capacity.headroomStoragePercent >= 50.0, 'Folga de armazenamento deve ser >= 50%');
});

test('AWS-052: Seguranca de borda, WAF e mitigacao de ataques de abuso em 72h/7d', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const w72 = manifest.windows.window72h.metrics;
    const w7d = manifest.windows.window7d.metrics;

    assert.ok(w72.wafBlockedHostPoisoningAttempts > 0, 'WAF deve registrar bloqueio de host header poisoning');
    assert.ok(w72.rateLimitThrottledRequests > 0, 'Rate limiting deve mitigar excessos de taxa');
    assert.strictEqual(w7d.zeroTenantDataLeaksConfirmed, true, 'Zero vazamentos de dados entre locatarios');
    assert.ok(w7d.p2pCertificateDaysRemaining > 14, 'Certificado P2P deve manter validade saudavel');
});

test('AWS-052: Reputacao de entrega de e-mail SES em producao (Bounce e Complaint 0%)', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const w24 = manifest.windows.window24h.metrics;

    assert.strictEqual(w24.sesBounceRatePercent, 0.0, 'Taxa de bounce deve ser 0% no inicio do piloto');
    assert.strictEqual(w24.sesComplaintRatePercent, 0.0, 'Taxa de complaint deve ser 0% no inicio do piloto');
});

test('AWS-052: Matriz de desvios operacionais com owners atribuidos e SLAs de contencao', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const dimensions = manifest.deviationOwnersAndResponses;

    const expectedDimensions = [
        'COST_AND_BUDGET',
        'QUEUE_AND_WORKERS',
        'INDEXER_CURSORS',
        'DATABASE_STORAGE',
        'BLOCKCHAIN_RPC',
        'SES_REPUTATION',
        'HOST_MEMORY',
        'ABUSE_AND_SECURITY'
    ];

    for (const exp of expectedDimensions) {
        const found = dimensions.find((d: any) => d.dimension === exp);
        assert.ok(found, `Dimensao ${exp} deve ter owner e resposta mapeados`);
        assert.ok(found.owner.length > 0, `Owner deve ser declarado para ${exp}`);
        assert.ok(found.slaMinutes <= 60, `SLA de resposta deve ser <= 60 min para ${exp}`);
    }
});
