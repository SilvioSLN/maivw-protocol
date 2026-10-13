#!/usr/bin/env bash
set -euo pipefail

expected_rust="rustc 1.93.1"
expected_anchor="anchor-cli 1.0.1"
expected_solana="solana-cli 3.1.10"

rustc --version | grep -F "$expected_rust"
anchor --version | grep -F "$expected_anchor"
solana --version | grep -F "$expected_solana"

echo "MAIVW Solana toolchain verified"
