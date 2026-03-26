# Open Code v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first `opencode` plugin release of Open Code with explicit multi-server SSH tools, encrypted local credentials, deterministic approval policy, structured local audit logs, and git-backed snapshots for dedicated file writes.

**Architecture:** Build a TypeScript ESM package that exports an `opencode` plugin while keeping the runtime core in-process and host-agnostic. The `opencode` adapter only registers tools, wires runtime dependencies, and relies on OpenCode's permission config to surface approval prompts; the core owns registry, policy, SSH, patch application, audit, and orchestration. Dedicated file write tools carry file-level audit guarantees; `remote_exec` carries command-level audit only.

**Tech Stack:** TypeScript ESM, Bun runtime/package manager, `@opencode-ai/plugin`, `ssh2`, `diff`, `env-paths`, `keytar`, `shescape`, `testcontainers`, Bun/Node crypto APIs, local `git` CLI, `bun:test`

---

## File Map

- Create: `package.json` - package metadata, scripts, runtime dependencies, publish entrypoints.
- Create: `tsconfig.json` - ESM TypeScript compiler settings for Bun-compatible output.
- Create: `.gitignore` - ignore build output, temp fixtures, and local runtime artifacts.
- Create: `src/index.ts` - public package entry that exports the `opencode` plugin.
- Create: `src/core/contracts.ts` - shared server records, tool arg types, approval types, and tool result shapes.
- Create: `src/core/result.ts` - canonical helpers for success, partial failure, and error payloads.
- Create: `src/core/paths.ts` - user config/data path resolution for registry and audit storage.
- Create: `src/core/policy.ts` - deterministic command classification and approval decisions.
- Create: `src/core/patch.ts` - apply unified diffs locally before remote writes.
- Create: `src/core/registry/secret-provider.ts` - secret-provider interface plus test double contract.
- Create: `src/core/registry/keychain-provider.ts` - OS-keychain-backed master-key provider.
- Create: `src/core/registry/crypto.ts` - AES-GCM encrypt/decrypt helpers for registry records.
- Create: `src/core/registry/server-registry.ts` - CRUD/load/resolve logic for encrypted server definitions.
- Create: `src/core/audit/redact.ts` - redact commands, content, and secret-like values before logging.
- Create: `src/core/audit/log-store.ts` - append-only JSONL audit log writer with fail-closed preflight.
- Create: `src/core/audit/git-audit-repo.ts` - audit repo init, snapshot path mapping, and git commit creation.
- Create: `src/core/ssh/ssh-runtime.ts` - SSH command execution and SFTP-backed file operations.
- Create: `src/core/orchestrator.ts` - central validate/classify/approve/execute/audit pipeline.
- Create: `src/opencode/plugin.ts` - OpenCode custom tool definitions using `@opencode-ai/plugin`.
- Create: `tests/unit/plugin-export.test.ts`
- Create: `tests/unit/result.test.ts`
- Create: `tests/unit/server-registry.test.ts`
- Create: `tests/unit/policy.test.ts`
- Create: `tests/unit/audit.test.ts`
- Create: `tests/unit/opencode-plugin.test.ts`
- Create: `tests/integration/fake-ssh-server.ts`
- Create: `tests/integration/ssh-runtime.test.ts`
- Create: `tests/integration/orchestrator.test.ts`
- Create: `examples/opencode-local/.opencode/package.json` - local plugin fixture dependencies for manual smoke testing.
- Create: `examples/opencode-local/.opencode/plugins/open-code.ts` - local loader for the plugin package during smoke testing.
- Create: `examples/opencode-local/opencode.json` - permission rules and plugin loading config for the fixture project.
- Modify: `README.md` - setup, security model, development commands, and manual OpenCode smoke test instructions.

## Task 1: Bootstrap The Package And Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `tests/unit/plugin-export.test.ts`

- [ ] **Step 1: Write the failing export smoke test**

```ts
import { describe, expect, test } from "bun:test"
import { OpenCodePlugin } from "../../src/index"

describe("package entry", () => {
  test("exports the OpenCode plugin factory", () => {
    expect(typeof OpenCodePlugin).toBe("function")
  })
})
```

- [ ] **Step 2: Run the test to verify the repo is still unimplemented**

Run: `bun test tests/unit/plugin-export.test.ts`
Expected: FAIL with a module resolution error for `../../src/index`

- [ ] **Step 3: Add the minimal package scaffold**

Run:

```bash
bun add @opencode-ai/plugin ssh2 diff env-paths keytar shescape
bun add -d typescript @types/bun testcontainers
```

Write:

```json
{
  "name": "open-code",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "dependencies": {
    "@opencode-ai/plugin": "*",
    "diff": "*",
    "env-paths": "*",
    "keytar": "*",
    "shescape": "*",
    "ssh2": "*"
  },
  "devDependencies": {
    "@types/bun": "*",
    "testcontainers": "*",
    "typescript": "*"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "examples/**/*.ts"]
}
```

```ts
export const OpenCodePlugin = async () => ({})
```

- [ ] **Step 4: Run the first green checks**

Run: `bun test tests/unit/plugin-export.test.ts`
Expected: PASS

Run: `bun run typecheck`
Expected: PASS with no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock tsconfig.json .gitignore src/index.ts tests/unit/plugin-export.test.ts
git commit -m "chore: bootstrap open code plugin package"
```

## Task 2: Lock Shared Contracts, Result Schema, And Runtime Paths

**Files:**
- Create: `src/core/contracts.ts`
- Create: `src/core/result.ts`
- Create: `src/core/paths.ts`
- Create: `tests/unit/result.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests for the canonical tool result helpers**

```ts
import { describe, expect, test } from "bun:test"
import { okResult, partialFailureResult, errorResult } from "../../src/core/result"

describe("tool result helpers", () => {
  test("builds success payloads", () => {
    expect(
      okResult({
        tool: "list_servers",
        data: [],
        execution: { attempted: true, completed: true },
        audit: { logWritten: true, snapshotStatus: "not-applicable" },
      }).status,
    ).toBe("ok")
  })

  test("builds partial-failure payloads", () => {
    expect(
      partialFailureResult({
        tool: "remote_write_file",
        message: "remote write succeeded but git commit failed",
      }).status,
    ).toBe("partial_failure")
  })

  test("builds hard-error payloads", () => {
    expect(errorResult({ tool: "remote_exec", code: "POLICY_REJECTED" }).status).toBe("error")
  })
})
```

