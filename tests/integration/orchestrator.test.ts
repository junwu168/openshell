import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createOrchestrator } from "../../src/core/orchestrator"
import type { ResolvedServerRecord, ServerRecord } from "../../src/core/registry/server-registry"

const createServerRecord = (id: string): ServerRecord => ({
  id,
  host: `${id}.example`,
  port: 22,
  username: "open",
  auth: {
    kind: "password",
    secret: "openpass",
  },
})

const createResolvedServerRecord = (
  overrides: Partial<ResolvedServerRecord> & Pick<ResolvedServerRecord, "scope">,
): ResolvedServerRecord => ({
  id: "prod-a",
  host: "prod-a.example",
  port: 22,
  username: "open",
  auth: {
    kind: "password",
    secret: "openpass",
  },
  workspaceRoot: "/repo",
  ...overrides,
})

const createStubSsh = (overrides: Partial<ReturnType<typeof createStubSshBase>> = {}) => ({
  ...createStubSshBase(),
  ...overrides,
})

const createStubSshBase = () => ({
  exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  readFile: async () => "",
  writeFile: async () => {},
  listDir: async () => [] as string[] | { name: string; longname: string }[],
  stat: async () => ({ size: 0, mode: 0o644, isFile: false, isDirectory: false }),
})

const createStubAudit = (overrides: Partial<ReturnType<typeof createStubAuditBase>> = {}) => ({
  ...createStubAuditBase(),
  ...overrides,
})

const createStubAuditBase = () => ({
  preflightLog: async () => {},
  appendLog: async () => {},
  preflightSnapshots: async () => {},
  captureSnapshots: async () => {},
})

