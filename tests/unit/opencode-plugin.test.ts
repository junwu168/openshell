import { describe, expect, mock, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { chdir, cwd } from "node:process"
import type { ToolContext } from "@opencode-ai/plugin"
import { join } from "node:path"
import { tmpdir } from "node:os"

const toolNames = [
  "list_servers",
  "remote_exec",
  "remote_read_file",
  "remote_write_file",
  "remote_patch_file",
  "remote_list_dir",
  "remote_stat",
  "remote_find",
]

const createRuntimeDependencies = () => ({
  registry: {
    list: async () => [],
    resolve: async () => ({
      id: "prod-a",
      host: "prod-a.example",
      port: 22,
      username: "open",
      auth: {
        kind: "password" as const,
        secret: "openpass",
      },
    }),
  },
  ssh: {
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    readFile: async () => "",
    writeFile: async () => {},
    listDir: async () => [],
    stat: async () => ({ size: 0, mode: 0o644, isFile: true, isDirectory: false }),
  },
  audit: {
    preflightLog: async () => {},
    appendLog: async () => {},
    preflightSnapshots: async () => {},
    captureSnapshots: async () => {},
  },
})

const createToolContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionID: "session-1",
  messageID: "message-1",
  agent: "default",
  directory: "/tmp/project",
  worktree: "/tmp/project",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
  ...overrides,
})