- [ ] **Step 2: Run the test to verify the contracts do not exist yet**

Run: `bun test tests/unit/result.test.ts`
Expected: FAIL with missing module errors for `src/core/result`

- [ ] **Step 3: Implement the shared types and helpers**

Write `src/core/contracts.ts`:

```ts
export type ServerID = string

export type ApprovalDecision = "allow" | "deny"
export type PolicyDecision = "auto-allow" | "approval-required" | "reject"

export type ToolStatus = "ok" | "partial_failure" | "error"

export interface ToolPayload<TData = unknown> {
  tool: string
  server?: ServerID
  data?: TData
  message?: string
  code?: string
  execution?: {
    attempted: boolean
    completed: boolean
    exitCode?: number
    stdoutBytes?: number
    stderrBytes?: number
    stdoutTruncated?: boolean
    stderrTruncated?: boolean
  }
  audit?: {
    logWritten: boolean
    snapshotStatus: "not-applicable" | "written" | "partial-failure"
  }
}

export interface ToolResult<TData = unknown> extends ToolPayload<TData> {
  status: ToolStatus
}
```

Write `src/core/result.ts`:

```ts
import type { ToolPayload, ToolResult } from "./contracts"

export const okResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  status: "ok",
  ...payload,
})

export const partialFailureResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  status: "partial_failure",
  ...payload,
})

export const errorResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  status: "error",
  ...payload,
})
```

Populate `execution` and `audit` in every return path from the orchestrator so adapters never need tool-specific result parsing to understand whether an action ran, finished, or wrote audit artifacts.

Write `src/core/paths.ts`:

```ts
import envPaths from "env-paths"
import { mkdir } from "node:fs/promises"

const paths = envPaths("open-code", { suffix: "" })

export const runtimePaths = {
  configDir: paths.config,
  dataDir: paths.data,
  registryFile: `${paths.config}/servers.enc.json`,
  auditLogFile: `${paths.data}/audit/actions.jsonl`,
  auditRepoDir: `${paths.data}/audit/repo`,
}

export const ensureRuntimeDirs = async () => {
  await mkdir(`${runtimePaths.dataDir}/audit`, { recursive: true })
  await mkdir(runtimePaths.configDir, { recursive: true })
}
```

Modify `src/index.ts`:

```ts
export const OpenCodePlugin = async () => ({})
export * from "./core/contracts"
```

- [ ] **Step 4: Run the focused checks**

Run: `bun test tests/unit/result.test.ts`
Expected: PASS

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/core/contracts.ts src/core/result.ts src/core/paths.ts tests/unit/result.test.ts
git commit -m "feat: add shared contracts and runtime paths"
```

## Task 3: Implement The Encrypted Multi-Server Registry

**Files:**
- Create: `src/core/registry/secret-provider.ts`
- Create: `src/core/registry/keychain-provider.ts`
- Create: `src/core/registry/crypto.ts`
- Create: `src/core/registry/server-registry.ts`
- Create: `tests/unit/server-registry.test.ts`

- [ ] **Step 1: Write failing tests for encrypted persistence**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createServerRegistry } from "../../src/core/registry/server-registry"

describe("server registry", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "open-code-registry-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test("stores server records encrypted at rest", async () => {
    const registry = createServerRegistry({
      registryFile: join(tempDir, "servers.enc.json"),
      secretProvider: { getMasterKey: async () => Buffer.alloc(32, 7) },
    })

    await registry.upsert({
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    })

    const disk = await readFile(join(tempDir, "servers.enc.json"), "utf8")
    expect(disk.includes("super-secret")).toBe(false)
    expect(await registry.resolve("prod-a")).toMatchObject({ id: "prod-a", host: "10.0.0.10" })
  })
})
```

- [ ] **Step 2: Run the registry test to see the missing implementation**

Run: `bun test tests/unit/server-registry.test.ts`
Expected: FAIL with missing module errors for `server-registry`

- [ ] **Step 3: Implement registry contracts, crypto, and persistence**

Write `src/core/registry/secret-provider.ts`:

```ts
export interface SecretProvider {
  getMasterKey(): Promise<Buffer>
}
```

Write `src/core/registry/keychain-provider.ts`:

```ts
import { randomBytes } from "node:crypto"
import keytar from "keytar"
import type { SecretProvider } from "./secret-provider"

const SERVICE = "open-code"
const ACCOUNT = "registry-master-key"

export const createKeychainSecretProvider = (): SecretProvider => ({
  async getMasterKey() {
    let secret = await keytar.getPassword(SERVICE, ACCOUNT)
    if (!secret) {
      secret = randomBytes(32).toString("base64")
      await keytar.setPassword(SERVICE, ACCOUNT, secret)
    }
    return Buffer.from(secret, "base64")
  },
})
```

Write `src/core/registry/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export const encryptJson = (plaintext: string, key: Buffer) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    body: body.toString("base64"),
  }
}

export const decryptJson = (payload: { iv: string; tag: string; body: string }, key: Buffer) => {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"))
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(payload.body, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
```

Write `src/core/registry/server-registry.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { mkdir } from "node:fs/promises"
import { decryptJson, encryptJson } from "./crypto"
import type { SecretProvider } from "./secret-provider"

export const createServerRegistry = ({ registryFile, secretProvider }: { registryFile: string; secretProvider: SecretProvider }) => {
  const load = async () => {
    try {
      const raw = await readFile(registryFile, "utf8")
      const payload = JSON.parse(raw)
      const key = await secretProvider.getMasterKey()
      return JSON.parse(decryptJson(payload, key)) as any[]
    } catch (error: any) {
      if (error.code === "ENOENT") return []
      throw error
    }
  }

  const save = async (records: any[]) => {
    await mkdir(dirname(registryFile), { recursive: true })
    const key = await secretProvider.getMasterKey()
    await writeFile(registryFile, JSON.stringify(encryptJson(JSON.stringify(records), key), null, 2))
  }

  return {
    async list() {
      return load()
    },
    async resolve(id: string) {
      return (await load()).find((record) => record.id === id) ?? null
    },
    async upsert(record: any) {
      const records = await load()
      const next = records.filter((item) => item.id !== record.id)
      next.push(record)
      await save(next)
    },
  }
}
```

- [ ] **Step 4: Run the registry checks**

