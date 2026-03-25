import { describe, expect, mock, test } from "bun:test"

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

describe("OpenCode plugin", () => {
  test("registers explicit remote tools in plan order and serializes results", async () => {
    const orchestratorResult = {
      status: "ok",
      tool: "list_servers",
      data: [{ id: "srv-1" }],
      execution: { attempted: true, completed: true },
      audit: { logWritten: true, snapshotStatus: "not-applicable" },
    }

    mock.module("/Users/wujunming/Documents/experimental/openshell/.worktrees/opencode-v1/src/core/paths", () => ({
      runtimePaths: {
        configDir: "/tmp/open-code-config",
        dataDir: "/tmp/open-code-data",
        registryFile: "/tmp/open-code-config/servers.enc.json",
        auditLogFile: "/tmp/open-code-data/audit/actions.jsonl",
        auditRepoDir: "/tmp/open-code-data/audit/repo",
      },
      ensureRuntimeDirs: async () => {},
    }))

    mock.module(
      "/Users/wujunming/Documents/experimental/openshell/.worktrees/opencode-v1/src/core/registry/keychain-provider",
      () => ({
        createKeychainSecretProvider: () => ({
          async getMasterKey() {
            return Buffer.from("a".repeat(32))
          },
        }),
      }),
    )

    mock.module(
      "/Users/wujunming/Documents/experimental/openshell/.worktrees/opencode-v1/src/core/registry/server-registry",
      () => ({
        createServerRegistry: () => ({
          async list() {
            return []
          },
          async resolve() {
            return null
          },
          async upsert() {},
        }),
      }),
    )

    mock.module("/Users/wujunming/Documents/experimental/openshell/.worktrees/opencode-v1/src/core/audit/log-store", () => ({
      createAuditLogStore: () => ({
        async preflight() {},
        async append() {},
      }),
    }))

    mock.module("/Users/wujunming/Documents/experimental/openshell/.worktrees/opencode-v1/src/core/audit/git-audit-repo", () => ({
      createGitAuditRepo: () => ({
        async preflight() {},
        async captureChange() {},
      }),
    }))

    mock.module("/Users/wujunming/Documents/experimental/openshell/.worktrees/opencode-v1/src/core/ssh/ssh-runtime", () => ({
      createSshRuntime: () => ({
        async exec() {
          return { stdout: "", stderr: "", exitCode: 0 }
        },
        async readFile() {
          return ""
        },
        async writeFile() {},
        async listDir() {
          return []
        },
        async stat() {
          return { size: 0, mode: 0, isFile: true, isDirectory: false }
        },
      }),
    }))

    mock.module("/Users/wujunming/Documents/experimental/openshell/.worktrees/opencode-v1/src/core/orchestrator", () => ({
      createOrchestrator: () => ({
        async listServers() {
          return orchestratorResult
        },
        async remoteExec() {
          return orchestratorResult
        },
        async remoteReadFile() {
          return orchestratorResult
        },
        async remoteWriteFile() {
          return orchestratorResult
        },
        async remotePatchFile() {
          return orchestratorResult
        },
        async remoteListDir() {
          return orchestratorResult
        },
        async remoteStat() {
          return orchestratorResult
        },
        async remoteFind() {
          return orchestratorResult
        },
      }),
    }))

    const { OpenCodePlugin } = await import("/Users/wujunming/Documents/experimental/openshell/.worktrees/opencode-v1/src/index")
    const hooks = await OpenCodePlugin({
      client: {} as never,
      project: {} as never,
      directory: "/tmp/project",
      worktree: "/tmp/project",
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    })

    expect(Object.keys(hooks.tool ?? {})).toEqual(toolNames)
    expect(typeof hooks.tool?.list_servers?.execute).toBe("function")
    await expect(hooks.tool?.list_servers?.execute({}, {} as never)).resolves.toBe(JSON.stringify(orchestratorResult))
  })
})
