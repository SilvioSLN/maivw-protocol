import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'releases/production/bootstrap-closure-manifest.json');

function loadManifest() {
  assert.ok(fs.existsSync(MANIFEST_PATH), `Manifesto de encerramento deve existir em ${MANIFEST_PATH}`);
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw);
}

test('AWS-053: Integridade declarativa do manifesto de encerramento do bootstrap', () => {
  const manifest = loadManifest();
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.closureId, 'MAIVW-BOOTSTRAP-CLOSURE-001');
  assert.equal(manifest.environment, 'production');
  assert.equal(manifest.closureStatus, 'BOOTSTRAP_FORMALLY_CLOSED_AND_APPROVED');
  assert.equal(manifest.allGatesApproved, true);
  assert.equal(manifest.totalTasksCompleted, 50);
  assert.equal(manifest.totalTasksTarget, 50);
  assert.equal(manifest.completionRatePercent, 100.0);
});

test('AWS-053: Fechamento e aprovacao de todos os 5 Gates do bootstrap (F1 a F5)', () => {
  const manifest = loadManifest();
  const gates = manifest.gates;

  assert.ok(gates, 'Objeto gates deve existir');
  const gateKeys = ['gateF1', 'gateF2', 'gateF3', 'gateF4', 'gateF5'];
  
  for (const key of gateKeys) {
    const gate = gates[key];
    assert.ok(gate, `Gate ${key} deve existir no manifesto`);
    assert.equal(gate.status, 'APPROVED', `Gate ${key} deve estar aprovado`);
    assert.equal(gate.tasksCompleted, 10, `Gate ${key} deve ter 10 tarefas completadas`);
    assert.equal(gate.totalTasks, 10, `Gate ${key} deve ter 10 tarefas no total`);

    const evidenceAbsPath = path.join(REPO_ROOT, gate.evidencePath);
    assert.ok(fs.existsSync(evidenceAbsPath), `Arquivo de evidencia deve existir: ${gate.evidencePath}`);
  }
});

test('AWS-053: Aceite formal do piloto de producao (0 a 100 clientes em 4 coortes)', () => {
  const manifest = loadManifest();
  const pilot = manifest.pilotAcceptance;

  assert.equal(pilot.status, 'PILOT_FULLY_ACCEPTED');
  assert.equal(pilot.totalNominalTenants, 100);
  assert.equal(pilot.criticalIncidentsCount, 0);
  assert.equal(pilot.tenantDataLeaks, 0);

  const cohorts = pilot.acceptedCohorts;
  assert.ok(cohorts.cohort1 && cohorts.cohort1.status === 'ACCEPTED');
  assert.ok(cohorts.cohort2 && cohorts.cohort2.status === 'ACCEPTED');
  assert.ok(cohorts.cohort3 && cohorts.cohort3.status === 'ACCEPTED');
  assert.ok(cohorts.cohort4 && cohorts.cohort4.status === 'ACCEPTED');

  const totalTenants = cohorts.cohort1.tenants + cohorts.cohort2.tenants + cohorts.cohort3.tenants + cohorts.cohort4.tenants;
  assert.equal(totalTenants, 100, 'A soma das 4 coortes deve totalizar 100 clientes');

  assert.equal(pilot.surveillanceSummary.window24h, 'HEALTHY_STABLE');
  assert.equal(pilot.surveillanceSummary.window72h, 'HEALTHY_SYNCHRONIZED');
  assert.equal(pilot.surveillanceSummary.window7d, 'HEALTHY_MATURED');
});

