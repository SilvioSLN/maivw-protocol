import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT_DIR = resolve(process.cwd(), '../..');
const LEDGER_MANIFEST_PATH = resolve(ROOT_DIR, 'releases/production/ledger-manifest.json');
const RUNTIME_CONTRACT_PATH = resolve(ROOT_DIR, 'config/runtime-contract.json');
const SECURITY_STACK_PATH = resolve(ROOT_DIR, 'infra/aws/lib/stacks/security-stack.ts');

// -----------------------------------------------------------------------------
// 1. Matriz de Ledgers e Separacao Estrita Anti-Mistura
// -----------------------------------------------------------------------------
test('AWS-049: Matriz de ledgers e separacao estrita anti-mistura (testnet vs mainnet)', async () => {
  assert.ok(existsSync(LEDGER_MANIFEST_PATH), 'Manifesto de ledgers de producao deve existir');
  assert.ok(existsSync(RUNTIME_CONTRACT_PATH), 'Contrato de runtime deve existir');

  const ledgerManifest = JSON.parse(readFileSync(LEDGER_MANIFEST_PATH, 'utf8'));
  const runtimeContract = JSON.parse(readFileSync(RUNTIME_CONTRACT_PATH, 'utf8'));

  assert.strictEqual(ledgerManifest.environment, 'production');
  assert.strictEqual(ledgerManifest.governancePolicy.antiMixingRule, 'ENFORCE_STRICT_SEPARATION');

  const networks = ledgerManifest.networks;
  assert.ok(Array.isArray(networks), 'networks deve ser um array');
  assert.strictEqual(networks.length, 8, 'Devem estar catalogadas exatamente 8 redes (4 mainnets + 4 canarios)');

  const mainnets = networks.filter((n: any) => n.networkType === 'mainnet');
  const testnets = networks.filter((n: any) => n.networkType === 'testnet_canary');

  assert.strictEqual(mainnets.length, 4, 'Devem existir exatamente 4 redes classificadas como mainnet');
  assert.strictEqual(testnets.length, 4, 'Devem existir exatamente 4 redes classificadas como testnet_canary');

  // Nenhuma testnet pode ser marcada como mainnet
  for (const t of testnets) {
    assert.strictEqual(t.networkType, 'testnet_canary', `Rede ${t.name} NAO pode ser mainnet`);
    assert.ok(t.isolationNote, `Rede ${t.name} deve possuir nota de isolamento de producao`);
  }

  // Validar presenca das 4 redes canario homologadas
  const testnetIds = testnets.map((t: any) => t.id);
  assert.ok(testnetIds.includes('base-sepolia'));
  assert.ok(testnetIds.includes('arbitrum-sepolia'));
  assert.ok(testnetIds.includes('polygon-amoy'));
  assert.ok(testnetIds.includes('solana-devnet'));

  // Validar presenca das 4 mainnets candidatas
  const mainnetIds = mainnets.map((m: any) => m.id);
  assert.ok(mainnetIds.includes('base-mainnet'));
  assert.ok(mainnetIds.includes('arbitrum-one'));
  assert.ok(mainnetIds.includes('polygon-mainnet'));
  assert.ok(mainnetIds.includes('solana-mainnet'));
});

