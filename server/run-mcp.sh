#!/usr/bin/env bash
export REVYME_API_URL="http://localhost:3333"
export REVYME_PROJECT_ID="proj-1792912529558-5urrmm"
export REVYME_BRANCH_ID="main"
export REVYME_MCP_BRIDGE_URL="http://127.0.0.1:8082"
cd "/home/rost/Документи/revyme/revyme-builder-fork"
exec node packages/cli/dist/main.js mcp
