#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CI=true
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
export CMAKE_POLICY_VERSION_MINIMUM=3.5
# Hermit and Flutter need writable SDK caches inside a read-only factory image.
if [[ -d /opt/hermit-cache ]]; then
  mkdir -p .factory-build
  if [[ ! -d .factory-build/hermit ]]; then
    cp -a /opt/hermit-cache .factory-build/hermit
    chmod -R u+w .factory-build/hermit
  fi
  export HERMIT_STATE_DIR="$PWD/.factory-build/hermit"
  export CARGO_HOME="$PWD/.factory-build/cargo"
  export PUB_CACHE="$PWD/.factory-build/pub"
fi
source ./bin/activate-hermit
just desktop-install-ci
just mobile-install
just ci