Run: `bun test tests/unit/server-registry.test.ts`
Expected: PASS

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/registry/secret-provider.ts src/core/registry/keychain-provider.ts src/core/registry/crypto.ts src/core/registry/server-registry.ts tests/unit/server-registry.test.ts
git commit -m "feat: add encrypted server registry"
```

## Task 4: Build The Deterministic Policy Engine

**Files:**
- Create: `src/core/policy.ts`
- Create: `tests/unit/policy.test.ts`

- [ ] **Step 1: Write failing tests for safe, approval-required, and rejected cases**

```ts
import { describe, expect, test } from "bun:test"
import { classifyRemoteExec } from "../../src/core/policy"

describe("remote exec policy", () => {
  test("auto-allows simple linux inspection commands", () => {
    expect(classifyRemoteExec("cat /etc/hosts").decision).toBe("auto-allow")
  })

  test("requires approval for middleware commands", () => {
    expect(classifyRemoteExec("kubectl get pods -A").decision).toBe("approval-required")
  })

  test("requires approval for shell composition", () => {
    expect(classifyRemoteExec("cat /etc/hosts | grep localhost").decision).toBe("approval-required")
  })
})
```

- [ ] **Step 2: Run the policy test and confirm it fails first**

Run: `bun test tests/unit/policy.test.ts`
Expected: FAIL with missing module errors for `policy`

- [ ] **Step 3: Implement the classifier**

Write `src/core/policy.ts`:

```ts
const SAFE_COMMANDS = new Set(["cat", "grep", "find", "ls", "pwd", "uname", "df", "free", "ps"])
const MIDDLEWARE_COMMANDS = new Set(["psql", "mysql", "redis-cli", "kubectl", "docker", "helm", "aws", "gcloud", "az"])
const SHELL_META = ["|", ">", "<", ";", "&&", "||", "$(", "`"]

export const classifyRemoteExec = (command: string) => {
  const trimmed = command.trim()
  if (!trimmed) return { decision: "reject", reason: "empty command" } as const
  if (SHELL_META.some((token) => trimmed.includes(token))) {
    return { decision: "approval-required", reason: "shell composition" } as const
  }

  const [binary] = trimmed.split(/\s+/)
  if (MIDDLEWARE_COMMANDS.has(binary)) {
    return { decision: "approval-required", reason: "middleware command" } as const
  }
  if (SAFE_COMMANDS.has(binary) || trimmed.startsWith("systemctl status")) {
    return { decision: "auto-allow", reason: "safe inspection command" } as const
  }
  return { decision: "approval-required", reason: "unknown command" } as const
}
```

- [ ] **Step 4: Run the policy checks**

Run: `bun test tests/unit/policy.test.ts`
Expected: PASS

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/policy.ts tests/unit/policy.test.ts
git commit -m "feat: add deterministic remote exec policy"
```

## Task 5: Add The Audit Log And Git Snapshot Engine

**Files:**
- Create: `src/core/audit/redact.ts`
- Create: `src/core/audit/log-store.ts`
- Create: `src/core/audit/git-audit-repo.ts`
- Create: `tests/unit/audit.test.ts`

- [ ] **Step 1: Write failing tests for redaction, preflight, and snapshot commits**

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createAuditLogStore } from "../../src/core/audit/log-store"
import { createGitAuditRepo } from "../../src/core/audit/git-audit-repo"

describe("audit engine", () => {
  test("redacts secret-looking values before writing JSONL entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-code-audit-"))
    const store = createAuditLogStore(join(dir, "actions.jsonl"))
    await store.preflight()
    await store.append({ command: "psql postgresql://user:secret@db/app" })
    const disk = await readFile(join(dir, "actions.jsonl"), "utf8")
    expect(disk.includes("secret")).toBe(false)
  })

  test("creates a git commit for before and after snapshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-code-git-audit-"))
    const repo = createGitAuditRepo(dir)
    await repo.preflight()
    await repo.captureChange({
      server: "prod-a",
      path: "/etc/app.conf",
      before: "port=80\n",
      after: "port=81\n",
    })
    expect(await repo.lastCommitMessage()).toContain("prod-a")
  })
})
```

- [ ] **Step 2: Run the audit test to verify it fails**

Run: `bun test tests/unit/audit.test.ts`
Expected: FAIL with missing module errors for the audit modules

- [ ] **Step 3: Implement redaction, JSONL logging, and git-backed snapshots**

Write `src/core/audit/redact.ts`:

```ts
export const redactSecrets = (value: string) =>
  value
    .replace(/:\/\/([^:\s]+):([^@\s]+)@/g, "://$1:[REDACTED]@")
    .replace(/(password|secret|token)=([^\s]+)/gi, "$1=[REDACTED]")
```

Write `src/core/audit/log-store.ts`:

```ts
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { redactSecrets } from "./redact"

export const createAuditLogStore = (file: string) => ({
  async preflight() {
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, "")
  },
  async append(entry: Record<string, unknown>) {
    const stamped = {
      timestamp: new Date().toISOString(),
      ...entry,
    }
    const json = JSON.stringify(stamped, (_key, value) =>
      typeof value === "string" ? redactSecrets(value) : value,
    )
    await appendFile(file, `${json}\n`)
  },
})
```

When wiring the orchestrator, always write log entries with at least `tool`, `server`, `timestamp`, `approvalStatus`, execution metadata, and either `changedPath` or `command` so both successful and failed actions are traceable.

Write `src/core/audit/git-audit-repo.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const run = async (cwd: string, args: string[]) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" })
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text())
}

