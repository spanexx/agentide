#!/bin/sh
# Q5 — Rust pre-commit checks for crates/cli-adapter.
# Skips with one warning line (exit 0) when cargo or the crate is absent,
# so the TS-only checkout still passes.

set -e

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CRATE_DIR="$ROOT/crates/cli-adapter"

if ! command -v cargo >/dev/null 2>&1; then
  echo "WARNING: cargo not found — skipping Rust checks (cli-adapter)" >&2
  exit 0
fi

if [ ! -f "$CRATE_DIR/Cargo.toml" ]; then
  echo "WARNING: $CRATE_DIR not present — skipping Rust checks" >&2
  exit 0
fi

cd "$CRATE_DIR"
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