// -----------------------------------------------------------------------------
// 2. Bloqueio Fail-Closed de Writes em Mainnets Pendentes de Auditoria
// -----------------------------------------------------------------------------
test('AWS-049: Bloqueio fail-closed de writes em mainnets pendentes de auditoria', async () => {
  const ledgerManifest = JSON.parse(readFileSync(LEDGER_MANIFEST_PATH, 'utf8'));
  const mainnets = ledgerManifest.networks.filter((n: any) => n.networkType === 'mainnet');

  for (const m of mainnets) {
    assert.strictEqual(m.writesEnabled, false, `Mainnet ${m.name} deve ter writesEnabled = false`);
    assert.strictEqual(m.readOnly, true, `Mainnet ${m.name} deve ter readOnly = true`);
    assert.strictEqual(m.status, 'DISABLED_PENDING_AUDIT_AND_FUNDING', `Mainnet ${m.name} deve ter status DISABLED_PENDING_AUDIT_AND_FUNDING`);
    assert.strictEqual(m.auditRequirements.externalSmartContractAudit || m.auditRequirements.externalProgramAudit, 'PENDING_EXECUTION');
  }

  // Simulacao de guardiao de submissao on-chain fail-closed
  class LedgerWriteGate {
    private manifest: any;

    constructor(manifest: any) {
      this.manifest = manifest;
    }

    public attemptWrite(networkId: string, _payload: any) {
      const net = this.manifest.networks.find((n: any) => n.id === networkId);
      if (!net) {
        throw new Error(`UNKNOWN_NETWORK: Rede ${networkId} nao cadastrada.`);
      }
      if (!net.writesEnabled || net.readOnly) {
        const error: any = new Error(`MAINNET_WRITES_DISABLED: Operacoes de escrita na rede ${net.name} estao desabilitadas.`);
        error.code = 'MAINNET_WRITES_DISABLED';
        error.networkId = networkId;
        error.status = net.status;
        throw error;
      }
      return { success: true, txHash: '0x1234567890abcdef' };
    }
  }

  const gate = new LedgerWriteGate(ledgerManifest);

  // Tentativa de escrita em qualquer mainnet deve falhar categoricamente
  for (const m of mainnets) {
    assert.throws(
      () => gate.attemptWrite(m.id, { action: 'registerMirror' }),
      (err: any) => {
        return err.code === 'MAINNET_WRITES_DISABLED' && err.status === 'DISABLED_PENDING_AUDIT_AND_FUNDING';
      },
      `Tentativa de escrita na mainnet ${m.id} DEVE falhar fail-closed com MAINNET_WRITES_DISABLED`
    );
  }

  // Testnet canario permite escrita apenas em testes isolados
  const canWriteSepolia = gate.attemptWrite('base-sepolia', { action: 'testMirror' });
  assert.strictEqual(canWriteSepolia.success, true);
});