export const createGitAuditRepo = (repoDir: string) => ({
  async preflight() {
    await mkdir(repoDir, { recursive: true })
    await run(repoDir, ["init"])
    await run(repoDir, ["config", "user.name", "Open Code"])
    await run(repoDir, ["config", "user.email", "open-code@local"])
  },
  async captureChange(input: { server: string; path: string; before: string; after: string }) {
    const base = join(repoDir, input.server, input.path.replace(/^\//, ""))
    await mkdir(dirname(base), { recursive: true })
    await writeFile(`${base}.before`, input.before)
    await writeFile(`${base}.after`, input.after)
    await run(repoDir, ["add", "."])
    await run(repoDir, ["commit", "-m", `audit: ${input.server} ${input.path}`])
  },
  async lastCommitMessage() {
    const proc = Bun.spawn(["git", "log", "-1", "--pretty=%s"], { cwd: repoDir, stdout: "pipe" })
    return (await new Response(proc.stdout).text()).trim()
  },
})
```

- [ ] **Step 4: Run the audit checks**

Run: `bun test tests/unit/audit.test.ts`
Expected: PASS

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/audit/redact.ts src/core/audit/log-store.ts src/core/audit/git-audit-repo.ts tests/unit/audit.test.ts
git commit -m "feat: add audit logging and git snapshot storage"
```

## Task 6: Implement SSH Runtime And Patch Application

**Files:**
- Create: `src/core/patch.ts`
- Create: `src/core/ssh/ssh-runtime.ts`
- Create: `tests/integration/fake-ssh-server.ts`
- Create: `tests/integration/ssh-runtime.test.ts`

- [ ] **Step 1: Write failing integration tests for exec, read, list, write, and patch**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { startFakeSshServer } from "./fake-ssh-server"
import { createSshRuntime } from "../../src/core/ssh/ssh-runtime"

describe("ssh runtime", () => {
  let server: Awaited<ReturnType<typeof startFakeSshServer>>
  let runtime: ReturnType<typeof createSshRuntime>

  beforeAll(async () => {
    server = await startFakeSshServer()
    runtime = createSshRuntime()
  })

  afterAll(async () => {
    await server.stop()
  })

  test("executes a safe remote command", async () => {
    const result = await runtime.exec(server.connection, "cat /tmp/open-code/hosts")
    expect(result.stdout).toContain("localhost")
  })

  test("writes and reads a remote file through sftp", async () => {
    await runtime.writeFile(server.connection, "/tmp/open-code/app.conf", "port=80\n")
    expect(await runtime.readFile(server.connection, "/tmp/open-code/app.conf")).toBe("port=80\n")
  })

  test("lists and stats remote paths", async () => {
    const entries = await runtime.listDir(server.connection, "/tmp/open-code", false, 50)
    expect(Array.isArray(entries)).toBe(true)
    expect(await runtime.stat(server.connection, "/tmp/open-code/hosts")).toMatchObject({ isFile: true })
  })
})
```

- [ ] **Step 2: Run the integration test and confirm it fails before the implementation exists**

Run: `bun test tests/integration/ssh-runtime.test.ts`
Expected: FAIL with missing module errors for `ssh-runtime`

- [ ] **Step 3: Implement patching and SSH/SFTP primitives**

Write `tests/integration/fake-ssh-server.ts`:

```ts
import { GenericContainer, Wait } from "testcontainers"

export const startFakeSshServer = async () => {
  const container = await new GenericContainer("linuxserver/openssh-server:latest")
    .withEnvironment({
      USER_NAME: "open",
      USER_PASSWORD: "openpass",
      PASSWORD_ACCESS: "true",
      SUDO_ACCESS: "false",
    })
    .withExposedPorts(2222)
    .withWaitStrategy(Wait.forListeningPorts())
    .start()

  await container.exec([
    "sh",
    "-lc",
    "mkdir -p /tmp/open-code && printf '127.0.0.1 localhost\n' > /tmp/open-code/hosts && printf 'port=80\n' > /tmp/open-code/app.conf",
  ])

  return {
    connection: {
      host: container.getHost(),
      port: container.getMappedPort(2222),
      username: "open",
      password: "openpass",
    },
    stop: () => container.stop(),
  }
}
```

Write `src/core/patch.ts`:

```ts
import { applyPatch } from "diff"

export const applyUnifiedPatch = (source: string, patch: string) => {
  const next = applyPatch(source, patch)
  if (next === false) throw new Error("patch apply failed")
  return next
}
```

Write `src/core/ssh/ssh-runtime.ts`:

```ts
import { Client } from "ssh2"
import { escape } from "shescape"

export const createSshRuntime = () => ({
  exec(connection: any, command: string, options: { cwd?: string; timeout?: number } = {}) {
    return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
      const client = new Client()
      const timer = options.timeout
        ? setTimeout(() => {
            client.end()
            reject(new Error(`command timed out after ${options.timeout}ms`))
          }, options.timeout)
        : null
      client
        .on("ready", () => {
          const effective = options.cwd ? `cd ${escape(options.cwd)} && ${command}` : command
          client.exec(effective, (error, stream) => {
            if (error) return reject(error)
            let stdout = ""
            let stderr = ""
            stream.on("data", (chunk) => (stdout += chunk.toString()))
            stream.stderr.on("data", (chunk) => (stderr += chunk.toString()))
            stream.on("close", (exitCode: number) => {
              if (timer) clearTimeout(timer)
              client.end()
              resolve({ stdout, stderr, exitCode })
            })
          })
        })
        .on("error", reject)
        .connect(connection)
    })
  },
  readFile(connection: any, path: string) {
    return new Promise<string>((resolve, reject) => {
      const client = new Client()
      client
        .on("ready", () => {
          client.sftp((error, sftp) => {
            if (error) return reject(error)
            const chunks: Buffer[] = []
            const stream = sftp.createReadStream(path)
            stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
            stream.on("error", (readError) => {
              client.end()
              reject(readError)
            })
            stream.on("close", () => {
              client.end()
              resolve(Buffer.concat(chunks).toString("utf8"))
            })
          })
        })
        .on("error", reject)
        .connect(connection)
    })
  },
  async writeFile(connection: any, path: string, content: string, mode?: number) {
    return new Promise<void>((resolve, reject) => {
      const client = new Client()
      client
        .on("ready", () => {
          client.sftp((error, sftp) => {
            if (error) return reject(error)
            const stream = sftp.createWriteStream(path, mode ? { mode } : undefined)
            stream.on("error", (writeError) => {
              client.end()
              reject(writeError)
            })
            stream.on("close", () => {
              client.end()
              resolve()
            })
            stream.end(content)
          })
        })
        .on("error", reject)
        .connect(connection)
    })
  },
  async listDir(connection: any, path: string, recursive = false, limit = 200) {
    if (recursive) {
      const listed = await this.exec(connection, `find ${escape(path)} | head -n ${limit}`)
      return listed.stdout.trim().split("\n").filter(Boolean)
    }

    return new Promise<any[]>((resolve, reject) => {
      const client = new Client()
      client
        .on("ready", () => {
          client.sftp((error, sftp) => {
            if (error) return reject(error)
            sftp.readdir(path, (readError, entries) => {
              client.end()
              if (readError) return reject(readError)
              resolve(entries.map((entry: any) => ({ name: entry.filename, longname: entry.longname })))
            })
          })
        })
        .on("error", reject)
        .connect(connection)
    })
  },
  stat(connection: any, path: string) {
    return new Promise<any>((resolve, reject) => {
      const client = new Client()
      client
        .on("ready", () => {
          client.sftp((error, sftp) => {
            if (error) return reject(error)
            sftp.stat(path, (statError, stats) => {
              client.end()
              if (statError) return reject(statError)
              resolve({
                size: stats.size,
                mode: stats.mode,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
              })
            })
          })
        })
        .on("error", reject)
        .connect(connection)
    })
  },
})
```

- [ ] **Step 4: Run the integration checks**

Run: `bun test tests/integration/ssh-runtime.test.ts`
Expected: PASS

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/patch.ts src/core/ssh/ssh-runtime.ts tests/integration/fake-ssh-server.ts tests/integration/ssh-runtime.test.ts
git commit -m "feat: add ssh runtime and patch application"
```

