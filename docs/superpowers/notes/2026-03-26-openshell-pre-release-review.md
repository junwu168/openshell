# OpenShell Pre-Release Review Note

Date: 2026-03-26
Branch: `main`
Reviewer: Claude Code

## Scope

This document reviews the first pre-release candidate for:

- npm package: `@junwu168/openshell`
- CLI binary: `openshell`
- supported host: `opencode`

The package enables AI coding CLIs to safely operate on remote Linux servers over SSH with credential isolation, user approval enforcement, and local audit trails.

## Automated Verification

Verified on current HEAD:

```bash
bun test
bun run typecheck
bun run build
```

Observed result:

- `bun test` -> `96 pass, 0 fail`
- `typecheck` -> pass
- `build` -> pass

## Architecture Summary

```
src/
├── index.ts                    # Package exports (OpenCodePlugin, contracts)
├── core/                       # Host-agnostic runtime core
│   ├── contracts.ts            # Shared types: ServerID, ToolPayload, ToolResult, PolicyDecision
│   ├── result.ts               # okResult(), partialFailureResult(), errorResult()
│   ├── paths.ts                # Runtime path resolution via env-paths
│   ├── policy.ts               # Deterministic command classification
│   ├── patch.ts                # Unified diff application
│   ├── orchestrator.ts         # Central pipeline: validate -> classify -> approve -> execute -> audit
│   ├── registry/               # Server registry (layered JSON, NOT encrypted)
│   │   └── server-registry.ts  # Global + workspace scoped server records
│   ├── ssh/                    # SSH/SFTP operations
│   │   └── ssh-runtime.ts      # exec, readFile, writeFile, listDir, stat
│   └── audit/                 # Audit logging and git-backed snapshots
│       ├── log-store.ts        # JSONL append-only audit log
│       ├── git-audit-repo.ts   # Git-backed file snapshots
│       └── redact.ts           # Secret redaction before logging
├── opencode/
│   └── plugin.ts              # OpenCode adapter (tool definitions, approval prompts)
├── cli/                       # CLI commands
│   ├── openshell.ts           # Main CLI entry (install/uninstall/server-registry)
│   └── server-registry.ts     # Interactive server registry CLI
└── product/                   # Install/uninstall lifecycle
    ├── install.ts             # openshell install
    ├── uninstall.ts           # openshell uninstall
    ├── opencode-config.ts     # OpenCode config merging
    └── workspace-tracker.ts   # Track workspaces for cleanup
```

## Implemented Features

### Remote Tools (8 tools)
- `list_servers` - List registered servers
- `remote_exec` - Execute shell commands on remote servers
- `remote_read_file` - Read remote files
- `remote_write_file` - Write remote files (approval-required)
- `remote_patch_file` - Apply unified diffs (approval-required)
- `remote_list_dir` - List remote directories
- `remote_stat` - Stat remote paths
- `remote_find` - Search remote files/content

### Policy Engine
- **Auto-allow:** Safe inspection commands (cat, grep, find, ls, pwd, uname, df, free, ps, systemctl status)
- **Approval-required:** Middleware commands (psql, mysql, redis-cli, kubectl, docker, helm, aws, gcloud, az) and shell composition (pipes, redirects, chaining)
- **Reject:** Empty commands

### Server Registry
- **Layered configuration:** Global (`~/.config/openshell/servers.json`) and workspace (`<workspace>/.open-code/servers.json`)
- **File locking:** Prevents concurrent write corruption
- **Workspace shadowing:** Workspace entries override global entries with the same ID
- **Auth types:** Password, private key (with optional passphrase), certificate

### Audit System
- **JSONL action log:** All tool actions logged with timestamps, sanitized secrets
- **Git-backed snapshots:** Before/after content for file writes stored in git commits
- **Fail-closed:** If audit preflight fails, operations do not proceed

### Install/Uninstall Lifecycle
- `openshell install` - Creates dirs, merges OpenCode config with plugin + permissions
- `openshell uninstall` - Aggressively removes all OpenShell state and tracked workspace `.open-code/` dirs

## Security Considerations

### Known Security Model (Documented)

> "Password auth is stored in plain text. That is intentionally simple for this pre-release and not recommended for long-term production use."

### Secret Handling
- Passwords stored in plain text JSON files (keytar dependency was removed)
- Private key paths and certificate paths are read from filesystem at runtime
- Secret redaction in audit logs covers URLs with embedded credentials and `password=`, `secret=`, `token=` patterns
- `list_servers` properly excludes auth data from returned server records

### Credential Isolation
- Server IDs used in tool calls, not raw credentials
- Auth paths validated for workspace-scoped records only
- Relative auth paths rejected for global scope

## Pre-Release Concerns

### 1. Plain-Text Password Storage
The current implementation stores passwords in plain text JSON. For a production release, encryption at rest would be essential.

### 2. `remote_find` Uses Shell Execution (Medium Risk)
The `remote_find` implementation builds shell commands (`find ... | head -n ...` or `grep -R -n ... | head -n ...`) which bypasses the policy engine's shell composition detection. Commands with pipes or redirects could be constructed via the `pattern` or `glob` arguments.

### 3. No Connection Pooling/Reuse (Performance)
Each SSH operation creates a new connection. For high-frequency tool use, this could be inefficient.

### 4. Uninstall Removes Workspace `.open-code/` Dirs
The uninstall is "aggressive" and removes ALL tracked workspace `.open-code/` directories. If users have other plugins or data in those directories, it would be lost.

### 5. Bun Runtime Dependency
The project uses Bun as its runtime/package manager. Node.js compatibility would require additional work.

### 6. No Connection Recovery (Reliability)
The audit system is fail-closed, but there's no retry logic or recovery for transient SSH failures.

## Review Path

Reviewer flow:

1. `npm install -g @junwu168/openshell`
2. `openshell install`
3. `openshell server-registry add`
4. Launch `opencode`
5. Exercise:
   - `list_servers`
   - safe `remote_exec`
   - approval-gated `remote_write_file`
6. `openshell uninstall`

## Prior Fix (Verified in This Review)

During prior verification, an uninstall bug was fixed:

- if OpenCode config only contained `@junwu168/openshell`, uninstall preserved the plugin entry because the config writer spread `...current` back into the output when the filtered plugin list became empty

This is covered by `tests/unit/opencode-config.test.ts` and fixed in `src/product/opencode-config.ts`.

## Test Coverage

| File | Approx Lines | Coverage Relevance |
|------|-------------|-------------------|
| `src/core/orchestrator.ts` | ~1080 | Central pipeline (critical) |
| `src/core/registry/server-registry.ts` | ~505 | Server registry |
| `src/cli/server-registry.ts` | ~470 | Interactive CLI |
| `src/core/ssh/ssh-runtime.ts` | ~355 | SSH operations |
| `src/opencode/plugin.ts` | ~243 | OpenCode adapter |
| `src/product/opencode-config.ts` | ~118 | Config lifecycle |

## Verdict

**Ready for pre-release** with the documented concerns understood by users:

- Plain-text password storage is acceptable for pre-release evaluation
- `remote_find` shell composition bypass should be addressed before production
- All automated tests pass (96 tests)

