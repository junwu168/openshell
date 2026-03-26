import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ServerRecord } from "../../src/core/registry/server-registry"

type Scope = "global" | "workspace"

type PromptCall = {
  kind: "text" | "password" | "confirm"
  message: string
  defaultValue?: string | boolean
}

const tempDirs: string[] = []

const cleanupTempDirs = async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

afterEach(async () => {
  await cleanupTempDirs()
})

const createWorkspaceRoot = async (withWorkspaceConfig: boolean) => {
  const tempDir = await mkdtemp(join(tmpdir(), "open-code-cli-"))
  tempDirs.push(tempDir)

  const workspaceRoot = join(tempDir, "repo")
  await mkdir(join(workspaceRoot, ".open-code"), { recursive: true })
  if (withWorkspaceConfig) {
    await writeFile(join(workspaceRoot, ".open-code", "servers.json"), "[]")
  }

  return workspaceRoot
}

const mergeRecords = (records: Record<Scope, ServerRecord[]>) => {
  const resolved = new Map<string, ServerRecord & { scope: Scope; shadowingGlobal?: boolean }>()
  const order: string[] = []

  for (const record of records.global) {
    if (!resolved.has(record.id)) {
      order.push(record.id)
    }
    resolved.set(record.id, { ...record, scope: "global" })
  }

  for (const record of records.workspace) {
    if (!resolved.has(record.id)) {
      order.push(record.id)
    }
    resolved.set(record.id, {
      ...record,
      scope: "workspace",
      ...(records.global.some((item) => item.id === record.id) ? { shadowingGlobal: true } : {}),
    })
  }

  return order.map((id) => resolved.get(id)!).filter(Boolean)
}

const createInMemoryRegistry = (initial: Partial<Record<Scope, ServerRecord[]>> = {}) => {
  const state: Record<Scope, Map<string, ServerRecord>> = {
    global: new Map((initial.global ?? []).map((record) => [record.id, record] as const)),
    workspace: new Map((initial.workspace ?? []).map((record) => [record.id, record] as const)),
  }

  const resolvedList = () =>
    mergeRecords({
      global: [...state.global.values()],
      workspace: [...state.workspace.values()],
    })

  return {
    async list() {
      return resolvedList()
    },
    async resolve(id: string) {
      return resolvedList().find((record) => record.id === id) ?? null
    },
    async upsert(scopeOrRecord: Scope | ServerRecord, maybeRecord?: ServerRecord) {
      if (maybeRecord === undefined) {
        state.global.set(scopeOrRecord.id, scopeOrRecord)
        return
      }

      state[scopeOrRecord].set(maybeRecord.id, maybeRecord)
    },
    async remove(scopeOrId: Scope | string, maybeId?: string) {
      if (maybeId === undefined) {
        return state.global.delete(scopeOrId)
      }

      return state[scopeOrId].delete(maybeId)
    },
    async listRaw(scope: Scope) {
      return [...state[scope].values()]
    },
  }
}

const createPrompt = (resolve: (call: PromptCall) => string | boolean) => {
  const calls: PromptCall[] = []

  return {
    calls,
    async text(message: string, defaultValue?: string) {
      const call: PromptCall = { kind: "text", message, defaultValue }
      calls.push(call)
      const answer = resolve(call)
      return typeof answer === "string" ? answer : String(answer)
    },
    async password(message: string) {
      const call: PromptCall = { kind: "password", message }
      calls.push(call)
      const answer = resolve(call)
      return typeof answer === "string" ? answer : String(answer)
    },
    async confirm(message: string, defaultValue = false) {
      const call: PromptCall = { kind: "confirm", message, defaultValue }
      calls.push(call)
      const answer = resolve(call)
      return typeof answer === "boolean" ? answer : Boolean(answer)
    },
  }
}

const createWritable = () => {
  let buffer = ""

  return {
    write(chunk: string) {
      buffer += chunk
    },
    toString() {
      return buffer
    },
  }
}