## Task 7: Build The Central Orchestrator And Enforce Audit Semantics

**Files:**
- Create: `src/core/orchestrator.ts`
- Create: `tests/integration/orchestrator.test.ts`

- [ ] **Step 1: Write failing orchestrator tests for policy enforcement and partial failures**

```ts
import { describe, expect, test } from "bun:test"
import { createOrchestrator } from "../../src/core/orchestrator"

describe("tool orchestrator", () => {
  test("auto-allows safe remote exec commands", async () => {
    const orchestrator = createOrchestrator({
      registry: { resolve: async () => ({ id: "prod-a" }) },
      policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
      ssh: {
        exec: async (_server: any, _command: string, options: any) => ({
          stdout: options.cwd,
          stderr: "",
          exitCode: options.timeout,
        }),
      },
      audit: { preflightLog: async () => {}, appendLog: async () => {} },
    })

    const result = await orchestrator.remoteExec({
      server: "prod-a",
      command: "cat /etc/hosts",
      cwd: "/etc",
      timeout: 5000,
    })
    expect(result).toMatchObject({ status: "ok", data: { stdout: "/etc", exitCode: 5000 } })
  })

  test("returns partial failure when audit snapshot finalization fails after a successful write", async () => {
    const orchestrator = createOrchestrator({
      registry: { resolve: async () => ({ id: "prod-a" }) },
      policy: { classifyRemoteExec: () => ({ decision: "approval-required", reason: "write" }) },
      ssh: {
        readFile: async () => "port=80\n",
        writeFile: async () => {},
      },
      audit: {
        preflightLog: async () => {},
        preflightSnapshots: async () => {},
        appendLog: async () => {},
        captureSnapshots: async () => {
          throw new Error("git commit failed")
        },
      },
    })

    const result = await orchestrator.remoteWriteFile({
      server: "prod-a",
      path: "/tmp/app.conf",
      content: "port=81\n",
      mode: 0o640,
    })
    expect(result.status).toBe("partial_failure")
  })

  test("keeps execution and audit scoped to the addressed server", async () => {
    const logs: any[] = []
    const orchestrator = createOrchestrator({
      registry: {
        resolve: async (id: string) => ({ id }),
      },
      policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
      ssh: {
        exec: async (server: any) => ({ stdout: server.id, stderr: "", exitCode: 0 }),
      },
      audit: {
        preflightLog: async () => {},
        appendLog: async (entry: any) => {
          logs.push(entry)
        },
      },
    })

    const first = await orchestrator.remoteExec({ server: "prod-a", command: "pwd" })
    const second = await orchestrator.remoteExec({ server: "prod-b", command: "pwd" })

    expect(first.data.stdout).toBe("prod-a")
    expect(second.data.stdout).toBe("prod-b")
    expect(logs.map((entry) => entry.server)).toEqual(["prod-a", "prod-b"])
  })

  test("keeps file writes and snapshots partitioned across two registered servers", async () => {
    const snapshots: any[] = []
    const files = new Map([
      ["prod-a:/tmp/app.conf", "port=80\n"],
      ["prod-b:/tmp/app.conf", "port=90\n"],
    ])

    const orchestrator = createOrchestrator({
      registry: {
        resolve: async (id: string) => ({ id }),
      },
      policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
      ssh: {
        readFile: async (server: any, path: string) => files.get(`${server.id}:${path}`) ?? "",
        writeFile: async (server: any, path: string, content: string) => {
          files.set(`${server.id}:${path}`, content)
        },
      },
      audit: {
        preflightLog: async () => {},
        preflightSnapshots: async () => {},
        appendLog: async () => {},
        captureSnapshots: async (entry: any) => {
          snapshots.push(entry)
        },
      },
    })

    await orchestrator.remoteWriteFile({ server: "prod-a", path: "/tmp/app.conf", content: "port=81\n" })
    await orchestrator.remoteWriteFile({ server: "prod-b", path: "/tmp/app.conf", content: "port=91\n" })

    expect(snapshots).toEqual([
      expect.objectContaining({ server: "prod-a", path: "/tmp/app.conf", before: "port=80\n", after: "port=81\n" }),
      expect.objectContaining({ server: "prod-b", path: "/tmp/app.conf", before: "port=90\n", after: "port=91\n" }),
    ])
  })
})
```

- [ ] **Step 2: Run the orchestrator test to verify the implementation is still missing**

Run: `bun test tests/integration/orchestrator.test.ts`
Expected: FAIL with missing module errors for `orchestrator`

- [ ] **Step 3: Implement the shared execution pipeline**

Write `src/core/orchestrator.ts`:

