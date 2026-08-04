#!/usr/bin/env bash
# install.sh — Agentide one-line installer
#
# Detects the host (OS + arch + Node/Docker presence), picks the best working
# distribution, and installs. If nothing works, prints a clear fallback message.
#
# Distribution order (per IMPL §Phase 7):
#   1. npm global install (requires Node). The "do it" option.
#   2. npx --package=@spanexx/agentide -y <cmd>  (one-off, doesn't pollute PATH)
#   3. Docker (only if a real published image exists — TODO; off by default)
#   4. GitHub release binary download (only if a release is published)
#
# The script itself is hosted at:
#   https://raw.githubusercontent.com/spanexx/agentide/main/packages/agentide/install.sh
# Fork the repo and change REPO + the raw URL if self-hosting.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/spanexx/agentide/main/packages/agentide/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/spanexx/agentide/main/packages/agentide/install.sh | bash -s -- --data-dir ~/.agentide/data
#
# Env overrides:
#   AGENTIDE_VERSION       default: latest
#   AGENTIDE_SKIP_NPM      default: 0 (set 1 to skip the npm install)
#   AGENTIDE_SKIP_NPX      default: 0 (set 1 to skip the npx fallback)
#   AGENTIDE_SKIP_DOCKER   default: 0 (set 1 to skip the docker branch)
#   AGENTIDE_SKIP_BINARY   default: 0 (set 1 to skip the binary-download branch)
#   AGENTIDE_DATA_DIR      default: ~/.agentide/data
#
# Exit codes:
#   0  installed (or already present)
#   1  unsupported environment
#   2  download / install failure (with fallback suggestion)

set -euo pipefail

DATA_DIR="${AGENTIDE_DATA_DIR:-$HOME/.agentide/data}"
VERSION="${AGENTIDE_VERSION:-latest}"
REPO="spanexx/agentide"
PACKAGE="@spanexx/agentide"

log() { printf "\033[36m[agentide]\033[0m %s\n" "$*"; }
err() { printf "\033[31m[agentide]\033[0m %s\n" "$*" 1>&2; }
ok() { printf "\033[32m[agentide]\033[0m %s\n" "$*"; }
warn() { printf "\033[33m[agentide]\033[0m %s\n" "$*"; }

# ── 1. Detect environment ──────────────────────────────────────────────────────
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  linux)   OS=linux ;;
  darwin)  OS=darwin ;;
  msys*|mingw*|cygwin*) OS=windows ;;
  *) err "Unsupported OS: $OS"; exit 1 ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH=amd64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) err "Unsupported arch: $ARCH"; exit 1 ;;
esac

# ── 2. Distributions ──────────────────────────────────────────────────────────

# Primary: install with npm globally. This is the version-tag-driven path
# that picks up the latest published @spanexx/agentide.
install_via_npm() {
  if [ "${AGENTIDE_SKIP_NPM:-0}" = "1" ]; then return 1; fi
  if ! command -v npm >/dev/null 2>&1; then return 1; fi
  log "Node.js detected; installing with npm (registry @ spanexx, version: $VERSION)"
  mkdir -p "$DATA_DIR"
  if npm install -g "$PACKAGE@$VERSION" 2>&1 | tail -5; then
    ok "Installed $PACKAGE via npm."
    ok "Next steps:"
    ok "  agentide init  --data-dir '$DATA_DIR' --default-tenant acme"
    ok "  agentide start --data-dir '$DATA_DIR' --default-tenant acme"
    ok "  agentide status"
    ok "Logs:   /tmp/agentide.log"
    ok "Stop:   agentide stop"
    return 0
  fi
  return 1
}

# Fallback: one-off `npx --package` for environments that don't allow global
# installs. Doesn't pollute PATH; user must wrap each invocation in `npx`.
install_via_npx() {
  if [ "${AGENTIDE_SKIP_NPX:-0}" = "1" ]; then return 1; fi
  if ! command -v npx >/dev/null 2>&1; then return 1; fi
  log "npx fallback — one-off invocations."
  mkdir -p "$DATA_DIR"
  ok "Run with:"
  ok "  npx -y $PACKAGE@$VERSION init  --data-dir '$DATA_DIR' --default-tenant acme"
  ok "  npx -y $PACKAGE@$VERSION start --data-dir '$DATA_DIR' --default-tenant acme"
  ok "  npx -y $PACKAGE@$VERSION stop"
  return 0
}

# Docker: only emit if a real image tag exists. Off until we publish one.
install_via_docker() {
  if [ "${AGENTIDE_SKIP_DOCKER:-0}" = "1" ]; then return 1; fi
  if ! command -v docker >/dev/null 2>&1; then return 1; fi
  warn "Docker detected, but no published agentide image yet ($REPO on Docker Hub is empty)."
  warn "Skipping the docker branch. Use npm (recommended) instead."
  return 1
}

# Binary: GitHub releases. Off until we cut a real release there.
install_binary() {
  if [ "${AGENTIDE_SKIP_BINARY:-0}" = "1" ]; then return 1; fi
  local url="https://github.com/${REPO}/releases/download/${VERSION}/agentide-${OS}-${ARCH}"
  warn "Binary download not yet published for $OS/$ARCH at $url"
  warn "Skipping the binary branch. Use npm (recommended) instead."
  return 1
}

# ── 3. Main ────────────────────────────────────────────────────────────────────
mkdir -p "$DATA_DIR"

# Order matters: most likely to succeed first. Each function returns 0 on
# success. If a step is "off by default" (docker / binary), it returns 1 to
# skip the success branch and try the next path.
if install_via_npm; then
  exit 0
fi

if install_via_npx; then
  exit 0
fi

if install_via_docker; then
  exit 0
fi

if install_binary; then
  exit 0
fi

err "Could not install $PACKAGE."
err "Install Node.js + npm (https://nodejs.org) and re-run this script."
err "Or fork the repo and run \`pnpm -r publish\` to make the package available locally."
exit 2
