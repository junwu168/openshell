# Open Code v1 Design: OpenCode Remote Tools

## Overview

Open Code is a terminal-only plugin for AI coding CLIs. In v1, the first host integration is `opencode`.

The product goal is to let an AI model operate on one or more remote Linux servers over SSH while keeping credentials isolated from the model, enforcing strict user approvals for risky actions, and preserving an audit trail on the client machine.

This document defines the design boundary for v1 so implementation planning can proceed without revisiting scope or architecture.

## Problem Statement

AI coding CLIs are useful for local development, but infrastructure and operations work often happens across multiple remote machines. Existing CLI tools do not provide a safe, structured way for a model to:

- work against multiple remote servers in one session,
- use isolated SSH credentials that the model cannot read,
- require explicit approval before risky remote actions,
- preserve a local audit trail of commands and file changes, and
- evolve cleanly to support additional host CLIs later.

## Goals

- Integrate with `opencode` as the first supported host CLI.
- Expose explicit remote tools rather than pretending the remote machine is the local filesystem.
- Support multiple registered servers from the start.
- Store server credentials in a local encrypted registry controlled by Open Code, not by model-visible config files.
- Allow clearly safe Linux inspection commands to run without approval.
- Require per-action approval for every write operation.
- Require approval for middleware-oriented commands even when they appear read-only.
- Keep a structured local audit log for every action.
- Keep a local git-backed audit repository for file changes made through dedicated remote file write tools.
- Preserve a host-agnostic core so future adapters for `codex`, `claude code`, or similar CLIs can reuse the same runtime and policy logic.

## Non-Goals

- Supporting GUI editors or IDE plugins in v1.
- Hiding remote execution behind local-looking file or shell tools.
- Auto-approving writes for a whole session or server.
- Using git on the remote server for audit or rollback.
- Guaranteeing full file-level reconstruction for arbitrary shell commands that mutate remote state indirectly.
- Supporting every possible remote protocol beyond SSH in v1.

## Scope Summary

V1 is a terminal plugin for `opencode` backed by a local core service/library. The plugin defines explicit remote tools. The core handles encrypted credentials, SSH execution, policy enforcement, audit logging, and local git snapshots for dedicated file-write operations.

## Architecture

### High-Level Shape

The system is split into two layers:

1. `opencode` host adapter
2. host-agnostic local core

The `opencode` adapter is responsible for:

- registering tool definitions with `opencode`,
- receiving tool calls,
- surfacing approval prompts to the user,
- returning structured tool results in the shape expected by `opencode`.

The local core is responsible for:

- encrypted server registry,
- SSH connection and session reuse,
- command classification and policy enforcement,
- remote file and command execution,
- audit log persistence,
- local git-backed file snapshotting.

### Core Module Boundaries

The local core should be split into the following modules:

- `host-adapter/opencode`
  - The `opencode`-specific plugin layer.
- `tool-orchestrator`
  - Entry point for all tool calls.
  - Applies common sequencing: validate, resolve server, classify, request approval when needed, execute, audit, return result.
- `server-registry`
  - Stores encrypted server definitions and authentication material.
- `ssh-runtime`
  - Owns connection lifecycle, command execution, file transfer, and remote patch/write operations.
- `policy-engine`
  - Classifies tool actions into auto-allow, approval-required, or reject.
- `audit-engine`
  - Writes structured action logs and manages local git-backed snapshots for file changes.

### Design Rule

All host tools must call the `tool-orchestrator`. No tool may bypass policy or audit directly. This keeps behavior consistent across commands and file tools and prevents policy drift as more adapters are added later.

## Tool Surface

The v1 tool set is explicit and server-targeted:

- `list_servers()`
- `remote_exec(server, command, cwd?, timeout?)`
- `remote_read_file(server, path, offset?, length?)`
- `remote_write_file(server, path, content, mode?)`
- `remote_patch_file(server, path, diff_or_patch)`
- `remote_list_dir(server, path, recursive?, limit?)`
- `remote_stat(server, path)`
- `remote_find(server, path, pattern, glob?, limit?)`

### Tool Surface Principles

- Every operation names a `server` explicitly.
- The default behavior must favor clarity over convenience.
- Session-local implicit "current server" behavior is out of scope for v1.
- Dedicated file tools are preferred for file inspection and file mutation.
- `remote_exec` remains available for shell-oriented work that does not map cleanly to a dedicated file tool.

## Data Flow

For every tool invocation, the runtime sequence is:

1. The `opencode` adapter receives the tool call.
2. `tool-orchestrator` validates arguments and resolves the target server via `server-registry`.
3. `policy-engine` classifies the action.
4. If the action requires approval, the adapter presents the exact server, path, and command or write intent to the user.
5. `ssh-runtime` executes the command or file action.
6. `audit-engine` records the action and, when relevant, creates local snapshots.
7. A structured result is returned to the adapter and then back to `opencode`.

## Security And Permissions

### Permission Classes

V1 uses three policy outcomes:

- `auto-allow`
- `approval-required`
- `reject`

### Auto-Allow

The following operations may run directly:

- dedicated read-focused file tools such as `remote_read_file`, `remote_list_dir`, `remote_stat`, and `remote_find`,
- clearly safe Linux inspection commands executed through `remote_exec`.

Examples of Linux inspection commands include:

- `cat`
- `grep`
- `find`
- `ls`
- `pwd`
- `uname`
- `df`
- `free`
- `ps`
- `systemctl status`

The exact allowlist belongs in implementation, but the design intent is a conservative rule-based allowlist.

### Approval-Required

The following actions must require explicit user approval for each execution:

- every file mutation,
- every shell command that may mutate remote state,
- every middleware-oriented command family even when the specific invocation appears read-only.

Examples of middleware-oriented command families include:

- `psql`
- `mysql`
- `redis-cli`
- `kubectl`
- `docker`
- `helm`
- cloud provider CLIs

Unknown commands must default to `approval-required`.

### Reject

The runtime may reject requests that are malformed or unsupported, such as:

- unknown server ids,
- invalid file paths or missing required arguments,
- unsupported patch formats,
- actions that violate hard safety rules defined by the implementation.

### Classification Strategy

Policy classification must be deterministic and rule-based. V1 must not rely on a model to decide whether a command is safe. The model may propose commands, but the core decides whether they run directly, require approval, or are rejected.

## Credential Model

### Storage

Open Code manages its own encrypted local server registry.

Each server record stores:

- server id,
- host,
- port,
- username,
- labels or grouping metadata,
- authentication method,
- authentication material,
- optional non-secret metadata.

Supported v1 authentication methods:

- username plus password,
- imported private key or certificate material.

### Isolation Requirements

- Credentials must not be stored in model-visible prompt files.
- Raw credentials must never be returned by tools.
- Tool calls reference servers by logical id, not by raw secret material.
- Decryption and secret handling stay inside the core.

## Multi-Server Model

Multi-server support is a first-class requirement.

Design implications:

- every tool call requires an explicit server target,
- the registry supports many named servers,
- the SSH runtime may reuse connections per server during a session,
- audit artifacts must be partitioned by server so changes remain attributable.

Grouping, tags, or labels may be stored in the registry for future filtering, but group-based orchestration is not required in v1.

## Audit Model

Audit artifacts are stored on the client machine where `opencode` runs, not on the remote server.

### Structured Action Log

Every tool action writes a structured local log entry that includes:

- timestamp,
- server id,
- tool name,
- sanitized arguments,
- approval status,
- execution result metadata,
- changed path metadata when available.

Sensitive values must be redacted before persistence.

### Git-Backed File Snapshot Audit

Dedicated file mutation tools participate in local git-backed snapshotting.

For `remote_write_file` and `remote_patch_file`, the audit flow is:

1. capture the pre-change remote file content if the file exists,
2. perform the write or patch,
3. capture the post-change remote file content,
4. store snapshots locally under an audit directory organized by server and remote path,
5. commit the snapshot change into a local git repository.

This repository exists only on the client machine and is used for inspection, history, and rollback support.

### Limit Of Audit Guarantees

`remote_exec` always creates structured command audit logs, but v1 does not promise file-level snapshots for arbitrary shell side effects. If a user wants file-level diffs and recovery guarantees, they should prefer dedicated file mutation tools.

## Error Handling

The system must return structured failures rather than flattening all problems into a generic error string.

Important error classes:

- server resolution failure,
- credential decrypt or load failure,
- SSH connection failure,
- authentication failure,
- timeout,
- policy rejection,
- approval denial,
- remote file-not-found,
- remote permission denied,
- non-zero command exit,
- patch apply failure,
- local audit persistence failure,
- local git snapshot failure.

Tool results should distinguish:

- whether the action was attempted,
- whether it completed,
- command exit status when applicable,
- stdout and stderr payloads or truncation metadata,
- audit/logging status when relevant.

## Testing Strategy

### Unit Tests

- `policy-engine` command classification
- argument validation and path validation
- secret redaction
- snapshot path mapping
- `tool-orchestrator` sequencing logic

### Integration Tests

- encrypted registry load and server resolution
- SSH connection against disposable local test targets
- read-only command execution
- approval-required command flow
- dedicated file read and write flows
- multi-server session isolation

### Audit Tests

- structured log persistence
- pre-change and post-change snapshot capture
- git commit creation for dedicated file writes
- server-specific audit partitioning

### Adapter Contract Tests

- tool registration shape for `opencode`
- argument-to-core mapping
- structured result mapping back to the host runtime

## Out Of Scope For V1

- session-wide approval grants
- group fan-out execution across multiple servers in one tool call
- background daemon deployment model
- remote git integration
- full TUI management experience for registry and audit browsing
- automatic command correction or command suggestion
- support for non-SSH transports

## Implementation Constraints For Planning

- The architecture must preserve a strict boundary between the `opencode` adapter and the host-agnostic core.
- The initial implementation should optimize for clear module ownership and extension over completeness of the tool catalog.
- Policy logic must be centralized and deterministic.
- File-change audit guarantees should attach only to dedicated file mutation tools in v1.
- The plan should assume future host adapters are likely, even though only `opencode` is in scope now.

## Success Criteria

The design is successful for v1 when all of the following are true:

- A user can register multiple remote servers locally with encrypted credentials.
- `opencode` can invoke explicit remote tools against any registered server.
- Clearly safe Linux inspection commands can run without approval.
- Every write requires explicit approval.
- Middleware-oriented commands require explicit approval even when nominally read-only.
- Dedicated remote file writes create local git-backed before/after audit history.
- Every tool action creates a structured local audit log.
- The implementation plan can be written without reopening architecture or scope decisions.