```ts
import { applyUnifiedPatch } from "./patch"
import { errorResult, okResult, partialFailureResult } from "./result"
import { classifyRemoteExec } from "./policy"
import { escape } from "shescape"

export const createOrchestrator = ({ registry, policy = { classifyRemoteExec }, ssh, audit }: any) => ({
  async listServers() {
    await audit.preflightLog()
    const servers = await registry.list()
    await audit.appendLog({ tool: "list_servers", approvalStatus: "not-required", count: servers.length })
    return okResult({ tool: "list_servers", data: servers.map(({ auth, ...server }: any) => server) })
  },

  async remoteExec(input: { server: string; command: string; cwd?: string; timeout?: number }) {
    await audit.preflightLog()
    const server = await registry.resolve(input.server)
    if (!server) {
      await audit.appendLog({ tool: "remote_exec", server: input.server, command: input.command, approvalStatus: "unknown", code: "SERVER_NOT_FOUND" })
      return errorResult({
        tool: "remote_exec",
        server: input.server,
        code: "SERVER_NOT_FOUND",
        execution: { attempted: false, completed: false },
        audit: { logWritten: true, snapshotStatus: "not-applicable" },
      })
    }

    const decision = policy.classifyRemoteExec(input.command)
    if (decision.decision === "reject") {
      await audit.appendLog({ tool: "remote_exec", server: input.server, command: input.command, approvalStatus: "not-required", code: "POLICY_REJECTED" })
      return errorResult({
        tool: "remote_exec",
        server: input.server,
        code: "POLICY_REJECTED",
        message: decision.reason,
        execution: { attempted: false, completed: false },
        audit: { logWritten: true, snapshotStatus: "not-applicable" },
      })
    }

    let executed
    try {
      executed = await ssh.exec(server, input.command, { cwd: input.cwd, timeout: input.timeout })
    } catch (error: any) {
      await audit.appendLog({ tool: "remote_exec", server: input.server, command: input.command, approvalStatus: decision.decision === "approval-required" ? "host-managed-required" : "not-required", code: "SSH_EXEC_FAILED", message: error.message })
      return errorResult({
        tool: "remote_exec",
        server: input.server,
        code: "SSH_EXEC_FAILED",
        message: error.message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: true, snapshotStatus: "not-applicable" },
      })
    }
    await audit.appendLog({
      tool: "remote_exec",
      server: input.server,
      command: input.command,
      cwd: input.cwd,
      timeout: input.timeout,
      approvalStatus: decision.decision === "approval-required" ? "host-managed-required" : "not-required",
      policyDecision: decision.decision,
      approvalRequired: decision.decision === "approval-required",
      ...executed,
    })
    return okResult({
      tool: "remote_exec",
      server: input.server,
      data: executed,
      execution: {
        attempted: true,
        completed: true,
        exitCode: executed.exitCode,
        stdoutBytes: executed.stdout.length,
        stderrBytes: executed.stderr.length,
      },
      audit: { logWritten: true, snapshotStatus: "not-applicable" },
    })
  },

  async remoteReadFile(input: { server: string; path: string; offset?: number; length?: number }) {
    await audit.preflightLog()
    const server = await registry.resolve(input.server)
    if (!server) {
      await audit.appendLog({ tool: "remote_read_file", server: input.server, path: input.path, approvalStatus: "not-required", code: "SERVER_NOT_FOUND" })
      return errorResult({ tool: "remote_read_file", server: input.server, code: "SERVER_NOT_FOUND" })
    }
    let body: string
    try {
      body = await ssh.readFile(server, input.path)
    } catch (error: any) {
      await audit.appendLog({ tool: "remote_read_file", server: input.server, path: input.path, approvalStatus: "not-required", code: "SSH_READ_FAILED", message: error.message })
      return errorResult({ tool: "remote_read_file", server: input.server, code: "SSH_READ_FAILED", message: error.message })
    }
    const sliced = body.slice(input.offset ?? 0, input.length ? (input.offset ?? 0) + input.length : undefined)
    await audit.appendLog({ tool: "remote_read_file", server: input.server, path: input.path, approvalStatus: "not-required" })
    return okResult({ tool: "remote_read_file", server: input.server, data: { content: sliced } })
  },

  async remoteWriteFile(input: { server: string; path: string; content: string; mode?: number }) {
    await audit.preflightLog()
    const server = await registry.resolve(input.server)
    if (!server) {
      await audit.appendLog({ tool: "remote_write_file", server: input.server, path: input.path, approvalStatus: "host-managed-required", code: "SERVER_NOT_FOUND" })
      return errorResult({ tool: "remote_write_file", server: input.server, code: "SERVER_NOT_FOUND" })
    }

    await audit.preflightSnapshots()
    const before = await ssh.readFile(server, input.path).catch(() => "")
    try {
      await ssh.writeFile(server, input.path, input.content, input.mode)
    } catch (error: any) {
      await audit.appendLog({ tool: "remote_write_file", server: input.server, path: input.path, approvalStatus: "host-managed-required", code: "SSH_WRITE_FAILED", message: error.message })
      return errorResult({
        tool: "remote_write_file",
        server: input.server,
        code: "SSH_WRITE_FAILED",
        message: error.message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: true, snapshotStatus: "not-applicable" },
      })
    }
    const after = await ssh.readFile(server, input.path)
    await audit.appendLog({
      tool: "remote_write_file",
      server: input.server,
      path: input.path,
      mode: input.mode,
      changedPath: input.path,
      approvalStatus: "host-managed-required",
      approvalRequired: true,
    })

    try {
      await audit.captureSnapshots({
        server: input.server,
        path: input.path,
        before,
        after,
      })
      return okResult({
        tool: "remote_write_file",
        server: input.server,
        execution: { attempted: true, completed: true },
        audit: { logWritten: true, snapshotStatus: "written" },
      })
    } catch (error: any) {
      return partialFailureResult({
        tool: "remote_write_file",
        server: input.server,
        message: `remote write succeeded but audit finalization failed: ${error.message}`,
        execution: { attempted: true, completed: true },
        audit: { logWritten: true, snapshotStatus: "partial-failure" },
      })
    }
  },

  async remotePatchFile(input: { server: string; path: string; patch: string }) {
    await audit.preflightLog()
    const server = await registry.resolve(input.server)
    if (!server) {
      await audit.appendLog({ tool: "remote_patch_file", server: input.server, path: input.path, approvalStatus: "host-managed-required", code: "SERVER_NOT_FOUND" })
      return errorResult({ tool: "remote_patch_file", server: input.server, code: "SERVER_NOT_FOUND" })
    }
    let before: string
    try {
      before = await ssh.readFile(server, input.path)
    } catch (error: any) {
      await audit.appendLog({ tool: "remote_patch_file", server: input.server, path: input.path, approvalStatus: "host-managed-required", code: "SSH_READ_FAILED", message: error.message })
      return errorResult({ tool: "remote_patch_file", server: input.server, code: "SSH_READ_FAILED", message: error.message })
    }
    let after: string
    try {
      after = applyUnifiedPatch(before, input.patch)
    } catch (error: any) {
      await audit.appendLog({ tool: "remote_patch_file", server: input.server, path: input.path, approvalStatus: "host-managed-required", code: "PATCH_APPLY_FAILED", message: error.message })
      return errorResult({
        tool: "remote_patch_file",
        server: input.server,
        code: "PATCH_APPLY_FAILED",
        message: error.message,
      })
    }
    return this.remoteWriteFile({ server: input.server, path: input.path, content: after })
  },

  async remoteListDir(input: { server: string; path: string; recursive?: boolean; limit?: number }) {
    await audit.preflightLog()
    const server = await registry.resolve(input.server)
    if (!server) {
      await audit.appendLog({ tool: "remote_list_dir", server: input.server, path: input.path, approvalStatus: "not-required", code: "SERVER_NOT_FOUND" })
      return errorResult({ tool: "remote_list_dir", server: input.server, code: "SERVER_NOT_FOUND" })
    }
    let entries
    try {
      entries = await ssh.listDir(server, input.path, input.recursive ?? false, input.limit ?? 200)
    } catch (error: any) {
      await audit.appendLog({ tool: "remote_list_dir", server: input.server, path: input.path, approvalStatus: "not-required", code: "SSH_LIST_FAILED", message: error.message })
      return errorResult({ tool: "remote_list_dir", server: input.server, code: "SSH_LIST_FAILED", message: error.message })
    }
    await audit.appendLog({ tool: "remote_list_dir", server: input.server, path: input.path, approvalStatus: "not-required" })
    return okResult({ tool: "remote_list_dir", server: input.server, data: entries })
  },

  async remoteStat(input: { server: string; path: string }) {
    await audit.preflightLog()
    const server = await registry.resolve(input.server)
    if (!server) {
      await audit.appendLog({ tool: "remote_stat", server: input.server, path: input.path, approvalStatus: "not-required", code: "SERVER_NOT_FOUND" })
      return errorResult({ tool: "remote_stat", server: input.server, code: "SERVER_NOT_FOUND" })
    }
    let stat
    try {
      stat = await ssh.stat(server, input.path)
    } catch (error: any) {
      await audit.appendLog({ tool: "remote_stat", server: input.server, path: input.path, approvalStatus: "not-required", code: "SSH_STAT_FAILED", message: error.message })
      return errorResult({ tool: "remote_stat", server: input.server, code: "SSH_STAT_FAILED", message: error.message })
    }
    await audit.appendLog({ tool: "remote_stat", server: input.server, path: input.path, approvalStatus: "not-required" })
    return okResult({ tool: "remote_stat", server: input.server, data: stat })
  },

  async remoteFind(input: { server: string; path: string; pattern: string; glob?: string; limit?: number }) {
    await audit.preflightLog()
    const server = await registry.resolve(input.server)
    if (!server) {
      await audit.appendLog({ tool: "remote_find", server: input.server, path: input.path, approvalStatus: "not-required", code: "SERVER_NOT_FOUND" })
      return errorResult({ tool: "remote_find", server: input.server, code: "SERVER_NOT_FOUND" })
    }
    const command = input.glob
      ? `find ${escape(input.path)} -name ${escape(input.glob)} | head -n ${input.limit ?? 200}`
      : `grep -R -n ${escape(input.pattern)} ${escape(input.path)} | head -n ${input.limit ?? 200}`
    let executed
    try {
      executed = await ssh.exec(server, command)
    } catch (error: any) {
      await audit.appendLog({ tool: "remote_find", server: input.server, command, approvalStatus: "not-required", code: "SSH_FIND_FAILED", message: error.message })
      return errorResult({ tool: "remote_find", server: input.server, code: "SSH_FIND_FAILED", message: error.message })
    }
    await audit.appendLog({ tool: "remote_find", server: input.server, command, approvalStatus: "not-required", ...executed })
    return okResult({ tool: "remote_find", server: input.server, data: executed })
  },
})
```

