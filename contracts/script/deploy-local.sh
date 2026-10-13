#!/bin/sh
set -eu

rpc_url="${RPC_URL:-http://anvil:8545}"
chain_id="${CHAIN_ID:-31337}"
output_dir="${DEPLOY_OUTPUT_DIR:-/deploy-output}"
address_file="$output_dir/contract-address.txt"
mirror_address_file="$output_dir/mirror-registry-v2-address.txt"
log_file="$output_dir/deploy.log"

mkdir -p "$output_dir"

until cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1; do
  echo "[contracts] aguardando RPC em $rpc_url"
  sleep 1
done

actual_chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [ "$actual_chain_id" != "$chain_id" ]; then
  echo "[contracts] chain ID do RPC ($actual_chain_id) difere de CHAIN_ID ($chain_id)" >&2
  exit 1
fi

if [ "$chain_id" != "31337" ]; then
  case "${REGISTRY_CONTRACT_ADDRESS:-}" in
    0x????????????????????????????????????????)
      printf '%s\n' "$REGISTRY_CONTRACT_ADDRESS" > "$address_file"
      echo "[contracts] usando Registry informado para a rede $chain_id: $REGISTRY_CONTRACT_ADDRESS"
      exit 0
      ;;
    *)
      echo "[contracts] REGISTRY_CONTRACT_ADDRESS válido é obrigatório fora do Anvil local" >&2
      exit 1
      ;;
  esac
fi

if [ -f "$address_file" ]; then
  existing_address="$(tr -d '[:space:]' < "$address_file")"
  case "$existing_address" in
    0x????????????????????????????????????????)
      existing_code="$(cast code "$existing_address" --rpc-url "$rpc_url" 2>/dev/null || true)"
      if [ -n "$existing_code" ] && [ "$existing_code" != "0x" ]; then
        mirror_address="$(tr -d '[:space:]' < "$mirror_address_file" 2>/dev/null || true)"
        mirror_code=""
        case "$mirror_address" in
          0x????????????????????????????????????????)
            mirror_code="$(cast code "$mirror_address" --rpc-url "$rpc_url" 2>/dev/null || true)"
            ;;
        esac
        if [ -n "$mirror_code" ] && [ "$mirror_code" != "0x" ]; then
          echo "[contracts] Registry local já implantado em $existing_address"
          echo "[contracts] Mirror Registry V2 local já implantado em $mirror_address"
          exit 0
        fi

        echo "[contracts] adicionando Mirror Registry V2 ao deploy local existente"
        LEGACY_REGISTRY_ADDRESS="$existing_address" forge script script/DeployMirrorV2.s.sol:DeployMirrorV2Script \
          --rpc-url "$rpc_url" \
          --broadcast \
          --color never 2>&1 | tee "$log_file"
        mirror_address="$(sed -n 's/.*Mirror Registry V2 Proxy:[[:space:]]*\(0x[0-9a-fA-F]\{40\}\).*/\1/p' "$log_file" | tail -n 1)"
        case "$mirror_address" in
          0x????????????????????????????????????????) ;;
          *)
            echo "[contracts] não foi possível extrair o endereço do Mirror Registry V2" >&2
            exit 1
            ;;
        esac
        printf '%s\n' "$mirror_address" > "$mirror_address_file.tmp"
        mv "$mirror_address_file.tmp" "$mirror_address_file"
        echo "[contracts] Mirror Registry V2 local pronto em $mirror_address"
        exit 0
      fi
      ;;
  esac
fi

echo "[contracts] implantando MAIVWRegistry no Anvil local"
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url "$rpc_url" \
  --broadcast \
  --color never 2>&1 | tee "$log_file"

contract_address="$(sed -n 's/.*PROXY (Endereco Oficial):[[:space:]]*\(0x[0-9a-fA-F]\{40\}\).*/\1/p' "$log_file" | tail -n 1)"
mirror_address="$(sed -n 's/.*Mirror Registry V2 Proxy:[[:space:]]*\(0x[0-9a-fA-F]\{40\}\).*/\1/p' "$log_file" | tail -n 1)"
case "$contract_address" in
  0x????????????????????????????????????????) ;;
  *)
    echo "[contracts] não foi possível extrair o endereço do proxy" >&2
    exit 1
    ;;
esac

case "$mirror_address" in
  0x????????????????????????????????????????) ;;
  *)
    echo "[contracts] não foi possível extrair o endereço do Mirror Registry V2" >&2
    exit 1
    ;;
esac

deployed_code="$(cast code "$contract_address" --rpc-url "$rpc_url")"
if [ -z "$deployed_code" ] || [ "$deployed_code" = "0x" ]; then
  echo "[contracts] o endereço extraído não contém bytecode" >&2
  exit 1
fi

printf '%s\n' "$contract_address" > "$address_file.tmp"
mv "$address_file.tmp" "$address_file"
printf '%s\n' "$mirror_address" > "$mirror_address_file.tmp"
mv "$mirror_address_file.tmp" "$mirror_address_file"
echo "[contracts] Registry local pronto em $contract_address"
echo "[contracts] Mirror Registry V2 local pronto em $mirror_address"