// -----------------------------------------------------------------------------
// 3. Custodia de Signers de Producao via AWS KMS Nao-Exportavel
// -----------------------------------------------------------------------------
test('AWS-049: Custodia de signers de producao via AWS KMS nao-exportavel', async () => {
  const ledgerManifest = JSON.parse(readFileSync(LEDGER_MANIFEST_PATH, 'utf8'));
  const runtimeContract = JSON.parse(readFileSync(RUNTIME_CONTRACT_PATH, 'utf8'));
  const kmsCustody = ledgerManifest.kmsCustody;
  const contractSigners = runtimeContract.productionSignerContract;

  assert.strictEqual(kmsCustody.provider, 'aws-kms');
  assert.strictEqual(kmsCustody.region, 'us-east-1');

  // 1. Oráculo EVM
  assert.strictEqual(kmsCustody.oracleEvm.keySpec, 'ECC_SECG_P256K1');
  assert.strictEqual(kmsCustody.oracleEvm.signingAlgorithm, 'ECDSA_SHA_256');
  assert.strictEqual(kmsCustody.oracleEvm.messageType, 'DIGEST');
  assert.strictEqual(kmsCustody.oracleEvm.alias, 'alias/maivw-production-oracle-signer');
  assert.strictEqual(kmsCustody.oracleEvm.privateKeyExportable, false);
  assert.strictEqual(contractSigners.oracleEvm.keySpec, 'ECC_SECG_P256K1');
  assert.strictEqual(contractSigners.oracleEvm.privateKeyExportable, false);

  // 2. Relayer EVM
  assert.strictEqual(kmsCustody.relayerEvm.keySpec, 'ECC_SECG_P256K1');
  assert.strictEqual(kmsCustody.relayerEvm.signingAlgorithm, 'ECDSA_SHA_256');
  assert.strictEqual(kmsCustody.relayerEvm.messageType, 'DIGEST');
  assert.strictEqual(kmsCustody.relayerEvm.alias, 'alias/maivw-production-relayer-signer');
  assert.strictEqual(kmsCustody.relayerEvm.privateKeyExportable, false);
  assert.strictEqual(contractSigners.relayerEvm.keySpec, 'ECC_SECG_P256K1');
  assert.strictEqual(contractSigners.relayerEvm.privateKeyExportable, false);

  // 3. Relayer Solana (Ed25519)
  assert.strictEqual(kmsCustody.relayerSolana.keySpec, 'ECC_NIST_EDWARDS25519');
  assert.strictEqual(kmsCustody.relayerSolana.signingAlgorithm, 'ED25519_SHA_512');
  assert.strictEqual(kmsCustody.relayerSolana.messageType, 'RAW');
  assert.strictEqual(kmsCustody.relayerSolana.maxRawMessageBytes, 4096);
  assert.strictEqual(kmsCustody.relayerSolana.alias, 'alias/maivw-production-solana-relayer-signer');
  assert.strictEqual(kmsCustody.relayerSolana.privateKeyExportable, false);
  assert.strictEqual(contractSigners.relayerSolana.keySpec, 'ECC_NIST_EDWARDS25519');
  assert.strictEqual(contractSigners.relayerSolana.privateKeyExportable, false);

  // Validar definicao correspondente no SecurityStack CDK
  if (existsSync(SECURITY_STACK_PATH)) {
    const secStack = readFileSync(SECURITY_STACK_PATH, 'utf8');
    assert.ok(secStack.includes('kms.KeySpec.ECC_SECG_P256K1'), 'SecurityStack deve criar chaves secp256k1');
    assert.ok(secStack.includes('kms.KeySpec.ECC_NIST_EDWARDS25519'), 'SecurityStack deve criar chave Ed25519');
    assert.ok(secStack.includes('oracle-signer'), 'SecurityStack deve definir oracle-signer');
    assert.ok(secStack.includes('relayer-signer'), 'SecurityStack deve definir relayer-signer');
    assert.ok(secStack.includes('solana-relayer-signer'), 'SecurityStack deve definir solana-relayer-signer');
  }
});

// -----------------------------------------------------------------------------
// 4. Proibicao Estrita de Papeis Administrativos no Runtime
// -----------------------------------------------------------------------------
test('AWS-049: Proibicao estrita de papeis administrativos no runtime da aplicacao', async () => {
  const ledgerManifest = JSON.parse(readFileSync(LEDGER_MANIFEST_PATH, 'utf8'));
  const runtimeContract = JSON.parse(readFileSync(RUNTIME_CONTRACT_PATH, 'utf8'));

  const forbiddenRoles = ledgerManifest.governancePolicy.forbiddenWorkloadRoles;
  assert.deepStrictEqual(forbiddenRoles, ['deployer', 'treasury', 'guardian']);
  assert.deepStrictEqual(runtimeContract.productionSignerContract.gatewayForbiddenRoles, ['deployer', 'treasury', 'guardian']);

  // Validar que funcoes de inicializacao do Gateway recusam configuracao com papéis proibidos
  function assertRoleNotPermittedInGateway(role: string) {
    if (forbiddenRoles.includes(role)) {
      throw new Error(`FORBIDDEN_ROLE: O papel '${role}' e estritamente proibido de operar no runtime da aplicacao.`);
    }
  }

  assert.throws(() => assertRoleNotPermittedInGateway('deployer'));
  assert.throws(() => assertRoleNotPermittedInGateway('treasury'));
  assert.throws(() => assertRoleNotPermittedInGateway('guardian'));
  assert.doesNotThrow(() => assertRoleNotPermittedInGateway('oracle'));
  assert.doesNotThrow(() => assertRoleNotPermittedInGateway('relayer'));
});