Apply the same `execution` and `audit` envelope to the other success and failure returns in this file, even when the snippet above shows only one representative branch per tool.

- [ ] **Step 4: Run the orchestrator checks**

Run: `bun test tests/integration/orchestrator.test.ts`
Expected: PASS

Run: `bun test tests/unit/*.test.ts tests/integration/ssh-runtime.test.ts tests/integration/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts tests/integration/orchestrator.test.ts
git commit -m "feat: add orchestrator for policy, audit, and ssh flows"
```

## Task 8: Add The OpenCode Adapter And Register Explicit Tools

**Files:**
- Create: `src/opencode/plugin.ts`
- Create: `tests/unit/opencode-plugin.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests for tool registration**

```ts
import { describe, expect, test } from "bun:test"
import { OpenCodePlugin } from "../../src/index"

describe("OpenCode plugin", () => {
  test("registers the expected explicit remote tools", async () => {
    const hooks = await OpenCodePlugin({
      client: { app: { log: async () => {} } },
      directory: process.cwd(),
      worktree: process.cwd(),
    } as any)

    expect(Object.keys(hooks.tool)).toEqual([
      "list_servers",
      "remote_exec",
      "remote_read_file",
      "remote_write_file",
      "remote_patch_file",
      "remote_list_dir",
      "remote_stat",
      "remote_find",
    ])
  })
})
```

- [ ] **Step 2: Run the plugin test and confirm it fails before implementation**

Run: `bun test tests/unit/opencode-plugin.test.ts`
Expected: FAIL because `OpenCodePlugin` does not yet return `tool` definitions

- [ ] **Step 3: Implement the OpenCode adapter with explicit custom tools**

Write `src/opencode/plugin.ts`:

```ts
import { tool, type Plugin } from "@opencode-ai/plugin"
import { createAuditLogStore } from "../core/audit/log-store"
import { createGitAuditRepo } from "../core/audit/git-audit-repo"
import { createOrchestrator } from "../core/orchestrator"
import { runtimePaths } from "../core/paths"
import { createKeychainSecretProvider } from "../core/registry/keychain-provider"
import { createServerRegistry } from "../core/registry/server-registry"
import { createSshRuntime } from "../core/ssh/ssh-runtime"

const createRuntimeDependencies = () => ({
  registry: createServerRegistry({
    registryFile: runtimePaths.registryFile,
    secretProvider: createKeychainSecretProvider(),
  }),
  ssh: createSshRuntime(),
  audit: {
    ...createAuditLogStore(runtimePaths.auditLogFile),
    preflightLog: async () => createAuditLogStore(runtimePaths.auditLogFile).preflight(),
    preflightSnapshots: async () => createGitAuditRepo(runtimePaths.auditRepoDir).preflight(),
    captureSnapshots: async (change: any) => createGitAuditRepo(runtimePaths.auditRepoDir).captureChange(change),
  },
})

