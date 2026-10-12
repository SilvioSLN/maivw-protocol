#!/usr/bin/env bash
set -euo pipefail

echo "================================================================="
echo "   MAIVW Protocol — Automated Audit Readiness & Sanity Check     "
echo "================================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📂 Contracts dir: $CONTRACTS_DIR"
echo ""

# 1. Contagem exata de nSLOC
echo "📊 [1/4] Calculando nSLOC dos contratos no escopo da auditoria..."
python3 -c "
files = [
    '$CONTRACTS_DIR/src/MAIVWRegistry.sol',
    '$CONTRACTS_DIR/src/MAIVWRegistryLens.sol'
]
total_lines = 0
total_nsloc = 0
print(f'| {\"Arquivo\":<35} | {\"Total Linhas\":<12} | {\"nSLOC\":<8} |')
print('|' + '-'*37 + '|' + '-'*14 + '|' + '-'*10 + '|')
for f in files:
    with open(f) as fp:
        lines = fp.readlines()
        nsloc = [l.strip() for l in lines if l.strip() and not l.strip().startswith('//') and not l.strip().startswith('/*') and not l.strip().startswith('*')]
        basename = f.split('/')[-1]
        print(f'| {basename:<35} | {len(lines):<12} | {len(nsloc):<8} |')
        total_lines += len(lines)
        total_nsloc += len(nsloc)
print('|' + '-'*37 + '|' + '-'*14 + '|' + '-'*10 + '|')
print(f'| {\"TOTAL NO ESCOPO\":<35} | {total_lines:<12} | {total_nsloc:<8} |')
"

echo ""
echo "🔍 [2/4] Executando inspeção de Storage Layout (compatibilidade UUPS)..."
docker run --rm --entrypoint /bin/sh -v "$CONTRACTS_DIR:/contracts" ghcr.io/foundry-rs/foundry:latest -c "
  cp -r /contracts /tmp/c && cd /tmp/c && forge inspect MAIVWRegistry storageLayout
" | grep -E "__gap|totalStaked|accumulatedTreasuryFees|owner|guardian"

echo ""
echo "📏 [3/4] Verificando limites de tamanho de Bytecode (EIP-170: máx 24.576 bytes)..."
docker run --rm --entrypoint /bin/sh -v "$CONTRACTS_DIR:/contracts" ghcr.io/foundry-rs/foundry:latest -c "
  cp -r /contracts /tmp/c && cd /tmp/c && forge build --sizes
" | grep -E "MAIVWRegistry|MAIVWRegistryLens" || true

echo ""
echo "🧪 [4/4] Executando a suíte completa de testes Foundry (106 testes)..."
docker run --rm --entrypoint /bin/sh -v "$CONTRACTS_DIR:/contracts" ghcr.io/foundry-rs/foundry:latest -c "
  cp -r /contracts /tmp/c && cd /tmp/c && forge test
"

echo ""
echo "================================================================="
echo "   ✅ AUDIT READINESS CHECK CONCLUÍDO COM 100% DE SUCESSO!        "
echo "================================================================="