const runCli = async (argv: string[], deps: Record<string, unknown>) => {
  const { runServerRegistryCli } = await import("../../src/cli/server-registry")
  return runServerRegistryCli(argv, deps as never)
}

describe("server registry cli", () => {
  test("defaults add to workspace scope when a workspace config exists", async () => {
    const workspaceRoot = await createWorkspaceRoot(true)
    const registry = createInMemoryRegistry()
    const prompt = createPrompt((call) => {
      if (call.kind === "text" && call.message.includes("Server id")) return "prod-a"
      if (call.kind === "text" && call.message.includes("Scope")) return ""
      if (call.kind === "text" && call.message.includes("Host")) return "10.0.0.10"
      if (call.kind === "text" && call.message.includes("Port")) return "22"
      if (call.kind === "text" && call.message.includes("Username")) return "root"
      if (call.kind === "text" && call.message.includes("Labels")) return ""
      if (call.kind === "text" && call.message.includes("Groups")) return ""
      if (call.kind === "text" && call.message.includes("Auth kind")) return "password"
      if (call.kind === "password") return "super-secret"
      return ""
    })

    await expect(
      runCli(["add"], {
        registry,
        prompt,
        stdout: createWritable(),
        stderr: createWritable(),
        workspaceRoot,
      }),
    ).resolves.toBe(0)

    expect(prompt.calls).toContainEqual(
      expect.objectContaining({
        kind: "text",
        message: expect.stringContaining("Server scope"),
        defaultValue: "workspace",
      }),
    )
    expect(await registry.listRaw("workspace")).toHaveLength(1)
    expect(await registry.listRaw("global")).toEqual([])
  })

  test("defaults add to global scope when no workspace config exists", async () => {
    const workspaceRoot = await createWorkspaceRoot(false)
    const registry = createInMemoryRegistry()
    const prompt = createPrompt((call) => {
      if (call.kind === "text" && call.message.includes("Server id")) return "prod-a"
      if (call.kind === "text" && call.message.includes("Scope")) return ""
      if (call.kind === "text" && call.message.includes("Host")) return "10.0.0.10"
      if (call.kind === "text" && call.message.includes("Port")) return "22"
      if (call.kind === "text" && call.message.includes("Username")) return "root"
      if (call.kind === "text" && call.message.includes("Labels")) return ""
      if (call.kind === "text" && call.message.includes("Groups")) return ""
      if (call.kind === "text" && call.message.includes("Auth kind")) return "password"
      if (call.kind === "password") return "super-secret"
      return ""
    })

    await expect(
      runCli(["add"], {
        registry,
        prompt,
        stdout: createWritable(),
        stderr: createWritable(),
        workspaceRoot,
      }),
    ).resolves.toBe(0)

    expect(prompt.calls).toContainEqual(
      expect.objectContaining({
        kind: "text",
        message: expect.stringContaining("Server scope"),
        defaultValue: "global",
      }),
    )
  })

  test("prompts for password auth kind and warns before storing a plain-text password", async () => {
    const workspaceRoot = await createWorkspaceRoot(true)
    const registry = createInMemoryRegistry()
    const stdout = createWritable()
    const stderr = createWritable()
    const prompt = createPrompt((call) => {
      if (call.kind === "text" && call.message.includes("Server id")) return "prod-a"
      if (call.kind === "text" && call.message.includes("Scope")) return ""
      if (call.kind === "text" && call.message.includes("Host")) return "10.0.0.10"
      if (call.kind === "text" && call.message.includes("Port")) return "22"
      if (call.kind === "text" && call.message.includes("Username")) return "root"
      if (call.kind === "text" && call.message.includes("Labels")) return ""
      if (call.kind === "text" && call.message.includes("Groups")) return ""
      if (call.kind === "text" && call.message.includes("Auth kind")) return "password"
      if (call.kind === "password") return "super-secret"
      return ""
    })

    await expect(
      runCli(["add"], {
        registry,
        prompt,
        stdout,
        stderr,
        workspaceRoot,
      }),
    ).resolves.toBe(0)

    expect(prompt.calls).toContainEqual(
      expect.objectContaining({
        kind: "text",
        message: expect.stringContaining("Auth kind"),
      }),
    )
    expect(stdout.toString()).toContain("plain-text password")
    expect(await registry.listRaw("workspace")).toEqual([
      {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        auth: { kind: "password", secret: "super-secret" },
      },
    ])
    expect(stderr.toString()).toBe("")
  })

  test("prompts for privateKey auth kind and stores the key path", async () => {
    const workspaceRoot = await createWorkspaceRoot(true)
    const registry = createInMemoryRegistry()
    const prompt = createPrompt((call) => {
      if (call.kind === "text" && call.message.includes("Server id")) return "prod-a"
      if (call.kind === "text" && call.message.includes("Scope")) return ""
      if (call.kind === "text" && call.message.includes("Host")) return "10.0.0.10"
      if (call.kind === "text" && call.message.includes("Port")) return "22"
      if (call.kind === "text" && call.message.includes("Username")) return "root"
      if (call.kind === "text" && call.message.includes("Labels")) return ""
      if (call.kind === "text" && call.message.includes("Groups")) return ""
      if (call.kind === "text" && call.message.includes("Auth kind")) return "privateKey"
      if (call.kind === "text" && call.message.includes("Private key path")) return "./keys/id_rsa"
      if (call.kind === "text" && call.message.includes("Passphrase")) return ""
      return ""
    })

    await expect(
      runCli(["add"], {
        registry,
        prompt,
        stdout: createWritable(),
        stderr: createWritable(),
        workspaceRoot,
      }),
    ).resolves.toBe(0)

    expect(prompt.calls).toContainEqual(
      expect.objectContaining({
        kind: "text",
        message: expect.stringContaining("Auth kind"),
      }),
    )
    expect(await registry.listRaw("workspace")).toEqual([
      {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        auth: {
          kind: "privateKey",
          privateKeyPath: "./keys/id_rsa",
        },
      },
    ])
  })

  test("prompts for certificate auth kind and stores both key paths", async () => {
    const workspaceRoot = await createWorkspaceRoot(true)
    const registry = createInMemoryRegistry()
    const prompt = createPrompt((call) => {
      if (call.kind === "text" && call.message.includes("Server id")) return "prod-a"
      if (call.kind === "text" && call.message.includes("Scope")) return ""
      if (call.kind === "text" && call.message.includes("Host")) return "10.0.0.10"
      if (call.kind === "text" && call.message.includes("Port")) return "22"
      if (call.kind === "text" && call.message.includes("Username")) return "root"
      if (call.kind === "text" && call.message.includes("Labels")) return ""
      if (call.kind === "text" && call.message.includes("Groups")) return ""
      if (call.kind === "text" && call.message.includes("Auth kind")) return "certificate"
      if (call.kind === "text" && call.message.includes("Certificate path")) return "./keys/client.pem"
      if (call.kind === "text" && call.message.includes("Private key path")) return "./keys/client-key.pem"
      if (call.kind === "text" && call.message.includes("Passphrase")) return "top-secret"
      return ""
    })

    await expect(
      runCli(["add"], {
        registry,
        prompt,
        stdout: createWritable(),
        stderr: createWritable(),
        workspaceRoot,
      }),
    ).resolves.toBe(0)

    expect(await registry.listRaw("workspace")).toEqual([
      {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        auth: {
          kind: "certificate",
          certificatePath: "./keys/client.pem",
          privateKeyPath: "./keys/client-key.pem",
          passphrase: "top-secret",
        },
      },
    ])
  })

  test("warns when a workspace id overrides a global id", async () => {
    const workspaceRoot = await createWorkspaceRoot(true)
    const registry = createInMemoryRegistry({
      global: [
        {
          id: "prod-a",
          host: "10.0.0.10",
          port: 22,
          username: "root",
          auth: { kind: "password", secret: "global-secret" },
        },
      ],
    })
    const stdout = createWritable()
    const prompt = createPrompt((call) => {
      if (call.kind === "text" && call.message.includes("Server id")) return "prod-a"
      if (call.kind === "confirm") return true
      if (call.kind === "text" && call.message.includes("Scope")) return "workspace"
      if (call.kind === "text" && call.message.includes("Host")) return "10.0.0.20"
      if (call.kind === "text" && call.message.includes("Port")) return "2222"
      if (call.kind === "text" && call.message.includes("Username")) return "deploy"
      if (call.kind === "text" && call.message.includes("Labels")) return ""
      if (call.kind === "text" && call.message.includes("Groups")) return ""
      if (call.kind === "text" && call.message.includes("Auth kind")) return "password"
      if (call.kind === "password") return "workspace-secret"
      return ""
    })

    await expect(
      runCli(["add"], {
        registry,
        prompt,
        stdout,
        stderr: createWritable(),
        workspaceRoot,
      }),
    ).resolves.toBe(0)

    expect(stdout.toString()).toContain("will override global entry")
    expect(await registry.listRaw("global")).toEqual([
      {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        auth: { kind: "password", secret: "global-secret" },
      },
    ])
    expect(await registry.listRaw("workspace")).toEqual([
      {
        id: "prod-a",
        host: "10.0.0.20",
        port: 2222,
        username: "deploy",
        auth: { kind: "password", secret: "workspace-secret" },
      },
    ])
  })

  test("prompts which scope to remove from when the same id exists in both configs", async () => {
    const workspaceRoot = await createWorkspaceRoot(true)
    const registry = createInMemoryRegistry({
      global: [
        {
          id: "prod-a",
          host: "10.0.0.10",
          port: 22,
          username: "root",
          auth: { kind: "password", secret: "global-secret" },
        },
      ],
      workspace: [
        {
          id: "prod-a",
          host: "10.0.0.20",
          port: 2222,
          username: "deploy",
          auth: { kind: "password", secret: "workspace-secret" },
        },
      ],
    })
    const prompt = createPrompt((call) => {
      if (call.kind === "confirm") return true
      if (call.kind === "text" && call.message.includes("Remove from which scope")) return "global"
      return ""
    })

    await expect(
      runCli(["remove", "prod-a"], {
        registry,
        prompt,
        stdout: createWritable(),
        stderr: createWritable(),
        workspaceRoot,
      }),
    ).resolves.toBe(0)

    expect(prompt.calls).toContainEqual(
      expect.objectContaining({
        kind: "text",
        message: expect.stringContaining("Remove from which scope"),
      }),
    )
    expect(await registry.listRaw("global")).toEqual([])
    expect(await registry.listRaw("workspace")).toEqual([
      {
        id: "prod-a",
        host: "10.0.0.20",
        port: 2222,
        username: "deploy",
        auth: { kind: "password", secret: "workspace-secret" },
      },
    ])
  })

  test("lists the source scope and shadowing status", async () => {
    const workspaceRoot = await createWorkspaceRoot(true)
    const registry = createInMemoryRegistry({
      global: [
        {
          id: "prod-b",
          host: "10.0.0.11",
          port: 22,
          username: "ops",
          auth: { kind: "privateKey", privateKeyPath: "/keys/prod-b" },
        },
        {
          id: "prod-a",
          host: "10.0.0.10",
          port: 22,
          username: "root",
          auth: { kind: "password", secret: "global-secret" },
        },
      ],
      workspace: [
        {
          id: "prod-a",
          host: "10.0.0.99",
          port: 2222,
          username: "deploy",
          auth: {
            kind: "certificate",
            certificatePath: "/certs/prod-a.crt",
            privateKeyPath: "/keys/prod-a",
          },
        },
      ],
    })
    const stdout = createWritable()

    await expect(
      runCli(["list"], {
        registry,
        prompt: createPrompt(() => ""),
        stdout,
        stderr: createWritable(),
        workspaceRoot,
      }),
    ).resolves.toBe(0)

    expect(stdout.toString()).toContain("SCOPE")
    expect(stdout.toString()).toContain("workspace")
    expect(stdout.toString()).toContain("global")
    expect(stdout.toString()).toContain("shadow")
  })
})
