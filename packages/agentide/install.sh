#!/usr/bin/env bash
# install.sh — Agentide one-line installer
#
# Detects the host (OS + arch + Node/Docker presence), picks the best distribution
# (binary download, Docker, or npx), and prints next steps.
#
# Per IMPL §Phase 7 (install.sh). Designed to fail loudly with a clear fallback message
# rather than leaving the operator with a half-installed system.
#
# Usage:
#   curl -fsSL https://agentide.io/install.sh | bash
#   curl -fsSL https://agentide.io/install.sh | bash -s -- --data-dir ~/.agentide/data
#
# Exit codes:
#   0  installed (or already present)
#   1  unsupported environment
#   2  download / install failure (with fallback suggestion)

set -euo pipefail

DATA_DIR="${AGENTIDE_DATA_DIR:-$HOME/.agentide/data}"
BIN_DIR=""
VERSION="${AGENTIDE_VERSION:-latest}"
REPO="spanexx/agentide"

log() { printf "\033[36m[agentide]\033[0m %s\n" "$*"; }
err() { printf "\033[31m[agentide]\033[0m %s\n" "$*" 1>&2; }
ok() { printf "\033[32m[agentide]\033[0m %s\n" "$*"; }

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

# ── 2. Pick distribution ───────────────────────────────────────────────────────
pick_install_path() {
  if [ -w /usr/local/bin ]; then
    BIN_DIR="/usr/local/bin"
  elif [ -w "$HOME/.local/bin" ]; then
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
  else
    BIN_DIR="$HOME/.agentide/bin"
    mkdir -p "$BIN_DIR"
    log "Note: installing to $BIN_DIR (no /usr/local/bin or ~/.local/bin writable)"
    log "Add this to your PATH: export PATH=\"$BIN_DIR:\$PATH\""
  fi
}

install_via_npx() {
  if command -v npx >/dev/null 2>&1 && [ "${AGENTIDE_SKIP_NPX:-0}" != "1" ]; then
    log "Node.js detected; using npx distribution"
    ok "Run with: npx -y @platform/agentide@${VERSION} init --data-dir \"$DATA_DIR\""
    ok "Then:      npx -y @platform/agentide@${VERSION} start"
    return 0
  fi
  return 1
}

install_via_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker detected; using docker distribution"
    mkdir -p "$DATA_DIR"
    ok "Run with: docker run --rm -v \"$DATA_DIR:/data\" -p 7100:7100 ${REPO}:${VERSION} init --data-dir /data"
    ok "Then:      docker run -d --name agentide -v \"$DATA_DIR:/data\" -p 7100:7100 ${REPO}:${VERSION}"
    return 0
  fi
  return 1
}

install_binary() {
  pick_install_path
  local url="https://github.com/${REPO}/releases/download/${VERSION}/agentide-${OS}-${ARCH}"
  log "Downloading agentide binary ($OS/$ARCH) from $url"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$BIN_DIR/agentide" || { err "download failed"; return 1; }
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$BIN_DIR/agentide" || { err "download failed"; return 1; }
  else
    err "neither curl nor wget present; cannot download binary"
    return 1
  fi
  chmod +x "$BIN_DIR/agentide" || true
  ok "Installed to $BIN_DIR/agentide"
}

# ── 3. Main ────────────────────────────────────────────────────────────────────
mkdir -p "$DATA_DIR"

if install_via_docker; then
  exit 0
fi

if install_via_npx; then
  exit 0
fi

if install_binary; then
  ok "Next steps:"
  ok "  agentide init --data-dir \"$DATA_DIR\""
  ok "  agentide start"
  exit 0
fi

err "Could not install via docker, npx, or binary download."
err "Install Node.js (https://nodejs.org) or Docker, then re-run this script."
exit 2