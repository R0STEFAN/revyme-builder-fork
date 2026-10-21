# Revyme CLI & Model Context Protocol (MCP) Server v2

The official headless automation tool for **Revyme Website Builder**. Author, inspect, validate, and release complete Next.js landing pages headlessly with full source fidelity.

---

## 1. Quick Start

### Installation

```bash
# Run directly via npx
npx @revyme/cli doctor

# Or install globally
npm install -g @revyme/cli
```

### Link a Project

Link your current workspace directory to a Revyme project:

```bash
revyme init my-portfolio
```

This generates `.revymelocal/automation.json` pointing to your project without writing any sensitive credentials.

---

## 2. CLI Usage

### Commands

| Command | Description |
|---|---|
| `revyme doctor` | Inspect environment, paths, unicode/space validity, and API connection |
| `revyme init <projectId>` | Link directory to a project |
| `revyme mcp` | Launch stdio Model Context Protocol (MCP) server |
| `revyme <toolName>` | Execute any registered automation operation directly |

### Tool Invocation Options

```bash
# Execute with inline arguments
revyme meta.guide --topic general

# Read input from JSON file (supports Cyrillic and paths with spaces)
revyme workflow.batch --input-file ./batch-ops.json

# Read input from standard input
cat payload.json | revyme workflow.batch --stdin

# Dry-run mode: generates and validates Plan without committing
revyme pages.create --input-file ./page.json --dry-run
```

---

## 3. Cursor & Claude Desktop MCP Configuration

Connect your AI coding assistants directly to Revyme via standard stdio MCP:

```json
{
  "mcpServers": {
    "revyme": {
      "command": "npx",
      "args": ["-y", "@revyme/cli", "mcp"],
      "env": {
        "REVYME_API_URL": "http://localhost:3000",
        "REVYME_PROJECT_ID": "my-project",
        "REVYME_BRANCH_ID": "main"
      }
    }
  }
}
```

---

## 4. Key Architectural Guarantees

1. **Source Code is the Truth**: All changes are compiled to real `.tsx` React source code.
2. **Atomic CAS (Compare-And-Swap)**: Commits check `baseRevision` to prevent race conditions or clobbering concurrent user edits in the GUI.
3. **No Phantom Scene Graph**: No separate proprietary save format; full bidirectional parity with the visual builder.
4. **Credential Safety**: Authentication tokens and secrets are strictly excluded from configuration files and code artifacts.
5. **Path Robustness**: Full UTF-8 support for directories containing Cyrillic characters or spaces.