describe("OpenCode plugin", () => {
  test("registers explicit remote tools in plan order and serializes results", async () => {
    const { OpenCodePlugin } = await import("../../src/index")
    const { createOpenCodePlugin } = await import("../../src/opencode/plugin")
    const plugin = createOpenCodePlugin({
      ensureRuntimeDirs: async () => {},
      createRuntimeDependencies,
    })

    expect(typeof OpenCodePlugin).toBe("function")

    const hooks = await plugin({
      client: {} as never,
      project: {} as never,
      directory: "/tmp/project",
      worktree: "/tmp/project",
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    })

    expect(Object.keys(hooks.tool ?? {})).toEqual(toolNames)
    expect(typeof hooks.tool?.list_servers?.execute).toBe("function")

    const serialized = await hooks.tool?.list_servers?.execute({}, {} as never)
    expect(JSON.parse(serialized ?? "null")).toMatchObject({
      status: "ok",
      tool: "list_servers",
      data: [],
      execution: { attempted: true, completed: true },
      audit: { logWritten: true, snapshotStatus: "not-applicable" },
    })
  })

  test("builds runtime dependencies from the plugin worktree", async () => {
    const { createOpenCodePlugin } = await import("../../src/opencode/plugin")
    const tempDir = await mkdtemp(join(tmpdir(), "opencode-plugin-root-"))
    const originalCwd = cwd()
    const workspaceRoots: Array<string | undefined> = []

    try {
      chdir(tempDir)

      const plugin = createOpenCodePlugin({
        ensureRuntimeDirs: async () => {},
        createRuntimeDependencies: (workspaceRoot) => {
          workspaceRoots.push(workspaceRoot)
          return createRuntimeDependencies()
        },
      })

      await plugin({
        client: {} as never,
        project: {} as never,
        directory: "/tmp/project",
        worktree: "/tmp/project-worktree",
        serverUrl: new URL("http://localhost"),
        $: {} as never,
      })
    } finally {
      chdir(originalCwd)
      await rm(tempDir, { recursive: true, force: true })
    }

    expect(workspaceRoots).toEqual(["/tmp/project-worktree"])
  })

  test("derives runtime registry paths from the OpenCode worktree at call time", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "opencode-plugin-env-"))
    const firstConfigDir = join(tempDir, "config-a")
    const firstDataDir = join(tempDir, "data-a")
    const secondConfigDir = join(tempDir, "config-b")
    const secondDataDir = join(tempDir, "data-b")
    const registryCalls: Array<Record<string, unknown>> = []
    const runtimePathCalls: string[] = []

    try {
      mock.module("../../src/core/paths", () => ({
        createRuntimePaths: (workspaceRoot: string) => {
          runtimePathCalls.push(workspaceRoot)
          return {
            configDir: secondConfigDir,
            dataDir: secondDataDir,
            globalRegistryFile: join(secondConfigDir, "servers.json"),
            workspaceRegistryFile: join(workspaceRoot, ".open-code", "servers.json"),
            auditLogFile: join(secondDataDir, "audit", "actions.jsonl"),
            auditRepoDir: join(secondDataDir, "audit", "repo"),
          }
        },
        runtimePaths: {
          configDir: firstConfigDir,
          dataDir: firstDataDir,
          globalRegistryFile: join(firstConfigDir, "servers.json"),
          workspaceRegistryFile: join(firstConfigDir, ".open-code", "servers.json"),
          auditLogFile: join(firstDataDir, "audit", "actions.jsonl"),
          auditRepoDir: join(firstDataDir, "audit", "repo"),
        },
        workspaceRegistryFile: (workspaceRoot: string) => join(workspaceRoot, ".open-code", "servers.json"),
        ensureRuntimeDirs: async () => {},
      }))
      mock.module("../../src/core/registry/server-registry", () => ({
        createServerRegistry: (options: Record<string, unknown>) => {
          registryCalls.push(options)
          return createRuntimeDependencies().registry
        },
      }))
      mock.module("../../src/core/audit/log-store", () => ({
        createAuditLogStore: () => ({
          preflight: async () => {},
          append: async () => {},
        }),
      }))
      mock.module("../../src/core/audit/git-audit-repo", () => ({
        createGitAuditRepo: () => ({
          preflight: async () => {},
          captureChange: async () => {},
        }),
      }))
      mock.module("../../src/core/ssh/ssh-runtime", () => ({
        createSshRuntime: () => createRuntimeDependencies().ssh,
      }))

      const { createOpenCodePlugin } = await import("../../src/opencode/plugin?runtime-path-check")
      const plugin = createOpenCodePlugin({
        ensureRuntimeDirs: async () => {},
      })

      await plugin({
        client: {} as never,
        project: {} as never,
        directory: "/tmp/project",
        worktree: "/tmp/project-worktree",
        serverUrl: new URL("http://localhost"),
        $: {} as never,
      })

      expect(runtimePathCalls).toEqual(["/tmp/project-worktree"])
      expect(registryCalls).toHaveLength(1)
      expect(registryCalls[0]).toMatchObject({
        globalRegistryFile: join(secondConfigDir, "servers.json"),
        workspaceRegistryFile: "/tmp/project-worktree/.open-code/servers.json",
        workspaceRoot: "/tmp/project-worktree",
      })
    } finally {
      mock.restore()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("does not ask for approval before safe remote exec commands", async () => {
    const { createOpenCodePlugin } = await import("../../src/opencode/plugin")
    const asks: Array<Record<string, unknown>> = []
    const plugin = createOpenCodePlugin({
      ensureRuntimeDirs: async () => {},
      createRuntimeDependencies,
    })

    const hooks = await plugin({
      client: {} as never,
      project: {} as never,
      directory: "/tmp/project",
      worktree: "/tmp/project",
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    })

    await hooks.tool?.remote_exec?.execute(
      {
        server: "prod-a",
        command: "cat /etc/hosts",
      },
      createToolContext({
        ask: async (request) => {
          asks.push(request)
        },
      }),
    )

    expect(asks).toHaveLength(0)
  })

  test("asks OpenCode for bash approval before approval-required remote exec commands", async () => {
    const { createOpenCodePlugin } = await import("../../src/opencode/plugin")
    const asks: Array<Record<string, unknown>> = []
    const plugin = createOpenCodePlugin({
      ensureRuntimeDirs: async () => {},
      createRuntimeDependencies,
    })

    const hooks = await plugin({
      client: {} as never,
      project: {} as never,
      directory: "/tmp/project",
      worktree: "/tmp/project",
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    })

    await hooks.tool?.remote_exec?.execute(
      {
        server: "prod-a",
        command: "kubectl get pods",
      },
      createToolContext({
        ask: async (request) => {
          asks.push(request)
        },
      }),
    )

    expect(asks).toEqual([
      expect.objectContaining({
        permission: "bash",
        patterns: ["kubectl get pods"],
        always: [],
        metadata: expect.objectContaining({
          tool: "remote_exec",
          server: "prod-a",
          command: "kubectl get pods",
        }),
      }),
    ])
  })

  test("asks OpenCode for edit approval before remote writes", async () => {
    const { createOpenCodePlugin } = await import("../../src/opencode/plugin")
    const asks: Array<Record<string, unknown>> = []
    const plugin = createOpenCodePlugin({
      ensureRuntimeDirs: async () => {},
      createRuntimeDependencies,
    })

    const hooks = await plugin({
      client: {} as never,
      project: {} as never,
      directory: "/tmp/project",
      worktree: "/tmp/project",
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    })

    await hooks.tool?.remote_write_file?.execute(
      {
        server: "prod-a",
        path: "/tmp/open-code-smoke.txt",
        content: "hello",
      },
      createToolContext({
        ask: async (request) => {
          asks.push(request)
        },
      }),
    )

    expect(asks).toEqual([
      expect.objectContaining({
        permission: "edit",
        patterns: ["/tmp/open-code-smoke.txt"],
        always: [],
        metadata: expect.objectContaining({
          tool: "remote_write_file",
          server: "prod-a",
          path: "/tmp/open-code-smoke.txt",
        }),
      }),
    ])
  })

  test("uses built-in bash and edit permission families in the local OpenCode example config", async () => {
    const raw = await readFile(new URL("../../examples/opencode-local/opencode.json", import.meta.url), "utf8")
    const config = JSON.parse(raw)

    expect(config.permission.edit).toBe("ask")
    expect(config.permission.bash).toMatchObject({
      "*": "ask",
      "cat *": "allow",
      "systemctl status *": "allow",
    })
    expect(config.permission.remote_write_file).toBeUndefined()
    expect(config.permission.remote_exec).toBeUndefined()
  })
})
