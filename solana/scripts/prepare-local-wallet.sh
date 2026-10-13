#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wallet_path="$repo_dir/tests/fixtures/local-authority.json"

if [[ -e "$wallet_path" ]]; then
  echo "Local test wallet already exists: $wallet_path"
  exit 0
fi

solana-keygen new --no-bip39-passphrase --silent --outfile "$wallet_path"
echo "Created disposable local test wallet: $wallet_path"
