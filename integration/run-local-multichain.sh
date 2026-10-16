#!/bin/sh
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
compose_file="$project_dir/integration/docker-compose.multichain.yml"

cleanup() {
  docker compose -f "$compose_file" down --remove-orphans
}
trap cleanup EXIT INT TERM

docker compose -f "$compose_file" up -d --wait

cd "$project_dir/gateway"
LOCAL_EVM_RPC_URL=http://127.0.0.1:58545 \
LOCAL_SOLANA_RPC_URL=http://127.0.0.1:58999 \
node --import tsx --test test/LocalMultichainIntegration.test.ts
