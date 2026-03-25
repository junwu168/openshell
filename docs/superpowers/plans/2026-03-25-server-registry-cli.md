# Server Registry CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive password-based server registry CLI for real OpenCode smoke testing, with `add`, `list`, and `remove` commands backed by the existing encrypted registry.

**Architecture:** Extend the existing encrypted registry with delete support, add a small CLI module that owns prompt flow and output formatting, and expose it through a thin script entrypoint plus a package script alias. Keep the OpenCode plugin and SSH runtime unchanged.

**Tech Stack:** TypeScript, Bun, Node readline/TTY APIs, existing encrypted registry + Keychain secret provider

---

### Task 1: Add Registry Delete Coverage

**Files:**
- Modify: `tests/unit/server-registry.test.ts`
- Modify: `src/core/registry/server-registry.ts`

- [ ] **Step 1: Write failing tests for deleting an existing record and removing a missing id safely**
- [ ] **Step 2: Run `~/.bun/bin/bun test tests/unit/server-registry.test.ts` and confirm the new cases fail**
- [ ] **Step 3: Add `remove(id)` to the registry interface and implementation with the existing write queue + lock discipline**
- [ ] **Step 4: Re-run `~/.bun/bin/bun test tests/unit/server-registry.test.ts` and confirm it passes**

### Task 2: Add CLI Behavior Tests

**Files:**
- Create: `tests/unit/server-registry-cli.test.ts`
- Create: `src/cli/server-registry.ts`

- [ ] **Step 1: Write failing tests for `list`, interactive `add`, and interactive `remove` using a fake prompt/output adapter**
- [ ] **Step 2: Run `~/.bun/bin/bun test tests/unit/server-registry-cli.test.ts` and confirm the new cases fail**
- [ ] **Step 3: Implement a CLI module with command dispatch, interactive prompts, confirmation flow, and safe non-secret listing output**
- [ ] **Step 4: Re-run `~/.bun/bin/bun test tests/unit/server-registry-cli.test.ts` and confirm it passes**

### Task 3: Wire The Script Entry Point

**Files:**
- Create: `scripts/server-registry.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a thin script entry point that calls the CLI module**
- [ ] **Step 2: Add a package script alias such as `server-registry`**
- [ ] **Step 3: Run `~/.bun/bin/bun run server-registry list` against an empty registry and confirm it exits cleanly**

### Task 4: Verify End To End

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the real-server smoke workflow using the new CLI**
- [ ] **Step 2: Run `~/.bun/bin/bun test tests/unit/server-registry.test.ts tests/unit/server-registry-cli.test.ts`**
- [ ] **Step 3: Run `~/.bun/bin/bun run typecheck`**
- [ ] **Step 4: Run `~/.bun/bin/bun run build`**
- [ ] **Step 5: Run `~/.bun/bin/bun test` with elevated container-runtime access if needed, or note the environment limitation explicitly**
