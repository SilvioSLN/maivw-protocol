#!/bin/sh
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
baseline="$project_dir/storage-layout/MAIVWMirrorRegistryV2.v2.slots"
actual="$(mktemp)"
trap 'rm -f "$actual"' EXIT

cd "$project_dir"
forge inspect MAIVWMirrorRegistryV2 storage-layout | awk -F '|' '
  $2 ~ /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*/ {
    name=$2; slot=$4; offset=$5; bytes=$6
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", slot)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", offset)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", bytes)
    if (name != "Name") print name "\t" slot "\t" offset "\t" bytes
  }
' > "$actual"

diff -u "$baseline" "$actual"
echo "[storage-layout] MAIVWMirrorRegistryV2 permanece compatível"
