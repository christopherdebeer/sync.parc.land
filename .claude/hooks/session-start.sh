#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Run asynchronously (5 min timeout) — session starts immediately while this runs
echo '{"async": true, "asyncTimeout": 300000}'

# Signal file so Claude knows when setup is done
SETUP_DONE_FILE="/tmp/.session-setup-complete"
rm -f "$SETUP_DONE_FILE"

DENO_DIR="/root/.deno"
DENO_BIN="$DENO_DIR/bin/deno"

# Install Deno if not present
if [ ! -x "$DENO_BIN" ]; then
  echo "Installing Deno..."
  curl -fsSL https://deno.land/install.sh | sh
fi

# Ensure Deno is on PATH for this session
export PATH="$DENO_DIR/bin:$PATH"
echo "export PATH=\"$DENO_DIR/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"

# TLS workaround for JSR in sandboxed environments
echo "export DENO_TLS_CA_STORE=system" >> "$CLAUDE_ENV_FILE"
export DENO_TLS_CA_STORE=system

# Install vt CLI globally if not present
if ! command -v vt &>/dev/null; then
  echo "Installing vt CLI..."
  deno install -grAf --name vt jsr:@valtown/vt 2>/dev/null
fi

# Cache project dependencies
if [ -f "$CLAUDE_PROJECT_DIR/deno.json" ]; then
  echo "Caching Deno dependencies..."
  cd "$CLAUDE_PROJECT_DIR"
  deno install 2>/dev/null || true
fi

# Write completion marker so Claude can check
echo "done" > "$SETUP_DONE_FILE"
echo "Session setup complete: Deno $(deno --version | grep -oP 'deno \K[^ ]+'  2>/dev/null || echo '?'), vt ready"