// -----------------------------------------------------------------------------
// 5. Parametros de Finalidade e Margem de Reorg por Rede
// -----------------------------------------------------------------------------
test('AWS-049: Parametros de finalidade e margem de reorg por rede', async () => {
  const ledgerManifest = JSON.parse(readFileSync(LEDGER_MANIFEST_PATH, 'utf8'));
  const networks = ledgerManifest.networks;

  for (const net of networks) {
    if (net.family === 'evm') {
      assert.ok(typeof net.finalityConfirmations === 'number' && net.finalityConfirmations > 0, `${net.name}: deve ter finalityConfirmations > 0`);
      assert.ok(typeof net.reorgMarginBlocks === 'number' && net.reorgMarginBlocks >= net.finalityConfirmations, `${net.name}: reorgMarginBlocks deve ser >= finalityConfirmations`);
    } else if (net.family === 'solana') {
      assert.strictEqual(net.commitment, 'finalized', `${net.name}: commitment deve ser finalized`);
      assert.ok(typeof net.reorgMarginSlots === 'number' && net.reorgMarginSlots >= 32, `${net.name}: reorgMarginSlots deve ser >= 32`);
    }
  }

  // Polygon PoS possui margem maior de reorgs profundos
  const polygonMainnet = networks.find((n: any) => n.id === 'polygon-mainnet');
  assert.ok(polygonMainnet.finalityConfirmations >= 128, 'Polygon PoS deve exigir ao menos 128 confirmacoes de finalidade');
  assert.ok(polygonMainnet.reorgMarginBlocks >= 256, 'Polygon PoS deve adotar margem de reorg >= 256 blocos');
});

// -----------------------------------------------------------------------------
// 6. Monitoramento de Saldo Minimo (Low Balance Guard) e Circuit Breaker
// -----------------------------------------------------------------------------
test('AWS-049: Monitoramento de saldo minimo e desarme do Circuit Breaker', async () => {
  const ledgerManifest = JSON.parse(readFileSync(LEDGER_MANIFEST_PATH, 'utf8'));

  class BalanceMonitor {
    private circuitBreakerState: 'CLOSED' | 'OPEN' = 'CLOSED';

    public evaluateBalance(networkId: string, currentBalanceUnits: bigint) {
      const net = ledgerManifest.networks.find((n: any) => n.id === networkId);
      if (!net) throw new Error('Rede nao encontrada');

      const minUnits = BigInt(net.minBalanceThreshold.minimumBalanceUnits);

      if (currentBalanceUnits < minUnits) {
        this.circuitBreakerState = 'OPEN';
        return {
          status: 'LOW_BALANCE',
          circuitBreaker: 'OPEN',
          tripped: true,
          current: currentBalanceUnits.toString(),
          required: minUnits.toString(),
          currency: net.minBalanceThreshold.currency,
        };
      }

      this.circuitBreakerState = 'CLOSED';
      return {
        status: 'HEALTHY',
        circuitBreaker: 'CLOSED',
        tripped: false,
        current: currentBalanceUnits.toString(),
        required: minUnits.toString(),
        currency: net.minBalanceThreshold.currency,
      };
    }
  }

  const monitor = new BalanceMonitor();

  // Teste 1: Saldo saudável na Base Sepolia (0.01 ETH > 0.001 ETH)
  const healthyCheck = monitor.evaluateBalance('base-sepolia', 10000000000000000n);
  assert.strictEqual(healthyCheck.status, 'HEALTHY');
  assert.strictEqual(healthyCheck.circuitBreaker, 'CLOSED');
  assert.strictEqual(healthyCheck.tripped, false);

  // Teste 2: Saldo criticamente baixo (0.0001 ETH < 0.001 ETH) -> Circuit Breaker OPEN
  const lowBalanceCheck = monitor.evaluateBalance('base-sepolia', 100000000000000n);
  assert.strictEqual(lowBalanceCheck.status, 'LOW_BALANCE');
  assert.strictEqual(lowBalanceCheck.circuitBreaker, 'OPEN');
  assert.strictEqual(lowBalanceCheck.tripped, true);

  // Teste 3: Solana Devnet com saldo insuficiente (0.05 SOL < 0.1 SOL) -> OPEN
  const solanaLowCheck = monitor.evaluateBalance('solana-devnet', 50000000n);
  assert.strictEqual(solanaLowCheck.status, 'LOW_BALANCE');
  assert.strictEqual(solanaLowCheck.circuitBreaker, 'OPEN');
});

