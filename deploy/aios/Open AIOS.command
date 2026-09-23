#!/usr/bin/env bash
set -euo pipefail
AIOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if ! "$AIOS_ROOT/scripts/aios-desktop" open; then
  echo "See the message above. Press Return to close."
  read -r
fi
