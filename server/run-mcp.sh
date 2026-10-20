#!/usr/bin/env bash
set -e

# Ensure node and local tools are in PATH
export PATH="/home/rost/.local/bin:/home/rost/.local/nodejs/bin:/home/rost/.npm-global/bin:$PATH"

# Resolve repo root directory
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

exec ./node_modules/.bin/tsx server/mcp-server.ts "$@"