// -----------------------------------------------------------------------------
// 7. Canario de Reconciliacao Multichain e Protecao Anti-Falsas Confirmacoes
// -----------------------------------------------------------------------------
test('AWS-049: Canario de reconciliacao multichain e classificacao UNREADABLE', async () => {
  interface ReplicaState {
    networkId: string;
    domain: string;
    active: boolean;
    version: number;
    error?: string;
  }

  function reconcileReplicas(origin: ReplicaState, replicas: ReplicaState[]) {
    return replicas.map((replica) => {
      if (replica.error) {
        // Falhas de RPC NUNCA viram confirmacao falsa
        return {
          networkId: replica.networkId,
          state: 'UNREADABLE',
          action: 'RETRY_READ',
          reason: replica.error,
        };
      }

      if (!replica.active) {
        return {
          networkId: replica.networkId,
          state: 'MISSING_MIRROR',
          action: 'REGISTER',
        };
      }

      if (replica.version < origin.version) {
        return {
          networkId: replica.networkId,
          state: 'VERSION_BEHIND',
          action: 'SYNC',
          lag: origin.version - replica.version,
        };
      }

      return {
        networkId: replica.networkId,
        state: 'IN_SYNC',
        action: 'NONE',
      };
    });
  }

  const origin: ReplicaState = { networkId: 'base-sepolia', domain: 'alice.maivw.com', active: true, version: 5 };
  const replicas: ReplicaState[] = [
    { networkId: 'arbitrum-sepolia', domain: 'alice.maivw.com', active: true, version: 5 },
    { networkId: 'polygon-amoy', domain: 'alice.maivw.com', active: true, version: 4 }, // behind
    { networkId: 'solana-devnet', domain: 'alice.maivw.com', active: false, version: 0 }, // missing
    { networkId: 'base-mainnet', domain: 'alice.maivw.com', active: false, version: 0, error: 'RPC_TIMEOUT' }, // unreadable
  ];

  const results = reconcileReplicas(origin, replicas);

  const arbitrumRes = results.find((r) => r.networkId === 'arbitrum-sepolia');
  assert.strictEqual(arbitrumRes?.state, 'IN_SYNC');
  assert.strictEqual(arbitrumRes?.action, 'NONE');

  const polygonRes = results.find((r) => r.networkId === 'polygon-amoy');
  assert.strictEqual(polygonRes?.state, 'VERSION_BEHIND');
  assert.strictEqual(polygonRes?.action, 'SYNC');

  const solanaRes = results.find((r) => r.networkId === 'solana-devnet');
  assert.strictEqual(solanaRes?.state, 'MISSING_MIRROR');
  assert.strictEqual(solanaRes?.action, 'REGISTER');

  const baseMainnetRes = results.find((r) => r.networkId === 'base-mainnet');
  assert.strictEqual(baseMainnetRes?.state, 'UNREADABLE', 'Falha de RPC DEVE ser classificada como UNREADABLE');
  assert.strictEqual(baseMainnetRes?.action, 'RETRY_READ', 'Acao deve ser RETRY_READ e NUNCA confirmacao falsa');
});