test('AWS-053: Auditoria de revogacao de acessos e recursos temporarios', () => {
  const manifest = loadManifest();
  const cleanup = manifest.temporaryAccessAndResourceCleanup;

  assert.equal(cleanup.auditStatus, 'AUDITED_AND_REVOKED');
  assert.ok(Array.isArray(cleanup.revokedItems), 'Itens revogados devem ser lista');
  assert.ok(cleanup.revokedItems.length >= 5, 'Devem existir ao menos 5 itens revogados catalogados');

  for (const item of cleanup.revokedItems) {
    assert.equal(item.action, 'REVOKED');
    assert.ok(item.identifier && item.identifier.length > 0);
    assert.ok(item.reason && item.reason.length > 0);
  }

  const lp = cleanup.leastPrivilegeVerification;
  assert.equal(lp.rootAccountUsage, 'FORBIDDEN_AND_ZERO_USAGE');
  assert.equal(lp.staticKeysInCode, 'ZERO_FOUND');
  assert.ok(lp.runtimeDbRole.includes('DML only'));
  assert.ok(lp.hostAccess.includes('SSM Session Manager only'));
});

test('AWS-053: Registro e categorizacao formal do backlog de evolucao', () => {
  const manifest = loadManifest();
  const backlog = manifest.registeredBacklogAndEvolution;

  assert.ok(backlog.totalItems >= 5);
  assert.equal(backlog.items.length, backlog.totalItems);

  const expectedIds = ['EVO-001', 'EVO-002', 'EVO-003', 'EVO-004', 'EVO-005'];
  for (const expectedId of expectedIds) {
    const item = backlog.items.find((i: { id: string }) => i.id === expectedId);
    assert.ok(item, `Item de evolucao ${expectedId} deve estar cadastrado`);
    assert.ok(item.category, `Item ${expectedId} deve possuir categoria`);
    assert.ok(item.priority, `Item ${expectedId} deve possuir prioridade`);
    assert.ok(item.trigger, `Item ${expectedId} deve possuir trigger`);
  }
});

test('AWS-053: Metricas, limiares e custo da proxima escala (100 a 500 clientes)', () => {
  const manifest = loadManifest();
  const nextScale = manifest.nextScalePlan;

  assert.equal(nextScale.targetScale, '100_TO_500_CLIENTS');
  assert.ok(nextScale.triggerMetrics.maxCpuThresholdPercent <= 70.0);
  assert.ok(nextScale.triggerMetrics.maxMemoryThresholdPercent <= 80.0);
  assert.ok(nextScale.triggerMetrics.maxRdsConnectionThresholdPercent <= 75.0);
  assert.ok(nextScale.triggerMetrics.maxBullmqJobAgeThresholdMs <= 150);

  assert.ok(nextScale.projectedMonthlyCost500ClientsUsd > 100.0, 'Escala maior deve ter custo projetado condizente');
  assert.ok(nextScale.projectedMonthlyCost500ClientsUsd <= 300.0, 'Custo para 500 clientes deve ser eficiente');
});

test('AWS-053: Procedimento de rollback da escala e salvaguarda operacional', () => {
  const manifest = loadManifest();
  const nextScale = manifest.nextScalePlan;

  assert.ok(nextScale.rollbackProcedure && nextScale.rollbackProcedure.length > 20);
  assert.ok(nextScale.rollbackProcedure.includes('RBK-005') || nextScale.rollbackProcedure.includes('t4g.large'));
});

test('AWS-053: Retrospectiva do bootstrap e consolidacao das 5 fases', () => {
  const manifest = loadManifest();
  const retro = manifest.retrospective;

  assert.ok(retro.phases && retro.phases.length === 5, 'Retrospectiva deve cobrir as 5 fases');
  for (let p = 1; p <= 5; p++) {
    const phase = retro.phases.find((item: { phase: number }) => item.phase === p);
    assert.ok(phase, `Fase ${p} deve constar na retrospectiva`);
    assert.equal(phase.tasks, 10, `Fase ${p} deve registrar 10 tarefas`);
    assert.ok(phase.keyTakeaway && phase.keyTakeaway.length > 10);
  }

  assert.ok(retro.overallConclusion && retro.overallConclusion.includes('50 tarefas'));
});