export const OpenCodePlugin: Plugin = async (ctx) => {
  const orchestrator = createOrchestrator(createRuntimeDependencies())

  return {
    tool: {
      list_servers: tool({
        description: "List registered remote servers",
        args: {},
        async execute() {
          return orchestrator.listServers()
        },
      }),
      remote_exec: tool({
        description: "Execute a command on a named remote server over SSH",
        args: {
          server: tool.schema.string(),
          command: tool.schema.string(),
          cwd: tool.schema.string().optional(),
          timeout: tool.schema.number().optional(),
        },
        async execute(args) {
          return orchestrator.remoteExec(args)
        },
      }),
      remote_read_file: tool({
        description: "Read a file from a named remote server",
        args: {
          server: tool.schema.string(),
          path: tool.schema.string(),
          offset: tool.schema.number().optional(),
          length: tool.schema.number().optional(),
        },
        async execute(args) {
          return orchestrator.remoteReadFile(args)
        },
      }),
      remote_write_file: tool({
        description: "Write a file to a named remote server with approval and audit",
        args: {
          server: tool.schema.string(),
          path: tool.schema.string(),
          content: tool.schema.string(),
          mode: tool.schema.number().optional(),
        },
        async execute(args) {
          return orchestrator.remoteWriteFile(args)
        },
      }),
      remote_patch_file: tool({
        description: "Apply a unified diff to a remote file with approval and audit",
        args: {
          server: tool.schema.string(),
          path: tool.schema.string(),
          patch: tool.schema.string(),
        },
        async execute(args) {
          return orchestrator.remotePatchFile(args)
        },
      }),
      remote_list_dir: tool({
        description: "List a directory on a named remote server",
        args: {
          server: tool.schema.string(),
          path: tool.schema.string(),
          recursive: tool.schema.boolean().optional(),
          limit: tool.schema.number().optional(),
        },
        async execute(args) {
          return orchestrator.remoteListDir(args)
        },
      }),
      remote_stat: tool({
        description: "Get file metadata on a named remote server",
        args: {
          server: tool.schema.string(),
          path: tool.schema.string(),
        },
        async execute(args) {
          return orchestrator.remoteStat(args)
        },
      }),
      remote_find: tool({
        description: "Search a named remote server for files or content",
        args: {
          server: tool.schema.string(),
          path: tool.schema.string(),
          pattern: tool.schema.string(),
          glob: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
        },
        async execute(args) {
          return orchestrator.remoteFind(args)
        },
      }),
    },
  }
}
```

Modify `src/index.ts`:

```ts
export { OpenCodePlugin } from "./opencode/plugin"
```

- [ ] **Step 4: Run the adapter checks**

Run: `bun test tests/unit/opencode-plugin.test.ts`
Expected: PASS

Run: `bun run build`
Expected: PASS and `dist/` emitted

- [ ] **Step 5: Commit**

```bash
git add src/opencode/plugin.ts src/index.ts tests/unit/opencode-plugin.test.ts
git commit -m "feat: register explicit remote tools for opencode"
```

## Task 9: Add A Local OpenCode Smoke Fixture And Finish The Docs

**Files:**
- Create: `examples/opencode-local/.opencode/package.json`
- Create: `examples/opencode-local/.opencode/plugins/open-code.ts`
- Create: `examples/opencode-local/opencode.json`
- Modify: `README.md`

- [ ] **Step 1: Write the fixture files and README sections before manual verification**

Write `examples/opencode-local/.opencode/package.json`:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "*",
    "diff": "*",
    "env-paths": "*",
    "keytar": "*",
    "shescape": "*",
    "ssh2": "*"
  }
}
```

Write `examples/opencode-local/.opencode/plugins/open-code.ts`:

```ts
export { OpenCodePlugin as default } from "../../../../dist/index.js"
```

Write `examples/opencode-local/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "list_servers": "allow",
    "remote_read_file": "allow",
    "remote_list_dir": "allow",
    "remote_stat": "allow",
    "remote_find": "allow",
    "remote_write_file": "ask",
    "remote_patch_file": "ask",
    "remote_exec": {
      "*": "ask",
      "cat *": "allow",
      "grep *": "allow",
      "find *": "allow",
      "ls *": "allow",
      "pwd": "allow",
      "uname *": "allow",
      "df *": "allow",
      "free *": "allow",
      "ps *": "allow",
      "systemctl status *": "allow"
    }
  }
}
```

Add to `README.md`:

```md
## Development

Run `bun install`, `bun test`, and `bun run build`.
Integration tests require Docker because `tests/integration/fake-ssh-server.ts` uses `testcontainers`.

## Manual OpenCode Smoke Test

1. `bun run build`
2. `cd examples/opencode-local`
3. `opencode`
4. Ask the agent to call `list_servers`
5. Ask the agent to call `remote_exec` with `cat /etc/hosts`
6. Ask the agent to call `remote_write_file` and confirm the approval prompt appears
```

- [ ] **Step 2: Run the automated verification before the manual smoke test**

Run: `bun test`
Expected: PASS

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Run the manual OpenCode smoke test**

Run:

```bash
cd examples/opencode-local
opencode
```

Expected:
- `list_servers`, `remote_exec`, `remote_read_file`, `remote_write_file`, `remote_patch_file`, `remote_list_dir`, `remote_stat`, and `remote_find` are visible to the host.
- `remote_exec` with `cat /etc/hosts` runs without a prompt.
- `remote_write_file` triggers an approval prompt.

If `remote_exec` object permissions do not match the `command` argument as expected, stop implementation and revisit the host adapter before shipping v1.

- [ ] **Step 4: Run the final project checks**

Run: `bun test`
Expected: PASS

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add examples/opencode-local/.opencode/package.json examples/opencode-local/.opencode/plugins/open-code.ts examples/opencode-local/opencode.json README.md
git commit -m "docs: add local opencode smoke fixture"
```

## Final Verification

- Run: `bun test`
- Expected: full test suite passes
- Run: `bun run typecheck`
- Expected: no TypeScript errors
- Run: `bun run build`
- Expected: `dist/index.js` and type declarations are emitted
- Run: manual smoke test in `examples/opencode-local`
- Expected: explicit remote tools load, safe reads auto-run, writes prompt, audit files appear under runtime data paths

## Notes For The Implementer

- Keep the `opencode` adapter thin. If logic starts accumulating in `src/opencode/plugin.ts`, move it into `src/core/`.
- Do not weaken the audit contract. Logging preflight must happen before remote execution, and dedicated file writes must preflight snapshot storage before mutating remote files.
- Do not add session-wide approvals in v1.
- Prefer extending dedicated remote file tools over making `remote_exec` more permissive.
- If OpenCode host permissions behave differently from the documented expectation for custom tools, pause and reopen the design instead of silently changing the user-facing safety model.