describe("tool orchestrator", () => {
  test("auto-allows safe remote exec commands", async () => {
    const logs: Record<string, unknown>[] = []
    const orchestrator = createOrchestrator({
      registry: { list: async () => [], resolve: async () => createServerRecord("prod-a") },
      policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
      ssh: createStubSsh({
        exec: async (_server, _command, options) => ({
          stdout: options?.cwd ?? "",
          stderr: "",
          exitCode: options?.timeout ?? 0,
        }),
      }),
      audit: createStubAudit({
        appendLog: async (entry) => {
          logs.push(entry)
        },
      }),
    })

    const result = await orchestrator.remoteExec({
      server: "prod-a",
      command: "cat /etc/hosts",
      cwd: "/etc",
      timeout: 5000,
    })

    expect(result).toMatchObject({ status: "ok", data: { stdout: "/etc", exitCode: 5000 } })
    expect(logs).toEqual([
      expect.objectContaining({
        tool: "remote_exec",
        server: "prod-a",
        approvalStatus: "not-required",
        policyDecision: "auto-allow",
      }),
    ])
  })

  test("executes approval-required remote exec commands with host-managed approval metadata", async () => {
    const logs: Record<string, unknown>[] = []
    const orchestrator = createOrchestrator({
      registry: { list: async () => [], resolve: async () => createServerRecord("prod-a") },
      policy: { classifyRemoteExec: () => ({ decision: "approval-required", reason: "write" }) },
      ssh: createStubSsh({
        exec: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
      }),
      audit: createStubAudit({
        appendLog: async (entry) => {
          logs.push(entry)
        },
      }),
    })

    const result = await orchestrator.remoteExec({
      server: "prod-a",
      command: "touch /tmp/file",
    })

    expect(result).toMatchObject({ status: "ok", data: { stdout: "ok", exitCode: 0 } })
    expect(logs).toEqual([
      expect.objectContaining({
        tool: "remote_exec",
        server: "prod-a",
        approvalStatus: "host-managed-required",
        approvalRequired: true,
        policyDecision: "approval-required",
      }),
    ])
  })

  test("remote_exec reads workspace-relative privateKeyPath values at runtime", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "open-code-auth-"))
    const workspaceRoot = join(tempDir, "repo")
    const keyPath = join(workspaceRoot, "keys", "id_rsa")
    const execCalls: Array<{ connection: Record<string, unknown>; command: string }> = []

    try {
      await mkdir(join(workspaceRoot, "keys"), { recursive: true })
      await writeFile(keyPath, "PRIVATE KEY")

      const orchestrator = createOrchestrator({
        registry: {
          list: async () => [],
          resolve: async () =>
            createResolvedServerRecord({
              scope: "workspace",
              workspaceRoot,
              auth: {
                kind: "privateKey",
                privateKeyPath: "keys/id_rsa",
              },
            }),
        },
        policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
        ssh: createStubSsh({
          exec: async (connection, command) => {
            execCalls.push({ connection: connection as Record<string, unknown>, command })
            return { stdout: "ok", stderr: "", exitCode: 0 }
          },
        }),
        audit: createStubAudit(),
      })

      const result = await orchestrator.remoteExec({
        server: "prod-a",
        command: "cat /etc/hosts",
      })

      expect(result).toMatchObject({ status: "ok", data: { stdout: "ok", exitCode: 0 } })
      expect(execCalls).toHaveLength(1)
      expect(execCalls[0]?.connection).toMatchObject({
        host: "prod-a.example",
        username: "open",
        privateKey: "PRIVATE KEY",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("missing privateKeyPath returns KEY_PATH_NOT_FOUND before SSH execution", async () => {
    const logs: Record<string, unknown>[] = []
    let execCalled = false
    const orchestrator = createOrchestrator({
      registry: {
        list: async () => [],
        resolve: async () =>
          createResolvedServerRecord({
            scope: "workspace",
            workspaceRoot: "/workspace",
            auth: {
              kind: "privateKey",
              privateKeyPath: "keys/missing-id_rsa",
            },
          }),
      },
      policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
      ssh: createStubSsh({
        exec: async () => {
          execCalled = true
          return { stdout: "ok", stderr: "", exitCode: 0 }
        },
      }),
      audit: createStubAudit({
        appendLog: async (entry) => {
          logs.push(entry)
        },
      }),
    })

    const result = await orchestrator.remoteExec({
      server: "prod-a",
      command: "cat /etc/hosts",
    })

    expect(execCalled).toBe(false)
    expect(result).toMatchObject({
      status: "error",
      code: "KEY_PATH_NOT_FOUND",
      execution: { attempted: false, completed: false },
      audit: { logWritten: true, snapshotStatus: "not-applicable" },
    })
    expect(logs).toEqual([
      expect.objectContaining({
        tool: "remote_exec",
        server: "prod-a",
        approvalStatus: "not-required",
        code: "KEY_PATH_NOT_FOUND",
      }),
    ])
  })

  test("missing certificatePath returns CERTIFICATE_PATH_NOT_FOUND before SSH execution", async () => {
    const logs: Record<string, unknown>[] = []
    const tempDir = await mkdtemp(join(tmpdir(), "open-code-auth-"))
    const workspaceRoot = join(tempDir, "repo")
    const privateKeyPath = join(workspaceRoot, "keys", "client-key.pem")
    let execCalled = false

    try {
      await mkdir(join(workspaceRoot, "keys"), { recursive: true })
      await writeFile(privateKeyPath, "PRIVATE KEY")

      const orchestrator = createOrchestrator({
        registry: {
          list: async () => [],
          resolve: async () =>
            createResolvedServerRecord({
              scope: "workspace",
              workspaceRoot,
              auth: {
                kind: "certificate",
                certificatePath: "certs/client-cert.pem",
                privateKeyPath: "keys/client-key.pem",
              },
            }),
        },
        policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
        ssh: createStubSsh({
          exec: async () => {
            execCalled = true
            return { stdout: "ok", stderr: "", exitCode: 0 }
          },
        }),
        audit: createStubAudit({
          appendLog: async (entry) => {
            logs.push(entry)
          },
        }),
      })

      const result = await orchestrator.remoteExec({
        server: "prod-a",
        command: "cat /etc/hosts",
      })

      expect(execCalled).toBe(false)
      expect(result).toMatchObject({
        status: "error",
        code: "CERTIFICATE_PATH_NOT_FOUND",
        execution: { attempted: false, completed: false },
        audit: { logWritten: true, snapshotStatus: "not-applicable" },
      })
      expect(logs).toEqual([
        expect.objectContaining({
          tool: "remote_exec",
          server: "prod-a",
          approvalStatus: "not-required",
          code: "CERTIFICATE_PATH_NOT_FOUND",
        }),
      ])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("directory auth paths are reported as AUTH_PATH_UNREADABLE", async () => {
    const logs: Record<string, unknown>[] = []
    const tempDir = await mkdtemp(join(tmpdir(), "open-code-auth-"))
    const workspaceRoot = join(tempDir, "repo")
    let execCalled = false

    try {
      await mkdir(workspaceRoot, { recursive: true })

      const orchestrator = createOrchestrator({
        registry: {
          list: async () => [],
          resolve: async () =>
            createResolvedServerRecord({
              scope: "workspace",
              workspaceRoot,
              auth: {
                kind: "privateKey",
                privateKeyPath: ".",
              },
            }),
        },
        policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
        ssh: createStubSsh({
          exec: async () => {
            execCalled = true
            return { stdout: "ok", stderr: "", exitCode: 0 }
          },
        }),
        audit: createStubAudit({
          appendLog: async (entry) => {
            logs.push(entry)
          },
        }),
      })

      const result = await orchestrator.remoteExec({
        server: "prod-a",
        command: "cat /etc/hosts",
      })

      expect(execCalled).toBe(false)
      expect(result).toMatchObject({
        status: "error",
        code: "AUTH_PATH_UNREADABLE",
        execution: { attempted: false, completed: false },
        audit: { logWritten: true, snapshotStatus: "not-applicable" },
      })
      expect(logs).toEqual([
        expect.objectContaining({
          tool: "remote_exec",
          server: "prod-a",
          approvalStatus: "not-required",
          code: "AUTH_PATH_UNREADABLE",
        }),
      ])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("global relative auth paths are rejected before SSH execution", async () => {
    let execCalled = false
    const orchestrator = createOrchestrator({
      registry: {
        list: async () => [],
        resolve: async () =>
          createResolvedServerRecord({
            scope: "global",
            workspaceRoot: undefined,
            auth: {
              kind: "privateKey",
              privateKeyPath: "./keys/id_rsa",
            },
          }),
      },
      policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
      ssh: createStubSsh({
        exec: async () => {
          execCalled = true
          return { stdout: "ok", stderr: "", exitCode: 0 }
        },
      }),
      audit: createStubAudit(),
    })

    const result = await orchestrator.remoteExec({
      server: "prod-a",
      command: "cat /etc/hosts",
    })

    expect(execCalled).toBe(false)
    expect(result).toMatchObject({
      status: "error",
      code: "AUTH_PATH_INVALID",
      execution: { attempted: false, completed: false },
    })
  })

  test("returns structured not-found errors for reads", async () => {
    const logs: Record<string, unknown>[] = []
    const orchestrator = createOrchestrator({
      registry: { list: async () => [], resolve: async () => null },
      ssh: createStubSsh(),
      audit: createStubAudit({
        appendLog: async (entry) => {
          logs.push(entry)
        },
      }),
    })

    const result = await orchestrator.remoteReadFile({
      server: "missing",
      path: "/etc/hosts",
    })

    expect(result).toMatchObject({
      status: "error",
      tool: "remote_read_file",
      server: "missing",
      code: "SERVER_NOT_FOUND",
      execution: { attempted: false, completed: false },
      audit: { logWritten: true, snapshotStatus: "not-applicable" },
    })
    expect(logs).toEqual([
      expect.objectContaining({
        tool: "remote_read_file",
        server: "missing",
        code: "SERVER_NOT_FOUND",
      }),
    ])
  })

  test("slices remote file reads with offset and length", async () => {
    const orchestrator = createOrchestrator({
      registry: { list: async () => [], resolve: async () => createServerRecord("prod-a") },
      ssh: createStubSsh({
        readFile: async () => "abcdef",
      }),
      audit: createStubAudit(),
    })

    const result = await orchestrator.remoteReadFile({
      server: "prod-a",
      path: "/tmp/example.txt",
      offset: 2,
      length: 2,
    })

    expect(result).toMatchObject({
      status: "ok",
      data: { content: "cd" },
    })
  })

  test("returns partial failure when audit snapshot finalization fails after a successful write", async () => {
    const orchestrator = createOrchestrator({
      registry: { list: async () => [], resolve: async () => createServerRecord("prod-a") },
      ssh: createStubSsh({
        readFile: async () => "port=80\n",
        writeFile: async () => {},
      }),
      audit: createStubAudit({
        captureSnapshots: async () => {
          throw new Error("git commit failed")
        },
      }),
    })

    const result = await orchestrator.remoteWriteFile({
      server: "prod-a",
      path: "/tmp/app.conf",
      content: "port=81\n",
      mode: 0o640,
    })

    expect(result.status).toBe("partial_failure")
    expect(result.execution).toMatchObject({ attempted: true, completed: true })
    expect(result.audit).toMatchObject({ logWritten: true, snapshotStatus: "partial-failure" })
  })

  test("keeps execution and audit scoped to the addressed server", async () => {
    const logs: Record<string, unknown>[] = []
    const orchestrator = createOrchestrator({
      registry: {
        list: async () => [],
        resolve: async (id: string) => createServerRecord(id),
      },
      policy: { classifyRemoteExec: () => ({ decision: "auto-allow", reason: "safe inspection command" }) },
      ssh: createStubSsh({
        exec: async (server) => ({ stdout: server.host, stderr: "", exitCode: 0 }),
      }),
      audit: createStubAudit({
        appendLog: async (entry) => {
          logs.push(entry)
        },
      }),
    })

    const first = await orchestrator.remoteExec({ server: "prod-a", command: "pwd" })
    const second = await orchestrator.remoteExec({ server: "prod-b", command: "pwd" })

    expect(first.data).toMatchObject({ stdout: "prod-a.example" })
    expect(second.data).toMatchObject({ stdout: "prod-b.example" })
    expect(logs.map((entry) => entry.server)).toEqual(["prod-a", "prod-b"])
  })

  test("keeps file writes and snapshots partitioned across two registered servers", async () => {
    const snapshots: Record<string, unknown>[] = []
    const files = new Map([
      ["prod-a.example:/tmp/app.conf", "port=80\n"],
      ["prod-b.example:/tmp/app.conf", "port=90\n"],
    ])

    const orchestrator = createOrchestrator({
      registry: {
        list: async () => [],
        resolve: async (id: string) => createServerRecord(id),
      },
      ssh: createStubSsh({
        readFile: async (server, path) => files.get(`${server.host}:${path}`) ?? "",
        writeFile: async (server, path, content) => {
          files.set(`${server.host}:${path}`, content)
        },
      }),
      audit: createStubAudit({
        captureSnapshots: async (entry) => {
          snapshots.push(entry)
        },
      }),
    })

    await orchestrator.remoteWriteFile({ server: "prod-a", path: "/tmp/app.conf", content: "port=81\n" })
    await orchestrator.remoteWriteFile({ server: "prod-b", path: "/tmp/app.conf", content: "port=91\n" })

    expect(snapshots).toEqual([
      expect.objectContaining({ server: "prod-a", path: "/tmp/app.conf", before: "port=80\n", after: "port=81\n" }),
      expect.objectContaining({ server: "prod-b", path: "/tmp/app.conf", before: "port=90\n", after: "port=91\n" }),
    ])
  })

  test("lists servers without exposing auth material", async () => {
    const orchestrator = createOrchestrator({
      registry: {
        list: async () => [createServerRecord("prod-a")],
        resolve: async () => createServerRecord("prod-a"),
      },
      ssh: createStubSsh(),
      audit: createStubAudit(),
    })

    const result = await orchestrator.listServers()

    expect(result.status).toBe("ok")
    expect(result.data).toEqual([
      expect.objectContaining({
        id: "prod-a",
        host: "prod-a.example",
      }),
    ])
    expect((result.data as Array<Record<string, unknown>>)[0]).not.toHaveProperty("auth")
  })

  test("builds remote find commands without reusing remote_exec policy gating", async () => {
    const logs: Record<string, unknown>[] = []
    let executedCommand = ""
    const orchestrator = createOrchestrator({
      registry: {
        list: async () => [],
        resolve: async () => createServerRecord("prod-a"),
      },
      policy: { classifyRemoteExec: () => ({ decision: "reject", reason: "should not be used here" }) },
      ssh: createStubSsh({
        exec: async (_server, command) => {
          executedCommand = command
          return { stdout: "match", stderr: "", exitCode: 0 }
        },
      }),
      audit: createStubAudit({
        appendLog: async (entry) => {
          logs.push(entry)
        },
      }),
    })

    const result = await orchestrator.remoteFind({
      server: "prod-a",
      path: "/var/log",
      pattern: "ERROR",
      limit: 5,
    })

    expect(result).toMatchObject({ status: "ok", data: { stdout: "match", exitCode: 0 } })
    expect(executedCommand).toContain("grep -R -n")
    expect(logs).toEqual([
      expect.objectContaining({
        tool: "remote_find",
        server: "prod-a",
        approvalStatus: "not-required",
      }),
    ])
  })
})
