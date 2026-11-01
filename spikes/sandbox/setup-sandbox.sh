#!/usr/bin/env bash
# near-workspaces 5 ships neard 2.6.2, which cannot load wasm built by current Rust/cargo-near.
# Swap in a current sandbox binary. Usage: ./setup-sandbox.sh [version]  (2.13.0 ~ mainnet, 2.14.0 ~ testnet)
set -euo pipefail
VERSION="${1:-2.14.0}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=Darwin-arm64 ;;
  Linux-x86_64) PLATFORM=Linux-x86_64 ;;
  *) echo "unsupported platform" >&2; exit 1 ;;
esac
TMP="$(mktemp -d)"
curl -sSfL "https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/$PLATFORM/$VERSION/near-sandbox.tar.gz" | tar -xz -C "$TMP"
cp "$TMP/$PLATFORM/near-sandbox" "$(dirname "$0")/node_modules/near-sandbox/bin/near-sandbox"
"$(dirname "$0")/node_modules/near-sandbox/bin/near-sandbox" --version | head -1
